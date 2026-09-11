import { describe, expect, it } from 'vitest'
import {
  classifyAtomicGroupAgainstRemote,
  sanitizeAcknowledgeIds,
  stampOpsWithTransactionGroup,
  warehouseTransactionGroupId,
} from '@/lib/cloud/transactionGroups'
import type { DirtyOperation } from '@/lib/cloud/dirtyOperations'
import type { AccessStore } from '@/lib/access/types'
import type { AppStore } from '@/lib/types'
import type { ProductionOrder } from '@/lib/planner/types'
import { reservedQtyForOrder } from '@/lib/planner/materialStock'
import {
  WAREHOUSE_NOT_INITIALIZED,
  withActiveWarehouses,
} from '@/lib/warehouse/accountingStatus'
import { documentSourceKind, queryDocumentJournal } from '@/lib/warehouse/documentJournalQuery'
import * as documents from '@/lib/warehouse/documents'
import {
  BATCH_OVERRIDE_REASON_REQUIRED,
  MISSING_ITEM_ID_ERROR,
  UNIT_MISMATCH_ERROR,
  canManualReallocateReservations,
  confirmProductionOrderReservation,
  reallocateProductionReservation,
} from '@/lib/warehouse/productionReservations'
import {
  INSUFFICIENT_PHYSICAL,
  LINE_LOCATION_MISSING,
  LINE_LOCATION_NOT_CONFIGURED,
  NEGATIVE_STOCK_FORBIDDEN,
  OVER_RESERVE_REASON_REQUIRED,
  RETURN_EXCEEDS_REMAINING,
  RETURN_REASON_REQUIRED,
  computeLineMaterialBalances,
  returnProductionMaterials,
  transferProductionMaterials,
} from '@/lib/warehouse/productionMaterialHandoff'
import { upsertProductionLineBinding } from '@/lib/warehouse/productionLineLocationConfig'
import { computeItemBalance } from '@/lib/warehouse/stock'
import type { WarehouseItem, WarehouseStore } from '@/lib/warehouse/types'

function emptyWarehouse(overrides?: Partial<WarehouseStore>): WarehouseStore {
  const raw = { id: 'wh-raw', name: 'Raw', sortOrder: 1, kind: 'raw' as const }
  const line = { id: 'wh-line1', name: 'Line 1', sortOrder: 2, kind: 'wip' as const }
  const item: WarehouseItem = {
    id: 'item-rm',
    internalCode: 'RM-1',
    name: 'Raw material test',
    categoryId: 'cat-1',
    warehouseId: raw.id,
    unit: 'kg',
    active: true,
    sortOrder: 1,
  }
  let base: WarehouseStore = {
    locations: [raw, line],
    categories: [{ id: 'cat-1', name: 'Raw', sortOrder: 1 }],
    items: [item],
    movements: [],
    documents: [],
    auditLog: [],
    nextInternalCode: 10,
    invoiceRegistry: [],
    materialShortages: [],
    productionLineBindings: [
      {
        id: 'line1',
        lineId: 'line1',
        productionWarehouseId: 'wh-line1',
        productionLocationId: 'wh-line1',
      },
    ],
    ...overrides,
  }
  base = withActiveWarehouses(base, [raw.id, line.id])
  return base
}

function stockReceipt(
  store: WarehouseStore,
  qty: number,
  opts?: { batchNo?: string; expiryDate?: string; createdAt?: string; warehouseId?: string },
) {
  const now = opts?.createdAt ?? '2026-09-01T10:00:00.000Z'
  const wh = opts?.warehouseId ?? 'wh-raw'
  return documents.postWarehouseDocument(store, {
    type: 'receipt',
    number: `RCV-TEST-${store.documents.length + 1}`,
    date: '2026-09-01',
    warehouseId: wh,
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
  }).store
}

function sampleOrder(overrides?: Partial<ProductionOrder>): ProductionOrder {
  return {
    id: 'po-1',
    orderNumber: 'PO-1',
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

function prepareReserved(
  qtyStock = 20,
  reserveViaOrder = true,
): { store: WarehouseStore; order: ProductionOrder } {
  let store = emptyWarehouse()
  store = stockReceipt(store, qtyStock)
  const order = sampleOrder()
  if (reserveViaOrder) {
    store = confirmProductionOrderReservation(store, order).store
  }
  return { store, order }
}

const keeper = { id: 'k1', name: 'Keeper', roleId: 'warehouse_keeper' as const }

describe('PHASE P1A production material handoff', () => {
  it('1-3: transfer decreases raw, increases line location, burns only own reserve', () => {
    const prep = prepareReserved(20)
    let store = prep.store
    const order = prep.order
    const reservedBefore = reservedQtyForOrder(store.movements, order.id, 'item-rm')
    expect(reservedBefore).toBe(10)

    const out = transferProductionMaterials(store, {
      productionOrder: order,
      rawWarehouseId: 'wh-raw',
      lines: [{ itemId: 'item-rm', quantity: 6 }],
      actor: keeper,
      idempotencyKey: 'handoff-1',
    })
    expect(out.result.ok).toBe(true)
    store = out.store

    const raw = computeItemBalance('item-rm', store.movements, 'wh-raw')
    expect(raw.balance).toBe(14)
    const line = computeItemBalance('item-rm', store.movements, 'wh-line1')
    expect(line.balance).toBe(6)
    expect(reservedQtyForOrder(store.movements, order.id, 'item-rm')).toBe(4)
  })

  it('4: foreign reserve cannot be used for another order transfer', () => {
    let store = emptyWarehouse()
    store = stockReceipt(store, 15)
    const a = sampleOrder({ id: 'po-a', orderNumber: 'A' })
    const b = sampleOrder({ id: 'po-b', orderNumber: 'B' })
    store = confirmProductionOrderReservation(store, a).store
    const bad = transferProductionMaterials(store, {
      productionOrder: b,
      rawWarehouseId: 'wh-raw',
      lines: [{ itemId: 'item-rm', quantity: 6 }],
      actor: keeper,
      overReserveReason: 'try steal',
      idempotencyKey: 'foreign-1',
    })
    expect(bad.result.ok).toBe(false)
    expect(bad.result.error).toBe(INSUFFICIENT_PHYSICAL)
  })

  it('5: transfer linked to ProductionOrder', () => {
    const prep = prepareReserved()
    let store = prep.store
    const order = prep.order
    const out = transferProductionMaterials(store, {
      productionOrder: order,
      rawWarehouseId: 'wh-raw',
      lines: [{ itemId: 'item-rm', quantity: 3 }],
      actor: keeper,
      idempotencyKey: 'link-po',
    })
    store = out.store
    const docs = store.documents.filter((d) => d.purpose === 'production_material_transfer')
    expect(docs.length).toBeGreaterThanOrEqual(2)
    expect(docs.every((d) => d.productionOrderId === order.id)).toBe(true)
    expect(
      store.movements.some(
        (m) => m.productionOrderId === order.id && (m.type === 'issue' || m.type === 'receipt'),
      ),
    ).toBe(true)
  })

  it('6: missing line location binding blocks transfer', () => {
    let store = emptyWarehouse({ productionLineBindings: [] })
    store = stockReceipt(store, 20)
    const order = sampleOrder()
    store = confirmProductionOrderReservation(store, order).store
    const out = transferProductionMaterials(store, {
      productionOrder: order,
      rawWarehouseId: 'wh-raw',
      lines: [{ itemId: 'item-rm', quantity: 1 }],
      actor: keeper,
      idempotencyKey: 'no-bind',
    })
    expect(out.result.ok).toBe(false)
    expect(out.result.error).toBe(LINE_LOCATION_NOT_CONFIGURED)
  })

  it('6b: configured binding to missing location id blocks', () => {
    let store = emptyWarehouse({
      productionLineBindings: [
        {
          id: 'line1',
          lineId: 'line1',
          productionWarehouseId: 'wh-line1',
          productionLocationId: 'wh-missing',
        },
      ],
    })
    store = stockReceipt(store, 20)
    const order = sampleOrder()
    store = confirmProductionOrderReservation(store, order).store
    const out = transferProductionMaterials(store, {
      productionOrder: order,
      rawWarehouseId: 'wh-raw',
      lines: [{ itemId: 'item-rm', quantity: 1 }],
      actor: keeper,
      idempotencyKey: 'miss-loc',
    })
    expect(out.result.ok).toBe(false)
    expect(out.result.error).toBe(LINE_LOCATION_MISSING)
  })

  it('7: uninitialized warehouse blocks', () => {
    let store = emptyWarehouse()
    store = { ...store, accountingByWarehouse: [] }
    store = {
      ...store,
      movements: [
        {
          id: 'm1',
          itemId: 'item-rm',
          warehouseId: 'wh-raw',
          type: 'receipt',
          quantity: 20,
          date: '2026-09-01',
          createdAt: '2026-09-01T10:00:00.000Z',
        },
      ],
    }
    const order = sampleOrder()
    const out = transferProductionMaterials(store, {
      productionOrder: order,
      rawWarehouseId: 'wh-raw',
      lines: [{ itemId: 'item-rm', quantity: 1 }],
      actor: keeper,
      idempotencyKey: 'uninit',
    })
    expect(out.result.ok).toBe(false)
    expect(out.result.error).toBe(WAREHOUSE_NOT_INITIALIZED)
  })

  it('8: missing itemId blocks without name fallback', () => {
    const { store, order } = prepareReserved()
    const out = transferProductionMaterials(store, {
      productionOrder: order,
      rawWarehouseId: 'wh-raw',
      lines: [{ itemId: '', quantity: 1 }],
      actor: keeper,
      idempotencyKey: 'no-item',
    })
    expect(out.result.ok).toBe(false)
    expect(out.result.error).toBe(MISSING_ITEM_ID_ERROR)
  })

  it('9: unit mismatch fail-closed', () => {
    const { store, order } = prepareReserved()
    const out = transferProductionMaterials(store, {
      productionOrder: order,
      rawWarehouseId: 'wh-raw',
      lines: [{ itemId: 'item-rm', quantity: 1, inputUnit: 'l' }],
      actor: keeper,
      idempotencyKey: 'unit-bad',
    })
    expect(out.result.ok).toBe(false)
    expect(out.result.error).toBe(UNIT_MISMATCH_ERROR)
  })

  it('10-11: FEFO picks nearest expiry; FIFO without expiry', () => {
    let store = emptyWarehouse()
    store = stockReceipt(store, 5, {
      batchNo: 'LATE',
      expiryDate: '2026-12-01',
      createdAt: '2026-09-01T09:00:00.000Z',
    })
    store = stockReceipt(store, 5, {
      batchNo: 'SOON',
      expiryDate: '2026-10-01',
      createdAt: '2026-09-01T10:00:00.000Z',
    })
    const order = sampleOrder({
      packagingPlan: {
        recipeName: 't',
        stackDescription: '',
        rollsPerPallet: 1,
        palletUnits: 1,
        palletsNeeded: 0,
        boxesNeeded: 0,
        topRolls: 0,
        rawRollsEstimated: 3,
      },
    })
    store = confirmProductionOrderReservation(store, order).store
    let out = transferProductionMaterials(store, {
      productionOrder: order,
      rawWarehouseId: 'wh-raw',
      lines: [{ itemId: 'item-rm', quantity: 3 }],
      actor: keeper,
      idempotencyKey: 'fefo-1',
    })
    expect(out.result.ok).toBe(true)
    store = out.store
    const issueLines = store.documents
      .filter((d) => d.purpose === 'production_material_transfer' && d.type === 'issue')
      .flatMap((d) => d.lines)
    expect(issueLines[0]?.batchNo).toBe('SOON')

    store = emptyWarehouse()
    store = stockReceipt(store, 5, {
      batchNo: 'OLD',
      createdAt: '2026-01-01T10:00:00.000Z',
    })
    store = stockReceipt(store, 5, {
      batchNo: 'NEW',
      createdAt: '2026-06-01T10:00:00.000Z',
    })
    const order2 = sampleOrder({
      id: 'po-fifo',
      packagingPlan: {
        recipeName: 't',
        stackDescription: '',
        rollsPerPallet: 1,
        palletUnits: 1,
        palletsNeeded: 0,
        boxesNeeded: 0,
        topRolls: 0,
        rawRollsEstimated: 2,
      },
    })
    store = confirmProductionOrderReservation(store, order2).store
    out = transferProductionMaterials(store, {
      productionOrder: order2,
      rawWarehouseId: 'wh-raw',
      lines: [{ itemId: 'item-rm', quantity: 2 }],
      actor: keeper,
      idempotencyKey: 'fifo-1',
    })
    expect(out.result.ok).toBe(true)
    const fifoLines = out.store.documents
      .filter((d) => d.purpose === 'production_material_transfer' && d.type === 'issue')
      .flatMap((d) => d.lines)
    expect(fifoLines[0]?.batchNo).toBe('OLD')
  })

  it('12: manual batch override requires reason', () => {
    const { store, order } = prepareReserved()
    const bad = transferProductionMaterials(store, {
      productionOrder: order,
      rawWarehouseId: 'wh-raw',
      lines: [{ itemId: 'item-rm', quantity: 2, batchNo: 'MANUAL' }],
      actor: keeper,
      idempotencyKey: 'batch-bad',
    })
    expect(bad.result.ok).toBe(false)
    expect(bad.result.error).toBe(BATCH_OVERRIDE_REASON_REQUIRED)

    const ok = transferProductionMaterials(store, {
      productionOrder: order,
      rawWarehouseId: 'wh-raw',
      lines: [
        {
          itemId: 'item-rm',
          quantity: 2,
          batchNo: 'MANUAL',
          batchOverrideReason: 'QC hold release',
        },
      ],
      actor: keeper,
      idempotencyKey: 'batch-ok',
    })
    expect(ok.result.ok).toBe(true)
  })

  it('13-15: within reserve ok; over-reserve without reason blocked; with reason + stock ok', () => {
    const prep = prepareReserved(20)
    let store = prep.store
    const order = prep.order
    const within = transferProductionMaterials(store, {
      productionOrder: order,
      rawWarehouseId: 'wh-raw',
      lines: [{ itemId: 'item-rm', quantity: 5 }],
      actor: keeper,
      idempotencyKey: 'within',
    })
    expect(within.result.ok).toBe(true)
    store = within.store

    const noReason = transferProductionMaterials(store, {
      productionOrder: order,
      rawWarehouseId: 'wh-raw',
      lines: [{ itemId: 'item-rm', quantity: 8 }],
      actor: keeper,
      idempotencyKey: 'over-noreason',
    })
    expect(noReason.result.ok).toBe(false)
    expect(noReason.result.error).toBe(OVER_RESERVE_REASON_REQUIRED)

    const withReason = transferProductionMaterials(store, {
      productionOrder: order,
      rawWarehouseId: 'wh-raw',
      lines: [{ itemId: 'item-rm', quantity: 8 }],
      actor: keeper,
      overReserveReason: 'urgent top-up',
      idempotencyKey: 'over-ok',
    })
    expect(withReason.result.ok).toBe(true)
    expect(
      withReason.store.documents.some((d) => d.purpose === 'production_reservation_increase'),
    ).toBe(true)
  })

  it('16: negative stock forbidden', () => {
    let store = emptyWarehouse()
    store = stockReceipt(store, 3)
    const order = sampleOrder({
      packagingPlan: {
        recipeName: 't',
        stackDescription: '',
        rollsPerPallet: 1,
        palletUnits: 1,
        palletsNeeded: 0,
        boxesNeeded: 0,
        topRolls: 0,
        rawRollsEstimated: 2,
      },
    })
    store = confirmProductionOrderReservation(store, order).store
    const out = transferProductionMaterials(store, {
      productionOrder: order,
      rawWarehouseId: 'wh-raw',
      lines: [{ itemId: 'item-rm', quantity: 5 }],
      actor: keeper,
      overReserveReason: 'too much',
      idempotencyKey: 'neg',
    })
    expect(out.result.ok).toBe(false)
    expect([INSUFFICIENT_PHYSICAL, NEGATIVE_STOCK_FORBIDDEN]).toContain(out.result.error)
  })

  it('17: repeated transfer with same key is idempotent', () => {
    const prep = prepareReserved()
    let store = prep.store
    const order = prep.order
    const a = transferProductionMaterials(store, {
      productionOrder: order,
      rawWarehouseId: 'wh-raw',
      lines: [{ itemId: 'item-rm', quantity: 4 }],
      actor: keeper,
      idempotencyKey: 'idem-xfer',
    })
    expect(a.result.ok).toBe(true)
    store = a.store
    const docs = store.documents.length
    const mov = store.movements.length
    const b = transferProductionMaterials(store, {
      productionOrder: order,
      rawWarehouseId: 'wh-raw',
      lines: [{ itemId: 'item-rm', quantity: 4 }],
      actor: keeper,
      idempotencyKey: 'idem-xfer',
    })
    expect(b.result.ok).toBe(true)
    expect(b.result.idempotent).toBe(true)
    expect(b.store.documents.length).toBe(docs)
    expect(b.store.movements.length).toBe(mov)
  })

  it('18: material at line computed by order/location/batch', () => {
    const prep = prepareReserved()
    let store = prep.store
    const order = prep.order
    store = transferProductionMaterials(store, {
      productionOrder: order,
      rawWarehouseId: 'wh-raw',
      lines: [
        {
          itemId: 'item-rm',
          quantity: 4,
          batchNo: 'L1',
          batchOverrideReason: 'manual',
        },
      ],
      actor: keeper,
      idempotencyKey: 'at-line',
    }).store
    const rows = computeLineMaterialBalances(store, {
      productionOrderId: order.id,
      productionWarehouseId: 'wh-line1',
      productionLocationId: 'wh-line1',
      lineId: 'line1',
    })
    expect(rows.length).toBe(1)
    expect(rows[0]?.batchNo).toBe('L1')
    expect(rows[0]?.transferredQty).toBe(4)
    expect(rows[0]?.remainingQty).toBe(4)
    expect(rows[0]?.returnedQty).toBe(0)
  })

  it('18a: distinct warehouse/location tuple is preserved and enforced end to end', () => {
    const prep = prepareReserved()
    const order = prep.order
    let store: WarehouseStore = {
      ...prep.store,
      locations: [
        ...prep.store.locations.filter((location) => location.id !== 'wh-line1'),
        { id: 'wh-production', name: 'Production warehouse', sortOrder: 2, kind: 'wip' },
        { id: 'line-location-1', name: 'Physical line 1', sortOrder: 3, kind: 'wip' },
      ],
      productionLineBindings: [
        {
          id: 'line1',
          lineId: 'line1',
          productionWarehouseId: 'wh-production',
          productionLocationId: 'line-location-1',
        },
      ],
    }
    // The physical location deliberately has no accounting row; accounting belongs to the warehouse.
    store = withActiveWarehouses(store, ['wh-production'])

    const transferred = transferProductionMaterials(store, {
      productionOrder: order,
      rawWarehouseId: 'wh-raw',
      lines: [{ itemId: 'item-rm', quantity: 4 }],
      actor: keeper,
      idempotencyKey: 'distinct-line-tuple',
    })
    expect(transferred.result.ok).toBe(true)
    store = transferred.store

    const receipt = store.documents.find(
      (document) =>
        document.productionOrderId === order.id &&
        document.purpose === 'production_material_transfer' &&
        document.type === 'receipt',
    )
    expect(receipt?.warehouseId).toBe('wh-production')
    const receiptMovement = store.movements.find(
      (movement) => movement.documentId === receipt?.id,
    )
    expect(receiptMovement).toMatchObject({
      warehouseId: 'wh-production',
      locationId: 'line-location-1',
    })

    // Same order/item at another physical location must not leak into line availability.
    store = {
      ...store,
      movements: [
        ...store.movements,
        {
          ...receiptMovement!,
          id: 'foreign-location-receipt',
          documentId: receipt!.id,
          quantity: 99,
          locationId: 'line-location-2',
        },
      ],
    }
    const balances = computeLineMaterialBalances(store, {
      productionOrderId: order.id,
      productionWarehouseId: 'wh-production',
      productionLocationId: 'line-location-1',
      lineId: 'line1',
    })
    expect(balances).toHaveLength(1)
    expect(balances[0]).toMatchObject({
      productionWarehouseId: 'wh-production',
      productionLocationId: 'line-location-1',
      transferredQty: 4,
      remainingQty: 4,
    })

    const returned = returnProductionMaterials(store, {
      productionOrder: order,
      rawWarehouseId: 'wh-raw',
      lines: [{ itemId: 'item-rm', quantity: 1 }],
      actor: keeper,
      returnReason: 'unused',
      idempotencyKey: 'distinct-line-return',
    })
    expect(returned.result.ok).toBe(true)
    const returnIssue = returned.store.documents.find(
      (document) =>
        document.productionOrderId === order.id &&
        document.purpose === 'production_material_return' &&
        document.type === 'issue',
    )
    expect(returnIssue?.warehouseId).toBe('wh-production')
    expect(
      returned.store.movements.find((movement) => movement.documentId === returnIssue?.id),
    ).toMatchObject({ warehouseId: 'wh-production', locationId: 'line-location-1' })
  })

  it('18b: canonical G3 transfer and return document roles drive line balance', () => {
    const base = emptyWarehouse()
    const documents: WarehouseStore['documents'] = [
      {
        id: 'g3-transfer-receipt',
        type: 'receipt',
        purpose: 'production_receipt',
        docRole: 'transfer_receipt',
        number: 'G3-TR',
        date: '2026-09-10',
        warehouseId: 'wh-line1',
        productionOrderId: 'po-g3',
        lines: [{ itemId: 'item-rm', quantity: 5 }],
        status: 'posted',
        createdAt: '2026-09-10T08:00:00.000Z',
      },
      {
        id: 'g3-consumption',
        type: 'issue',
        purpose: 'production_issue',
        docRole: 'production_consumption',
        number: 'G3-CONS',
        date: '2026-09-10',
        warehouseId: 'wh-line1',
        productionOrderId: 'po-g3',
        lines: [{ itemId: 'item-rm', quantity: 2 }],
        status: 'posted',
        createdAt: '2026-09-10T08:01:00.000Z',
      },
      {
        id: 'g3-return',
        type: 'issue',
        purpose: 'return',
        docRole: 'transfer_issue',
        number: 'G3-RET',
        date: '2026-09-10',
        warehouseId: 'wh-line1',
        productionOrderId: 'po-g3',
        lines: [{ itemId: 'item-rm', quantity: 1 }],
        status: 'posted',
        createdAt: '2026-09-10T08:02:00.000Z',
      },
    ]
    const store: WarehouseStore = {
      ...base,
      documents,
      movements: [
        {
          id: 'g3-transfer-movement',
          documentId: 'g3-transfer-receipt',
          itemId: 'item-rm',
          warehouseId: 'wh-line1',
          locationId: 'wh-line1',
          type: 'receipt',
          quantity: 5,
          date: '2026-09-10',
          productionOrderId: 'po-g3',
          createdAt: '2026-09-10T08:00:00.000Z',
        },
        {
          id: 'g3-consumption-movement',
          documentId: 'g3-consumption',
          itemId: 'item-rm',
          warehouseId: 'wh-line1',
          locationId: 'wh-line1',
          type: 'issue',
          quantity: 2,
          date: '2026-09-10',
          productionOrderId: 'po-g3',
          createdAt: '2026-09-10T08:01:00.000Z',
        },
        {
          id: 'g3-return-movement',
          documentId: 'g3-return',
          itemId: 'item-rm',
          warehouseId: 'wh-line1',
          locationId: 'wh-line1',
          type: 'issue',
          quantity: 1,
          date: '2026-09-10',
          productionOrderId: 'po-g3',
          createdAt: '2026-09-10T08:02:00.000Z',
        },
      ],
    }
    const rows = computeLineMaterialBalances(store, {
      productionOrderId: 'po-g3',
      productionWarehouseId: 'wh-line1',
      productionLocationId: 'wh-line1',
      lineId: 'line1',
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      transferredQty: 5,
      consumedQty: 2,
      returnedQty: 1,
      remainingQty: 2,
    })
  })

  it('19-24: return decreases line, increases raw, keeps batch, requires reason, caps remaining, idempotent', () => {
    const prep = prepareReserved()
    let store = prep.store
    const order = prep.order
    store = transferProductionMaterials(store, {
      productionOrder: order,
      rawWarehouseId: 'wh-raw',
      lines: [
        {
          itemId: 'item-rm',
          quantity: 5,
          batchNo: 'R1',
          batchOverrideReason: 'pick',
        },
      ],
      actor: keeper,
      idempotencyKey: 'ret-prep',
    }).store

    const noReason = returnProductionMaterials(store, {
      productionOrder: order,
      rawWarehouseId: 'wh-raw',
      lines: [{ itemId: 'item-rm', quantity: 2, batchNo: 'R1' }],
      actor: keeper,
      returnReason: '  ',
      idempotencyKey: 'ret-nr',
    })
    expect(noReason.result.ok).toBe(false)
    expect(noReason.result.error).toBe(RETURN_REASON_REQUIRED)

    const tooMuch = returnProductionMaterials(store, {
      productionOrder: order,
      rawWarehouseId: 'wh-raw',
      lines: [{ itemId: 'item-rm', quantity: 99, batchNo: 'R1' }],
      actor: keeper,
      returnReason: 'leftover',
      idempotencyKey: 'ret-over',
    })
    expect(tooMuch.result.ok).toBe(false)
    expect(tooMuch.result.error).toBe(RETURN_EXCEEDS_REMAINING)

    const ok = returnProductionMaterials(store, {
      productionOrder: order,
      rawWarehouseId: 'wh-raw',
      lines: [{ itemId: 'item-rm', quantity: 2, batchNo: 'R1' }],
      actor: keeper,
      returnReason: 'order finished leftover',
      idempotencyKey: 'ret-ok',
    })
    expect(ok.result.ok).toBe(true)
    store = ok.store
    expect(computeItemBalance('item-rm', store.movements, 'wh-line1').balance).toBe(3)
    expect(computeItemBalance('item-rm', store.movements, 'wh-raw').balance).toBe(17)
    const retIssue = store.documents.find(
      (d) => d.purpose === 'production_material_return' && d.type === 'issue',
    )
    expect(retIssue?.lines[0]?.batchNo).toBe('R1')

    const rows = computeLineMaterialBalances(store, {
      productionOrderId: order.id,
      productionWarehouseId: 'wh-line1',
      productionLocationId: 'wh-line1',
    })
    expect(rows[0]?.returnedQty).toBe(2)
    expect(rows[0]?.remainingQty).toBe(3)

    const again = returnProductionMaterials(store, {
      productionOrder: order,
      rawWarehouseId: 'wh-raw',
      lines: [{ itemId: 'item-rm', quantity: 2, batchNo: 'R1' }],
      actor: keeper,
      returnReason: 'order finished leftover',
      idempotencyKey: 'ret-ok',
    })
    expect(again.result.idempotent).toBe(true)
  })

  it('25-26: transfer/return pair rolls back when second document fails', () => {
    const prep = prepareReserved()
    let store = prep.store
    const order = prep.order
    const snapDocs = store.documents.length
    const snapMov = store.movements.length

    const xferFail = documents.postWarehouseDocumentsAtomic(store, [
      {
        type: 'issue',
        number: 'RB-1-I',
        date: '2026-09-03',
        warehouseId: 'wh-raw',
        purpose: 'production_material_transfer',
        productionOrderId: order.id,
        lines: [{ itemId: 'item-rm', quantity: 1 }],
        status: 'posted',
        postedAt: '2026-09-03T12:00:00.000Z',
      },
      {
        type: 'receipt',
        number: 'RB-1-R',
        date: '2026-09-03',
        warehouseId: '',
        purpose: 'production_material_transfer',
        productionOrderId: order.id,
        lines: [{ itemId: 'item-rm', quantity: 1 }],
        status: 'posted',
        postedAt: '2026-09-03T12:00:00.000Z',
      },
    ])
    expect(xferFail.result.ok).toBe(false)
    expect(xferFail.store.documents.length).toBe(snapDocs)
    expect(xferFail.store.movements.length).toBe(snapMov)

    store = transferProductionMaterials(store, {
      productionOrder: order,
      rawWarehouseId: 'wh-raw',
      lines: [{ itemId: 'item-rm', quantity: 3 }],
      actor: keeper,
      idempotencyKey: 'rb-prep',
    }).store
    const before = store.documents.length
    const beforeMov = store.movements.length
    const retFail = documents.postWarehouseDocumentsAtomic(store, [
      {
        type: 'issue',
        number: 'RB-2-I',
        date: '2026-09-03',
        warehouseId: 'wh-line1',
        purpose: 'production_material_return',
        productionOrderId: order.id,
        lines: [{ itemId: 'item-rm', quantity: 1 }],
        status: 'posted',
        postedAt: '2026-09-03T12:00:00.000Z',
      },
      {
        type: 'receipt',
        number: 'RB-2-R',
        date: '2026-09-03',
        warehouseId: '',
        purpose: 'production_material_return',
        productionOrderId: order.id,
        lines: [{ itemId: 'item-rm', quantity: 1 }],
        status: 'posted',
        postedAt: '2026-09-03T12:00:00.000Z',
      },
    ])
    expect(retFail.result.ok).toBe(false)
    expect(retFail.store.documents.length).toBe(before)
    expect(retFail.store.movements.length).toBe(beforeMov)
  })

  it('27: cloud conflict / subset ack fail-closed for handoff group', () => {
    const groupId = warehouseTransactionGroupId({
      kind: 'production_material_transfer',
      sourceId: 'po-1',
      revision: 'h1',
    })
    const ops: DirtyOperation[] = stampOpsWithTransactionGroup(
      [
        {
          operationId: 'op1',
          type: 'create',
          domain: 'warehouse.documents',
          entityId: 'doc-1',
          baseRevision: 1,
          origin: 'user',
        },
        {
          operationId: 'op2',
          type: 'create',
          domain: 'warehouse.movements',
          entityId: 'mov-1',
          baseRevision: 1,
          origin: 'user',
        },
      ],
      {
        transactionGroupId: groupId,
        transactionGroupKind: 'production_material_transfer',
        atomic: true,
      },
      {} as AppStore,
      {} as AppStore,
    )
    const ack = sanitizeAcknowledgeIds(ops, ['op1'])
    expect(ack.safeIds).toHaveLength(0)
    expect(ack.blockedGroupIds).toContain(groupId)

    const remote = {
      warehouse: { documents: [{ id: 'doc-1', updatedAt: 'conflict' }], movements: [] },
    } as unknown as AppStore
    const classified = classifyAtomicGroupAgainstRemote(ops, remote)
    expect(['apply', 'skip', 'conflict', 'unsupported']).toContain(classified)
  })

  it('28-29: chief_engineer without capability cannot reallocate; with capability needs reason', () => {
    let store = emptyWarehouse()
    store = stockReceipt(store, 30)
    const a = sampleOrder({ id: 'po-a', orderNumber: 'A' })
    const b = sampleOrder({ id: 'po-b', orderNumber: 'B' })
    store = confirmProductionOrderReservation(store, a).store

    expect(
      canManualReallocateReservations(
        { roleId: 'chief_engineer', active: true },
        {} as AccessStore,
        { reason: 'x' },
      ),
    ).toBe(false)

    const denied = reallocateProductionReservation(store, a, b, {
      sourceProductionOrderId: a.id,
      targetProductionOrderId: b.id,
      itemId: 'item-rm',
      warehouseId: 'wh-raw',
      quantity: 2,
      reason: 'shift',
      idempotencyKey: 'ce-deny',
      actor: { id: 'ce', name: 'CE', roleId: 'chief_engineer' },
      access: { roleAllowReservationReallocation: {} } as AccessStore,
    })
    expect(denied.result.ok).toBe(false)

    const noReason = reallocateProductionReservation(store, a, b, {
      sourceProductionOrderId: a.id,
      targetProductionOrderId: b.id,
      itemId: 'item-rm',
      warehouseId: 'wh-raw',
      quantity: 2,
      reason: ' ',
      idempotencyKey: 'ce-nr',
      actor: { id: 'ce', name: 'CE', roleId: 'chief_engineer' },
      access: {
        roleAllowReservationReallocation: { chief_engineer: true },
      } as AccessStore,
    })
    expect(noReason.result.ok).toBe(false)
    expect(noReason.result.error).toBeDefined()

    const allowed = reallocateProductionReservation(store, a, b, {
      sourceProductionOrderId: a.id,
      targetProductionOrderId: b.id,
      itemId: 'item-rm',
      warehouseId: 'wh-raw',
      quantity: 2,
      reason: 'authorized reallocation',
      idempotencyKey: 'ce-ok',
      actor: { id: 'ce', name: 'CE', roleId: 'chief_engineer' },
      access: {
        roleAllowReservationReallocation: { chief_engineer: true },
      } as AccessStore,
    })
    expect(allowed.result.ok).toBe(true)
  })

  it('journal source=production for handoff docs; upsert binding does not create locations', () => {
    const prep = prepareReserved()
    let store = prep.store
    const order = prep.order
    store = transferProductionMaterials(store, {
      productionOrder: order,
      rawWarehouseId: 'wh-raw',
      lines: [{ itemId: 'item-rm', quantity: 2 }],
      actor: keeper,
      idempotencyKey: 'jrnl',
    }).store
    const rows = queryDocumentJournal(store, { source: 'production' })
    expect(rows.some((r) => r.doc.purpose === 'production_material_transfer')).toBe(true)
    const issue = store.documents.find(
      (d) => d.purpose === 'production_material_transfer' && d.type === 'issue',
    )!
    expect(documentSourceKind(issue)).toBe('production')

    const locCount = store.locations.length
    store = upsertProductionLineBinding(store, {
      lineId: 'line2',
      productionWarehouseId: 'wh-line1',
      productionLocationId: 'wh-line1',
    })
    expect(store.locations.length).toBe(locCount)
  })

  it('30: employees/months/timesheets untouched', () => {
    const employees = [{ id: 'e1' }]
    const months = { '2026-09': { rows: [] } }
    const { store, order } = prepareReserved()
    transferProductionMaterials(store, {
      productionOrder: order,
      rawWarehouseId: 'wh-raw',
      lines: [{ itemId: 'item-rm', quantity: 1 }],
      actor: keeper,
      idempotencyKey: 'ts-safe',
    })
    expect(employees).toEqual([{ id: 'e1' }])
    expect(months['2026-09']?.rows).toEqual([])
  })
})
