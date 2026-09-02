/**
 * PHASE T2 — durable journal (in-memory adapter; no production).
 */
import { describe, expect, it, beforeEach } from 'vitest'
import type { AppStore, MonthSheet } from '@/lib/types'
import {
  cloudDirtyTracker,
  resetCloudDirtyTracker,
} from '@/lib/cloud/dirtyOperations'
import { timesheetCellEntityId as cellId } from '@/lib/cloud/timesheetCellOps'
import { diffStoreToOperations } from '@/lib/cloud/storeDiff'
import { buildCloudSavePayload } from '@/lib/cloud/cloudSavePipeline'
import {
  DURABLE_JOURNAL_SCHEMA_VERSION,
  DurableJournalController,
  buildJournalScopeKey,
  classifyJournalOpsAgainstRemote,
  createMemoryDurableJournalAdapter,
  createUnavailableDurableJournalAdapter,
  dirtyOpToJournalRecord,
  resetDurableJournalControllerForTests,
  shouldWarnBeforeUnloadT2,
  shouldAttemptBlindUnloadSqlWrite,
} from '@/lib/cloud/durableJournal'
import {
  noteCloudPullCompleted,
  resetSyncLifecycle,
  setSyncLifecyclePhase,
} from '@/lib/cloud/syncLifecycle'

function sheet(partial?: Partial<MonthSheet>): MonthSheet {
  return {
    month: '2026-09',
    rows: [{ id: 'row-1', brigade: 'A', employeeId: 'e1', sortOrder: 0 }],
    plan: {},
    fact: { 'row-1': { '2026-09-01': '8' } },
    factOverrides: [],
    comments: {},
    substitutions: {},
    ...partial,
  }
}

function baseStore(): AppStore {
  return {
    version: 6,
    employees: [{ id: 'e1', fullName: 'Alice', active: true, schedule: '5/2 8ч', shiftMode: 'day' }],
    months: { '2026-09': sheet() },
    candidates: [],
    settings: {},
    brigades: [],
    shiftTemplates: [],
    hrStructuralUnits: [],
    hrPositions: [],
    trash: { employees: [], months: [], candidates: [] },
  } as AppStore
}

const scopeA = {
  projectId: 'proj-a',
  uid: 'uid-a',
  storeDocId: 'fibercell-main',
  appStoreVersion: 6,
}

const scopeB = {
  projectId: 'proj-a',
  uid: 'uid-b',
  storeDocId: 'fibercell-main',
  appStoreVersion: 6,
}

function readyLifecycle() {
  resetSyncLifecycle()
  setSyncLifecyclePhase('ready')
  noteCloudPullCompleted(1)
}

beforeEach(() => {
  resetCloudDirtyTracker()
  resetDurableJournalControllerForTests()
  readyLifecycle()
})

describe('PHASE T2 durable journal', () => {
  it('enqueue writes operation to durable journal', async () => {
    const adapter = createMemoryDurableJournalAdapter()
    const journal = new DurableJournalController(adapter)
    await journal.bindScope(scopeA)
    cloudDirtyTracker.setJournalHooks({
      persist: async (ops) => {
        for (const op of ops) await journal.persistOperation(op, 'pending')
      },
      acknowledge: (ids) => journal.acknowledge(ids),
      discard: (ids) => journal.discardOperationIds(ids),
    })

    const baseline = baseStore()
    const local = structuredClone(baseline) as AppStore
    local.months['2026-09']!.fact['row-1']!['2026-09-02'] = 'Н'
    const ops = diffStoreToOperations(baseline, local, 1, 'user')
    cloudDirtyTracker.enqueue(ops)
    await cloudDirtyTracker.awaitJournalFlushes()

    const listed = await adapter.list(buildJournalScopeKey(scopeA))
    expect(listed).toHaveLength(1)
    expect(listed[0]!.operationId).toBe(ops[0]!.operationId)
    expect(listed[0]!.timesheetCell?.nextValue).toBe('Н')
    expect(listed[0]!.journalSchemaVersion).toBe(DURABLE_JOURNAL_SCHEMA_VERSION)
  })

  it('coalesce keeps first baseline and last next in journal', async () => {
    const adapter = createMemoryDurableJournalAdapter()
    const journal = new DurableJournalController(adapter)
    await journal.bindScope(scopeA)
    cloudDirtyTracker.setJournalHooks({
      persist: async (ops) => {
        for (const op of ops) await journal.persistOperation(op, 'pending')
      },
    })

    const entity = cellId('2026-09', 'fact', 'row-1', '2026-09-01')
    cloudDirtyTracker.enqueue([
      {
        operationId: 'op-1',
        type: 'update',
        domain: 'months',
        entityId: entity,
        fields: ['fact'],
        baseRevision: 1,
        origin: 'user',
        at: new Date().toISOString(),
        timesheetCell: {
          monthKey: '2026-09',
          employeeId: 'e1',
          rowId: 'row-1',
          dateKey: '2026-09-01',
          layer: 'fact',
          baselineValue: '8',
          nextValue: 'Н',
          explicitClear: false,
        },
      },
    ])
    cloudDirtyTracker.enqueue([
      {
        operationId: 'op-2',
        type: 'update',
        domain: 'months',
        entityId: entity,
        fields: ['fact'],
        baseRevision: 1,
        origin: 'user',
        at: new Date().toISOString(),
        timesheetCell: {
          monthKey: '2026-09',
          employeeId: 'e1',
          rowId: 'row-1',
          dateKey: '2026-09-01',
          layer: 'fact',
          baselineValue: 'Н',
          nextValue: 'О',
          explicitClear: false,
        },
      },
    ])
    await cloudDirtyTracker.awaitJournalFlushes()
    const listed = await adapter.list(buildJournalScopeKey(scopeA))
    expect(listed).toHaveLength(1)
    expect(listed[0]!.timesheetCell?.baselineValue).toBe('8')
    expect(listed[0]!.timesheetCell?.nextValue).toBe('О')
    expect(listed[0]!.operationId).toBe('op-1')
  })

  it('reload + remote==baseline restores pending with sqlWriteCount=0', async () => {
    const adapter = createMemoryDurableJournalAdapter()
    const journal = new DurableJournalController(adapter)
    await journal.bindScope(scopeA)
    const remote = baseStore()
    const record = dirtyOpToJournalRecord(
      {
        operationId: 'op-rec',
        type: 'update',
        domain: 'months',
        entityId: cellId('2026-09', 'fact', 'row-1', '2026-09-02'),
        fields: ['fact'],
        baseRevision: 1,
        origin: 'user',
        at: new Date().toISOString(),
        timesheetCell: {
          monthKey: '2026-09',
          employeeId: 'e1',
          rowId: 'row-1',
          dateKey: '2026-09-02',
          layer: 'fact',
          baselineValue: null,
          nextValue: 'Н',
          explicitClear: false,
        },
      },
      buildJournalScopeKey(scopeA),
      'pending',
    )
    await adapter.upsert(record)

    const restored = await journal.restoreAfterCloudLoad(remote.months)
    // Contract: restore never triggers SQL mutation path.
    expect(restored.sqlWriteCount).toBe(0)
    expect(restored.recoverableOps).toHaveLength(1)
    expect(journal.isRecoveryHoldActive()).toBe(true)
  })

  it('recovery hold prevents save until explicit Continue (no auto SQL)', async () => {
    const journal = new DurableJournalController(createMemoryDurableJournalAdapter())
    await journal.bindScope(scopeA)
    await journal.getAdapter().upsert(
      dirtyOpToJournalRecord(
        {
          operationId: 'op-hold',
          type: 'update',
          domain: 'months',
          entityId: cellId('2026-09', 'fact', 'row-1', '2026-09-02'),
          fields: ['fact'],
          baseRevision: 1,
          origin: 'user',
          at: new Date().toISOString(),
          timesheetCell: {
            monthKey: '2026-09',
            employeeId: 'e1',
            rowId: 'row-1',
            dateKey: '2026-09-02',
            layer: 'fact',
            baselineValue: null,
            nextValue: 'Н',
            explicitClear: false,
          },
        },
        buildJournalScopeKey(scopeA),
        'pending',
      ),
    )
    let sqlWrites = 0
    await journal.restoreAfterCloudLoad(baseStore().months)
    expect(journal.isRecoveryHoldActive()).toBe(true)
    // Simulate scheduleSave/flushSave gate used by FstSqlConnectSync
    if (!journal.isRecoveryHoldActive()) sqlWrites += 1
    expect(sqlWrites).toBe(0)
    journal.releaseRecoveryHold()
    if (!journal.isRecoveryHoldActive()) sqlWrites += 1
    expect(sqlWrites).toBe(1)
  })

  it('explicit Continue releases hold so save is allowed', async () => {
    const journal = new DurableJournalController(createMemoryDurableJournalAdapter())
    await journal.bindScope(scopeA)
    const remote = baseStore()
    await journal.getAdapter().upsert(
      dirtyOpToJournalRecord(
        {
          operationId: 'op-c',
          type: 'update',
          domain: 'months',
          entityId: cellId('2026-09', 'fact', 'row-1', '2026-09-02'),
          fields: ['fact'],
          baseRevision: 1,
          origin: 'user',
          at: new Date().toISOString(),
          timesheetCell: {
            monthKey: '2026-09',
            employeeId: 'e1',
            rowId: 'row-1',
            dateKey: '2026-09-02',
            layer: 'fact',
            baselineValue: null,
            nextValue: 'В',
            explicitClear: false,
          },
        },
        buildJournalScopeKey(scopeA),
        'pending',
      ),
    )
    await journal.restoreAfterCloudLoad(remote.months)
    expect(journal.isRecoveryHoldActive()).toBe(true)
    journal.releaseRecoveryHold()
    expect(journal.isRecoveryHoldActive()).toBe(false)
  })

  it('reload + remote==next clears idempotent without SQL write', async () => {
    const adapter = createMemoryDurableJournalAdapter()
    const journal = new DurableJournalController(adapter)
    await journal.bindScope(scopeA)
    const remote = baseStore()
    remote.months['2026-09']!.fact['row-1']!['2026-09-02'] = 'Н'
    await adapter.upsert(
      dirtyOpToJournalRecord(
        {
          operationId: 'op-idemp',
          type: 'update',
          domain: 'months',
          entityId: cellId('2026-09', 'fact', 'row-1', '2026-09-02'),
          fields: ['fact'],
          baseRevision: 1,
          origin: 'user',
          at: new Date().toISOString(),
          timesheetCell: {
            monthKey: '2026-09',
            employeeId: 'e1',
            rowId: 'row-1',
            dateKey: '2026-09-02',
            layer: 'fact',
            baselineValue: null,
            nextValue: 'Н',
            explicitClear: false,
          },
        },
        buildJournalScopeKey(scopeA),
        'pending',
      ),
    )
    const restored = await journal.restoreAfterCloudLoad(remote.months)
    expect(restored.sqlWriteCount).toBe(0)
    expect(restored.idempotentIds).toEqual(['op-idemp'])
    expect(restored.recoverableOps).toHaveLength(0)
    const left = await adapter.list(buildJournalScopeKey(scopeA))
    expect(left).toHaveLength(0)
  })

  it('reload + remote conflict keeps cloud and journal conflict', async () => {
    const adapter = createMemoryDurableJournalAdapter()
    const journal = new DurableJournalController(adapter)
    await journal.bindScope(scopeA)
    const remote = baseStore()
    remote.months['2026-09']!.fact['row-1']!['2026-09-01'] = 'О'
    await adapter.upsert(
      dirtyOpToJournalRecord(
        {
          operationId: 'op-cf',
          type: 'update',
          domain: 'months',
          entityId: cellId('2026-09', 'fact', 'row-1', '2026-09-01'),
          fields: ['fact'],
          baseRevision: 1,
          origin: 'user',
          at: new Date().toISOString(),
          timesheetCell: {
            monthKey: '2026-09',
            employeeId: 'e1',
            rowId: 'row-1',
            dateKey: '2026-09-01',
            layer: 'fact',
            baselineValue: '8',
            nextValue: 'Н',
            explicitClear: false,
          },
        },
        buildJournalScopeKey(scopeA),
        'pending',
      ),
    )
    const restored = await journal.restoreAfterCloudLoad(remote.months)
    expect(restored.conflicts.length).toBeGreaterThan(0)
    expect(restored.conflictOps).toHaveLength(1)
    expect(remote.months['2026-09']!.fact['row-1']!['2026-09-01']).toBe('О')
    const left = await adapter.list(buildJournalScopeKey(scopeA))
    expect(left).toHaveLength(1)
    expect(left[0]!.state).toBe('conflicted')
  })

  it('draft of another uid/project is inaccessible', async () => {
    const adapter = createMemoryDurableJournalAdapter()
    const journalA = new DurableJournalController(adapter)
    await journalA.bindScope(scopeA)
    await adapter.upsert(
      dirtyOpToJournalRecord(
        {
          operationId: 'op-a',
          type: 'update',
          domain: 'months',
          entityId: cellId('2026-09', 'fact', 'row-1', '2026-09-02'),
          fields: ['fact'],
          baseRevision: 1,
          origin: 'user',
          at: new Date().toISOString(),
          timesheetCell: {
            monthKey: '2026-09',
            employeeId: 'e1',
            rowId: 'row-1',
            dateKey: '2026-09-02',
            layer: 'fact',
            baselineValue: null,
            nextValue: 'Н',
            explicitClear: false,
          },
        },
        buildJournalScopeKey(scopeA),
        'pending',
      ),
    )

    const journalB = new DurableJournalController(adapter)
    await journalB.bindScope(scopeB)
    const restoredB = await journalB.restoreAfterCloudLoad(baseStore().months)
    expect(restoredB.recoverableOps).toHaveLength(0)
    expect(restoredB.conflictOps).toHaveLength(0)
    // Original scope still has record
    expect(await adapter.list(buildJournalScopeKey(scopeA))).toHaveLength(1)
  })

  it('SQL ack removes only applied IDs from journal', async () => {
    const adapter = createMemoryDurableJournalAdapter()
    const journal = new DurableJournalController(adapter)
    await journal.bindScope(scopeA)
    cloudDirtyTracker.setJournalHooks({
      persist: async (ops) => {
        for (const op of ops) await journal.persistOperation(op, 'pending')
      },
      acknowledge: (ids) => journal.acknowledge(ids),
    })

    const baseline = baseStore()
    const local = structuredClone(baseline) as AppStore
    local.months['2026-09']!.fact['row-1']!['2026-09-02'] = 'Н'
    local.months['2026-09']!.fact['row-1']!['2026-09-03'] = 'В'
    const ops = diffStoreToOperations(baseline, local, 1, 'user')
    cloudDirtyTracker.enqueue(ops)
    await cloudDirtyTracker.awaitJournalFlushes()
    expect(await adapter.list(buildJournalScopeKey(scopeA))).toHaveLength(2)

    const remote = structuredClone(baseline) as AppStore
    remote.months['2026-09']!.fact['row-1']!['2026-09-02'] = 'О' // conflict day 02
    const build = buildCloudSavePayload({
      remote,
      remoteRevision: 2,
      local,
      baseline,
      operations: cloudDirtyTracker.getPending(),
    })
    expect(build.appliedOperationIds.length).toBe(1)
    expect(build.conflicts.length).toBe(1)
    cloudDirtyTracker.acknowledgePersisted(build.appliedOperationIds)
    await cloudDirtyTracker.awaitJournalFlushes()
    const left = await adapter.list(buildJournalScopeKey(scopeA))
    expect(left).toHaveLength(1)
    expect(left[0]!.timesheetCell?.dateKey).toBe('2026-09-02')
  })

  it('discard removes only selected restored operations', async () => {
    const adapter = createMemoryDurableJournalAdapter()
    const journal = new DurableJournalController(adapter)
    await journal.bindScope(scopeA)
    for (const [id, day] of [
      ['op-1', '2026-09-02'],
      ['op-2', '2026-09-03'],
    ] as const) {
      await adapter.upsert(
        dirtyOpToJournalRecord(
          {
            operationId: id,
            type: 'update',
            domain: 'months',
            entityId: cellId('2026-09', 'fact', 'row-1', day),
            fields: ['fact'],
            baseRevision: 1,
            origin: 'user',
            at: new Date().toISOString(),
            timesheetCell: {
              monthKey: '2026-09',
              employeeId: 'e1',
              rowId: 'row-1',
              dateKey: day,
              layer: 'fact',
              baselineValue: null,
              nextValue: 'Н',
              explicitClear: false,
            },
          },
          buildJournalScopeKey(scopeA),
          'pending',
        ),
      )
    }
    await journal.restoreAfterCloudLoad(baseStore().months)
    expect(journal.getRestoredOperationIds()).toHaveLength(2)
    await journal.discardOperationIds(['op-1'])
    const left = await adapter.list(buildJournalScopeKey(scopeA))
    expect(left.map((r) => r.operationId)).toEqual(['op-2'])
  })

  it('IndexedDB failure shows degraded state', async () => {
    const journal = new DurableJournalController(createUnavailableDurableJournalAdapter())
    await journal.bindScope(scopeA)
    const ok = await journal.persistOperation(
      {
        operationId: 'op-x',
        type: 'update',
        domain: 'months',
        entityId: cellId('2026-09', 'fact', 'row-1', '2026-09-02'),
        fields: ['fact'],
        baseRevision: 1,
        origin: 'user',
        at: new Date().toISOString(),
        timesheetCell: {
          monthKey: '2026-09',
          employeeId: 'e1',
          rowId: 'row-1',
          dateKey: '2026-09-02',
          layer: 'fact',
          baselineValue: null,
          nextValue: 'Н',
          explicitClear: false,
        },
      },
      'pending',
    )
    expect(ok).toBe(false)
    expect(journal.getStatus().degraded).toBe(true)
    expect(journal.getStatus().degradeReason).toBeTruthy()
  })

  it('unsupported journal version is not applied and not deleted', async () => {
    const adapter = createMemoryDurableJournalAdapter()
    const journal = new DurableJournalController(adapter)
    await journal.bindScope(scopeA)
    const rec = dirtyOpToJournalRecord(
      {
        operationId: 'op-old',
        type: 'update',
        domain: 'months',
        entityId: cellId('2026-09', 'fact', 'row-1', '2026-09-02'),
        fields: ['fact'],
        baseRevision: 1,
        origin: 'user',
        at: new Date().toISOString(),
        timesheetCell: {
          monthKey: '2026-09',
          employeeId: 'e1',
          rowId: 'row-1',
          dateKey: '2026-09-02',
          layer: 'fact',
          baselineValue: null,
          nextValue: 'Н',
          explicitClear: false,
        },
      },
      buildJournalScopeKey(scopeA),
      'pending',
    )
    rec.journalSchemaVersion = 99
    await adapter.upsert(rec)
    const restored = await journal.restoreAfterCloudLoad(baseStore().months)
    expect(restored.unsupported).toHaveLength(1)
    expect(restored.recoverableOps).toHaveLength(0)
    expect(await adapter.list(buildJournalScopeKey(scopeA))).toHaveLength(1)
    expect(journal.getStatus().degradeReason).toBe('unsupported_journal_version')
  })

  it('first open without actions does not require SQL mutation path', async () => {
    const journal = new DurableJournalController(createMemoryDurableJournalAdapter())
    await journal.bindScope(scopeA)
    const restored = await journal.restoreAfterCloudLoad(baseStore().months)
    expect(restored.sqlWriteCount).toBe(0)
    expect(restored.recoverableOps).toHaveLength(0)
    expect(journal.isRecoveryHoldActive()).toBe(false)
    // No pending → canCloudWriteNow false without user ops
    expect(cloudDirtyTracker.hasPendingUserOperations()).toBe(false)
  })

  it('beforeunload includes journal unconfirmed and recovery hold', () => {
    expect(
      shouldWarnBeforeUnloadT2({
        pendingUserOps: 0,
        saving: false,
        unresolvedConflicts: 0,
        unconfirmedJournalWrites: 1,
        recoveryHold: false,
      }),
    ).toBe(true)
    expect(
      shouldWarnBeforeUnloadT2({
        pendingUserOps: 0,
        saving: false,
        unresolvedConflicts: 0,
        unconfirmedJournalWrites: 0,
        recoveryHold: true,
      }),
    ).toBe(true)
    expect(
      shouldWarnBeforeUnloadT2({
        pendingUserOps: 0,
        saving: false,
        unresolvedConflicts: 0,
        unconfirmedJournalWrites: 0,
        recoveryHold: false,
      }),
    ).toBe(false)
    // Unload must never attempt blind SQL write
    expect(shouldAttemptBlindUnloadSqlWrite()).toBe(false)
  })

  it('classify helper: different cells recoverable independently', () => {
    const remote = baseStore().months
    const records = [
      dirtyOpToJournalRecord(
        {
          operationId: 'd1',
          type: 'update',
          domain: 'months',
          entityId: cellId('2026-09', 'fact', 'row-1', '2026-09-02'),
          fields: ['fact'],
          baseRevision: 1,
          origin: 'user',
          at: new Date().toISOString(),
          timesheetCell: {
            monthKey: '2026-09',
            employeeId: 'e1',
            rowId: 'row-1',
            dateKey: '2026-09-02',
            layer: 'fact',
            baselineValue: null,
            nextValue: 'Н',
            explicitClear: false,
          },
        },
        buildJournalScopeKey(scopeA),
        'pending',
      ),
      dirtyOpToJournalRecord(
        {
          operationId: 'd2',
          type: 'update',
          domain: 'months',
          entityId: cellId('2026-09', 'fact', 'row-1', '2026-09-03'),
          fields: ['fact'],
          baseRevision: 1,
          origin: 'user',
          at: new Date().toISOString(),
          timesheetCell: {
            monthKey: '2026-09',
            employeeId: 'e1',
            rowId: 'row-1',
            dateKey: '2026-09-03',
            layer: 'fact',
            baselineValue: null,
            nextValue: 'В',
            explicitClear: false,
          },
        },
        buildJournalScopeKey(scopeA),
        'pending',
      ),
    ]
    const c = classifyJournalOpsAgainstRemote(records, remote)
    expect(c.recoverableOps).toHaveLength(2)
    expect(c.conflicts).toHaveLength(0)
  })
})
