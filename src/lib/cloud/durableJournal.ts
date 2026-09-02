/**
 * PHASE T2 — durable journal for unconfirmed timesheet cloud operations.
 * Client-only IndexedDB; never writes to SQL automatically on restore.
 */
import type { AppStore } from '@/lib/types'
import type { DirtyOperation, EntityConflict, TimesheetCellPatch } from './dirtyOperations'
import {
  applyMonthsGranularOperations,
  isStructuralMonthOp,
  isTimesheetCellOp,
} from './timesheetCellOps'

export const DURABLE_JOURNAL_SCHEMA_VERSION = 1 as const
export const DURABLE_JOURNAL_DB_NAME = 'fst-cloud-ops-journal'
export const DURABLE_JOURNAL_STORE_NAME = 'operations'
/** Mark restored records stale after 7 days (never auto-delete). */
export const DURABLE_JOURNAL_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

export type DurableJournalOpState =
  | 'pending'
  | 'restored'
  | 'conflicted'
  | 'stale'
  | 'confirmed'

export type DurableJournalScope = {
  projectId: string
  uid: string
  storeDocId: string
  appStoreVersion: number
}

export type DurableJournalRecord = {
  journalSchemaVersion: typeof DURABLE_JOURNAL_SCHEMA_VERSION | number
  scopeKey: string
  recordKey: string
  operationId: string
  type: DirtyOperation['type']
  domain: string
  entityId: string
  origin: DirtyOperation['origin']
  fields: string[]
  baseRevision: number
  at: string
  explicit?: boolean
  timesheetCell?: TimesheetCellPatch
  /** Structural snapshot / cell baseline — no employee names/photos. */
  baselineEntity?: unknown
  baselineFingerprint?: string
  pendingLocal?: unknown
  createdAt: string
  updatedAt: string
  state: DurableJournalOpState
}

export type DurableJournalAdapter = {
  readonly kind: 'memory' | 'indexeddb' | 'unavailable'
  upsert(record: DurableJournalRecord): Promise<void>
  remove(scopeKey: string, operationIds: string[]): Promise<void>
  list(scopeKey: string): Promise<DurableJournalRecord[]>
  /** List without applying — used to detect foreign scopes (not returned to caller for apply). */
  hasAnyForOtherScope?(scopeKey: string): Promise<boolean>
}

export type JournalClassifyKind = 'recoverable' | 'idempotent' | 'conflict' | 'unsupported'

export type ClassifiedJournalOp = {
  record: DurableJournalRecord
  op: DirtyOperation
  kind: JournalClassifyKind
  conflict?: EntityConflict
}

export function buildJournalScopeKey(scope: DurableJournalScope): string {
  return [
    scope.projectId.trim() || 'unknown-project',
    scope.uid.trim() || 'anonymous',
    scope.storeDocId.trim() || 'store',
    `v${scope.appStoreVersion || 6}`,
  ].join('::')
}

export function journalRecordKey(scopeKey: string, operationId: string): string {
  return `${scopeKey}::${operationId}`
}

export function shouldPersistOperationToJournal(op: DirtyOperation): boolean {
  return op.origin === 'user' && (isTimesheetCellOp(op) || isStructuralMonthOp(op))
}

/** Strip PII / secrets — only timesheet op metadata. */
export function dirtyOpToJournalRecord(
  op: DirtyOperation,
  scopeKey: string,
  state: DurableJournalOpState,
  prev?: DurableJournalRecord | null,
): DurableJournalRecord {
  const now = new Date().toISOString()
  return {
    journalSchemaVersion: DURABLE_JOURNAL_SCHEMA_VERSION,
    scopeKey,
    recordKey: journalRecordKey(scopeKey, op.operationId),
    operationId: op.operationId,
    type: op.type,
    domain: op.domain,
    entityId: op.entityId,
    origin: op.origin,
    fields: [...(op.fields ?? [])],
    baseRevision: op.baseRevision,
    at: op.at,
    explicit: op.explicit,
    timesheetCell: op.timesheetCell ? { ...op.timesheetCell } : undefined,
    baselineEntity: op.baselineEntity,
    baselineFingerprint: op.baselineFingerprint,
    pendingLocal: op.pendingLocal,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    state,
  }
}

export function journalRecordToDirtyOp(record: DurableJournalRecord): DirtyOperation {
  return {
    operationId: record.operationId,
    type: record.type,
    domain: record.domain,
    entityId: record.entityId,
    origin: record.origin,
    fields: [...(record.fields ?? [])],
    baseRevision: record.baseRevision,
    at: record.at,
    explicit: record.explicit,
    timesheetCell: record.timesheetCell ? { ...record.timesheetCell } : undefined,
    baselineEntity: record.baselineEntity,
    baselineFingerprint: record.baselineFingerprint,
    pendingLocal: record.pendingLocal,
  }
}

export function isJournalRecordSupported(record: DurableJournalRecord): boolean {
  return record.journalSchemaVersion === DURABLE_JOURNAL_SCHEMA_VERSION
}

export function markStaleIfNeeded(
  record: DurableJournalRecord,
  nowMs = Date.now(),
): DurableJournalRecord {
  const updated = Date.parse(record.updatedAt)
  if (!Number.isFinite(updated)) return record
  if (nowMs - updated < DURABLE_JOURNAL_STALE_AFTER_MS) return record
  if (record.state === 'stale') return record
  return { ...record, state: 'stale' }
}

/**
 * Classify journal ops against fresh remote using T1 three-way rules.
 * Does not perform SQL writes.
 */
export function classifyJournalOpsAgainstRemote(
  records: DurableJournalRecord[],
  remoteMonths: AppStore['months'],
): {
  classified: ClassifiedJournalOp[]
  unsupported: DurableJournalRecord[]
  recoverableOps: DirtyOperation[]
  conflictOps: DirtyOperation[]
  conflicts: EntityConflict[]
  idempotentIds: string[]
} {
  const unsupported: DurableJournalRecord[] = []
  const supported: DurableJournalRecord[] = []
  for (const r of records) {
    if (!isJournalRecordSupported(r)) unsupported.push(r)
    else supported.push(markStaleIfNeeded(r))
  }

  const classified: ClassifiedJournalOp[] = []
  const recoverableOps: DirtyOperation[] = []
  const conflictOps: DirtyOperation[] = []
  const conflicts: EntityConflict[] = []
  const idempotentIds: string[] = []

  for (const record of supported) {
    const op = journalRecordToDirtyOp(record)
    const alone = applyMonthsGranularOperations(remoteMonths, remoteMonths, remoteMonths, [op])
    if (alone.conflicts.length > 0) {
      const conflict = alone.conflicts[0]!
      classified.push({ record, op, kind: 'conflict', conflict })
      conflictOps.push(op)
      conflicts.push(conflict)
      continue
    }
    if (alone.appliedOperationIds.includes(op.operationId)) {
      const monthsChanged =
        JSON.stringify(alone.months ?? {}) !== JSON.stringify(remoteMonths ?? {})
      if (monthsChanged) {
        classified.push({ record, op, kind: 'recoverable' })
        recoverableOps.push(op)
      } else {
        classified.push({ record, op, kind: 'idempotent' })
        idempotentIds.push(op.operationId)
      }
      continue
    }
    const conflict: EntityConflict = {
      operationId: op.operationId,
      domain: op.domain,
      entityId: op.entityId,
      reason: 'domain_conflict',
      message: 'Journal operation could not be classified against cloud',
    }
    classified.push({ record, op, kind: 'conflict', conflict })
    conflictOps.push(op)
    conflicts.push(conflict)
  }

  for (const r of unsupported) {
    classified.push({
      record: r,
      op: journalRecordToDirtyOp(r),
      kind: 'unsupported',
    })
  }

  return {
    classified,
    unsupported,
    recoverableOps,
    conflictOps,
    conflicts,
    idempotentIds,
  }
}

/** Overlay recoverable ops onto cloud months for UI preview (baseline stays pure cloud). */
export function previewRecoveredMonths(
  remoteMonths: AppStore['months'],
  recoverableOps: DirtyOperation[],
): AppStore['months'] {
  if (!recoverableOps.length) return remoteMonths
  return applyMonthsGranularOperations(
    remoteMonths,
    remoteMonths,
    remoteMonths,
    recoverableOps,
  ).months
}

export function createMemoryDurableJournalAdapter(): DurableJournalAdapter {
  const map = new Map<string, DurableJournalRecord>()
  return {
    kind: 'memory',
    async upsert(record) {
      map.set(record.recordKey, structuredClone(record))
    },
    async remove(scopeKey, operationIds) {
      const done = new Set(operationIds)
      for (const [key, rec] of [...map.entries()]) {
        if (rec.scopeKey === scopeKey && done.has(rec.operationId)) map.delete(key)
      }
    },
    async list(scopeKey) {
      return [...map.values()]
        .filter((r) => r.scopeKey === scopeKey)
        .map((r) => structuredClone(r))
    },
    async hasAnyForOtherScope(scopeKey) {
      return [...map.values()].some((r) => r.scopeKey !== scopeKey)
    },
  }
}

export function createUnavailableDurableJournalAdapter(reason = 'indexeddb_unavailable'): DurableJournalAdapter {
  void reason
  return {
    kind: 'unavailable',
    async upsert() {
      throw new Error('durable_journal_unavailable')
    },
    async remove() {
      /* no-op */
    },
    async list() {
      return []
    },
  }
}

export function createIndexedDbDurableJournalAdapter(
  indexedDBRef: IDBFactory | null | undefined = typeof indexedDB !== 'undefined' ? indexedDB : null,
): DurableJournalAdapter {
  if (!indexedDBRef) return createUnavailableDurableJournalAdapter()

  const openDb = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const req = indexedDBRef.open(DURABLE_JOURNAL_DB_NAME, 1)
      req.onerror = () => reject(req.error ?? new Error('idb_open_failed'))
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(DURABLE_JOURNAL_STORE_NAME)) {
          const store = db.createObjectStore(DURABLE_JOURNAL_STORE_NAME, { keyPath: 'recordKey' })
          store.createIndex('scopeKey', 'scopeKey', { unique: false })
          store.createIndex('operationId', 'operationId', { unique: false })
        }
      }
      req.onsuccess = () => resolve(req.result)
    })

  return {
    kind: 'indexeddb',
    async upsert(record) {
      const db = await openDb()
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(DURABLE_JOURNAL_STORE_NAME, 'readwrite')
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error ?? new Error('idb_upsert_failed'))
          tx.objectStore(DURABLE_JOURNAL_STORE_NAME).put(record)
        })
      } finally {
        db.close()
      }
    },
    async remove(scopeKey, operationIds) {
      if (!operationIds.length) return
      const db = await openDb()
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(DURABLE_JOURNAL_STORE_NAME, 'readwrite')
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error ?? new Error('idb_remove_failed'))
          const store = tx.objectStore(DURABLE_JOURNAL_STORE_NAME)
          for (const id of operationIds) {
            store.delete(journalRecordKey(scopeKey, id))
          }
        })
      } finally {
        db.close()
      }
    },
    async list(scopeKey) {
      const db = await openDb()
      try {
        return await new Promise<DurableJournalRecord[]>((resolve, reject) => {
          const tx = db.transaction(DURABLE_JOURNAL_STORE_NAME, 'readonly')
          const idx = tx.objectStore(DURABLE_JOURNAL_STORE_NAME).index('scopeKey')
          const req = idx.getAll(scopeKey)
          req.onsuccess = () => resolve((req.result as DurableJournalRecord[]) ?? [])
          req.onerror = () => reject(req.error ?? new Error('idb_list_failed'))
        })
      } finally {
        db.close()
      }
    },
  }
}

export type DurableJournalControllerStatus = {
  degraded: boolean
  degradeReason: string | null
  scopeKey: string | null
  /** Journal write in flight / not yet confirmed for at least one op. */
  unconfirmedWrites: number
  recoveryHold: boolean
  restoredCount: number
  unsupportedCount: number
}

/**
 * Bridges DirtyOperationTracker ↔ durable adapter.
 * Autosave must respect `recoveryHold` until user Continue.
 */
export class DurableJournalController {
  private adapter: DurableJournalAdapter
  private scopeKey: string | null = null
  private degraded = false
  private degradeReason: string | null = null
  private unconfirmedWrites = 0
  private recoveryHold = false
  private restoredOperationIds = new Set<string>()
  private unsupportedCount = 0
  private listeners = new Set<() => void>()
  private cache = new Map<string, DurableJournalRecord>()

  constructor(adapter?: DurableJournalAdapter) {
    this.adapter = adapter ?? createMemoryDurableJournalAdapter()
    if (this.adapter.kind === 'unavailable') {
      this.degraded = true
      this.degradeReason = 'indexeddb_unavailable'
    }
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    fn()
    return () => this.listeners.delete(fn)
  }

  private emit(): void {
    for (const fn of this.listeners) fn()
  }

  getStatus(): DurableJournalControllerStatus {
    return {
      degraded: this.degraded,
      degradeReason: this.degradeReason,
      scopeKey: this.scopeKey,
      unconfirmedWrites: this.unconfirmedWrites,
      recoveryHold: this.recoveryHold,
      restoredCount: this.restoredOperationIds.size,
      unsupportedCount: this.unsupportedCount,
    }
  }

  setAdapter(adapter: DurableJournalAdapter): void {
    this.adapter = adapter
    if (adapter.kind === 'unavailable') {
      this.degraded = true
      this.degradeReason = 'indexeddb_unavailable'
    } else if (this.degradeReason === 'indexeddb_unavailable') {
      this.degraded = false
      this.degradeReason = null
    }
    this.emit()
  }

  getAdapter(): DurableJournalAdapter {
    return this.adapter
  }

  async bindScope(scope: DurableJournalScope): Promise<void> {
    this.scopeKey = buildJournalScopeKey(scope)
    this.cache.clear()
    this.restoredOperationIds.clear()
    this.unsupportedCount = 0
    this.recoveryHold = false
    this.emit()
  }

  clearScopeMemory(): void {
    // Logout: drop in-memory only — do not delete other uid journal on disk.
    this.scopeKey = null
    this.cache.clear()
    this.restoredOperationIds.clear()
    this.unsupportedCount = 0
    this.recoveryHold = false
    this.unconfirmedWrites = 0
    this.emit()
  }

  isRecoveryHoldActive(): boolean {
    return this.recoveryHold
  }

  getRestoredOperationIds(): string[] {
    return [...this.restoredOperationIds]
  }

  releaseRecoveryHold(): void {
    this.recoveryHold = false
    this.restoredOperationIds.clear()
    this.emit()
  }

  /** Persist after in-memory coalesce — crash-protected only after await resolves. */
  async persistOperation(op: DirtyOperation, state: DurableJournalOpState = 'pending'): Promise<boolean> {
    if (!shouldPersistOperationToJournal(op)) return true
    if (!this.scopeKey) return false
    if (this.adapter.kind === 'unavailable') {
      this.degraded = true
      this.degradeReason = 'indexeddb_unavailable'
      this.emit()
      return false
    }
    this.unconfirmedWrites += 1
    this.emit()
    try {
      const prev = this.cache.get(op.operationId) ?? null
      const record = dirtyOpToJournalRecord(op, this.scopeKey, state, prev)
      await this.adapter.upsert(record)
      this.cache.set(op.operationId, record)
      return true
    } catch (err) {
      this.degraded = true
      this.degradeReason = err instanceof Error ? err.message : 'journal_write_failed'
      return false
    } finally {
      this.unconfirmedWrites = Math.max(0, this.unconfirmedWrites - 1)
      this.emit()
    }
  }

  async acknowledge(operationIds: string[]): Promise<void> {
    if (!this.scopeKey || !operationIds.length) return
    const ids = operationIds.filter((id) => this.cache.has(id) || true)
    try {
      await this.adapter.remove(this.scopeKey, ids)
    } catch (err) {
      this.degraded = true
      this.degradeReason = err instanceof Error ? err.message : 'journal_remove_failed'
    }
    for (const id of ids) {
      this.cache.delete(id)
      this.restoredOperationIds.delete(id)
    }
    this.emit()
  }

  async discardOperationIds(operationIds: string[]): Promise<void> {
    await this.acknowledge(operationIds)
  }

  /**
   * After fresh cloud load: classify journal, remove idempotent, hold recoverable.
   * Never SQL-writes.
   */
  async restoreAfterCloudLoad(remoteMonths: AppStore['months']): Promise<{
    recoverableOps: DirtyOperation[]
    conflictOps: DirtyOperation[]
    conflicts: EntityConflict[]
    idempotentIds: string[]
    unsupported: DurableJournalRecord[]
    previewMonths: AppStore['months']
    sqlWriteCount: 0
  }> {
    const empty = {
      recoverableOps: [] as DirtyOperation[],
      conflictOps: [] as DirtyOperation[],
      conflicts: [] as EntityConflict[],
      idempotentIds: [] as string[],
      unsupported: [] as DurableJournalRecord[],
      previewMonths: remoteMonths,
      sqlWriteCount: 0 as const,
    }
    if (!this.scopeKey) return empty
    if (this.adapter.kind === 'unavailable') {
      this.degraded = true
      this.degradeReason = 'indexeddb_unavailable'
      this.emit()
      return empty
    }

    let records: DurableJournalRecord[]
    try {
      records = await this.adapter.list(this.scopeKey)
    } catch (err) {
      this.degraded = true
      this.degradeReason = err instanceof Error ? err.message : 'journal_list_failed'
      this.emit()
      return empty
    }

    this.cache.clear()
    for (const r of records) this.cache.set(r.operationId, r)

    const classified = classifyJournalOpsAgainstRemote(records, remoteMonths)
    this.unsupportedCount = classified.unsupported.length

    // Idempotent: safe remove without SQL write
    if (classified.idempotentIds.length) {
      await this.acknowledge(classified.idempotentIds)
    }

    if (classified.unsupported.length > 0) {
      this.recoveryHold = true
      this.degraded = true
      this.degradeReason = 'unsupported_journal_version'
    }

    if (classified.recoverableOps.length || classified.conflictOps.length) {
      this.recoveryHold = true
      for (const op of classified.recoverableOps) {
        this.restoredOperationIds.add(op.operationId)
        const prev = this.cache.get(op.operationId)
        if (prev && this.scopeKey) {
          const next = { ...prev, state: 'restored' as const, updatedAt: new Date().toISOString() }
          this.cache.set(op.operationId, next)
          try {
            await this.adapter.upsert(next)
          } catch {
            /* keep memory */
          }
        }
      }
      for (const op of classified.conflictOps) {
        this.restoredOperationIds.add(op.operationId)
        const prev = this.cache.get(op.operationId)
        if (prev && this.scopeKey) {
          const next = { ...prev, state: 'conflicted' as const, updatedAt: new Date().toISOString() }
          this.cache.set(op.operationId, next)
          try {
            await this.adapter.upsert(next)
          } catch {
            /* keep memory */
          }
        }
      }
    }

    this.emit()
    return {
      recoverableOps: classified.recoverableOps,
      conflictOps: classified.conflictOps,
      conflicts: classified.conflicts,
      idempotentIds: classified.idempotentIds,
      unsupported: classified.unsupported,
      previewMonths: previewRecoveredMonths(remoteMonths, classified.recoverableOps),
      sqlWriteCount: 0,
    }
  }
}

let sharedController: DurableJournalController | null = null

export function getDurableJournalController(): DurableJournalController {
  if (!sharedController) sharedController = new DurableJournalController()
  return sharedController
}

export function setDurableJournalControllerForTests(c: DurableJournalController | null): void {
  sharedController = c
}

export function resetDurableJournalControllerForTests(): void {
  sharedController = new DurableJournalController(createMemoryDurableJournalAdapter())
}

/** Extended beforeunload gate including journal/recovery. */
export function shouldWarnBeforeUnloadT2(input: {
  pendingUserOps: number
  saving: boolean
  unresolvedConflicts: number
  unconfirmedJournalWrites: number
  recoveryHold: boolean
}): boolean {
  return (
    input.pendingUserOps > 0 ||
    input.saving ||
    input.unresolvedConflicts > 0 ||
    input.unconfirmedJournalWrites > 0 ||
    input.recoveryHold
  )
}

/** PHASE T2: never blind-write SQL on unload/pagehide (journal + beforeunload only). */
export function shouldAttemptBlindUnloadSqlWrite(): false {
  return false
}
