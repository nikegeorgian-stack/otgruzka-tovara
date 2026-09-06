/**
 * R2.9A — procurement receipt persistence / sync / idempotency gate (local store path).
 * Production remains read-only; these tests do not touch SQL/Vercel.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { AppStore } from '@/lib/types'
import {
  receivePurchaseOrderInStore,
  preparePurchaseOrderReceipt,
  applyPurchaseOrderReceiptAck,
} from '@/lib/procurement/receive'
import { postWarehouseDocument } from '@/lib/warehouse/documents'
import { computeAllBalances } from '@/lib/warehouse/stock'
import { diffStoreToOperations } from '@/lib/cloud/storeDiff'
import {
  buildCloudSavePayload,
  mergeStoreForCloudSave,
} from '@/lib/cloud/cloudSavePipeline'
import {
  noteCloudPullCompleted,
  resetSyncLifecycle,
  setSyncLifecyclePhase,
} from '@/lib/cloud/syncLifecycle'
import type { PurchaseOrder } from '@/lib/procurement/types'

function emptyPo(partial: Partial<PurchaseOrder> & Pick<PurchaseOrder, 'id' | 'lines'>): PurchaseOrder {
  return {
    orderNumber: 'ЗЗ-2026-0003',
    status: 'arrived',
    statusHistory: [],
    counterpartyId: 'sup1',
    destinationWarehouseId: 'loc1',
    warehouseDocumentIds: [],
    milestones: [],
    legs: [],
    createdAt: '2026-09-05T00:00:00Z',
    updatedAt: '2026-09-05T00:00:00Z',
    ...partial,
  } as PurchaseOrder
}

function receiptFixture(): AppStore {
  return {
    version: 6,
    employees: [],
    months: {},
    brigades: [],
    access: { users: [], roles: [] },
    auditLog: [],
    settings: { signatures: {} },
    candidates: [],
    counterparties: {
      items: [
        {
          id: 'sup1',
          code: 'КА-000001',
          name: 'Supplier A',
          role: 'supplier',
          bankAccounts: [],
          contracts: [],
          active: true,
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        },
      ],
      nextCode: 2,
    },
    warehouse: {
      items: [
        { id: 'w-ll', name: 'LL-145-50', unit: 'kg', active: true },
        { id: 'w-rh', name: 'Rheovis HS 1212', unit: 'kg', active: true },
      ],
      documents: [],
      movements: [],
      categories: [],
      locations: [{ id: 'loc1', name: 'Main', active: true }],
      accountingByWarehouse: [{ id: 'acc1', warehouseId: 'loc1', status: 'active' }],
      auditLog: [],
    },
    sales: { orders: [], reservations: [], allocations: [] },
    procurement: {
      orders: [
        emptyPo({
          id: 'po1',
          lines: [
            {
              id: 'line-ll',
              name: 'LL-145-50',
              quantity: 18,
              receivedQty: 0,
              unit: 'kg',
              warehouseItemId: 'w-ll',
            },
            {
              id: 'line-rh',
              name: 'Rheovis HS 1212',
              quantity: 1,
              receivedQty: 0,
              unit: 'kg',
              warehouseItemId: 'w-rh',
            },
          ] as PurchaseOrder['lines'],
        }),
      ],
      categories: [],
      routePoints: [],
      nextOrderSeq: 4,
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
  } as AppStore
}

describe('R2.9A procurement receipt persistence', () => {
  beforeEach(() => {
    resetSyncLifecycle()
    setSyncLifecyclePhase('ready')
    noteCloudPullCompleted(1)
  })

  it('posts one receipt document, movements, exact stock delta, and Received status', () => {
    const baseline = receiptFixture()
    const before = computeAllBalances(baseline.warehouse)
    expect(before.get('w-ll')?.balance ?? 0).toBe(0)
    expect(before.get('w-rh')?.balance ?? 0).toBe(0)

    const { store, result } = receivePurchaseOrderInStore(baseline, 'po1', {
      date: '2026-09-05',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const receiptDocs = store.warehouse.documents.filter(
      (d) => d.type === 'receipt' && d.purchaseOrderId === 'po1' && d.status === 'posted',
    )
    expect(receiptDocs).toHaveLength(1)
    expect(receiptDocs[0]!.id).toBe(result.documentId)

    const movs = store.warehouse.movements.filter((m) => m.documentId === result.documentId)
    expect(movs.length).toBeGreaterThanOrEqual(2)
    const qtyLl = movs.filter((m) => m.itemId === 'w-ll').reduce((s, m) => s + m.quantity, 0)
    const qtyRh = movs.filter((m) => m.itemId === 'w-rh').reduce((s, m) => s + m.quantity, 0)
    expect(qtyLl).toBe(18)
    expect(qtyRh).toBe(1)

    const after = computeAllBalances(store.warehouse)
    expect(after.get('w-ll')?.balance).toBe(18)
    expect(after.get('w-rh')?.balance).toBe(1)

    const order = store.procurement.orders.find((o) => o.id === 'po1')
    expect(order?.status).toBe('received')
    expect(order?.lines.find((l) => l.id === 'line-ll')?.receivedQty).toBe(18)
    expect(order?.lines.find((l) => l.id === 'line-rh')?.receivedQty).toBe(1)
    expect(order?.warehouseDocumentIds).toContain(result.documentId)
  })

  it('diff emits receipt ops exactly once per entity create (doc + movements + PO update)', () => {
    const baseline = receiptFixture()
    const { store, result } = receivePurchaseOrderInStore(baseline, 'po1', {
      date: '2026-09-05',
    })
    expect(result.ok).toBe(true)

    const ops = diffStoreToOperations(baseline, store, 1, 'user')
    expect(ops.length).toBeGreaterThan(0)

    const docCreates = ops.filter(
      (o) => o.domain === 'warehouse.documents' && o.type === 'create',
    )
    expect(docCreates).toHaveLength(1)
    expect(docCreates[0]!.entityId).toBe(result.ok ? result.documentId : '')

    const movCreates = ops.filter(
      (o) => o.domain === 'warehouse.movements' && o.type === 'create',
    )
    expect(movCreates.length).toBeGreaterThanOrEqual(2)

    const poUpdates = ops.filter(
      (o) =>
        (o.domain === 'procurement.orders' && o.entityId === 'po1') ||
        (o.domain === 'procurement' && o.entityId === '*'),
    )
    expect(poUpdates.length).toBeGreaterThanOrEqual(1)

    // No duplicate create for the same document entity
    const docIds = docCreates.map((o) => o.entityId)
    expect(new Set(docIds).size).toBe(docIds.length)
  })

  it('reload / cross-session merge keeps committed receipt without domain_conflict', () => {
    const baseline = receiptFixture()
    const { store: localCommitted, result } = receivePurchaseOrderInStore(baseline, 'po1', {
      date: '2026-09-05',
    })
    expect(result.ok).toBe(true)

    const ops = diffStoreToOperations(baseline, localCommitted, 1, 'user')
    // Session B pulled baseline + unrelated audit echo while session A saves
    const remoteWithNoise = {
      ...baseline,
      warehouse: {
        ...baseline.warehouse,
        auditLog: [{ id: 'a-view', at: '2026-09-05T12:00:00Z', action: 'view' } as never],
      },
    }

    const merged = mergeStoreForCloudSave({
      remote: remoteWithNoise,
      local: localCommitted,
      baseline,
      operations: ops,
    })
    expect(merged.conflicts.filter((c) => c.reason === 'domain_conflict')).toHaveLength(0)
    expect(merged.appliedOperationIds.length).toBeGreaterThan(0)
    expect(merged.store.warehouse.documents.some((d) => d.id === (result.ok && result.documentId))).toBe(
      true,
    )
    expect(merged.store.procurement.orders.find((o) => o.id === 'po1')?.status).toBe('received')

    // "Reload" = client adopts merged/remote committed snapshot
    const reloaded = structuredClone(merged.store)
    expect(reloaded.warehouse.documents.filter((d) => d.purchaseOrderId === 'po1')).toHaveLength(1)
    expect(computeAllBalances(reloaded.warehouse).get('w-ll')?.balance).toBe(18)

    const build = buildCloudSavePayload({
      remote: remoteWithNoise,
      remoteRevision: 1,
      local: localCommitted,
      baseline,
      operations: ops,
    })
    expect(build.allowed).toBe(true)
    expect(build.appliedOperationIds.length).toBeGreaterThan(0)
  })

  it('same idempotency key does not duplicate warehouse documents or stock', () => {
    const baseline = receiptFixture()
    const prepared = preparePurchaseOrderReceipt(baseline, 'po1', { date: '2026-09-05' })
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return

    const key = `po-receipt-po1-${prepared.number}-test`
    const first = postWarehouseDocument(prepared.warehouseWithItems, {
      ...prepared.documentInput,
      status: 'draft',
      idempotencyKey: key,
    })
    expect(first.result.ok).toBe(true)
    if (!first.result.ok) return

    const second = postWarehouseDocument(first.store, {
      ...prepared.documentInput,
      status: 'draft',
      idempotencyKey: key,
    })
    expect(second.result.ok).toBe(true)
    if (!second.result.ok) {
      throw new Error(`second post failed: ${'error' in second.result ? second.result.error : '?'}`)
    }
    expect(second.result.idempotent).toBe(true)
    expect(second.result.documentId).toBe(first.result.documentId)

    const docs = second.store.documents.filter((d) => d.idempotencyKey === key)
    expect(docs).toHaveLength(1)
    const movs = second.store.movements.filter((m) => m.documentId === first.result.documentId)
    const after = computeAllBalances(second.store)
    expect(after.get('w-ll')?.balance).toBe(18)
    expect(movs.filter((m) => m.itemId === 'w-ll').reduce((s, m) => s + m.quantity, 0)).toBe(18)
  })

  it('failed prepare never mutates store (no false success)', () => {
    const baseline = receiptFixture()
    const beforeJson = JSON.stringify(baseline)
    const { store, result } = receivePurchaseOrderInStore(baseline, 'missing-po')
    expect(result.ok).toBe(false)
    expect(JSON.stringify(store)).toBe(beforeJson)

    const already = receivePurchaseOrderInStore(baseline, 'po1', { date: '2026-09-05' })
    expect(already.result.ok).toBe(true)
    const again = receivePurchaseOrderInStore(already.store, 'po1', { date: '2026-09-05' })
    expect(again.result.ok).toBe(false)
    expect(again.result.ok === false && again.result.error).toBe('procurement.receive.errNothing')
    expect(again.store.warehouse.documents.filter((d) => d.purchaseOrderId === 'po1')).toHaveLength(1)
    expect(computeAllBalances(again.store.warehouse).get('w-ll')?.balance).toBe(18)
  })

  it('applyPurchaseOrderReceiptAck is not applied when warehouse post fails', () => {
    const baseline = receiptFixture()
    const prepared = preparePurchaseOrderReceipt(baseline, 'po1', { date: '2026-09-05' })
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return

    // Force post failure: empty warehouseId
    const failed = postWarehouseDocument(prepared.warehouseWithItems, {
      ...prepared.documentInput,
      warehouseId: '',
      status: 'draft',
    })
    expect(failed.result.ok).toBe(false)

    // Caller must not ack PO on failure (same contract as receivePurchaseOrderInStore)
    expect(baseline.procurement.orders[0]!.status).toBe('arrived')
    const wronglyAcked = applyPurchaseOrderReceiptAck(baseline, prepared, 'ghost-doc')
    // Demonstrate ack alone would change PO — therefore UI must gate on post ok first
    expect(wronglyAcked.procurement.orders[0]!.status).toBe('received')

    const cancelled = {
      ...baseline,
      procurement: {
        ...baseline.procurement,
        orders: [{ ...baseline.procurement.orders[0]!, status: 'cancelled' as const }],
      },
    }
    const guarded = receivePurchaseOrderInStore(cancelled, 'po1')
    expect(guarded.result.ok).toBe(false)
    expect(guarded.store.procurement.orders[0]!.status).toBe('cancelled')
    expect(guarded.store.warehouse.documents).toHaveLength(0)
  })
})

describe('R2.9A G1 false-success block', () => {
  it('legacy receivePurchaseOrder refuses when G1 authoritative path is active', async () => {
    vi.resetModules()
    vi.doMock('@/lib/warehouse/g1ServerClient', () => ({
      isG1WebAuthoritativePath: () => true,
      g1PostWarehouseDocument: vi.fn(),
      mirrorAuthoritativeWarehousePost: (w: unknown) => w,
    }))
    vi.doMock('@/lib/planner/g5Activation', () => ({
      isG5ProcurementActive: () => false,
    }))

    const { createProcurementSlice } = await import('@/store/slices/procurementSlice')
    let store = receiptFixture()
    const slice = createProcurementSlice({
      setStore: ((updater: unknown) => {
        store = typeof updater === 'function' ? (updater as (s: AppStore) => AppStore)(store) : (updater as AppStore)
      }) as never,
      getStore: () => store,
      getActor: () => ({ actorId: 'u1', actorName: 'Test' }),
    })

    const legacy = slice.receivePurchaseOrder('po1')
    expect(legacy.ok).toBe(false)
    if (!legacy.ok) {
      expect(legacy.error).toBe('warehouse.g1.errUseAuthoritativePost')
    }
    expect(store.warehouse.documents).toHaveLength(0)
    expect(store.procurement.orders[0]!.status).toBe('arrived')
    vi.doUnmock('@/lib/warehouse/g1ServerClient')
    vi.doUnmock('@/lib/planner/g5Activation')
  })
})
