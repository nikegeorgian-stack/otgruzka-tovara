import type { StoreMutationOrigin } from './storeMutationOrigin'
import { getPathValue } from './stableIdPaths'
import { sanitizeAcknowledgeIds, expandOperationIdsToWholeGroups } from './transactionGroups'

export type DirtyOperationType = 'create' | 'update' | 'delete'

/** PHASE T1 — client-only timesheet cell patch (not a SQL column). */
export type TimesheetCellLayer =
  | 'plan'
  | 'fact'
  | 'comment'
  | 'factExtraHours'
  | 'factHoursOverride'

export type TimesheetCellValue = string | number | null

export type TimesheetCellPatch = {
  monthKey: string
  employeeId: string
  rowId: string
  dateKey: string
  layer: TimesheetCellLayer
  baselineValue: TimesheetCellValue
  nextValue: TimesheetCellValue
  explicitClear: boolean
}

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
  /** PHASE T1 — granular timesheet cell patch (client-only). */
  timesheetCell?: TimesheetCellPatch
  /** PHASE W0.6 — explicit atomic warehouse transaction group. */
  transactionGroupId?: string
  transactionGroupKind?: string
  transactionGroupLabel?: string
  atomic?: boolean
}

export type EntityConflict = {
  operationId?: string
  domain: string
  entityId: string
  reason:
    | 'remote_newer'
    | 'concurrent_edit'
    | 'missing_local_entity'
    | 'domain_conflict'
    | 'atomic_group_conflict'
  message: string
  pendingLocal?: unknown
  cloudSnapshot?: unknown
  baselineSnapshot?: unknown
  transactionGroupId?: string
  transactionGroupKind?: string
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
  /** PHASE T2 — optional durable persist after coalesce (async). */
  private journalPersist:
    | ((ops: DirtyOperation[]) => void | Promise<void>)
    | null = null
  private journalAck: ((ids: string[]) => void | Promise<void>) | null = null
  private journalDiscard: ((ids: string[]) => void | Promise<void>) | null = null
  private journalFlushChain: Promise<void> = Promise.resolve()

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    fn()
    return () => this.listeners.delete(fn)
  }

  private emit(): void {
    for (const fn of this.listeners) fn()
  }

  /** Wire durable journal (PHASE T2). */
  setJournalHooks(hooks: {
    persist?: ((ops: DirtyOperation[]) => void | Promise<void>) | null
    acknowledge?: ((ids: string[]) => void | Promise<void>) | null
    discard?: ((ids: string[]) => void | Promise<void>) | null
  }): void {
    this.journalPersist = hooks.persist ?? null
    this.journalAck = hooks.acknowledge ?? null
    this.journalDiscard = hooks.discard ?? null
  }

  /** Test helper: wait for queued journal writes. */
  awaitJournalFlushes(): Promise<void> {
    return this.journalFlushChain
  }

  private queueJournal(task: () => void | Promise<void>): void {
    this.journalFlushChain = this.journalFlushChain.then(() => Promise.resolve(task())).catch(() => {
      /* degrade handled by journal controller */
    })
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
    const touched: DirtyOperation[] = []
    for (const op of ops) {
      const idx = this.pending.findIndex((p) => {
        if (p.domain !== op.domain || p.entityId !== op.entityId) return false
        // Cell ops coalesce across update/delete (set → clear).
        if (p.timesheetCell && op.timesheetCell) return true
        return p.type === op.type
      })
      if (idx >= 0) {
        const prev = this.pending[idx]!
        if (prev.timesheetCell && op.timesheetCell) {
          // Keep earliest baseline; take latest next value.
          this.pending[idx] = {
            ...op,
            operationId: prev.operationId,
            timesheetCell: {
              ...op.timesheetCell,
              baselineValue: prev.timesheetCell.baselineValue,
              explicitClear:
                op.timesheetCell.explicitClear ||
                op.timesheetCell.nextValue === null ||
                op.timesheetCell.nextValue === '',
            },
            baselineEntity: prev.timesheetCell.baselineValue,
            baselineFingerprint: entityFingerprint(prev.timesheetCell.baselineValue),
            pendingLocal: op.timesheetCell.nextValue,
          }
        } else {
          this.pending[idx] = { ...prev, ...op }
        }
        touched.push(this.pending[idx]!)
      } else {
        this.pending.push(op)
        touched.push(op)
      }
    }
    this.emit()
    if (this.journalPersist && touched.length) {
      const snapshot = touched.map((o) => ({ ...o, timesheetCell: o.timesheetCell ? { ...o.timesheetCell } : undefined }))
      const persist = this.journalPersist
      this.queueJournal(() => persist(snapshot))
    }
  }

  getPending(): DirtyOperation[] {
    return [...this.pending]
  }

  hasPendingUserOperations(): boolean {
    return this.pending.some((op) => op.origin === 'user')
  }

  /** Drop only ops that were successfully persisted — never wipe the rest.
   * PHASE W0.6: atomic groups are all-or-nothing — subset ack is rejected. */
  acknowledgePersisted(operationIds: string[]): void {
    if (!operationIds.length) return
    const { safeIds, diagnostic } = sanitizeAcknowledgeIds(this.pending, operationIds)
    if (diagnostic) {
      console.error('[cloudDirtyTracker]', diagnostic)
      this.conflicts = [
        ...this.conflicts,
        {
          domain: 'warehouse',
          entityId: '*',
          reason: 'atomic_group_conflict',
          message: diagnostic,
        },
      ]
    }
    if (!safeIds.length) {
      this.emit()
      return
    }
    const done = new Set(safeIds)
    this.pending = this.pending.filter((op) => !done.has(op.operationId))
    this.emit()
    if (this.journalAck) {
      const ack = this.journalAck
      this.queueJournal(() => ack(safeIds))
    }
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

  /** Cancel pending ops that match current conflicts (e.g. accept remote).
   * PHASE W0.6: discarding any member drops the whole atomic group. */
  discardConflictingPending(): string[] {
    if (!this.conflicts.length) return []
    const byOpId = new Set(
      this.conflicts.map((c) => c.operationId).filter((id): id is string => Boolean(id)),
    )
    const keys = new Set(this.conflicts.map((c) => `${c.domain}::${c.entityId}`))
    const seedIds: string[] = []
    for (const op of this.pending) {
      if (byOpId.has(op.operationId) || keys.has(`${op.domain}::${op.entityId}`)) {
        seedIds.push(op.operationId)
      }
    }
    const dropSet = new Set(expandOperationIdsToWholeGroups(this.pending, seedIds))
    const dropped: string[] = []
    this.pending = this.pending.filter((op) => {
      if (dropSet.has(op.operationId)) {
        dropped.push(op.operationId)
        return false
      }
      return true
    })
    this.conflicts = []
    this.emit()
    if (dropped.length && this.journalDiscard) {
      const discard = this.journalDiscard
      this.queueJournal(() => discard(dropped))
    }
    return dropped
  }

  /** Restore pending after reload without re-writing journal (already durable). */
  hydratePendingFromRecovery(ops: DirtyOperation[]): void {
    if (!ops.length) return
    for (const op of ops) {
      const idx = this.pending.findIndex((p) => p.operationId === op.operationId)
      if (idx >= 0) this.pending[idx] = op
      else this.pending.push(op)
    }
    this.emit()
  }

  /** Explicit discard of selected operation IDs (recovery UX).
   * PHASE W0.6: subset of an atomic group expands to the whole group. */
  discardPendingByIds(operationIds: string[]): string[] {
    if (!operationIds.length) return []
    const done = new Set(expandOperationIdsToWholeGroups(this.pending, operationIds))
    const dropped: string[] = []
    this.pending = this.pending.filter((op) => {
      if (done.has(op.operationId)) {
        dropped.push(op.operationId)
        return false
      }
      return true
    })
    this.conflicts = this.conflicts.filter((c) => !c.operationId || !done.has(c.operationId))
    this.emit()
    if (dropped.length && this.journalDiscard) {
      const discard = this.journalDiscard
      this.queueJournal(() => discard(dropped))
    }
    return dropped
  }

  /** Explicit user cancel of pending ops (not used on pull). */
  discardAllPending(): void {
    const ids = this.pending.map((o) => o.operationId)
    this.pending = []
    this.conflicts = []
    this.emit()
    if (ids.length && this.journalDiscard) {
      const discard = this.journalDiscard
      this.queueJournal(() => discard(ids))
    }
  }

  /** Test helper only — does NOT clear durable journal (avoid wipe). */
  clearAll(): void {
    this.pending = []
    this.conflicts = []
    this.baselineStore = null
    this.emit()
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
  cloudDirtyTracker.setJournalHooks({})
  cloudDirtyTracker.discardAllPending()
  cloudDirtyTracker.setBaseRevision(0)
  cloudDirtyTracker.setBaselineStore(null)
  opSeq = 0
}
