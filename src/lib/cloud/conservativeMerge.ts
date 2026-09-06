import type { AppStore } from '@/lib/types'
import { listPersistentDomainKeys } from './persistentDomains'
import { STABLE_ID_COLLECTION_PATHS, getPathValue } from './stableIdPaths'
import {
  entityFingerprint,
  type DirtyOperation,
  type EntityConflict,
} from './dirtyOperations'
import { eqJsonStable as eqJson } from './stableJsonEq'

function cloneStore(store: AppStore): AppStore {
  return JSON.parse(JSON.stringify(store)) as AppStore
}

type IdEntity = { id: string }

function asIdArray(value: unknown, path?: string): IdEntity[] | null {
  if (!Array.isArray(value)) return null
  if (value.length === 0) return []
  if (path?.startsWith('trash.')) {
    if (
      value.every(
        (x) =>
          x &&
          typeof x === 'object' &&
          typeof (x as { deletedAt?: string }).deletedAt === 'string',
      )
    ) {
      return value.map((x) => {
        const row = x as Record<string, unknown> & { deletedAt: string }
        return { ...row, id: row.deletedAt } as IdEntity
      })
    }
    return null
  }
  if (value.every((x) => x && typeof x === 'object' && typeof (x as IdEntity).id === 'string')) {
    return value as IdEntity[]
  }
  return null
}

function stripSyntheticTrashId(entity: unknown): unknown {
  if (!entity || typeof entity !== 'object') return entity
  const rec = entity as Record<string, unknown>
  if (typeof rec.deletedAt === 'string' && rec.id === rec.deletedAt) {
    const next = { ...rec }
    delete next.id
    return next
  }
  return entity
}

function deleteBaselineOf(
  op: DirtyOperation | undefined,
  bv: IdEntity | undefined,
): unknown | undefined {
  if (op?.baselineEntity !== undefined) return op.baselineEntity
  return bv ? stripSyntheticTrashId(bv) : undefined
}

function remoteMatchesDeleteBaseline(
  remote: IdEntity | undefined,
  baselineSnap: unknown | undefined,
): boolean {
  if (!remote) return false
  if (baselineSnap === undefined) return false
  return eqJson(stripSyntheticTrashId(remote), stripSyntheticTrashId(baselineSnap))
}

function mergeIdArray(
  domain: string,
  baseline: IdEntity[] | null,
  remote: IdEntity[] | null,
  local: IdEntity[] | null,
  _deletesById: Map<string, DirtyOperation>,
  conflicts: EntityConflict[],
): IdEntity[] {
  const b = new Map((baseline ?? []).map((e) => [e.id, e]))
  const r = new Map((remote ?? []).map((e) => [e.id, e]))
  const l = new Map((local ?? []).map((e) => [e.id, e]))
  const ids = new Set([...b.keys(), ...r.keys(), ...l.keys()])
  const out: IdEntity[] = []

  for (const id of ids) {
    const bv = b.get(id)
    const rv = r.get(id)
    const lv = l.get(id)

    if (bv && rv && !lv) {
      // Absence in local is NOT a delete — keep remote. Explicit deletes applied in second pass.
      out.push(rv)
      continue
    }
    if (!bv && rv && !lv) {
      out.push(rv)
      continue
    }
    if (!bv && !rv && lv) {
      out.push(lv)
      continue
    }
    if (bv && !rv && lv) {
      // remote deleted — cloud wins
      continue
    }
    if (bv && !rv && !lv) {
      continue
    }
    if (bv && rv && lv) {
      if (eqJson(lv, bv)) {
        out.push(rv)
      } else if (eqJson(rv, bv)) {
        out.push(lv)
      } else if (eqJson(lv, rv)) {
        out.push(rv)
      } else {
        conflicts.push({
          domain,
          entityId: id,
          reason: 'concurrent_edit',
          message: `Concurrent edit on ${domain}/${id}; cloud kept`,
          pendingLocal: lv,
          cloudSnapshot: rv,
        })
        out.push(rv)
      }
      continue
    }
    if (!bv && rv && lv) {
      if (eqJson(lv, rv)) out.push(lv)
      else {
        conflicts.push({
          domain,
          entityId: id,
          reason: 'concurrent_edit',
          message: `Both created diverging ${domain}/${id}; cloud kept`,
          pendingLocal: lv,
          cloudSnapshot: rv,
        })
        out.push(rv)
      }
    }
  }
  return out
}

function getPath(store: AppStore, path: string): unknown {
  return getPathValue(store, path)
}

function stripTrashSyntheticId(value: unknown, path: string): unknown {
  if (!path.startsWith('trash.') || !Array.isArray(value)) return value
  return value.map((row) => {
    if (!row || typeof row !== 'object') return row
    const rec = { ...(row as Record<string, unknown>) }
    if (rec.id != null && rec.id === rec.deletedAt) delete rec.id
    return rec
  })
}

function setPath(store: AppStore, path: string, value: unknown): void {
  const parts = path.split('.')
  let cur: Record<string, unknown> = store as unknown as Record<string, unknown>
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!
    if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = {}
    cur = cur[p] as Record<string, unknown>
  }
  cur[parts[parts.length - 1]!] = stripTrashSyntheticId(value, path)
}

const STABLE_ARRAY_PATHS = [...STABLE_ID_COLLECTION_PATHS]

/**
 * Compare composite domains without stable-id collections (those are merged
 * entity-by-entity). Prevents false "Domain X changed on both sides; cloud kept"
 * when only id-array entities diverged and were already 3-way merged.
 */
function compositeWithoutStableArrays(domainKey: string, value: unknown): unknown {
  if (value == null || typeof value !== 'object') return value
  const clone = JSON.parse(JSON.stringify(value)) as Record<string, unknown>
  for (const path of STABLE_ARRAY_PATHS) {
    if (path === domainKey) return []
    if (!path.startsWith(`${domainKey}.`)) continue
    const rel = path.slice(domainKey.length + 1)
    const parts = rel.split('.')
    let cur: Record<string, unknown> = clone
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i]!
      if (cur[p] == null || typeof cur[p] !== 'object') {
        cur = {}
        break
      }
      cur = cur[p] as Record<string, unknown>
    }
    if (parts.length > 0 && cur && typeof cur === 'object') {
      cur[parts[parts.length - 1]!] = []
    }
  }
  return clone
}

export type ConservativeMergeResult = {
  store: AppStore
  conflicts: EntityConflict[]
  changedDomains: string[]
  /** Delete ops that completed (applied or remote already absent). */
  completedDeleteOperationIds: string[]
}

/**
 * Hybrid save merge: fresh remote base + user-only local changes.
 * Explicit deletes only when listed AND remote matches entity baseline.
 */
export function conservativeMergeForSave(
  baseline: AppStore,
  remote: AppStore,
  local: AppStore,
  explicitDeletes: DirtyOperation[],
): ConservativeMergeResult {
  const result = cloneStore(remote)
  const conflicts: EntityConflict[] = []
  const changedDomains: string[] = []
  const completedDeleteOperationIds: string[] = []

  const deletesByDomain = new Map<string, Map<string, DirtyOperation>>()
  for (const op of explicitDeletes) {
    if (op.type !== 'delete' || !op.explicit) continue
    if (!deletesByDomain.has(op.domain)) deletesByDomain.set(op.domain, new Map())
    deletesByDomain.get(op.domain)!.set(op.entityId, op)
  }

  for (const path of STABLE_ARRAY_PATHS) {
    const b = asIdArray(getPath(baseline, path), path)
    const r = asIdArray(getPath(remote, path), path)
    const l = asIdArray(getPath(local, path), path)
    if (r == null && l == null && b == null) continue
    const merged = mergeIdArray(
      path,
      b,
      r,
      l,
      deletesByDomain.get(path) ?? new Map(),
      conflicts,
    )
    if (!eqJson(merged, r ?? [])) {
      setPath(result, path, merged)
      changedDomains.push(path)
    }
  }

  for (const key of listPersistentDomainKeys(local)) {
    if (key === 'version') {
      result.version = 6
      continue
    }
    // PHASE T1: months are applied only via granular cell/structural ops in cloudSavePipeline.
    if (key === 'months') {
      continue
    }
    const bv = (baseline as Record<string, unknown>)[key]
    const lv = (local as Record<string, unknown>)[key]
    const baseRv = (remote as Record<string, unknown>)[key]

    const COMPOSITE_ROOT_KEYS = new Set([
      'warehouse',
      'sales',
      'procurement',
      'tasks',
      'access',
      'production',
      'finance',
      'counterparties',
      'finishedProducts',
      'packagingRecipes',
      'formulations',
      'technologistQc',
      'otc',
      'wastewater',
      'engineerLog',
      'workwear',
      'itOffice',
      'orgChart',
      'trash',
    ])

    if (STABLE_ARRAY_PATHS.some((p) => p === key || p.startsWith(`${key}.`))) {
      if (COMPOSITE_ROOT_KEYS.has(key)) {
        if (eqJson(lv, bv)) {
          continue
        }
        if (eqJson(baseRv, bv) && !eqJson(lv, bv)) {
          const localClone = cloneStore({ ...result, [key]: lv } as AppStore)
          for (const path of STABLE_ARRAY_PATHS.filter((p) => p === key || p.startsWith(`${key}.`))) {
            setPath(localClone, path, getPath(result, path))
          }
          ;(result as Record<string, unknown>)[key] = (localClone as Record<string, unknown>)[key]
          changedDomains.push(key)
          continue
        }
        if (!eqJson(lv, bv) && !eqJson(baseRv, bv) && !eqJson(lv, baseRv)) {
          // Entity arrays already merged into `result`. Only conflict when
          // non-array composite fields truly diverge (not own-write echo).
          const localRest = compositeWithoutStableArrays(key, lv)
          const remoteRest = compositeWithoutStableArrays(key, baseRv)
          const baseRest = compositeWithoutStableArrays(key, bv)
          if (eqJson(localRest, remoteRest) || eqJson(localRest, baseRest)) {
            // Arrays merged; local non-array matches remote or baseline — no domain banner.
            if (!eqJson(localRest, remoteRest) && eqJson(remoteRest, baseRest)) {
              const localClone = cloneStore({ ...result, [key]: lv } as AppStore)
              for (const path of STABLE_ARRAY_PATHS.filter(
                (p) => p === key || p.startsWith(`${key}.`),
              )) {
                setPath(localClone, path, getPath(result, path))
              }
              ;(result as Record<string, unknown>)[key] = (localClone as Record<string, unknown>)[
                key
              ]
            }
            changedDomains.push(key)
            continue
          }
          conflicts.push({
            domain: key,
            entityId: '*',
            reason: 'domain_conflict',
            message: `Domain ${key} changed on both sides; cloud kept`,
            pendingLocal: lv,
            cloudSnapshot: baseRv,
          })
          changedDomains.push(key)
        }
      }
      continue
    }

    if (eqJson(lv, bv)) {
      continue
    }
    if (eqJson(baseRv, bv)) {
      ;(result as Record<string, unknown>)[key] = lv
      changedDomains.push(key)
      continue
    }
    if (eqJson(lv, baseRv)) {
      continue
    }
    conflicts.push({
      domain: key,
      entityId: '*',
      reason: 'domain_conflict',
      message: `Domain ${key} changed on both sides; cloud kept`,
      pendingLocal: lv,
      cloudSnapshot: baseRv,
    })
    changedDomains.push(key)
  }

  // Second pass: apply / conflict explicit deletes using entity-level baseline only.
  for (const [domain, byId] of deletesByDomain) {
    const remoteArr = asIdArray(getPath(remote, domain), domain) ?? []
    const baselineArr = asIdArray(getPath(baseline, domain), domain) ?? []
    const resultArr = asIdArray(getPath(result, domain), domain) ?? remoteArr
    const remoteById = new Map(remoteArr.map((e) => [e.id, e]))
    const baselineById = new Map(baselineArr.map((e) => [e.id, e]))
    const next: IdEntity[] = []
    const handled = new Set<string>()

    for (const e of resultArr) {
      const delOp = byId.get(e.id)
      if (!delOp) {
        next.push(e)
        continue
      }
      handled.add(e.id)
      const rv = remoteById.get(e.id) ?? e
      const bv = baselineById.get(e.id)
      const baselineSnap = deleteBaselineOf(delOp, bv)

      if (!remoteById.has(e.id) && !bv) {
        // Appeared only via merge artifact — treat as remote_newer if present
        conflicts.push({
          operationId: delOp.operationId,
          domain,
          entityId: e.id,
          reason: 'remote_newer',
          message: `Cloud entity ${domain}/${e.id} appeared after baseline; delete blocked`,
          cloudSnapshot: rv,
          baselineSnapshot: delOp.baselineEntity,
        })
        next.push(rv)
        continue
      }

      if (!baselineSnap && !bv) {
        conflicts.push({
          operationId: delOp.operationId,
          domain,
          entityId: e.id,
          reason: 'remote_newer',
          message: `Cloud entity ${domain}/${e.id} appeared after baseline; delete blocked`,
          cloudSnapshot: rv,
        })
        next.push(rv)
        continue
      }

      if (remoteMatchesDeleteBaseline(rv, baselineSnap)) {
        // B: remote matches baseline — apply delete (omit from next)
        completedDeleteOperationIds.push(delOp.operationId)
        continue
      }

      // C: remote differs — keep remote, conflict, pending delete retained
      conflicts.push({
        operationId: delOp.operationId,
        domain,
        entityId: e.id,
        reason: 'concurrent_edit',
        message: `Cloud entity ${domain}/${e.id} changed after delete baseline; delete blocked`,
        pendingLocal: baselineSnap,
        cloudSnapshot: rv,
        baselineSnapshot: baselineSnap,
      })
      next.push(rv)
    }

    // A: remote already absent — idempotent success
    for (const [entityId, delOp] of byId) {
      if (handled.has(entityId)) continue
      if (!remoteById.has(entityId)) {
        completedDeleteOperationIds.push(delOp.operationId)
        continue
      }
      // Present on remote but missing from result — re-evaluate
      const rv = remoteById.get(entityId)!
      const bv = baselineById.get(entityId)
      const baselineSnap = deleteBaselineOf(delOp, bv)
      if (!bv && !baselineSnap) {
        conflicts.push({
          operationId: delOp.operationId,
          domain,
          entityId,
          reason: 'remote_newer',
          message: `Cloud entity ${domain}/${entityId} appeared after baseline; delete blocked`,
          cloudSnapshot: rv,
        })
        next.push(rv)
        continue
      }
      if (remoteMatchesDeleteBaseline(rv, baselineSnap)) {
        completedDeleteOperationIds.push(delOp.operationId)
      } else {
        conflicts.push({
          operationId: delOp.operationId,
          domain,
          entityId,
          reason: 'concurrent_edit',
          message: `Cloud entity ${domain}/${entityId} changed after delete baseline; delete blocked`,
          pendingLocal: baselineSnap,
          cloudSnapshot: rv,
          baselineSnapshot: baselineSnap,
        })
        next.push(rv)
      }
    }

    if (!eqJson(next, resultArr)) {
      setPath(result, domain, next)
      changedDomains.push(domain)
    }
  }

  return { store: result, conflicts, changedDomains, completedDeleteOperationIds }
}

/** @internal test helper */
export function fingerprintsEqual(a: unknown, b: unknown): boolean {
  return entityFingerprint(a) === entityFingerprint(b)
}
