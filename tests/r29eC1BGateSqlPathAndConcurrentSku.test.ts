/**
 * R2.9E-C1B-GATE — SQL Connect save path + concurrent SKU fail-closed.
 * Exercises buildCloudSavePayload / conservativeMergeForSave (FstSqlConnectSync.flushSave),
 * not mergeCloudStores alone.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import type { AppStore } from '@/lib/types'
import { createDefaultStore } from '@/lib/storage'
import {
  buildCloudSavePayload,
  mergeStoreForCloudSave,
} from '@/lib/cloud/cloudSavePipeline'
import { conservativeMergeForSave } from '@/lib/cloud/conservativeMerge'
import { diffStoreToOperations } from '@/lib/cloud/storeDiff'
import {
  noteCloudPullCompleted,
  resetSyncLifecycle,
  setSyncLifecyclePhase,
} from '@/lib/cloud/syncLifecycle'
import { type DirtyOperation, resetCloudDirtyTracker } from '@/lib/cloud/dirtyOperations'

function whItem(
  id: string,
  name: string,
  extra: Partial<WarehouseItem> = {},
): WarehouseItem {
  return {
    id,
    name,
    unit: 'kg',
    categoryId: 'cat1',
    warehouseId: 'loc1',
    active: true,
    sortOrder: 0,
    ...extra,
  } as WarehouseItem
}

function baseStore(overrides: Partial<AppStore> = {}): AppStore {
  const d = createDefaultStore()
  return {
    ...d,
    warehouse: {
      ...d.warehouse,
      locations: [{ id: 'loc1', name: 'Main', sortOrder: 0 }],
      categories: [{ id: 'cat1', name: 'Химия', sortOrder: 0 }],
      items: [],
      movements: [],
      documents: [],
      nextInternalCode: 10,
    },
    procurement: {
      ...d.procurement,
      orders: [
        {
          id: 'po1',
          orderNumber: 'ЗЗ-GATE-1',
          status: 'draft',
          lines: [],
          milestones: [],
        } as AppStore['procurement']['orders'][number],
      ],
    },
    formulations: {
      ...d.formulations,
      recipes: [
        {
          id: 'rec1',
          code: 'РП-GATE',
          name: 'Recipe gate',
        } as AppStore['formulations']['recipes'][number],
      ],
    },
    ...overrides,
  } as AppStore
}

function withItems(store: AppStore, items: WarehouseItem[], next?: number): AppStore {
  return {
    ...store,
    warehouse: {
      ...store.warehouse,
      items,
      ...(next != null ? { nextInternalCode: next } : {}),
    },
  }
}

function userOps(baseline: AppStore, local: AppStore): DirtyOperation[] {
  return diffStoreToOperations(baseline, local, 1, 'user')
}

function armLifecycle() {
  resetSyncLifecycle()
  setSyncLifecyclePhase('ready')
  noteCloudPullCompleted(1)
  resetCloudDirtyTracker()
}

function isSkuConflict(c: { message?: string; reason?: string }): boolean {
  const m = String(c.message ?? '')
  return (
    m.includes('warehouse.err.duplicateSku') ||
    m.includes('duplicateSku') ||
    m.includes('Concurrent SKU') ||
    m.includes('SKU conflict')
  )
}

describe('R2.9E-C1B-GATE SQL Connect path + concurrent SKU', () => {
  beforeEach(() => {
    armLifecycle()
  })

  it('SQL path: concurrent FC create reallocates local, keeps remote, emits ops, reload-safe', () => {
    const baseline = baseStore()
    const remote = withItems(baseline, [whItem('item-R', 'Remote', { internalCode: 'FC-000010' })], 11)
    const local = withItems(baseline, [whItem('item-L', 'Local', { internalCode: 'FC-000010' })], 11)
    const ops = userOps(baseline, local)
    expect(ops.some((o) => o.domain === 'warehouse.items' && o.entityId === 'item-L')).toBe(true)

    const build = buildCloudSavePayload({
      remote,
      remoteRevision: 3,
      local,
      baseline,
      operations: ops,
    })

    expect(build.allowed).toBe(true)
    expect(build.conflicts.filter((c) => c.reason === 'domain_conflict')).toHaveLength(0)
    expect(build.payloadJson).toBeTruthy()
    expect(build.store).toBeTruthy()

    const items = build.store!.warehouse.items
    const r = items.find((i) => i.id === 'item-R')
    const l = items.find((i) => i.id === 'item-L')
    expect(r?.internalCode).toBe('FC-000010')
    expect(l?.internalCode).toBeTruthy()
    expect(l!.internalCode).not.toBe('FC-000010')
    expect(l!.internalCode).toMatch(/^FC-\d{6}$/i)
    expect(new Set(items.map((i) => String(i.internalCode).toUpperCase())).size).toBe(items.length)

    const maxFc = Math.max(
      ...items.map((i) => Number(String(i.internalCode).match(/(\d+)$/)?.[1] ?? 0)),
    )
    expect(Number(build.store!.warehouse.nextInternalCode)).toBeGreaterThan(maxFc)

    const payload = JSON.parse(build.payloadJson!) as AppStore
    const payloadL = payload.warehouse.items.find((i) => i.id === 'item-L')
    expect(payloadL?.internalCode).toBe(l!.internalCode)

    expect(build.appliedOperationIds.length).toBeGreaterThan(0)
    expect(build.appliedOperationIds).toEqual(
      expect.arrayContaining(ops.filter((o) => o.entityId === 'item-L').map((o) => o.operationId)),
    )

    // Reload = saved payload as new baseline/remote; retry idempotent
    const reloadLocal = build.store!
    const retryMerge = mergeStoreForCloudSave({
      remote: payload,
      local: reloadLocal,
      baseline: payload,
      operations: [],
    })
    const rl = retryMerge.store.warehouse.items.find((i) => i.id === 'item-L')
    const rr = retryMerge.store.warehouse.items.find((i) => i.id === 'item-R')
    expect(rr?.internalCode).toBe('FC-000010')
    expect(rl?.internalCode).toBe(l!.internalCode)

    // Unrelated domains unchanged
    expect(build.store!.procurement.orders.find((o) => o.id === 'po1')?.orderNumber).toBe('ЗЗ-GATE-1')
    expect(build.store!.formulations.recipes.find((r) => r.id === 'rec1')?.code).toBe('РП-GATE')
  })

  it('SQL path: conservativeMergeForSave invokes shared IC reconcile (not cloudMerge-only)', () => {
    const baseline = baseStore()
    const remote = withItems(baseline, [whItem('item-R', 'Remote', { internalCode: 'FC-000010' })])
    const local = withItems(baseline, [whItem('item-L', 'Local', { internalCode: 'FC-000010' })])
    const { store, conflicts } = conservativeMergeForSave(baseline, remote, local, [])
    expect(conflicts.filter((c) => c.reason === 'domain_conflict')).toHaveLength(0)
    expect(store.warehouse.items.find((i) => i.id === 'item-R')?.internalCode).toBe('FC-000010')
    expect(store.warehouse.items.find((i) => i.id === 'item-L')?.internalCode).not.toBe('FC-000010')
  })

  it('A: concurrent same SKU local/remote creates fail closed — no ack, no silent rename', () => {
    const baseline = baseStore()
    const remote = withItems(baseline, [
      whItem('item-R', 'Remote', { internalCode: 'FC-000020', sku: 'EDU-SAME' }),
    ])
    const local = withItems(baseline, [
      whItem('item-L', 'Local', { internalCode: 'FC-000021', sku: 'EDU-SAME' }),
    ])
    const ops = userOps(baseline, local)
    const build = buildCloudSavePayload({
      remote,
      remoteRevision: 2,
      local,
      baseline,
      operations: ops,
    })

    expect(build.conflicts.some(isSkuConflict)).toBe(true)
    expect(build.appliedOperationIds).toHaveLength(0)
    expect(build.payloadJson).toBeFalsy()

    // Remote kept; local ID not deleted from input local; SKU not renamed on local
    expect(local.warehouse.items.find((i) => i.id === 'item-L')?.sku).toBe('EDU-SAME')
    expect(remote.warehouse.items.find((i) => i.id === 'item-R')?.sku).toBe('EDU-SAME')
    expect(build.store?.warehouse.items.find((i) => i.id === 'item-L')?.sku ?? 'EDU-SAME').toBe(
      'EDU-SAME',
    )
  })

  it('B: whitespace/case SKU collision fails closed', () => {
    const baseline = baseStore()
    const remote = withItems(baseline, [
      whItem('item-R', 'Remote', { internalCode: 'FC-000030', sku: 'edu-case' }),
    ])
    const local = withItems(baseline, [
      whItem('item-L', 'Local', { internalCode: 'FC-000031', sku: '  EDU-CASE  ' }),
    ])
    const build = buildCloudSavePayload({
      remote,
      remoteRevision: 2,
      local,
      baseline,
      operations: userOps(baseline, local),
    })
    expect(build.conflicts.some(isSkuConflict)).toBe(true)
    expect(build.appliedOperationIds).toHaveLength(0)
    expect(build.payloadJson).toBeFalsy()
  })

  it('C: local SKU edit collides with remote create — fail closed, pending preserved', () => {
    const baseline = withItems(baseStore(), [
      whItem('item-L', 'Local', { internalCode: 'FC-000040', sku: 'OLD-SKU' }),
    ])
    const remote = withItems(baseline, [
      ...baseline.warehouse.items,
      whItem('item-R', 'Remote', { internalCode: 'FC-000041', sku: 'NEW-SKU' }),
    ])
    const local = withItems(baseline, [
      whItem('item-L', 'Local', { internalCode: 'FC-000040', sku: 'NEW-SKU' }),
    ])
    const ops = userOps(baseline, local)
    const build = buildCloudSavePayload({
      remote,
      remoteRevision: 5,
      local,
      baseline,
      operations: ops,
    })
    expect(build.conflicts.some(isSkuConflict)).toBe(true)
    expect(build.appliedOperationIds).toHaveLength(0)
    expect(build.payloadJson).toBeFalsy()
    expect(local.warehouse.items[0]?.sku).toBe('NEW-SKU')
  })

  it('D: blank SKUs may both exist', () => {
    const baseline = baseStore()
    const remote = withItems(baseline, [
      whItem('item-R', 'Remote', { internalCode: 'FC-000050', sku: '' }),
    ])
    const local = withItems(baseline, [
      whItem('item-L', 'Local', { internalCode: 'FC-000051', sku: '   ' }),
    ])
    const build = buildCloudSavePayload({
      remote,
      remoteRevision: 2,
      local,
      baseline,
      operations: userOps(baseline, local),
    })
    expect(build.conflicts.some(isSkuConflict)).toBe(false)
    expect(build.allowed).toBe(true)
    expect(build.payloadJson).toBeTruthy()
    expect(build.store!.warehouse.items).toHaveLength(2)
  })

  it('E: legacy baseline SKU duplicates are not auto-migrated', () => {
    const baseline = withItems(baseStore(), [
      whItem('a', 'A', { internalCode: 'FC-000060', sku: 'LEGACY-DUP' }),
      whItem('b', 'B', { internalCode: 'FC-000061', sku: 'LEGACY-DUP' }),
    ])
    const remote = baseline
    const local = withItems(baseline, [
      ...baseline.warehouse.items,
      // unrelated local create
      whItem('c', 'C', { internalCode: 'FC-000062', sku: 'UNIQUE-C' }),
    ])
    const build = buildCloudSavePayload({
      remote,
      remoteRevision: 2,
      local,
      baseline,
      operations: userOps(baseline, local),
    })
    expect(build.allowed).toBe(true)
    expect(build.payloadJson).toBeTruthy()
    const a = build.store!.warehouse.items.find((i) => i.id === 'a')
    const b = build.store!.warehouse.items.find((i) => i.id === 'b')
    expect(a?.sku).toBe('LEGACY-DUP')
    expect(b?.sku).toBe('LEGACY-DUP')
  })

  it('after unique SKU assigned, retry succeeds', () => {
    const baseline = baseStore()
    const remote = withItems(baseline, [
      whItem('item-R', 'Remote', { internalCode: 'FC-000070', sku: 'EDU-SAME' }),
    ])
    const localBad = withItems(baseline, [
      whItem('item-L', 'Local', { internalCode: 'FC-000071', sku: 'EDU-SAME' }),
    ])
    const bad = buildCloudSavePayload({
      remote,
      remoteRevision: 2,
      local: localBad,
      baseline,
      operations: userOps(baseline, localBad),
    })
    expect(bad.conflicts.some(isSkuConflict)).toBe(true)

    const localFixed = withItems(baseline, [
      whItem('item-L', 'Local', { internalCode: 'FC-000071', sku: 'EDU-L-UNIQUE' }),
    ])
    const ok = buildCloudSavePayload({
      remote,
      remoteRevision: 2,
      local: localFixed,
      baseline,
      operations: userOps(baseline, localFixed),
    })
    expect(ok.conflicts.some(isSkuConflict)).toBe(false)
    expect(ok.payloadJson).toBeTruthy()
    expect(ok.appliedOperationIds.length).toBeGreaterThan(0)
    expect(ok.store!.warehouse.items.find((i) => i.id === 'item-L')?.sku).toBe('EDU-L-UNIQUE')
    expect(ok.store!.warehouse.items.find((i) => i.id === 'item-R')?.sku).toBe('EDU-SAME')
  })
})
