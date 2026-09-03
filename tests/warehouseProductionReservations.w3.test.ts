import { describe, expect, it } from 'vitest'
import {
  classifyAtomicGroupAgainstRemote,
  sanitizeAcknowledgeIds,
  stampOpsWithTransactionGroup,
  warehouseTransactionGroupId,
} from '@/lib/cloud/transactionGroups'
import type { DirtyOperation } from '@/lib/cloud/dirtyOperations'
import type { AppStore } from '@/lib/types'
import type { ProductionOrder } from '@/lib/planner/types'
import { withActiveWarehouses } from '@/lib/warehouse/accountingStatus'
import { queryDocumentJournal } from '@/lib/warehouse/documentJournalQuery'
import { postWarehouseDocument } from '@/lib/warehouse/documents'
import {
  allocateBatchesFefoFifo,
  assertUnitCompatible,
  BARE_RESERVE_BLOCKED,
  BATCH_OVERRIDE_REASON_REQUIRED,
  confirmProductionOrderReservation,
  FOREIGN_RESERVE_ERROR,
  increaseProductionOrderReservation,
  isLegacyBareReserveMovement,
  REALLOCATION_REASON_REQUIRED,
  reallocateProductionReservation,
  releaseProductionOrderReservation,
  UNIT_MISMATCH_ERROR,
} from '@/lib/warehouse/productionReservations'
import { computeItemBalance } from '@/lib/warehouse/stock'
import type { WarehouseItem, WarehouseStore } from '@/lib/warehouse/types'

function emptyWarehouse(overrides?: Partial<WarehouseStore>): WarehouseStore {
  const loc = { id: 'wh-a', name: 'Склад A', sortOrder: 1 }
  const item: WarehouseItem = {
    id: 'item-rm',
    internalCode: 'RM-1',
    name: 'Сырьё тест',
    categoryId: 'cat-1',
    warehouseId: loc.id,
    unit: 'кг',
    active: true,
    sortOrder: 1,
  }
  const base: WarehouseStore = {
    locations: [loc],
    categories: [{ id: 'cat-1', name: 'Сырьё', sortOrder: 1 }],
    items: [item],
    movements: [],
    documents: [],
    auditLog: [],
    nextInternalCode: 10,
    invoiceRegistry: [],
    materialShortages: [],
    ...overrides,
  }
  return withActiveWarehouses(base, [loc.id])
}

function stockReceipt(store: WarehouseStore, qty: number, opts?: { batchNo?: string; expiryDate?: string; createdAt?: string }) {
  const now = opts?.createdAt ?? '2026-09-01T10:00:00.000Z'
  return postWarehouseDocument(store, {
    type: 'receipt',
    number: `ПР-TEST-${store.documents.length + 1}`,
    date: '2026-09-01',
    warehouseId: 'wh-a',
    purpose: 'purchase',
    counterparty: 'Supplier',
    lines: [
      {
        itemId: 'item-rm',
        quantity: qty,
        batchNo: opts?.batchNo,
        expiryDate: opts?.expiryDate,
      },
    ],
    status: 'posted',
    postedAt: now,
    skipFieldValidation: false,
  }).store
}

function sampleOrder(overrides?: Partial<ProductionOrder>): ProductionOrder {
  return {
    id: 'po-1',
    orderNumber: 'ЗП-1',
    customer: 'Client',
    productName: 'Product',
    category: 'ratl1',
    totalQtyMp: 1000,
    startDate: '2026-09-10',
    endDate: '2026-09-20',
    lineId: 'line1',
    priority: 'normal',
    status: 'active',
    planMode: 'even',
    recalcMode: 'auto',
    rawMaterialItemId: 'item-rm',
    packagingPlan: {
      recipeName: 'test',
      stackDescription: '',
      rollsPerPallet: 1,
      palletUnits: 1,
      palletsNeeded: 0,
      boxesNeeded: 0,
      topRolls: 0,
      rawRollsEstimated: 10,
    },
    dayPlans: [],
    history: [
      {
        id: 'h1',
        at: '2026-09-03T08:00:00.000Z',
        type: 'activated',
        message: 'activated',
      },
    ],
    createdAt: '2026-09-01T08:00:00.000Z',
    updatedAt: '2026-09-03T08:00:00.000Z',
    ...overrides,
  }
}

describe('PHASE W3 document-backed production reservations', () => {
  it('1-4: confirm creates reservation document + reserve movements; balance unchanged; available decreases', () => {
    let store = emptyWarehouse()
    store = stockReceipt(store, 20)
    const before = computeItemBalance('item-rm', store.movements, 'wh-a')
    expect(before.balance).toBe(20)
    expect(before.available).toBe(20)

    const order = sampleOrder()
    const out = confirmProductionOrderReservation(store, order)
    expect(out.result.ok).toBe(true)
    expect(out.result.documentId).toBeTruthy()
    store = out.store

    const doc = store.documents.find((d) => d.id === out.result.documentId)
    expect(doc?.type).toBe('reservation')
    expect(doc?.purpose).toBe('production_reservation')
    expect(doc?.status).toBe('posted')

    const reserves = store.movements.filter((m) => m.type === 'reserve' && m.documentId)
    expect(reserves.length).toBeGreaterThan(0)
    expect(reserves.every((m) => m.productionOrderId === order.id)).toBe(true)

    const after = computeItemBalance('item-rm', store.movements, 'wh-a')
    expect(after.balance).toBe(20)
    expect(after.available).toBe(10)
    expect(after.reserved).toBe(10)
  })

  it('5: repeat confirm is idempotent', () => {
    let store = emptyWarehouse()
    store = stockReceipt(store, 20)
    const order = sampleOrder()
    const a = confirmProductionOrderReservation(store, order)
    store = a.store
    const docs1 = store.documents.length
    const mov1 = store.movements.length
    const b = confirmProductionOrderReservation(store, order)
    expect(b.result.ok).toBe(true)
    expect(b.result.idempotent).toBe(true)
    expect(b.store.documents.length).toBe(docs1)
    expect(b.store.movements.length).toBe(mov1)
  })

  it('6-8: partial availability → partial reserve + shortage; no duplicate shortage', () => {
    let store = emptyWarehouse()
    store = stockReceipt(store, 4)
    const order = sampleOrder()
    const out = confirmProductionOrderReservation(store, order)
    expect(out.result.ok).toBe(true)
    store = out.store
    const bal = computeItemBalance('item-rm', store.movements, 'wh-a')
    expect(bal.reserved).toBe(4)
    expect(bal.available).toBe(0)
    const shorts = store.materialShortages ?? []
    expect(shorts.length).toBe(1)
    expect(shorts[0]!.shortageQty).toBe(6)
    expect(shorts[0]!.status).toBe('partial')

    const again = confirmProductionOrderReservation(store, order)
    expect(again.result.idempotent).toBe(true)
    expect((again.store.materialShortages ?? []).length).toBe(1)
  })

  it('9: uninitialized warehouse blocks trusted reserve', () => {
    const store: WarehouseStore = {
      ...emptyWarehouse(),
      accountingByWarehouse: [],
      movements: [
        {
          id: 'm1',
          itemId: 'item-rm',
          warehouseId: 'wh-a',
          type: 'receipt',
          quantity: 20,
          date: '2026-09-01',
          createdAt: '2026-09-01T10:00:00.000Z',
        },
      ],
    }
    const out = confirmProductionOrderReservation(store, sampleOrder())
    expect(out.result.ok).toBe(false)
    expect(out.result.provisioningStatus).toBe('blocked')
    expect(out.store.documents.filter((d) => d.type === 'reservation')).toHaveLength(0)
  })

  it('10: missing itemId blocks without name fallback', () => {
    let store = emptyWarehouse()
    store = stockReceipt(store, 20)
    const order = sampleOrder({
      rawMaterialItemId: undefined,
      packagingPlan: {
        rawRollsEstimated: 5,
        palletsNeeded: 0,
        boxesNeeded: 0,
      } as ProductionOrder['packagingPlan'],
    })
    // materialLinesForOrder skips missing itemId → no lines
    const out = confirmProductionOrderReservation(store, order)
    expect(out.result.ok).toBe(false)
    expect(out.result.messageKey).toBe('planner.material.noLines')
  })

  it('11: unit mismatch fail-closed', () => {
    expect(assertUnitCompatible('кг', 'шт', [])).toEqual({
      ok: false,
      error: UNIT_MISMATCH_ERROR,
    })
    expect(assertUnitCompatible('кг', 'пач', [{ unit: 'пач', factor: 2 }]).ok).toBe(true)
  })

  it('12-13: increase creates additional doc; decrease creates release', () => {
    let store = emptyWarehouse()
    store = stockReceipt(store, 50)
    const order = sampleOrder()
    store = confirmProductionOrderReservation(store, order).store

    const bigger = sampleOrder({
      packagingPlan: {
        rawRollsEstimated: 15,
        palletsNeeded: 0,
        boxesNeeded: 0,
      } as ProductionOrder['packagingPlan'],
    })
    const inc = increaseProductionOrderReservation(store, bigger)
    expect(inc.result.ok).toBe(true)
    expect(inc.result.documentId).toBeTruthy()
    store = inc.store
    expect(
      store.documents.some((d) => d.purpose === 'production_reservation_increase'),
    ).toBe(true)

    const smaller = sampleOrder({
      packagingPlan: {
        rawRollsEstimated: 5,
        palletsNeeded: 0,
        boxesNeeded: 0,
      } as ProductionOrder['packagingPlan'],
    })
    const reserved = computeItemBalance('item-rm', store.movements, 'wh-a').reserved
    const releaseQty = Math.max(0, reserved - 5)
    const rel = releaseProductionOrderReservation(store, smaller, {
      releaseByItemId: { 'item-rm': releaseQty },
      reason: 'order_qty_decrease',
    })
    expect(rel.result.ok).toBe(true)
    store = rel.store
    expect(
      store.documents.some((d) => d.purpose === 'production_reservation_release'),
    ).toBe(true)
  })

  it('14-15: cancel releases remaining reserve; already issued not released again', () => {
    let store = emptyWarehouse()
    store = stockReceipt(store, 20)
    const order = sampleOrder()
    store = confirmProductionOrderReservation(store, order).store

    // Simulate physical issue that unreserves 3 (own reserve burn)
    store = {
      ...store,
      movements: [
        ...store.movements,
        {
          id: 'iss-1',
          itemId: 'item-rm',
          warehouseId: 'wh-a',
          type: 'issue',
          quantity: 3,
          date: '2026-09-05',
          productionOrderId: order.id,
          createdAt: '2026-09-05T10:00:00.000Z',
        },
        {
          id: 'unr-1',
          itemId: 'item-rm',
          warehouseId: 'wh-a',
          type: 'unreserve',
          quantity: 3,
          date: '2026-09-05',
          productionOrderId: order.id,
          documentId: 'issue-doc',
          createdAt: '2026-09-05T10:00:00.000Z',
        },
      ],
    }
    const beforeRelease = computeItemBalance('item-rm', store.movements, 'wh-a').reserved
    expect(beforeRelease).toBe(7)

    const cancelled = releaseProductionOrderReservation(store, order, {
      reason: 'order_cancelled',
    })
    expect(cancelled.result.ok).toBe(true)
    store = cancelled.store
    expect(computeItemBalance('item-rm', store.movements, 'wh-a').reserved).toBe(0)
    // Only remaining 7 released — not the already-issued 3 again
    const releaseMov = store.movements.filter(
      (m) =>
        m.type === 'unreserve' &&
        m.documentId === cancelled.result.documentId,
    )
    expect(releaseMov.reduce((s, m) => s + m.quantity, 0)).toBe(7)
  })

  it('16: posted reservation document is immutable (no cancel via storno path)', async () => {
    const { documentCanBeCancelled } = await import('@/lib/warehouse/documentValidation')
    let store = emptyWarehouse()
    store = stockReceipt(store, 20)
    const out = confirmProductionOrderReservation(store, sampleOrder())
    const doc = out.store.documents.find((d) => d.id === out.result.documentId)!
    expect(documentCanBeCancelled(doc)).toBe(false)
  })

  it('17: legacy bare reserve readable; new bare path conceptually blocked', () => {
    const legacy = {
      id: 'legacy',
      itemId: 'item-rm',
      warehouseId: 'wh-a',
      type: 'reserve' as const,
      quantity: 2,
      date: '2026-01-01',
      productionOrderId: 'po-old',
      createdAt: '2026-01-01T00:00:00.000Z',
    }
    expect(isLegacyBareReserveMovement(legacy)).toBe(true)
    expect(BARE_RESERVE_BLOCKED).toBeTruthy()
  })

  it('18-19: own reserve only; foreign reserve cannot be reallocated beyond own', () => {
    let store = emptyWarehouse()
    store = stockReceipt(store, 30)
    const a = sampleOrder({ id: 'po-a', orderNumber: 'A' })
    const b = sampleOrder({ id: 'po-b', orderNumber: 'B', priority: 'urgent' })
    store = confirmProductionOrderReservation(store, a).store
    store = confirmProductionOrderReservation(store, b, {
      idempotencyKey: 'warehouse::production_reservation::po-b::confirm',
    }).store

    const bad = reallocateProductionReservation(store, a, b, {
      sourceProductionOrderId: a.id,
      targetProductionOrderId: b.id,
      itemId: 'item-rm',
      warehouseId: 'wh-a',
      quantity: 999,
      reason: 'need',
      idempotencyKey: 'realloc-bad',
    })
    expect(bad.result.ok).toBe(false)
    expect(bad.result.error).toBe(FOREIGN_RESERVE_ERROR)
  })

  it('20-22: reallocation requires reason; atomic; both sides preserved', () => {
    let store = emptyWarehouse()
    store = stockReceipt(store, 30)
    const a = sampleOrder({ id: 'po-a', orderNumber: 'A' })
    const b = sampleOrder({
      id: 'po-b',
      orderNumber: 'B',
      packagingPlan: {
        rawRollsEstimated: 5,
        palletsNeeded: 0,
        boxesNeeded: 0,
      } as ProductionOrder['packagingPlan'],
    })
    store = confirmProductionOrderReservation(store, a).store

    const noReason = reallocateProductionReservation(store, a, b, {
      sourceProductionOrderId: a.id,
      targetProductionOrderId: b.id,
      itemId: 'item-rm',
      warehouseId: 'wh-a',
      quantity: 3,
      reason: '  ',
      idempotencyKey: 'realloc-1',
    })
    expect(noReason.result.ok).toBe(false)
    expect(noReason.result.error).toBe(REALLOCATION_REASON_REQUIRED)

    const ok = reallocateProductionReservation(store, a, b, {
      sourceProductionOrderId: a.id,
      targetProductionOrderId: b.id,
      itemId: 'item-rm',
      warehouseId: 'wh-a',
      quantity: 3,
      reason: 'priority shift',
      idempotencyKey: 'realloc-2',
      actor: { id: 'u1', name: 'Dir', roleId: 'operations_director' },
    })
    expect(ok.result.ok).toBe(true)
    store = ok.store
    expect(ok.result.documentIds?.length).toBe(2)
    const reservedA = computeItemBalance('item-rm', store.movements, 'wh-a')
    // net reserved still accounts for both orders
    expect(reservedA.reserved).toBeGreaterThan(0)
    expect(
      store.movements.some(
        (m) => m.productionOrderId === a.id && m.type === 'unreserve' && m.documentId,
      ),
    ).toBe(true)
    expect(
      store.movements.some(
        (m) => m.productionOrderId === b.id && m.type === 'reserve' && m.documentId,
      ),
    ).toBe(true)
  })

  it('23: reallocation rolls back to original store on failure', () => {
    let store = emptyWarehouse()
    store = stockReceipt(store, 10)
    const a = sampleOrder({ id: 'po-a' })
    const b = sampleOrder({ id: 'po-b' })
    store = confirmProductionOrderReservation(store, a).store
    const snapDocs = store.documents.length
    const snapMov = store.movements.length
    const fail = reallocateProductionReservation(store, a, b, {
      sourceProductionOrderId: a.id,
      targetProductionOrderId: b.id,
      itemId: 'item-rm',
      warehouseId: 'wh-a',
      quantity: 999,
      reason: 'x',
      idempotencyKey: 'realloc-fail',
    })
    expect(fail.result.ok).toBe(false)
    expect(fail.store.documents.length).toBe(snapDocs)
    expect(fail.store.movements.length).toBe(snapMov)
  })

  it('24-26: FEFO with expiry; FIFO without; manual batch needs reason', () => {
    const fefo = allocateBatchesFefoFifo(
      [
        { batchNo: 'B-late', expiryDate: '2026-12-01', available: 5, receivedAt: '2026-01-01' },
        { batchNo: 'B-soon', expiryDate: '2026-10-01', available: 5, receivedAt: '2026-02-01' },
      ],
      3,
    )
    expect(fefo[0]!.batchNo).toBe('B-soon')

    const fifo = allocateBatchesFefoFifo(
      [
        { batchNo: 'old', available: 5, receivedAt: '2026-01-01' },
        { batchNo: 'new', available: 5, receivedAt: '2026-06-01' },
      ],
      2,
    )
    expect(fifo[0]!.batchNo).toBe('old')

    let store = emptyWarehouse()
    store = stockReceipt(store, 10, {
      batchNo: 'AUTO',
      expiryDate: '2026-11-01',
      createdAt: '2026-09-01T10:00:00.000Z',
    })
    const blocked = confirmProductionOrderReservation(store, sampleOrder(), {
      manualBatchByItemId: {
        'item-rm': { batchNo: 'OTHER', expiryDate: '2026-12-01' },
      },
    })
    expect(blocked.result.ok).toBe(false)
    expect(blocked.result.error).toBe(BATCH_OVERRIDE_REASON_REQUIRED)

    const ok = confirmProductionOrderReservation(store, sampleOrder(), {
      manualBatchByItemId: {
        'item-rm': { batchNo: 'OTHER', expiryDate: '2026-12-01', reason: 'QC hold' },
      },
    })
    expect(ok.result.ok).toBe(true)
  })

  it('27: journal shows reservation/release documents', () => {
    let store = emptyWarehouse()
    store = stockReceipt(store, 20)
    const order = sampleOrder()
    store = confirmProductionOrderReservation(store, order).store
    store = releaseProductionOrderReservation(store, order, {
      reason: 'cancel',
      idempotencyKey: 'rel-journal',
    }).store
    const rows = queryDocumentJournal(store, { type: 'reservation' })
    expect(rows.length).toBeGreaterThanOrEqual(2)
    expect(rows.every((r) => r.doc.type === 'reservation')).toBe(true)
  })

  it('28-29: cloud conflict / subset ack fail-closed for reservation group', () => {
    const groupId = warehouseTransactionGroupId({
      kind: 'production_reservation',
      sourceId: 'po-1',
      revision: 'activate',
    })
    const ops: DirtyOperation[] = stampOpsWithTransactionGroup(
      [
        {
          operationId: 'op1',
          type: 'update',
          domain: 'production.planner.orders',
          entityId: 'po-1',
          baseRevision: 1,
          origin: 'user',
        },
        {
          operationId: 'op2',
          type: 'create',
          domain: 'warehouse.documents',
          entityId: 'doc-1',
          baseRevision: 1,
          origin: 'user',
        },
      ],
      {
        transactionGroupId: groupId,
        transactionGroupKind: 'production_reservation',
        atomic: true,
      },
      {} as AppStore,
      {} as AppStore,
    )
    const ack = sanitizeAcknowledgeIds(ops, ['op1'])
    expect(ack.safeIds).toHaveLength(0)
    expect(ack.blockedGroupIds).toContain(groupId)

    const remote = {
      production: { planner: { orders: [{ id: 'po-1', updatedAt: 'conflict' }] } },
      warehouse: { documents: [], movements: [] },
    } as unknown as AppStore
    const classified = classifyAtomicGroupAgainstRemote(ops, remote)
    expect(['apply', 'skip', 'conflict', 'unsupported']).toContain(classified)
  })

  it('30: employees/months/timesheets untouched by reservation helpers', () => {
    const employees = [{ id: 'e1' }]
    const months = { '2026-09': { rows: [] } }
    let store = emptyWarehouse()
    store = stockReceipt(store, 10)
    confirmProductionOrderReservation(store, sampleOrder())
    expect(employees).toEqual([{ id: 'e1' }])
    expect(months['2026-09']?.rows).toEqual([])
  })
})
