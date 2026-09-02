/**
 * PHASE T1 — granular timesheet cell save (mocks only; no production).
 */
import { describe, expect, it, beforeEach } from 'vitest'
import type { AppStore, MonthSheet } from '@/lib/types'
import {
  cloudDirtyTracker,
  resetCloudDirtyTracker,
  type DirtyOperation,
} from '@/lib/cloud/dirtyOperations'
import { diffStoreToOperations } from '@/lib/cloud/storeDiff'
import { buildCloudSavePayload } from '@/lib/cloud/cloudSavePipeline'
import { prepareCloudPayload } from '@/lib/cloud/cloudPayload'
import { sanitizeStoreForExport } from '@/lib/storage'
import {
  applyMonthsGranularOperations,
  isTimesheetCellOp,
  readCellValue,
  shouldWarnBeforeUnload,
  timesheetCellEntityId,
} from '@/lib/cloud/timesheetCellOps'
import {
  noteCloudPullCompleted,
  resetSyncLifecycle,
  setSyncLifecyclePhase,
} from '@/lib/cloud/syncLifecycle'

function sheet(partial?: Partial<MonthSheet>): MonthSheet {
  return {
    month: '2026-09',
    rows: [
      { id: 'row-1', brigade: 'A', employeeId: 'e1', sortOrder: 0 },
      { id: 'row-2', brigade: 'A', employeeId: 'e2', sortOrder: 1 },
    ],
    plan: {},
    fact: {},
    factOverrides: [],
    comments: {},
    substitutions: {},
    ...partial,
  }
}

function baseStore(months?: AppStore['months']): AppStore {
  return {
    version: 6,
    employees: [
      { id: 'e1', fullName: 'Alice', active: true, schedule: '5/2 8ч', shiftMode: 'day' },
      { id: 'e2', fullName: 'Bob', active: true, schedule: '5/2 8ч', shiftMode: 'day' },
    ],
    months: months ?? {
      '2026-09': sheet({
        plan: { 'row-1': { '2026-09-01': '8' }, 'row-2': { '2026-09-01': '8' } },
        fact: { 'row-1': { '2026-09-01': '8' }, 'row-2': { '2026-09-01': '8' } },
      }),
      '2026-08': sheet({
        month: '2026-08',
        plan: { 'row-1': { '2026-08-15': 'В' } },
        fact: { 'row-1': { '2026-08-15': 'В' } },
      }),
    },
    candidates: [],
    settings: {},
    brigades: [],
    shiftTemplates: [],
    hrStructuralUnits: [],
    hrPositions: [],
    trash: { employees: [], months: [], candidates: [] },
  } as AppStore
}

function readyLifecycle(rev = 1) {
  resetSyncLifecycle()
  setSyncLifecyclePhase('ready')
  noteCloudPullCompleted(rev)
}

beforeEach(() => {
  resetCloudDirtyTracker()
  readyLifecycle(1)
})

describe('PHASE T1 granular timesheet cell ops', () => {
  it('one cell edit → one granular operation (not months/*)', () => {
    const baseline = baseStore()
    const local = structuredClone(baseline) as AppStore
    local.months['2026-09']!.fact['row-1']!['2026-09-02'] = '8'
    const ops = diffStoreToOperations(baseline, local, 1, 'user')
    const cellOps = ops.filter(isTimesheetCellOp)
    expect(cellOps).toHaveLength(1)
    expect(ops.some((o) => o.domain === 'months' && o.entityId === '*')).toBe(false)
    expect(cellOps[0]!.entityId).toBe(timesheetCellEntityId('2026-09', 'fact', 'row-1', '2026-09-02'))
    expect(cellOps[0]!.timesheetCell).toMatchObject({
      monthKey: '2026-09',
      employeeId: 'e1',
      rowId: 'row-1',
      dateKey: '2026-09-02',
      layer: 'fact',
      baselineValue: null,
      nextValue: '8',
      explicitClear: false,
    })
  })

  it('clear cell → explicit clear/delete operation', () => {
    const baseline = baseStore()
    const local = structuredClone(baseline) as AppStore
    delete local.months['2026-09']!.fact['row-1']!['2026-09-01']
    const ops = diffStoreToOperations(baseline, local, 1, 'user')
    const cellOps = ops.filter(isTimesheetCellOp)
    expect(cellOps).toHaveLength(1)
    expect(cellOps[0]!.timesheetCell?.explicitClear).toBe(true)
    expect(cellOps[0]!.timesheetCell?.nextValue).toBeNull()
    expect(cellOps[0]!.type).toBe('delete')
    expect(cellOps[0]!.explicit).toBe(true)
  })

  it('two users edit different days of same month → both applied', () => {
    const baseline = baseStore()
    // User A: day 02
    const localA = structuredClone(baseline) as AppStore
    localA.months['2026-09']!.fact['row-1']!['2026-09-02'] = 'Н'
    const opsA = diffStoreToOperations(baseline, localA, 1, 'user')
    // Fresh remote already has user B's day 03
    const remote = structuredClone(baseline) as AppStore
    remote.months['2026-09']!.fact['row-1']!['2026-09-03'] = 'О'
    const build = buildCloudSavePayload({
      remote,
      remoteRevision: 2,
      local: localA,
      baseline,
      operations: opsA,
    })
    expect(build.allowed).toBe(true)
    expect(build.conflicts).toHaveLength(0)
    expect(readCellValue(build.store!.months['2026-09'], 'fact', 'row-1', '2026-09-02')).toBe('Н')
    expect(readCellValue(build.store!.months['2026-09'], 'fact', 'row-1', '2026-09-03')).toBe('О')
  })

  it('two users edit same cell → visible conflict; cloud not overwritten', () => {
    const baseline = baseStore()
    const local = structuredClone(baseline) as AppStore
    local.months['2026-09']!.fact['row-1']!['2026-09-01'] = 'Н'
    const ops = diffStoreToOperations(baseline, local, 1, 'user')
    const remote = structuredClone(baseline) as AppStore
    remote.months['2026-09']!.fact['row-1']!['2026-09-01'] = 'О'
    const build = buildCloudSavePayload({
      remote,
      remoteRevision: 3,
      local,
      baseline,
      operations: ops,
    })
    expect(build.conflicts.length).toBeGreaterThan(0)
    expect(build.conflicts[0]?.reason).toBe('concurrent_edit')
    expect(readCellValue(build.store!.months['2026-09'], 'fact', 'row-1', '2026-09-01')).toBe('О')
    expect(build.appliedOperationIds).not.toContain(ops[0]!.operationId)
  })

  it('remote already has next value → idempotent ack', () => {
    const baseline = baseStore()
    const local = structuredClone(baseline) as AppStore
    local.months['2026-09']!.fact['row-1']!['2026-09-02'] = '8'
    const ops = diffStoreToOperations(baseline, local, 1, 'user')
    const remote = structuredClone(local) as AppStore
    const build = buildCloudSavePayload({
      remote,
      remoteRevision: 4,
      local,
      baseline,
      operations: ops,
    })
    expect(build.conflicts).toHaveLength(0)
    expect(build.appliedOperationIds).toEqual([ops[0]!.operationId])
  })

  it('cell edit does not carry other stale local months into save', () => {
    const baseline = baseStore()
    const local = structuredClone(baseline) as AppStore
    // Stale local corruption of another month
    local.months['2026-08'] = sheet({
      month: '2026-08',
      plan: {},
      fact: {},
    })
    local.months['2026-09']!.fact['row-1']!['2026-09-02'] = 'В'
    // Only enqueue September cell op (tracker would have Aug ops too — save uses pending only)
    const ops = diffStoreToOperations(baseline, local, 1, 'user').filter(
      (o) => isTimesheetCellOp(o) && o.timesheetCell?.monthKey === '2026-09',
    )
    expect(ops).toHaveLength(1)
    const remote = structuredClone(baseline) as AppStore
    const build = buildCloudSavePayload({
      remote,
      remoteRevision: 5,
      local,
      baseline,
      operations: ops,
    })
    expect(build.store!.months['2026-08']!.fact['row-1']!['2026-08-15']).toBe('В')
    expect(readCellValue(build.store!.months['2026-09'], 'fact', 'row-1', '2026-09-02')).toBe('В')
  })

  it('structural month edit does not silently overwrite remote cells', () => {
    const baseline = baseStore()
    const local = structuredClone(baseline) as AppStore
    local.months['2026-09']!.rows = [
      ...local.months['2026-09']!.rows,
      { id: 'row-3', brigade: 'B', employeeId: 'e3', sortOrder: 2 },
    ]
    const ops = diffStoreToOperations(baseline, local, 1, 'user')
    const remote = structuredClone(baseline) as AppStore
    remote.months['2026-09']!.fact['row-2']!['2026-09-05'] = 'К' // concurrent cell on remote
    const build = buildCloudSavePayload({
      remote,
      remoteRevision: 6,
      local,
      baseline,
      operations: ops,
    })
    // Structural apply keeps remote cells
    expect(readCellValue(build.store!.months['2026-09'], 'fact', 'row-2', '2026-09-05')).toBe('К')
    expect(build.store!.months['2026-09']!.rows.some((r) => r.id === 'row-3')).toBe(true)
  })

  it('structural conflict when remote structure also diverged — fail closed', () => {
    const baseline = baseStore()
    const local = structuredClone(baseline) as AppStore
    local.months['2026-09']!.rows = [
      { id: 'row-1', brigade: 'A', employeeId: 'e1', sortOrder: 0 },
    ]
    const ops = diffStoreToOperations(baseline, local, 1, 'user')
    const remote = structuredClone(baseline) as AppStore
    remote.months['2026-09']!.rows = [
      ...remote.months['2026-09']!.rows,
      { id: 'row-x', brigade: 'X', employeeId: null, sortOrder: 9 },
    ]
    const build = buildCloudSavePayload({
      remote,
      remoteRevision: 7,
      local,
      baseline,
      operations: ops,
    })
    expect(build.conflicts.some((c) => c.entityId.startsWith('month:'))).toBe(true)
    // Remote structure preserved
    expect(build.store!.months['2026-09']!.rows.some((r) => r.id === 'row-x')).toBe(true)
  })

  it('conflict keeps pending operation; Accept Remote drops only that cell', () => {
    const baseline = baseStore()
    const local = structuredClone(baseline) as AppStore
    local.months['2026-09']!.fact['row-1']!['2026-09-01'] = 'Н'
    local.months['2026-09']!.fact['row-1']!['2026-09-02'] = '8'
    const ops = diffStoreToOperations(baseline, local, 1, 'user')
    cloudDirtyTracker.enqueue(ops)
    expect(cloudDirtyTracker.getPending()).toHaveLength(2)

    const remote = structuredClone(baseline) as AppStore
    remote.months['2026-09']!.fact['row-1']!['2026-09-01'] = 'О'
    const build = buildCloudSavePayload({
      remote,
      remoteRevision: 8,
      local,
      baseline,
      operations: cloudDirtyTracker.getPending(),
    })
    expect(build.conflicts).toHaveLength(1)
    expect(build.appliedOperationIds).toHaveLength(1)

    cloudDirtyTracker.setConflicts(build.conflicts)
    // Simulate ack of applied only
    cloudDirtyTracker.acknowledgePersisted(build.appliedOperationIds)
    expect(cloudDirtyTracker.getPending()).toHaveLength(1)
    expect(cloudDirtyTracker.getPending()[0]!.timesheetCell?.dateKey).toBe('2026-09-01')

    const dropped = cloudDirtyTracker.discardConflictingPending()
    expect(dropped).toHaveLength(1)
    expect(cloudDirtyTracker.getPending()).toHaveLength(0)
  })

  it('acknowledge removes only applied IDs', () => {
    cloudDirtyTracker.enqueue([
      {
        operationId: 'op-a',
        type: 'update',
        domain: 'months',
        entityId: 'cell:2026-09:fact:row-1:2026-09-01',
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
      {
        operationId: 'op-b',
        type: 'update',
        domain: 'months',
        entityId: 'cell:2026-09:fact:row-1:2026-09-02',
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
          nextValue: '8',
          explicitClear: false,
        },
      },
    ])
    cloudDirtyTracker.acknowledgePersisted(['op-a'])
    expect(cloudDirtyTracker.getPending().map((o) => o.operationId)).toEqual(['op-b'])
  })

  it('pull-style revision bump does not clear pending', () => {
    cloudDirtyTracker.enqueue([
      {
        operationId: 'op-keep',
        type: 'update',
        domain: 'months',
        entityId: 'cell:x',
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
    cloudDirtyTracker.setBaseRevision(99)
    noteCloudPullCompleted(99)
    expect(cloudDirtyTracker.getPending()).toHaveLength(1)
  })

  it('saved status only after ack semantics: applied IDs returned only when merge succeeds', () => {
    const baseline = baseStore()
    const local = structuredClone(baseline) as AppStore
    local.months['2026-09']!.fact['row-1']!['2026-09-02'] = '8'
    const ops = diffStoreToOperations(baseline, local, 1, 'user')
    const ok = buildCloudSavePayload({
      remote: baseline,
      remoteRevision: 1,
      local,
      baseline,
      operations: ops,
    })
    expect(ok.appliedOperationIds).toEqual([ops[0]!.operationId])
    expect(ok.conflicts).toHaveLength(0)

    const conflicted = buildCloudSavePayload({
      remote: {
        ...baseline,
        months: {
          ...baseline.months,
          '2026-09': {
            ...baseline.months['2026-09']!,
            fact: {
              ...baseline.months['2026-09']!.fact,
              'row-1': { ...baseline.months['2026-09']!.fact['row-1'], '2026-09-02': 'О' },
            },
          },
        },
      },
      remoteRevision: 2,
      local,
      baseline,
      operations: ops,
    })
    expect(conflicted.appliedOperationIds).toHaveLength(0)
    expect(conflicted.conflicts.length).toBeGreaterThan(0)
  })

  it('beforeunload gate active with pending and inactive after ack', () => {
    expect(shouldWarnBeforeUnload({ pendingUserOps: 1, saving: false, unresolvedConflicts: 0 })).toBe(
      true,
    )
    expect(shouldWarnBeforeUnload({ pendingUserOps: 0, saving: true, unresolvedConflicts: 0 })).toBe(
      true,
    )
    expect(shouldWarnBeforeUnload({ pendingUserOps: 0, saving: false, unresolvedConflicts: 2 })).toBe(
      true,
    )
    expect(shouldWarnBeforeUnload({ pendingUserOps: 0, saving: false, unresolvedConflicts: 0 })).toBe(
      false,
    )
  })

  it('empty local month does not wipe filled remote when no month ops', () => {
    const baseline = baseStore()
    const remote = baseline
    const local = { ...baseline, months: {} }
    const build = buildCloudSavePayload({
      remote,
      remoteRevision: 1,
      local,
      baseline,
      operations: [
        {
          operationId: 'op-settings',
          type: 'update',
          domain: 'settings',
          entityId: 'settings',
          fields: ['*'],
          baseRevision: 1,
          origin: 'user',
          at: new Date().toISOString(),
        },
      ],
    })
    expect(Object.keys(build.store!.months['2026-09']!.fact['row-1'] ?? {})).not.toHaveLength(0)
  })

  it('legacy whole-months op is blocked (no silent overwrite)', () => {
    const baseline = baseStore()
    const remote = baseline
    const local = { ...baseline, months: {} }
    const legacy: DirtyOperation = {
      operationId: 'op-legacy',
      type: 'update',
      domain: 'months',
      entityId: '*',
      fields: ['*'],
      baseRevision: 1,
      origin: 'user',
      at: new Date().toISOString(),
    }
    const { months, conflicts, appliedOperationIds } = applyMonthsGranularOperations(
      remote.months,
      baseline.months,
      local.months,
      [legacy],
    )
    expect(appliedOperationIds).toHaveLength(0)
    expect(conflicts.length).toBeGreaterThan(0)
    expect(months['2026-09']!.fact['row-1']!['2026-09-01']).toBe('8')
  })

  it('existing v6 payload round-trip without shape change', () => {
    const store = baseStore()
    const prepared = prepareCloudPayload(sanitizeStoreForExport(store))
    const again = JSON.parse(prepared.json) as AppStore
    expect(again.version).toBe(6)
    expect(again.months['2026-09']!.fact['row-1']!['2026-09-01']).toBe('8')
    expect(again.months['2026-08']!.plan['row-1']!['2026-08-15']).toBe('В')
    // No new required cloud fields
    expect(prepared.json).not.toContain('timesheetCell')
    expect(prepared.json).not.toContain('operationId')
  })

  it('coalesce same cell keeps original baseline', () => {
    cloudDirtyTracker.enqueue([
      {
        operationId: 'op-1',
        type: 'update',
        domain: 'months',
        entityId: timesheetCellEntityId('2026-09', 'fact', 'row-1', '2026-09-01'),
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
        entityId: timesheetCellEntityId('2026-09', 'fact', 'row-1', '2026-09-01'),
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
    const pending = cloudDirtyTracker.getPending()
    expect(pending).toHaveLength(1)
    expect(pending[0]!.timesheetCell?.baselineValue).toBe('8')
    expect(pending[0]!.timesheetCell?.nextValue).toBe('О')
    expect(pending[0]!.operationId).toBe('op-1')
  })
})
