/**
 * PHASE W0.6 — cloud transaction groups (warehouse all-or-nothing).
 */
import { describe, expect, it, beforeEach } from 'vitest'
import type { AppStore } from '@/lib/types'
import {
  cloudDirtyTracker,
  resetCloudDirtyTracker,
  type DirtyOperation,
} from '@/lib/cloud/dirtyOperations'
import { buildCloudSavePayload, mergeStoreForCloudSave } from '@/lib/cloud/cloudSavePipeline'
import { diffStoreToOperations } from '@/lib/cloud/storeDiff'
import { applyTrackedStoreUpdate } from '@/store/storeApi'
import {
  classifyAtomicGroupAgainstRemote,
  sanitizeAcknowledgeIds,
  stampOpsWithTransactionGroup,
  warehouseTransactionGroupId,
} from '@/lib/cloud/transactionGroups'
import {
  createMemoryDurableJournalAdapter,
  dirtyOpToJournalRecord,
  DurableJournalController,
  journalRecordToDirtyOp,
  shouldPersistOperationToJournal,
} from '@/lib/cloud/durableJournal'
import { postOpeningInventory } from '@/lib/warehouse/openingInventory'
import { withActiveWarehouses } from '@/lib/warehouse/accountingStatus'
import type { WarehouseItem, WarehouseStore } from '@/lib/warehouse/types'
import {
  noteCloudPullCompleted,
  resetSyncLifecycle,
  setSyncLifecyclePhase,
} from '@/lib/cloud/syncLifecycle'
import { timesheetCellEntityId } from '@/lib/cloud/timesheetCellOps'
import type { TimesheetCellPatch } from '@/lib/cloud/dirtyOperations'

function readyLifecycle(rev = 1) {
  resetSyncLifecycle()
  setSyncLifecyclePhase('ready')
  noteCloudPullCompleted(rev)
}

function whBase(overrides?: Partial<WarehouseStore>): WarehouseStore {
  const item: WarehouseItem = {
    id: 'item-1',
    internalCode: 'RM-1',
    name: 'Сырьё 1',
    categoryId: 'cat-1',
    warehouseId: 'wh-a',
    unit: 'кг',
    active: true,
    sortOrder: 1,
  }
  return {
    locations: [
      { id: 'wh-a', name: 'A', sortOrder: 1 },
      { id: 'wh-b', name: 'B', sortOrder: 2 },
    ],
    categories: [{ id: 'cat-1', name: 'Сырьё', sortOrder: 1 }],
    items: [item],
    movements: [],
    documents: [],
    auditLog: [],
    nextInternalCode: 10,
    invoiceRegistry: [],
    ...overrides,
  }
}

function baseStore(warehouse?: WarehouseStore): AppStore {
  return {
    version: 6,
    employees: [{ id: 'e1', fullName: 'Alice', active: true, schedule: '5/2 8ч', shiftMode: 'day' }],
    months: {
      '2026-09': {
        month: '2026-09',
        rows: [{ id: 'row-1', brigade: 'A', employeeId: 'e1', sortOrder: 0 }],
        plan: { 'row-1': { '2026-09-01': '8' } },
        fact: { 'row-1': { '2026-09-01': '8' } },
        factOverrides: [],
        comments: {},
        substitutions: {},
      },
    },
    candidates: [],
    settings: {},
    brigades: [],
    shiftTemplates: [],
    hrStructuralUnits: [],
    hrPositions: [],
    trash: { employees: [], months: [], candidates: [] },
    warehouse: warehouse ?? whBase(),
    production: { requests: [], planner: { orders: [] } },
    formulations: { recipes: [], batchRuns: [], nextInternalCode: 1 },
  } as AppStore
}

function op(
  partial: Partial<DirtyOperation> & Pick<DirtyOperation, 'operationId' | 'domain' | 'entityId' | 'type'>,
): DirtyOperation {
  return {
    fields: ['*'],
    baseRevision: 1,
    origin: 'user',
    at: '2026-09-02T00:00:00.000Z',
    ...partial,
  }
}

function stampGroup(
  ops: DirtyOperation[],
  kind: string,
  sourceId: string,
  local: AppStore,
  baseline: AppStore,
): DirtyOperation[] {
  return stampOpsWithTransactionGroup(
    ops,
    {
      transactionGroupId: warehouseTransactionGroupId({ kind, sourceId, revision: '1' }),
      transactionGroupKind: kind,
      transactionGroupLabel: kind,
      atomic: true,
    },
    local,
    baseline,
  )
}

beforeEach(() => {
  resetCloudDirtyTracker()
  readyLifecycle(1)
})

describe('W0.6 cloud transaction groups', () => {
  it('clean group → all operation ids applied', () => {
    const baseline = baseStore()
    const remote = structuredClone(baseline)
    const local = structuredClone(baseline)
    local.warehouse = {
      ...local.warehouse,
      documents: [
        {
          id: 'doc-1',
          number: 'Т-1',
          date: '2026-09-02',
          type: 'issue',
          status: 'posted',
          warehouseId: 'wh-a',
          lines: [{ itemId: 'item-1', quantity: 1 }],
          createdAt: '2026-09-02T00:00:00.000Z',
        } as never,
      ],
      movements: [
        {
          id: 'mov-1',
          itemId: 'item-1',
          warehouseId: 'wh-a',
          type: 'issue',
          quantity: 1,
          date: '2026-09-02',
          createdAt: '2026-09-02T00:00:00.000Z',
          documentId: 'doc-1',
        },
      ],
    }
    const raw = diffStoreToOperations(baseline, local, 1, 'user')
    const ops = stampGroup(raw, 'warehouse_transfer', 'pair-1', local, baseline)
    const build = buildCloudSavePayload({
      remote,
      remoteRevision: 1,
      local,
      baseline,
      operations: ops,
    })
    expect(build.allowed).toBe(true)
    expect(build.conflicts).toHaveLength(0)
    expect(new Set(build.appliedOperationIds).size).toBe(ops.length)
    expect(ops.every((o) => build.appliedOperationIds.includes(o.operationId))).toBe(true)
    expect(build.store?.warehouse.documents.some((d) => d.id === 'doc-1')).toBe(true)
  })

  it('document conflict → neither document nor movements nor status applied', () => {
    const baseline = baseStore()
    const remote = structuredClone(baseline)
    remote.warehouse.documents = [
      {
        id: 'doc-1',
        number: 'CLOUD',
        date: '2026-09-01',
        type: 'issue',
        status: 'posted',
        warehouseId: 'wh-a',
        lines: [{ itemId: 'item-1', quantity: 9 }],
        createdAt: '2026-09-01T00:00:00.000Z',
      } as never,
    ]
    const local = structuredClone(baseline)
    local.warehouse = {
      ...local.warehouse,
      documents: [
        {
          id: 'doc-1',
          number: 'LOCAL',
          date: '2026-09-02',
          type: 'issue',
          status: 'posted',
          warehouseId: 'wh-a',
          lines: [{ itemId: 'item-1', quantity: 1 }],
          createdAt: '2026-09-02T00:00:00.000Z',
        } as never,
      ],
      movements: [
        {
          id: 'mov-1',
          itemId: 'item-1',
          warehouseId: 'wh-a',
          type: 'issue',
          quantity: 1,
          date: '2026-09-02',
          createdAt: '2026-09-02T00:00:00.000Z',
          documentId: 'doc-1',
        },
      ],
      accountingByWarehouse: [{ id: 'wh-a', warehouseId: 'wh-a', status: 'active' }],
    }
    // Both sides created diverging doc-1 (no baseline entity)
    const ops = stampGroup(
      [
        op({ operationId: 'g-doc', type: 'create', domain: 'warehouse.documents', entityId: 'doc-1' }),
        op({ operationId: 'g-mov', type: 'create', domain: 'warehouse.movements', entityId: 'mov-1' }),
        op({
          operationId: 'g-acc',
          type: 'create',
          domain: 'warehouse.accountingByWarehouse',
          entityId: 'wh-a',
        }),
      ],
      'opening_inventory',
      'wh-a',
      local,
      baseline,
    )
    const build = buildCloudSavePayload({
      remote,
      remoteRevision: 1,
      local,
      baseline,
      operations: ops,
    })
    expect(build.appliedOperationIds).toHaveLength(0)
    expect(build.conflicts.every((c) => c.reason === 'atomic_group_conflict' || c.reason === 'concurrent_edit')).toBe(
      true,
    )
    expect(build.store?.warehouse.documents.find((d) => d.id === 'doc-1')?.number).toBe('CLOUD')
    expect(build.store?.warehouse.movements.some((m) => m.id === 'mov-1')).toBe(false)
    expect(build.store?.warehouse.accountingByWarehouse?.find((a) => a.warehouseId === 'wh-a')?.status).not.toBe(
      'active',
    )
  })

  it('movement conflict blocks accounting active', () => {
    const baseline = baseStore()
    const remote = structuredClone(baseline)
    remote.warehouse.movements = [
      {
        id: 'mov-1',
        itemId: 'item-1',
        warehouseId: 'wh-a',
        type: 'receipt',
        quantity: 50,
        date: '2026-09-01',
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ]
    const local = structuredClone(baseline)
    local.warehouse = {
      ...local.warehouse,
      movements: [
        {
          id: 'mov-1',
          itemId: 'item-1',
          warehouseId: 'wh-a',
          type: 'receipt',
          quantity: 40,
          date: '2026-09-02',
          createdAt: '2026-09-02T00:00:00.000Z',
        },
      ],
      accountingByWarehouse: [{ id: 'wh-a', warehouseId: 'wh-a', status: 'active' }],
    }
    const ops = stampGroup(
      [
        op({ operationId: 'g-mov', type: 'create', domain: 'warehouse.movements', entityId: 'mov-1' }),
        op({
          operationId: 'g-acc',
          type: 'create',
          domain: 'warehouse.accountingByWarehouse',
          entityId: 'wh-a',
        }),
      ],
      'opening_inventory',
      'wh-a',
      local,
      baseline,
    )
    const build = buildCloudSavePayload({
      remote,
      remoteRevision: 1,
      local,
      baseline,
      operations: ops,
    })
    expect(build.appliedOperationIds).toHaveLength(0)
    expect(build.store?.warehouse.accountingByWarehouse?.some((a) => a.status === 'active') ?? false).toBe(
      false,
    )
  })

  it('opening inventory cannot save active without delta movements (group conflict)', () => {
    const baseline = baseStore()
    const remote = structuredClone(baseline)
    // Remote already has conflicting accounting row
    remote.warehouse.accountingByWarehouse = [
      { id: 'wh-a', warehouseId: 'wh-a', status: 'reconciling' },
    ]
    const local = structuredClone(baseline)
    const posted = postOpeningInventory(local.warehouse, {
      number: 'НВИ-1',
      date: '2026-09-02',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', countedQty: 40 }],
    })
    expect(posted.result.ok).toBe(true)
    local.warehouse = posted.store
    // Remote accounting diverged from baseline (empty → reconciling) while local wants active
    const ops = stampGroup(
      diffStoreToOperations(baseline, local, 1, 'user'),
      'opening_inventory',
      'wh-a',
      local,
      baseline,
    )
    // Force accounting conflict: remote changed accounting independently
    remote.warehouse.accountingByWarehouse = [
      { id: 'wh-a', warehouseId: 'wh-a', status: 'reconciling', note: 'remote-hold' },
    ]
    const build = buildCloudSavePayload({
      remote,
      remoteRevision: 1,
      local,
      baseline,
      operations: ops,
    })
    expect(build.appliedOperationIds).toHaveLength(0)
    const payload = JSON.parse(build.payloadJson ?? '{}') as AppStore
    expect(payload.warehouse?.documents?.some((d) => d.purpose === 'opening_inventory')).toBeFalsy()
    expect(payload.warehouse?.accountingByWarehouse?.find((a) => a.warehouseId === 'wh-a')?.status).toBe(
      'reconciling',
    )
  })

  it('W0.5 scenario: accounting-only remote conflict excludes opening doc and delta movements from payload', () => {
    const baseline = baseStore()
    const local = structuredClone(baseline)
    const posted = postOpeningInventory(local.warehouse, {
      number: 'НВИ-2',
      date: '2026-09-02',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', countedQty: 25 }],
    })
    local.warehouse = posted.store
    const remote = structuredClone(baseline)
    remote.warehouse.accountingByWarehouse = [
      { id: 'wh-a', warehouseId: 'wh-a', status: 'reconciling', note: 'other-client' },
    ]
    const ops = stampGroup(
      diffStoreToOperations(baseline, local, 1, 'user'),
      'opening_inventory',
      'wh-a',
      local,
      baseline,
    )
    const build = buildCloudSavePayload({
      remote,
      remoteRevision: 1,
      local,
      baseline,
      operations: ops,
    })
    expect(build.appliedOperationIds).toHaveLength(0)
    const payload = JSON.parse(build.payloadJson ?? '{}') as AppStore
    expect(payload.warehouse.documents ?? []).toHaveLength(0)
    const deltaMovs = (payload.warehouse.movements ?? []).filter((m) =>
      (local.warehouse.movements ?? []).some((lm) => lm.id === m.id),
    )
    expect(deltaMovs).toHaveLength(0)
    expect(payload.warehouse.accountingByWarehouse?.[0]?.status).toBe('reconciling')
  })

  it('opening inventory cannot save movements without active (blocked whole group)', () => {
    const baseline = baseStore()
    const remote = structuredClone(baseline)
    remote.warehouse.accountingByWarehouse = [
      { id: 'wh-a', warehouseId: 'wh-a', status: 'uninitialized' },
    ]
    const local = structuredClone(baseline)
    local.warehouse = {
      ...local.warehouse,
      movements: [
        {
          id: 'mov-delta',
          itemId: 'item-1',
          warehouseId: 'wh-a',
          type: 'receipt',
          quantity: 10,
          date: '2026-09-02',
          createdAt: '2026-09-02T00:00:00.000Z',
        },
      ],
      accountingByWarehouse: [{ id: 'wh-a', warehouseId: 'wh-a', status: 'active' }],
    }
    // Conflict on accounting
    const ops = stampGroup(
      [
        op({ operationId: 'm1', type: 'create', domain: 'warehouse.movements', entityId: 'mov-delta' }),
        op({
          operationId: 'a1',
          type: 'update',
          domain: 'warehouse.accountingByWarehouse',
          entityId: 'wh-a',
          baselineEntity: { id: 'wh-a', warehouseId: 'wh-a', status: 'uninitialized' },
        }),
      ],
      'opening_inventory',
      'wh-a',
      local,
      baseline,
    )
    // Force conflict: remote already active with different note
    remote.warehouse.accountingByWarehouse = [
      { id: 'wh-a', warehouseId: 'wh-a', status: 'active', note: 'foreign' },
    ]
    const build2 = buildCloudSavePayload({
      remote,
      remoteRevision: 1,
      local,
      baseline,
      operations: ops,
    })
    expect(build2.appliedOperationIds).toHaveLength(0)
    expect(build2.store?.warehouse.movements.some((m) => m.id === 'mov-delta')).toBe(false)
  })

  it('production request does not become posted without warehouse docs', () => {
    const baseline = baseStore()
    const remote = structuredClone(baseline)
    remote.warehouse.documents = [
      {
        id: 'iss-1',
        number: 'X',
        date: '2026-09-01',
        type: 'issue',
        status: 'posted',
        warehouseId: 'wh-a',
        lines: [],
        createdAt: '2026-09-01T00:00:00.000Z',
      } as never,
    ]
    const local = structuredClone(baseline)
    local.warehouse.documents = [
      {
        id: 'iss-1',
        number: 'Y',
        date: '2026-09-02',
        type: 'issue',
        status: 'posted',
        warehouseId: 'wh-a',
        lines: [],
        createdAt: '2026-09-02T00:00:00.000Z',
      } as never,
    ]
    local.production = {
      requests: [
        {
          id: 'req-1',
          status: 'posted',
          productId: 'p1',
          quantity: 1,
          date: '2026-09-02',
          planSegments: [],
        } as never,
      ],
      planner: { orders: [] },
    }
    const ops = stampGroup(
      [
        op({ operationId: 'd1', type: 'create', domain: 'warehouse.documents', entityId: 'iss-1' }),
        op({ operationId: 'r1', type: 'create', domain: 'production.requests', entityId: 'req-1' }),
      ],
      'production_request',
      'req-1',
      local,
      baseline,
    )
    const build = buildCloudSavePayload({
      remote,
      remoteRevision: 1,
      local,
      baseline,
      operations: ops,
    })
    expect(build.appliedOperationIds).toHaveLength(0)
    expect(build.store?.production.requests.some((r) => r.id === 'req-1')).toBe(false)
  })

  it('transfer pair saves wholly or not at all', () => {
    const baseline = baseStore(withActiveWarehouses(whBase(), ['wh-a', 'wh-b']))
    const remote = structuredClone(baseline)
    remote.warehouse.documents = [
      {
        id: 'out-1',
        number: 'remote',
        date: '2026-09-01',
        type: 'issue',
        status: 'posted',
        warehouseId: 'wh-a',
        lines: [],
        createdAt: '2026-09-01T00:00:00.000Z',
        transferPairId: 'pair-1',
      } as never,
    ]
    const local = structuredClone(baseline)
    local.warehouse.documents = [
      {
        id: 'out-1',
        number: 'local-out',
        date: '2026-09-02',
        type: 'issue',
        status: 'posted',
        warehouseId: 'wh-a',
        lines: [{ itemId: 'item-1', quantity: 1 }],
        createdAt: '2026-09-02T00:00:00.000Z',
        transferPairId: 'pair-1',
      } as never,
      {
        id: 'in-1',
        number: 'local-in',
        date: '2026-09-02',
        type: 'receipt',
        status: 'posted',
        warehouseId: 'wh-b',
        lines: [{ itemId: 'item-1', quantity: 1 }],
        createdAt: '2026-09-02T00:00:00.000Z',
        transferPairId: 'pair-1',
      } as never,
    ]
    const ops = stampGroup(
      [
        op({ operationId: 't-out', type: 'create', domain: 'warehouse.documents', entityId: 'out-1' }),
        op({ operationId: 't-in', type: 'create', domain: 'warehouse.documents', entityId: 'in-1' }),
      ],
      'warehouse_transfer',
      'pair-1',
      local,
      baseline,
    )
    const build = buildCloudSavePayload({
      remote,
      remoteRevision: 1,
      local,
      baseline,
      operations: ops,
    })
    expect(build.appliedOperationIds).toHaveLength(0)
    expect(build.store?.warehouse.documents.some((d) => d.id === 'in-1')).toBe(false)
  })

  it('batch status saves with issue/receipt or not at all', () => {
    const baseline = baseStore(withActiveWarehouses(whBase(), ['wh-a']))
    const remote = structuredClone(baseline)
    remote.formulations = {
      recipes: [],
      batchRuns: [{ id: 'run-1', status: 'pending', mixedAt: '2026-09-01' } as never],
      nextInternalCode: 1,
    }
    const local = structuredClone(baseline)
    local.formulations = {
      recipes: [],
      batchRuns: [{ id: 'run-1', status: 'confirmed', mixedAt: '2026-09-01' } as never],
      nextInternalCode: 1,
    }
    local.warehouse.documents = [
      {
        id: 'b-iss',
        number: 'BI',
        date: '2026-09-02',
        type: 'issue',
        status: 'posted',
        warehouseId: 'wh-a',
        lines: [],
        createdAt: '2026-09-02T00:00:00.000Z',
      } as never,
      {
        id: 'b-rec',
        number: 'BR',
        date: '2026-09-02',
        type: 'receipt',
        status: 'posted',
        warehouseId: 'wh-a',
        lines: [],
        createdAt: '2026-09-02T00:00:00.000Z',
      } as never,
    ]
    // Conflict on batch run (both updated from missing baseline differently)
    baseline.formulations = {
      recipes: [],
      batchRuns: [{ id: 'run-1', status: 'pending', mixedAt: '2026-09-01' } as never],
      nextInternalCode: 1,
    }
    remote.formulations.batchRuns = [{ id: 'run-1', status: 'rejected', mixedAt: '2026-09-01' } as never]
    const ops = stampGroup(
      [
        op({
          operationId: 'br',
          type: 'update',
          domain: 'formulations.batchRuns',
          entityId: 'run-1',
          baselineEntity: baseline.formulations.batchRuns[0],
        }),
        op({ operationId: 'bi', type: 'create', domain: 'warehouse.documents', entityId: 'b-iss' }),
        op({ operationId: 'bc', type: 'create', domain: 'warehouse.documents', entityId: 'b-rec' }),
      ],
      'batch_mix',
      'run-1',
      local,
      baseline,
    )
    const build = buildCloudSavePayload({
      remote,
      remoteRevision: 1,
      local,
      baseline,
      operations: ops,
    })
    expect(build.appliedOperationIds).toHaveLength(0)
    expect(build.store?.warehouse.documents.some((d) => d.id === 'b-iss')).toBe(false)
    expect(build.store?.formulations.batchRuns.find((r) => r.id === 'run-1')?.status).toBe('rejected')
  })

  it('cancel pair saves wholly or not at all', () => {
    const baseline = baseStore()
    baseline.warehouse.documents = [
      {
        id: 'out-1',
        number: 'O',
        date: '2026-09-01',
        type: 'issue',
        status: 'posted',
        warehouseId: 'wh-a',
        lines: [],
        createdAt: '2026-09-01T00:00:00.000Z',
        transferPairId: 'pair-x',
      } as never,
      {
        id: 'in-1',
        number: 'I',
        date: '2026-09-01',
        type: 'receipt',
        status: 'posted',
        warehouseId: 'wh-b',
        lines: [],
        createdAt: '2026-09-01T00:00:00.000Z',
        transferPairId: 'pair-x',
      } as never,
    ]
    const remote = structuredClone(baseline)
    remote.warehouse.documents = remote.warehouse.documents.map((d) =>
      d.id === 'out-1' ? { ...d, comment: 'touched-remote' } : d,
    )
    const local = structuredClone(baseline)
    local.warehouse.documents = local.warehouse.documents.map((d) => ({
      ...d,
      status: 'cancelled' as const,
    }))
    const ops = stampGroup(
      [
        op({
          operationId: 'c1',
          type: 'update',
          domain: 'warehouse.documents',
          entityId: 'out-1',
          baselineEntity: baseline.warehouse.documents[0],
        }),
        op({
          operationId: 'c2',
          type: 'update',
          domain: 'warehouse.documents',
          entityId: 'in-1',
          baselineEntity: baseline.warehouse.documents[1],
        }),
      ],
      'cancel_transfer_pair',
      'pair-x',
      local,
      baseline,
    )
    const build = buildCloudSavePayload({
      remote,
      remoteRevision: 1,
      local,
      baseline,
      operations: ops,
    })
    expect(build.appliedOperationIds).toHaveLength(0)
    expect(build.store?.warehouse.documents.find((d) => d.id === 'in-1')?.status).toBe('posted')
  })

  it('blocked group stays fully pending; subset ack rejected', () => {
    const ops = stampGroup(
      [
        op({ operationId: 'a', type: 'create', domain: 'warehouse.documents', entityId: 'd1' }),
        op({ operationId: 'b', type: 'create', domain: 'warehouse.movements', entityId: 'm1' }),
      ],
      'warehouse_transfer',
      'p',
      baseStore(),
      baseStore(),
    )
    cloudDirtyTracker.enqueue(ops)
    const { safeIds, diagnostic } = sanitizeAcknowledgeIds(cloudDirtyTracker.getPending(), ['a'])
    expect(safeIds).toHaveLength(0)
    expect(diagnostic).toMatch(/atomic_group_ack_rejected/)
    cloudDirtyTracker.acknowledgePersisted(['a'])
    expect(cloudDirtyTracker.getPending()).toHaveLength(2)
  })

  it('SQL revision conflict path does not ack group (caller must not ack)', () => {
    // Simulate: build succeeds, but ack is skipped on revision conflict — pending remains.
    const baseline = baseStore()
    const local = structuredClone(baseline)
    local.warehouse.documents = [
      {
        id: 'd-ok',
        number: '1',
        date: '2026-09-02',
        type: 'receipt',
        status: 'posted',
        warehouseId: 'wh-a',
        lines: [],
        createdAt: '2026-09-02T00:00:00.000Z',
      } as never,
    ]
    const ops = stampGroup(
      diffStoreToOperations(baseline, local, 1, 'user'),
      'warehouse_transfer',
      'ok',
      local,
      baseline,
    )
    cloudDirtyTracker.enqueue(ops)
    const build = buildCloudSavePayload({
      remote: baseline,
      remoteRevision: 1,
      local,
      baseline,
      operations: ops,
    })
    expect(build.appliedOperationIds.length).toBeGreaterThan(0)
    // revision conflict → do not call acknowledgePersisted
    expect(cloudDirtyTracker.getPending().length).toBe(ops.length)
  })

  it('durable journal stores group metadata; reload all-next clears group; mixed → partial_remote_group', async () => {
    const baseline = baseStore()
    const local = structuredClone(baseline)
    local.warehouse.documents = [
      {
        id: 'jd1',
        number: '1',
        date: '2026-09-02',
        type: 'receipt',
        status: 'posted',
        warehouseId: 'wh-a',
        lines: [],
        createdAt: '2026-09-02T00:00:00.000Z',
      } as never,
    ]
    local.warehouse.movements = [
      {
        id: 'jm1',
        itemId: 'item-1',
        warehouseId: 'wh-a',
        type: 'receipt',
        quantity: 1,
        date: '2026-09-02',
        createdAt: '2026-09-02T00:00:00.000Z',
        documentId: 'jd1',
      },
    ]
    // Entity-level ops only (no composite *) so mixed remote classifies as partial_remote_group
    const entityOps = stampGroup(
      [
        op({
          operationId: 'jd',
          type: 'create',
          domain: 'warehouse.documents',
          entityId: 'jd1',
          pendingLocal: local.warehouse.documents[0],
        }),
        op({
          operationId: 'jm',
          type: 'create',
          domain: 'warehouse.movements',
          entityId: 'jm1',
          pendingLocal: local.warehouse.movements[0],
        }),
      ],
      'warehouse_transfer',
      'j',
      local,
      baseline,
    )
    expect(entityOps.every((o) => shouldPersistOperationToJournal(o))).toBe(true)
    const rec = dirtyOpToJournalRecord(entityOps[0]!, 'scope', 'pending')
    expect(rec.transactionGroupId).toBeTruthy()
    expect(journalRecordToDirtyOp(rec).transactionGroupId).toBe(rec.transactionGroupId)

    const adapter = createMemoryDurableJournalAdapter()
    const ctl = new DurableJournalController(adapter)
    await ctl.bindScope({
      projectId: 'p',
      uid: 'u',
      storeDocId: 'store',
      appStoreVersion: 6,
    })
    for (const o of entityOps) await ctl.persistOperation(o)

    // all-next
    const restoredIdem = await ctl.restoreAfterCloudLoad(local)
    expect(restoredIdem.idempotentIds.length).toBe(entityOps.length)
    expect(restoredIdem.recoverableOps).toHaveLength(0)

    // re-persist for mixed case
    for (const o of entityOps) await ctl.persistOperation(o)
    const mixed = structuredClone(baseline)
    mixed.warehouse.documents = [local.warehouse.documents[0]!]
    const classified = classifyAtomicGroupAgainstRemote(entityOps, mixed)
    expect(classified).toBe('partial_remote_group')
    const restoredMixed = await ctl.restoreAfterCloudLoad(mixed)
    expect(restoredMixed.sqlWriteCount).toBe(0)
    expect(restoredMixed.conflictOps.length).toBe(entityOps.length)
    expect(ctl.isRecoveryHoldActive()).toBe(true)
  })

  it('ungrouped timesheet cells save independently of warehouse groups', () => {
    const baseline = baseStore()
    const remote = structuredClone(baseline)
    // Conflict warehouse group
    remote.warehouse.documents = [
      {
        id: 'wx',
        number: 'r',
        date: '2026-09-01',
        type: 'issue',
        status: 'posted',
        warehouseId: 'wh-a',
        lines: [],
        createdAt: '2026-09-01T00:00:00.000Z',
      } as never,
    ]
    const local = structuredClone(baseline)
    local.warehouse.documents = [
      {
        id: 'wx',
        number: 'l',
        date: '2026-09-02',
        type: 'issue',
        status: 'posted',
        warehouseId: 'wh-a',
        lines: [],
        createdAt: '2026-09-02T00:00:00.000Z',
      } as never,
    ]
    local.months = {
      '2026-09': {
        ...baseline.months['2026-09']!,
        fact: { 'row-1': { '2026-09-01': '7' } },
      },
    }
    const groupOps = stampGroup(
      [op({ operationId: 'w1', type: 'create', domain: 'warehouse.documents', entityId: 'wx' })],
      'warehouse_transfer',
      'x',
      local,
      baseline,
    )
    const cell: TimesheetCellPatch = {
      monthKey: '2026-09',
      employeeId: 'e1',
      rowId: 'row-1',
      dateKey: '2026-09-01',
      layer: 'fact',
      baselineValue: '8',
      nextValue: '7',
    }
    const cellOp = op({
      operationId: 'cell-1',
      type: 'update',
      domain: 'months',
      entityId: timesheetCellEntityId(cell),
      timesheetCell: cell,
    })
    const build = buildCloudSavePayload({
      remote,
      remoteRevision: 1,
      local,
      baseline,
      operations: [...groupOps, cellOp],
    })
    expect(build.appliedOperationIds).toContain('cell-1')
    expect(build.appliedOperationIds).not.toContain('w1')
    expect(build.store?.months['2026-09']?.fact?.['row-1']?.['2026-09-01']).toBe('7')
  })

  it('two groups: clean applies, conflicting stays wholly pending', () => {
    const baseline = baseStore()
    const remote = structuredClone(baseline)
    remote.warehouse.documents = [
      {
        id: 'bad',
        number: 'r',
        date: '2026-09-01',
        type: 'issue',
        status: 'posted',
        warehouseId: 'wh-a',
        lines: [],
        createdAt: '2026-09-01T00:00:00.000Z',
      } as never,
    ]
    const local = structuredClone(baseline)
    local.warehouse.documents = [
      {
        id: 'bad',
        number: 'l',
        date: '2026-09-02',
        type: 'issue',
        status: 'posted',
        warehouseId: 'wh-a',
        lines: [],
        createdAt: '2026-09-02T00:00:00.000Z',
      } as never,
      {
        id: 'good',
        number: 'g',
        date: '2026-09-02',
        type: 'receipt',
        status: 'posted',
        warehouseId: 'wh-a',
        lines: [],
        createdAt: '2026-09-02T00:00:00.000Z',
      } as never,
    ]
    const bad = stampGroup(
      [op({ operationId: 'bad1', type: 'create', domain: 'warehouse.documents', entityId: 'bad' })],
      'warehouse_transfer',
      'bad',
      local,
      baseline,
    )
    const good = stampOpsWithTransactionGroup(
      [op({ operationId: 'good1', type: 'create', domain: 'warehouse.documents', entityId: 'good' })],
      {
        transactionGroupId: warehouseTransactionGroupId({
          kind: 'warehouse_transfer',
          sourceId: 'good',
          revision: '1',
        }),
        transactionGroupKind: 'warehouse_transfer',
        atomic: true,
      },
      local,
      baseline,
    )
    const build = buildCloudSavePayload({
      remote,
      remoteRevision: 1,
      local,
      baseline,
      operations: [...bad, ...good],
    })
    expect(build.appliedOperationIds).toContain('good1')
    expect(build.appliedOperationIds).not.toContain('bad1')
    expect(build.store?.warehouse.documents.some((d) => d.id === 'good')).toBe(true)
    expect(build.store?.warehouse.documents.find((d) => d.id === 'bad')?.number).toBe('r')
  })

  it('explicit delete inside group blocks whole group on conflict', () => {
    const baseline = baseStore()
    baseline.warehouse.documents = [
      {
        id: 'del-1',
        number: 'D',
        date: '2026-09-01',
        type: 'issue',
        status: 'posted',
        warehouseId: 'wh-a',
        lines: [],
        createdAt: '2026-09-01T00:00:00.000Z',
      } as never,
    ]
    const remote = structuredClone(baseline)
    remote.warehouse.documents = [
      {
        ...baseline.warehouse.documents[0]!,
        comment: 'changed',
      },
    ]
    const local = structuredClone(baseline)
    local.warehouse.documents = []
    local.warehouse.movements = [
      {
        id: 'rev-1',
        itemId: 'item-1',
        warehouseId: 'wh-a',
        type: 'receipt',
        quantity: 1,
        date: '2026-09-02',
        createdAt: '2026-09-02T00:00:00.000Z',
      },
    ]
    const ops = stampGroup(
      [
        op({
          operationId: 'del',
          type: 'delete',
          domain: 'warehouse.documents',
          entityId: 'del-1',
          explicit: true,
          baselineEntity: baseline.warehouse.documents[0],
        }),
        op({ operationId: 'rev', type: 'create', domain: 'warehouse.movements', entityId: 'rev-1' }),
      ],
      'cancel_transfer_pair',
      'del-1',
      local,
      baseline,
    )
    const build = buildCloudSavePayload({
      remote,
      remoteRevision: 1,
      local,
      baseline,
      operations: ops,
    })
    expect(build.appliedOperationIds).toHaveLength(0)
    expect(build.store?.warehouse.documents.some((d) => d.id === 'del-1')).toBe(true)
    expect(build.store?.warehouse.movements.some((m) => m.id === 'rev-1')).toBe(false)
  })

  it('legacy operations without transactionGroupId keep partial behavior', () => {
    const baseline = baseStore()
    const remote = structuredClone(baseline)
    remote.warehouse.documents = [
      {
        id: 'c1',
        number: 'r',
        date: '2026-09-01',
        type: 'issue',
        status: 'posted',
        warehouseId: 'wh-a',
        lines: [],
        createdAt: '2026-09-01T00:00:00.000Z',
      } as never,
    ]
    const local = structuredClone(baseline)
    local.warehouse.documents = [
      {
        id: 'c1',
        number: 'l',
        date: '2026-09-02',
        type: 'issue',
        status: 'posted',
        warehouseId: 'wh-a',
        lines: [],
        createdAt: '2026-09-02T00:00:00.000Z',
      } as never,
      {
        id: 'ok',
        number: 'ok',
        date: '2026-09-02',
        type: 'receipt',
        status: 'posted',
        warehouseId: 'wh-a',
        lines: [],
        createdAt: '2026-09-02T00:00:00.000Z',
      } as never,
    ]
    const ops: DirtyOperation[] = [
      op({ operationId: 'legacy-c', type: 'create', domain: 'warehouse.documents', entityId: 'c1' }),
      op({ operationId: 'legacy-ok', type: 'create', domain: 'warehouse.documents', entityId: 'ok' }),
    ]
    const merged = mergeStoreForCloudSave({
      remote,
      local,
      baseline,
      operations: ops,
    })
    expect(merged.appliedOperationIds).toContain('legacy-ok')
    expect(merged.appliedOperationIds).not.toContain('legacy-c')
  })

  it('applyTrackedStoreUpdate stamps meta onto dirty ops', () => {
    const prev = baseStore()
    const next = structuredClone(prev)
    next.warehouse.documents = [
      {
        id: 'meta-1',
        number: '1',
        date: '2026-09-02',
        type: 'receipt',
        status: 'posted',
        warehouseId: 'wh-a',
        lines: [],
        createdAt: '2026-09-02T00:00:00.000Z',
      } as never,
    ]
    applyTrackedStoreUpdate(prev, next, {
      origin: 'user',
      atomic: true,
      transactionGroupId: warehouseTransactionGroupId({
        kind: 'opening_inventory',
        sourceId: 'wh-a',
        revision: '1',
      }),
      transactionGroupKind: 'opening_inventory',
    })
    const pending = cloudDirtyTracker.getPending()
    expect(pending.length).toBeGreaterThan(0)
    expect(pending.every((p) => p.atomic && p.transactionGroupId?.includes('opening_inventory'))).toBe(
      true,
    )
  })
})
