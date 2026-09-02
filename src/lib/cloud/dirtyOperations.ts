import type { StoreMutationOrigin } from './storeMutationOrigin'
import { getPathValue } from './stableIdPaths'

export type DirtyOperationType = 'create' | 'update' | 'delete'

export type DirtyOperation = {
  operationId: string
  type: DirtyOperationType
  domain: string
  entityId: string
  fields: string[]
  baseRevision: number
  origin: StoreMutationOrigin
  at: string
  explicit?: boolean
  tombstoneId?: string
  actorId?: string
  actorName?: string
  /** Entity snapshot at delete intent (sync baseline / pre-delete). */
  baselineEntity?: unknown
  /** Stable fingerprint of baselineEntity for entity-level conflict checks. */
  baselineFingerprint?: string
  /** Local snapshot of entity at conflict time (for UI). */
  pendingLocal?: unknown
  cloudSnapshot?: unknown
}

export type EntityConflict = {
  operationId?: string
  domain: string
  entityId: string
  reason: 'remote_newer' | 'concurrent_edit' | 'missing_local_entity' | 'domain_conflict'
  message: string
  pendingLocal?: unknown
  cloudSnapshot?: unknown
  baselineSnapshot?: unknown
}

let opSeq = 0

export function nextOperationId(): string {
  opSeq += 1
  return `op-${Date.now()}-${opSeq}`
}

export function entityFingerprint(entity: unknown): string {
  try {
    return JSON.stringify(entity ?? null)
  } catch {
    return String(entity)
  }
}

export function findStableEntity(
  store: unknown,
  domain: string,
  entityId: string,
): unknown | undefined {
  const arr = getPathValue(store, domain)
  if (!Array.isArray(arr)) return undefined
  if (domain.startsWith('trash.')) {
    return arr.find(
      (x) =>
        x &&
        typeof x === 'object' &&
        String((x as { deletedAt?: string }).deletedAt ?? '') === entityId,
    )
  }
  return arr.find(
    (x) => x && typeof x === 'object' && String((x as { id?: string }).id ?? '') === entityId,
  )
}

export class DirtyOperationTracker {
  private pending: DirtyOperation[] = []
  private conflicts: EntityConflict[] = []
  private baseRevision = 0
  private baselineStore: unknown | null = null
  private listeners = new Set<() => void>()

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    fn()
    return () => this.listeners.delete(fn)
  }

  private emit(): void {
    for (const fn of this.listeners) fn()
  }

  setBaseRevision(revision: number): void {
    if (Number.isFinite(revision) && revision > 0) this.baseRevision = revision
  }

  getBaseRevision(): number {
    return this.baseRevision
  }

  /** Last successfully synced cloud store — used for delete baseline snapshots. */
  setBaselineStore(store: unknown | null): void {
    this.baselineStore = store
  }

  getBaselineStore(): unknown | null {
    return this.baselineStore
  }

  enqueue(ops: DirtyOperation[]): void {
    if (!ops.length) return
    for (const op of ops) {
      const idx = this.pending.findIndex(
        (p) => p.domain === op.domain && p.entityId === op.entityId && p.type === op.type,
      )
      if (idx >= 0) this.pending[idx] = { ...this.pending[idx], ...op }
      else this.pending.push(op)
    }
    this.emit()
  }

  getPending(): DirtyOperation[] {
    return [...this.pending]
  }

  hasPendingUserOperations(): boolean {
    return this.pending.some((op) => op.origin === 'user')
  }

  /** Drop only ops that were successfully persisted — never wipe the rest. */
  acknowledgePersisted(operationIds: string[]): void {
    if (!operationIds.length) return
    const done = new Set(operationIds)
    this.pending = this.pending.filter((op) => !done.has(op.operationId))
    this.emit()
  }

  setConflicts(conflicts: EntityConflict[]): void {
    this.conflicts = conflicts
    this.emit()
  }

  getConflicts(): EntityConflict[] {
    return [...this.conflicts]
  }

  clearConflicts(): void {
    this.conflicts = []
    this.emit()
  }

  /** Cancel pending ops that match current conflicts (e.g. accept remote). */
  discardConflictingPending(): string[] {
    if (!this.conflicts.length) return []
    const keys = new Set(this.conflicts.map((c) => `${c.domain}::${c.entityId}`))
    const dropped: string[] = []
    this.pending = this.pending.filter((op) => {
      const key = `${op.domain}::${op.entityId}`
      if (keys.has(key)) {
        dropped.push(op.operationId)
        return false
      }
      return true
    })
    this.conflicts = []
    this.emit()
    return dropped
  }

  /** Explicit user cancel of pending ops (not used on pull). */
  discardAllPending(): void {
    this.pending = []
    this.conflicts = []
    this.emit()
  }

  /** Test helper only. */
  clearAll(): void {
    this.discardAllPending()
    this.baselineStore = null
  }
}

export const cloudDirtyTracker = new DirtyOperationTracker()

export function recordExplicitDelete(input: {
  domain: string
  entityId: string
  baseRevision?: number
  actorId?: string
  actorName?: string
  origin?: StoreMutationOrigin
  baselineEntity?: unknown
}): void {
  const fromBaseline =
    input.baselineEntity !== undefined
      ? input.baselineEntity
      : findStableEntity(cloudDirtyTracker.getBaselineStore(), input.domain, input.entityId)
  cloudDirtyTracker.enqueue([
    {
      operationId: nextOperationId(),
      type: 'delete',
      domain: input.domain,
      entityId: input.entityId,
      fields: ['*'],
      baseRevision: input.baseRevision ?? cloudDirtyTracker.getBaseRevision(),
      origin: input.origin ?? 'user',
      at: new Date().toISOString(),
      explicit: true,
      tombstoneId: `del-${input.domain}-${input.entityId}-${Date.now()}`,
      actorId: input.actorId,
      actorName: input.actorName,
      baselineEntity: fromBaseline,
      baselineFingerprint:
        fromBaseline !== undefined ? entityFingerprint(fromBaseline) : undefined,
    },
  ])
}

export function resetCloudDirtyTracker(): void {
  cloudDirtyTracker.discardAllPending()
  cloudDirtyTracker.setBaseRevision(0)
  cloudDirtyTracker.setBaselineStore(null)
  opSeq = 0
}
