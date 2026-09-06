/**
 * R2.9E-B2 — warehouse/procurement sync persistence (R29D-003/004/006).
 * Accept-cloud must be entity-scoped; self-writes must not false-conflict.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import type { AppStore } from '@/lib/types'
import { acceptCloudScopedMerge } from '@/lib/cloud/acceptCloudScoped'
import { conservativeMergeForSave } from '@/lib/cloud/conservativeMerge'
import {
  buildCloudSavePayload,
  mergeStoreForCloudSave,
} from '@/lib/cloud/cloudSavePipeline'
import {
  cloudDirtyTracker,
  nextOperationId,
  resetCloudDirtyTracker,
  type DirtyOperation,
  type EntityConflict,
} from '@/lib/cloud/dirtyOperations'
import { diffStoreToOperations } from '@/lib/cloud/storeDiff'
import {
  noteCloudPullCompleted,
  resetSyncLifecycle,
  setSyncLifecyclePhase,
} from '@/lib/cloud/syncLifecycle'

function whItem(
  id: string,
  name: string,
  extra: Record<string, unknown> = {},
): AppStore['warehouse']['items'][number] {
  return {
    id,
    name,
    unit: 'kg',
    active: true,
    ...extra,
  } as AppStore['warehouse']['items'][number]
}

function po(
  id: string,
  status: string,
  extra: Record<string, unknown> = {},
): AppStore['procurement']['orders'][number] {
  return {
    id,
    orderNumber: 'ЗЗ-2026-0002',
    status,
    lines: [],
    milestones: [],
    ...extra,
  } as AppStore['procurement']['orders'][number]
}

function baseStore(overrides: Partial<AppStore> = {}): AppStore {
  const warehouseItems = [whItem('w1', 'Latex v1')]
  const orders = [po('po1', 'draft')]
  return {
    version: 6,
    employees: [],
    months: {},
    brigades: [],
    access: { users: [], roles: [] },
    auditLog: [],
    settings: { signatures: {} },
    candidates: [],
    warehouse: {
      items: warehouseItems,
      documents: [],
      movements: [],
      categories: [],
      locations: [{ id: 'loc1', name: 'Main' }],
    },
    sales: { orders: [], reservations: [], allocations: [] },
    procurement: {
      orders,
      categories: [],
      routePoints: [],
    },
    tasks: { tasks: [], attachments: [] },
    production: { requests: [], planner: { orders: [], nextOrderSeq: 1 } },
    finance: {},
    meals: {},
    protocols: {},
    orgChart: {},
    finishedProducts: { items: [] },
    packagingRecipes: { items: [], boxes: [] },
    formulations: { recipes: [], recipeVersions: [], batchRuns: [], mixTasks: [] },
    ...overrides,
  } as AppStore
}

function withItems(store: AppStore, items: AppStore['warehouse']['items']): AppStore {
  return {
    ...store,
    warehouse: { ...store.warehouse, items },
  }
}

function withOrders(store: AppStore, orders: AppStore['procurement']['orders']): AppStore {
  return {
    ...store,
    procurement: { ...store.procurement, orders },
  }
}

function userOp(domain: string, entityId: string, type: DirtyOperation['type'] = 'update'): DirtyOperation {
  return {
    operationId: nextOperationId(),
    type,
    domain,
    entityId,
    fields: ['*'],
    baseRevision: 1,
    origin: 'user',
    at: new Date().toISOString(),
  }
}

describe('R2.9E-B2 warehouse self-write / concurrent edit', () => {
  beforeEach(() => {
    resetCloudDirtyTracker()
    resetSyncLifecycle()
    setSyncLifecyclePhase('ready')
    noteCloudPullCompleted(1)
  })

  it('A: acknowledged self-write (local===remote content, key-order drift) must not concurrent_edit', () => {
    const baseline = baseStore()
    const local = withItems(baseline, [
      whItem('w1', 'Latex v2', { updatedAt: '2026-09-06T12:00:00.000Z', sku: 'EDU-L' }),
    ])
    // SQL round-trip often reorders object keys — must not become concurrent_edit.
    const remote = withItems(baseline, [
      {
        id: 'w1',
        updatedAt: '2026-09-06T12:00:00.000Z',
        sku: 'EDU-L',
        active: true,
        unit: 'kg',
        name: 'Latex v2',
      } as AppStore['warehouse']['items'][number],
    ])

    const { conflicts, store } = conservativeMergeForSave(baseline, remote, local, [])
    expect(conflicts.filter((c) => c.reason === 'concurrent_edit')).toHaveLength(0)
    expect(store.warehouse.items.find((i) => i.id === 'w1')?.name).toBe('Latex v2')
  })

  it('B: sequential self-write after ack — remote==baseline, local advanced', () => {
    const v2 = whItem('w1', 'Latex v2')
    const baseline = withItems(baseStore(), [v2])
    const remote = withItems(baseStore(), [v2])
    const local = withItems(baseStore(), [whItem('w1', 'Latex v3')])

    const { conflicts, store } = conservativeMergeForSave(baseline, remote, local, [])
    expect(conflicts).toHaveLength(0)
    expect(store.warehouse.items.find((i) => i.id === 'w1')?.name).toBe('Latex v3')
  })

  it('C: real concurrent edit still detected (local v2 vs remote v3)', () => {
    const baseline = baseStore()
    const local = withItems(baseline, [whItem('w1', 'Latex v2')])
    const remote = withItems(baseline, [whItem('w1', 'Latex v3')])

    const { conflicts, store } = conservativeMergeForSave(baseline, remote, local, [])
    expect(conflicts.some((c) => c.entityId === 'w1' && c.reason === 'concurrent_edit')).toBe(
      true,
    )
    expect(store.warehouse.items.find((i) => i.id === 'w1')?.name).toBe('Latex v3')
  })
})

describe('R2.9E-B2 cross-domain isolation + operation accounting', () => {
  beforeEach(() => {
    resetCloudDirtyTracker()
    resetSyncLifecycle()
    setSyncLifecyclePhase('ready')
    noteCloudPullCompleted(1)
  })

  it('D: warehouse item conflict does not reject procurement.orders op; PO ordered kept in merge', () => {
    const baseline = baseStore()
    const local = withOrders(withItems(baseline, [whItem('w1', 'Latex v2')]), [
      po('po1', 'ordered'),
    ])
    const remote = withOrders(withItems(baseline, [whItem('w1', 'Latex v3')]), [
      po('po1', 'draft'),
    ])

    const ops = [
      userOp('warehouse.items', 'w1'),
      userOp('procurement.orders', 'po1'),
    ]
    const merged = mergeStoreForCloudSave({
      remote,
      local,
      baseline,
      operations: ops,
    })

    expect(
      merged.conflicts.some((c) => c.domain === 'warehouse.items' && c.entityId === 'w1'),
    ).toBe(true)
    expect(merged.store.procurement.orders.find((o) => o.id === 'po1')?.status).toBe('ordered')
    expect(merged.appliedOperationIds).toContain(ops[1]!.operationId)
    expect(merged.appliedOperationIds).not.toContain(ops[0]!.operationId)
  })

  it('G: appliedOperationIds contain only non-conflicted ops', () => {
    const baseline = baseStore()
    const local = withItems(baseline, [
      whItem('w1', 'Latex v2'),
      whItem('w2', 'Paste v2'),
    ])
    const remote = withItems(baseline, [
      whItem('w1', 'Latex v3'),
      whItem('w2', 'Paste v2'),
    ])
    const ops = [userOp('warehouse.items', 'w1'), userOp('warehouse.items', 'w2')]
    const merged = mergeStoreForCloudSave({ remote, local, baseline, operations: ops })
    expect(merged.appliedOperationIds).toEqual([ops[1]!.operationId])
  })
})

describe('R2.9E-B2 Accept-cloud scope + picker', () => {
  beforeEach(() => {
    resetCloudDirtyTracker()
  })

  it('E: Accept cloud for one warehouse item does not replace PO / formulations / other items', () => {
    const remote = withOrders(
      withItems(baseStore(), [
        whItem('w1', 'Cloud Latex'),
        whItem('w2', 'Cloud only?'),
      ]),
      [po('po1', 'draft')],
    )
    const local = withOrders(
      withItems(baseStore(), [
        whItem('w1', 'Local Latex'),
        whItem('w-edu', 'EDU Paste', { active: true }),
      ]),
      [po('po1', 'ordered')],
    )
    local.formulations = {
      ...local.formulations,
      recipes: [{ id: 'r1', code: 'РП-0002', name: 'EDU' } as never],
    }

    const conflicts: EntityConflict[] = [
      {
        domain: 'warehouse.items',
        entityId: 'w1',
        reason: 'concurrent_edit',
        message: 'Concurrent edit on warehouse.items/w1; cloud kept',
        pendingLocal: whItem('w1', 'Local Latex'),
        cloudSnapshot: whItem('w1', 'Cloud Latex'),
      },
    ]

    const accepted = acceptCloudScopedMerge(local, remote, conflicts)
    expect(accepted.ok).toBe(true)
    if (!accepted.ok) return

    expect(accepted.store.warehouse.items.find((i) => i.id === 'w1')?.name).toBe('Cloud Latex')
    expect(accepted.store.warehouse.items.find((i) => i.id === 'w-edu')?.name).toBe('EDU Paste')
    expect(accepted.store.procurement.orders.find((o) => o.id === 'po1')?.status).toBe('ordered')
    expect(accepted.store.formulations.recipes.some((r) => r.id === 'r1')).toBe(true)
  })

  it('F: picker still sees acknowledged EDU item after scoped accept of unrelated conflict', () => {
    const remote = withItems(baseStore(), [whItem('w1', 'Cloud Latex')])
    const local = withItems(baseStore(), [
      whItem('w1', 'Local Latex'),
      whItem('w-edu', 'EDU Fiber', { active: true }),
    ])
    const conflicts: EntityConflict[] = [
      {
        domain: 'warehouse.items',
        entityId: 'w1',
        reason: 'concurrent_edit',
        cloudSnapshot: whItem('w1', 'Cloud Latex'),
      },
    ]
    const accepted = acceptCloudScopedMerge(local, remote, conflicts)
    expect(accepted.ok).toBe(true)
    if (!accepted.ok) return
    const picker = accepted.store.warehouse.items.filter((i) => i.active !== false)
    expect(picker.map((i) => i.id).sort()).toEqual(['w-edu', 'w1'])
  })

  it('GATE: empty conflict scope is no-op (no full remote replace)', () => {
    const remote = withOrders(withItems(baseStore(), [whItem('w1', 'Cloud')]), [po('po1', 'draft')])
    const local = withOrders(
      withItems(baseStore(), [whItem('w1', 'Local'), whItem('w-edu', 'EDU')]),
      [po('po1', 'ordered')],
    )
    const res = acceptCloudScopedMerge(local, remote, [])
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason).toBe('empty_scope')
    expect(res.store.procurement.orders.find((o) => o.id === 'po1')?.status).toBe('ordered')
    expect(res.store.warehouse.items.find((i) => i.id === 'w-edu')?.name).toBe('EDU')
    expect(res.store.warehouse.items.find((i) => i.id === 'w1')?.name).toBe('Local')
  })

  it('GATE: missing conflict scope is no-op', () => {
    const remote = withItems(baseStore(), [whItem('w1', 'Cloud')])
    const local = withItems(baseStore(), [whItem('w1', 'Local')])
    const res = acceptCloudScopedMerge(local, remote, undefined)
    expect(res).toEqual({
      ok: false,
      reason: 'missing_scope',
      store: expect.objectContaining({
        warehouse: expect.objectContaining({
          items: expect.arrayContaining([expect.objectContaining({ id: 'w1', name: 'Local' })]),
        }),
      }),
    })
  })

  it('GATE: malformed conflict entries refuse without store change', () => {
    const remote = withItems(baseStore(), [whItem('w1', 'Cloud')])
    const local = withItems(baseStore(), [whItem('w1', 'Local'), whItem('w-edu', 'EDU')])
    const bad = [
      { domain: '', entityId: 'w1', reason: 'concurrent_edit', message: 'x' },
      { domain: 'warehouse.items', entityId: 'w1', reason: 'concurrent_edit', message: 'x' },
    ] as EntityConflict[]
    const res = acceptCloudScopedMerge(local, remote, bad)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason).toBe('malformed_scope')
    expect(res.store.warehouse.items.map((i) => i.id).sort()).toEqual(['w-edu', 'w1'])
    expect(res.store.warehouse.items.find((i) => i.id === 'w1')?.name).toBe('Local')
  })

  it('GATE: stale conflict (no cloud entity / snapshot) refuses without wipe', () => {
    const remote = withItems(baseStore(), []) // w1 gone from cloud
    const local = withOrders(
      withItems(baseStore(), [whItem('w1', 'Local'), whItem('w-edu', 'EDU')]),
      [po('po1', 'ordered')],
    )
    const conflicts: EntityConflict[] = [
      {
        domain: 'warehouse.items',
        entityId: 'w1',
        reason: 'concurrent_edit',
        message: 'stale',
        // no cloudSnapshot; remote has no w1
      },
    ]
    const res = acceptCloudScopedMerge(local, remote, conflicts)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason).toBe('stale_scope')
    expect(res.store.procurement.orders.find((o) => o.id === 'po1')?.status).toBe('ordered')
    expect(res.store.warehouse.items.find((i) => i.id === 'w-edu')?.name).toBe('EDU')
    expect(res.store.warehouse.items.find((i) => i.id === 'w1')?.name).toBe('Local')
  })

  it('GATE: unknown domain is malformed (no implicit full replace)', () => {
    const remote = withItems(baseStore(), [whItem('w1', 'Cloud')])
    const local = withItems(baseStore(), [whItem('w1', 'Local')])
    const conflicts = [
      {
        domain: 'not.a.real.domain',
        entityId: 'x',
        reason: 'concurrent_edit',
        message: 'x',
      },
    ] as EntityConflict[]
    const res = acceptCloudScopedMerge(local, remote, conflicts)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason).toBe('malformed_scope')
    expect(res.store.warehouse.items[0]?.name).toBe('Local')
  })

  it('discardConflictingPending keeps unrelated procurement ops', () => {
    cloudDirtyTracker.setBaselineStore(baseStore())
    cloudDirtyTracker.setBaseRevision(1)
    const whOp = userOp('warehouse.items', 'w1')
    const poOp = userOp('procurement.orders', 'po1')
    cloudDirtyTracker.enqueue([whOp, poOp])
    cloudDirtyTracker.setConflicts([
      {
        domain: 'warehouse.items',
        entityId: 'w1',
        reason: 'concurrent_edit',
        operationId: whOp.operationId,
      },
    ])
    const dropped = cloudDirtyTracker.discardConflictingPending()
    expect(dropped).toContain(whOp.operationId)
    expect(dropped).not.toContain(poOp.operationId)
    expect(cloudDirtyTracker.getPending().map((o) => o.operationId)).toEqual([poOp.operationId])
  })
})

describe('R2.9E-B2 save payload accounting', () => {
  beforeEach(() => {
    resetSyncLifecycle()
    setSyncLifecyclePhase('ready')
    noteCloudPullCompleted(1)
  })

  it('buildCloudSavePayload applies PO ordered while reporting WH concurrent_edit', () => {
    const baseline = baseStore()
    const local = withOrders(withItems(baseline, [whItem('w1', 'v2')]), [po('po1', 'ordered')])
    const remote = withOrders(withItems(baseline, [whItem('w1', 'v3')]), [po('po1', 'draft')])
    const ops = diffStoreToOperations(baseline, local, 1, 'user')
    const build = buildCloudSavePayload({
      remote,
      remoteRevision: 3,
      local,
      baseline,
      operations: ops,
    })
    expect(build.allowed).toBe(true)
    expect(build.conflicts.some((c) => c.domain === 'warehouse.items')).toBe(true)
    expect(build.store?.procurement.orders.find((o) => o.id === 'po1')?.status).toBe('ordered')
    expect(build.appliedOperationIds.some((id) => ops.find((o) => o.operationId === id && o.domain === 'procurement.orders'))).toBe(
      true,
    )
  })
})
