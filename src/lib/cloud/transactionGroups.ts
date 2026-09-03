/**
 * PHASE W0.6 — explicit atomic transaction groups for warehouse cloud ops.
 * Groups are created only via StoreUpdateMeta (never ambient/time-based).
 */
import type { AppStore } from '@/lib/types'
import {
  entityFingerprint,
  findStableEntity,
  type DirtyOperation,
  type EntityConflict,
} from './dirtyOperations'
import { getPathValue, STABLE_ID_COLLECTION_PATHS } from './stableIdPaths'

export type WarehouseTransactionGroupKind =
  | 'opening_inventory'
  | 'production_request'
  | 'warehouse_transfer'
  | 'batch_mix'
  | 'cancel_transfer_pair'
  | 'document_cancel'
  | 'production_reservation'
  | 'production_reservation_adjustment'
  | 'production_reservation_release'
  | 'production_reservation_reallocation'

export type TransactionGroupMeta = {
  transactionGroupId: string
  transactionGroupKind: string
  transactionGroupLabel?: string
  atomic: true
}

/** Deterministic group id: warehouse::{kind}::{sourceId}::{revision} */
export function warehouseTransactionGroupId(input: {
  kind: WarehouseTransactionGroupKind | string
  sourceId: string
  revision?: string
}): string {
  const rev = (input.revision ?? '1').trim() || '1'
  return `warehouse::${input.kind}::${input.sourceId}::${rev}`
}

export function isAtomicGroupOp(op: DirtyOperation): boolean {
  return op.atomic === true && Boolean(op.transactionGroupId)
}

export function partitionDirtyOperations(ops: DirtyOperation[]): {
  ungrouped: DirtyOperation[]
  groups: Map<string, DirtyOperation[]>
} {
  const ungrouped: DirtyOperation[] = []
  const groups = new Map<string, DirtyOperation[]>()
  for (const op of ops) {
    if (!isAtomicGroupOp(op) || !op.transactionGroupId) {
      ungrouped.push(op)
      continue
    }
    const list = groups.get(op.transactionGroupId) ?? []
    list.push(op)
    groups.set(op.transactionGroupId, list)
  }
  return { ungrouped, groups }
}

export function stampOpsWithTransactionGroup(
  ops: DirtyOperation[],
  meta: TransactionGroupMeta,
  nextStore: unknown,
  prevStore: unknown,
): DirtyOperation[] {
  return ops.map((op) => {
    const pendingLocal =
      op.entityId === '*'
        ? getPathValue(nextStore, op.domain)
        : findStableEntity(nextStore, op.domain, op.entityId)
    const baselineEntity =
      op.type === 'create'
        ? undefined
        : op.entityId === '*'
          ? getPathValue(prevStore, op.domain)
          : findStableEntity(prevStore, op.domain, op.entityId)
    return {
      ...op,
      transactionGroupId: meta.transactionGroupId,
      transactionGroupKind: meta.transactionGroupKind,
      transactionGroupLabel: meta.transactionGroupLabel,
      atomic: true as const,
      pendingLocal: pendingLocal ?? op.pendingLocal,
      baselineEntity: baselineEntity !== undefined ? baselineEntity : op.baselineEntity,
      baselineFingerprint:
        baselineEntity !== undefined
          ? entityFingerprint(baselineEntity)
          : op.baselineFingerprint,
    }
  })
}

/** Fail-closed: if caller acks a subset of an atomic group, drop the whole group from the ack set. */
export function sanitizeAcknowledgeIds(
  pending: DirtyOperation[],
  operationIds: string[],
): { safeIds: string[]; blockedGroupIds: string[]; diagnostic?: string } {
  const done = new Set(operationIds)
  const byGroup = new Map<string, DirtyOperation[]>()
  for (const op of pending) {
    if (!isAtomicGroupOp(op) || !op.transactionGroupId) continue
    const list = byGroup.get(op.transactionGroupId) ?? []
    list.push(op)
    byGroup.set(op.transactionGroupId, list)
  }

  const blockedGroupIds: string[] = []
  for (const [gid, members] of byGroup) {
    const memberIds = members.map((m) => m.operationId)
    const hit = memberIds.filter((id) => done.has(id))
    if (hit.length > 0 && hit.length < memberIds.length) {
      blockedGroupIds.push(gid)
      for (const id of memberIds) done.delete(id)
    }
  }

  const diagnostic =
    blockedGroupIds.length > 0
      ? `atomic_group_ack_rejected: partial acknowledge blocked for ${blockedGroupIds.join(',')}`
      : undefined

  return { safeIds: [...done], blockedGroupIds, diagnostic }
}

export function entityKey(domain: string, entityId: string): string {
  return `${domain}::${entityId}`
}

export function groupEntityKeys(ops: DirtyOperation[]): Set<string> {
  return new Set(ops.map((o) => entityKey(o.domain, o.entityId)))
}

function cloneStore(store: AppStore): AppStore {
  return JSON.parse(JSON.stringify(store)) as AppStore
}

function asIdArray(value: unknown): Array<{ id: string }> | null {
  if (!Array.isArray(value)) return null
  if (value.length === 0) return []
  if (value.every((x) => x && typeof x === 'object' && typeof (x as { id?: string }).id === 'string')) {
    return value as Array<{ id: string }>
  }
  return null
}

function setPath(store: AppStore, path: string, value: unknown): void {
  const parts = path.split('.')
  let cur: Record<string, unknown> = store as unknown as Record<string, unknown>
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!
    if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = {}
    cur = cur[p] as Record<string, unknown>
  }
  cur[parts[parts.length - 1]!] = value
}

function upsertEntity(store: AppStore, domain: string, entity: { id: string }): void {
  const arr = asIdArray(getPathValue(store, domain)) ?? []
  const idx = arr.findIndex((e) => e.id === entity.id)
  const next = [...arr]
  if (idx >= 0) next[idx] = entity
  else next.push(entity)
  setPath(store, domain, next)
}

function removeEntity(store: AppStore, domain: string, entityId: string): void {
  const arr = asIdArray(getPathValue(store, domain)) ?? []
  setPath(store, domain, arr.filter((e) => e.id !== entityId))
}

/**
 * Build a local view that only carries entities/domains touched by `ops`
 * (everything else equals `base`, typically remote or accumulated result).
 */
export function buildSparseLocalForOps(
  base: AppStore,
  fullLocal: AppStore,
  ops: DirtyOperation[],
): AppStore {
  const out = cloneStore(base)
  const compositeDomains = new Set(
    ops.filter((o) => o.entityId === '*').map((o) => o.domain),
  )

  for (const domain of compositeDomains) {
    const localDomain = (fullLocal as Record<string, unknown>)[domain]
    if (localDomain == null || typeof localDomain !== 'object') continue
    ;(out as Record<string, unknown>)[domain] = JSON.parse(JSON.stringify(localDomain))
    // Restore stable arrays from base, then re-apply entity ops below.
    for (const path of STABLE_ID_COLLECTION_PATHS) {
      if (path === domain || path.startsWith(`${domain}.`)) {
        setPath(out, path, getPathValue(base, path) ?? [])
      }
    }
  }

  for (const op of ops) {
    if (op.entityId === '*') continue
    if (op.type === 'delete') {
      removeEntity(out, op.domain, op.entityId)
      continue
    }
    const ent = findStableEntity(fullLocal, op.domain, op.entityId) as { id: string } | undefined
    if (ent) {
      upsertEntity(out, op.domain, ent)
      continue
    }
    // Non-collection domains (e.g. settings with entityId 'settings'): copy whole path from local.
    const localVal = getPathValue(fullLocal, op.domain)
    if (localVal !== undefined) {
      setPath(out, op.domain, JSON.parse(JSON.stringify(localVal)))
    }
  }

  return out
}

export function atomicGroupBlockedConflicts(
  groupOps: DirtyOperation[],
  rootConflicts: EntityConflict[],
): EntityConflict[] {
  const out: EntityConflict[] = [...rootConflicts]
  const conflictedKeys = new Set(rootConflicts.map((c) => entityKey(c.domain, c.entityId)))
  const kind = groupOps[0]?.transactionGroupKind ?? 'warehouse'
  const gid = groupOps[0]?.transactionGroupId ?? ''
  const label = groupOps[0]?.transactionGroupLabel

  for (const op of groupOps) {
    const key = entityKey(op.domain, op.entityId)
    if (conflictedKeys.has(key)) continue
    // Also skip if domain-level * conflict already covers
    if (conflictedKeys.has(entityKey(op.domain, '*'))) continue
    out.push({
      operationId: op.operationId,
      domain: op.domain,
      entityId: op.entityId,
      reason: 'atomic_group_conflict',
      message:
        label ||
        `Связанная складская операция (${kind}) не сохранена целиком из-за конфликта. Данные в облаке не изменены.`,
      pendingLocal: op.pendingLocal,
      transactionGroupId: gid || undefined,
      transactionGroupKind: kind,
    })
  }

  // Ensure root conflicts carry group context
  for (const c of out) {
    if (c.reason === 'atomic_group_conflict') continue
    if (!groupOps.some((o) => o.domain === c.domain && (o.entityId === c.entityId || o.entityId === '*'))) {
      continue
    }
    c.message = `${c.message} [group ${gid}]`
  }
  return out
}

export type GroupClassifyKind =
  | 'idempotent'
  | 'recoverable'
  | 'conflict'
  | 'partial_remote_group'
  | 'unsupported'

function eqJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Overlay a successfully merged group onto an accumulated save store (entity-level). */
export function overlayAtomicGroupOntoStore(
  target: AppStore,
  groupMerged: AppStore,
  groupOps: DirtyOperation[],
): void {
  for (const op of groupOps) {
    if (op.entityId === '*') {
      const src = getPathValue(groupMerged, op.domain)
      const dst = getPathValue(target, op.domain)
      if (src == null) continue
      if (dst == null || typeof dst !== 'object' || typeof src !== 'object') {
        setPath(target, op.domain, JSON.parse(JSON.stringify(src)))
        continue
      }
      // Copy non-array scalar/object fields; stable id arrays handled by entity ops.
      const next = { ...(dst as Record<string, unknown>) }
      for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
        if (v === undefined) continue
        if (Array.isArray(v) && v.every((x) => x && typeof x === 'object' && 'id' in (x as object))) {
          continue
        }
        next[k] = JSON.parse(JSON.stringify(v))
      }
      setPath(target, op.domain, next)
      continue
    }
    if (op.type === 'delete') {
      removeEntity(target, op.domain, op.entityId)
      continue
    }
    const ent = findStableEntity(groupMerged, op.domain, op.entityId) as { id: string } | undefined
    if (ent) upsertEntity(target, op.domain, ent)
  }
}

export function expandOperationIdsToWholeGroups(
  pending: DirtyOperation[],
  operationIds: string[],
): string[] {
  const done = new Set(operationIds)
  const { groups } = partitionDirtyOperations(pending)
  for (const members of groups.values()) {
    if (members.some((m) => done.has(m.operationId))) {
      for (const m of members) done.add(m.operationId)
    }
  }
  return [...done]
}

export function formatAtomicGroupConflictDetail(conflict: EntityConflict): string {
  const kind = conflict.transactionGroupKind ?? 'warehouse'
  const base =
    conflict.message ||
    'Связанная складская операция не сохранена целиком из-за конфликта. Данные в облаке не изменены.'
  const obj =
    conflict.entityId && conflict.entityId !== '*'
      ? ` · конфликт: ${conflict.domain}/${conflict.entityId}`
      : conflict.domain
        ? ` · конфликт: ${conflict.domain}`
        : ''
  return `${base} · тип: ${kind}${obj}`
}

export function classifyAtomicGroupAgainstRemote(
  groupOps: DirtyOperation[],
  remote: AppStore,
): GroupClassifyKind {
  if (!groupOps.length) return 'unsupported'
  if (groupOps.some((o) => !isAtomicGroupOp(o))) return 'unsupported'

  let nextCount = 0
  let baselineCount = 0
  let conflictCount = 0

  for (const op of groupOps) {
    if (op.entityId === '*') {
      const remoteVal = getPathValue(remote, op.domain)
      if (op.pendingLocal !== undefined && eqJson(remoteVal, op.pendingLocal)) {
        nextCount++
        continue
      }
      if (
        op.baselineEntity !== undefined &&
        eqJson(remoteVal, op.baselineEntity)
      ) {
        baselineCount++
        continue
      }
      if (op.baselineEntity === undefined && remoteVal == null) {
        baselineCount++
        continue
      }
      conflictCount++
      continue
    }

    const remoteEnt = findStableEntity(remote, op.domain, op.entityId)
    if (op.type === 'delete') {
      if (!remoteEnt) {
        nextCount++ // already absent
        continue
      }
      if (
        op.baselineEntity !== undefined &&
        eqJson(remoteEnt, op.baselineEntity)
      ) {
        baselineCount++
        continue
      }
      conflictCount++
      continue
    }

    if (op.pendingLocal !== undefined && remoteEnt && eqJson(remoteEnt, op.pendingLocal)) {
      nextCount++
      continue
    }
    if (!remoteEnt) {
      // create not yet on remote
      if (op.type === 'create') {
        baselineCount++
        continue
      }
      conflictCount++
      continue
    }
    if (op.baselineEntity !== undefined && eqJson(remoteEnt, op.baselineEntity)) {
      baselineCount++
      continue
    }
    conflictCount++
  }

  if (conflictCount > 0) return 'conflict'
  if (nextCount > 0 && baselineCount > 0) return 'partial_remote_group'
  if (nextCount === groupOps.length) return 'idempotent'
  if (baselineCount === groupOps.length) return 'recoverable'
  return 'conflict'
}
