import { describe, expect, it } from 'vitest'

import {
  coerceG5ProcurementOrderRow,
  validateG5ProcurementOrderAck,
  validateG5ProcurementReceiptAck,
  type G5AckPayload,
} from '@/lib/planner/g5ServerClient'
import { applyCriticalDomainOverlays } from '@/lib/cloud/applyCriticalDomainOverlays'
import { buildAuthoritativePurchaseOrderReceiptPlan } from '@/lib/procurement/receive'
import type { PurchaseOrder } from '@/lib/procurement/types'
import { createDefaultStore } from '@/lib/storage'
import type { AppStore } from '@/lib/types'

const DATE = '2026-09-10'
const PREVIOUS_REVISION = 41
const ORDER_ID = 'po-server-1'
const ORDER_NUMBER = 'ЗЗ-2026-0042'
const PO_LINE_ID = 'pol-server-1'
const ITEM_ID = 'item-raw-1'
const SUPPLIER_ID = 'supplier-edu-1'
const WAREHOUSE_ID = 'wh-main'
const LOCATION_ID = 'loc-receipt-1'
const DOCUMENT_ID = 'wh-doc-receipt-1'
const DOCUMENT_LINE_ID = 'wdl-receipt-1'
const MOVEMENT_ID = 'mov-receipt-1'

function canonicalOrderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    orderNumber: ORDER_NUMBER,
    status: 'draft',
    scope: 'domestic',
    category: 'raw_material',
    supplierId: SUPPLIER_ID,
    supplierNameSnapshot: 'Учебный поставщик',
    destinationWarehouseId: WAREHOUSE_ID,
    orderDate: DATE,
    requestedDeliveryDate: DATE,
    currency: 'GEL',
    revision: 0,
    lines: [
      {
        lineId: PO_LINE_ID,
        itemId: ITEM_ID,
        itemCodeSnapshot: 'RAW-001',
        itemNameSnapshot: 'Суровьё EDU',
        unit: 'kg',
        requestedQty: 12.5,
        receivedQty: 0,
        requiredDate: DATE,
      },
    ],
    createdAt: `${DATE}T08:00:00.000Z`,
    updatedAt: `${DATE}T08:00:00.000Z`,
    ...overrides,
  }
}

function expectedCreate() {
  return {
    operation: 'create' as const,
    status: 'draft',
    lines: [{ itemId: ITEM_ID, requestedQty: 12.5, unit: 'kg' }],
  }
}

function orderAck(row: Record<string, unknown> = canonicalOrderRow()): G5AckPayload {
  return {
    id: ORDER_ID,
    orderNumber: String(row.orderNumber ?? ORDER_NUMBER),
    status: 'draft',
    order: row,
    criticalRevision: PREVIOUS_REVISION + 1,
    procurement: { orders: [row] },
  }
}

function localPurchaseOrder(id = 'po-local-stale'): PurchaseOrder {
  return {
    id,
    orderNumber: 'ЗЗ-2026-0001',
    counterpartyId: SUPPLIER_ID,
    scope: 'domestic',
    category: 'raw_material',
    status: 'draft',
    orderDate: DATE,
    destinationWarehouseId: WAREHOUSE_ID,
    currency: 'GEL',
    lines: [
      {
        id: 'local-line-1',
        warehouseItemId: ITEM_ID,
        name: 'Устаревшая строка',
        quantity: 1,
        unit: 'kg',
        receivedQty: 0,
      },
    ],
    legs: [],
    milestones: [],
    statusHistory: [],
    attachments: [],
    warehouseDocumentIds: [],
    createdAt: `${DATE}T07:00:00.000Z`,
    updatedAt: `${DATE}T07:00:00.000Z`,
  }
}

function storeWithCanonicalReceiptInputs(): AppStore {
  const store = createDefaultStore() as AppStore
  store.procurement.orders = [
    {
      ...localPurchaseOrder(ORDER_ID),
      orderNumber: ORDER_NUMBER,
      status: 'ordered',
      lines: [
        {
          id: PO_LINE_ID,
          warehouseItemId: ITEM_ID,
          name: 'Суровьё EDU',
          quantity: 12.5,
          unit: 'kg',
          receivedQty: 2.5,
        },
      ],
    },
  ]
  store.warehouse.locations = [
    { id: WAREHOUSE_ID, name: 'Основной', sortOrder: 0 },
    { id: LOCATION_ID, name: 'Зона приёмки', sortOrder: 1 },
  ]
  store.warehouse.items = [
    {
      id: ITEM_ID,
      internalCode: 'RAW-001',
      name: 'Суровьё EDU',
      categoryId: store.warehouse.categories[0]?.id ?? 'raw',
      warehouseId: WAREHOUSE_ID,
      unit: 'kg',
      active: true,
      sortOrder: 0,
    },
  ]
  return store
}

describe('R3.1C canonical procurement order adapter', () => {
  it('maps the authoritative schema into the UI schema without retaining client identity', () => {
    const mapped = coerceG5ProcurementOrderRow(canonicalOrderRow(), localPurchaseOrder(ORDER_ID))

    expect(mapped).toMatchObject({
      id: ORDER_ID,
      orderNumber: ORDER_NUMBER,
      counterpartyId: SUPPLIER_ID,
      status: 'draft',
      orderDate: DATE,
      requestedDeliveryDate: DATE,
      destinationWarehouseId: WAREHOUSE_ID,
      currency: 'GEL',
      revision: 0,
    })
    expect(mapped.lines).toEqual([
      expect.objectContaining({
        id: PO_LINE_ID,
        warehouseItemId: ITEM_ID,
        name: 'Суровьё EDU',
        quantity: 12.5,
        receivedQty: 0,
        unit: 'kg',
      }),
    ])
    expect(mapped.lines[0]?.id).not.toBe('local-line-1')
  })

  it('hard-replaces stale local procurement rows on an authoritative pull', async () => {
    const store = createDefaultStore() as AppStore
    store.procurement.orders = [localPurchaseOrder()]

    const next = await applyCriticalDomainOverlays(store, {
      revision: PREVIOUS_REVISION + 1,
      procurement: { orders: [canonicalOrderRow()] },
      procurementActive: true,
      warehouseActive: false,
    })

    expect(next.procurement.orders.map((order) => order.id)).toEqual([ORDER_ID])
    expect(next.procurement.orders[0]).toMatchObject({
      orderNumber: ORDER_NUMBER,
      counterpartyId: SUPPLIER_ID,
    })
    expect(next.procurement.orders[0]?.lines[0]).toMatchObject({
      id: PO_LINE_ID,
      warehouseItemId: ITEM_ID,
      quantity: 12.5,
    })
  })
})

describe('R3.1C procurement order ACK validation', () => {
  it('accepts server-owned order/line IDs for create when item, quantity, and unit match', () => {
    expect(
      validateG5ProcurementOrderAck(orderAck(), PREVIOUS_REVISION, expectedCreate()),
    ).toMatchObject({
      ok: true,
      criticalRevision: PREVIOUS_REVISION + 1,
      order: { id: ORDER_ID, orderNumber: ORDER_NUMBER },
    })
  })

  it.each([
    ['missing human number', canonicalOrderRow({ orderNumber: '' })],
    [
      'duplicate target order',
      null,
    ],
    [
      'extra line',
      canonicalOrderRow({
        lines: [
          ...(canonicalOrderRow().lines as unknown[]),
          {
            lineId: 'pol-extra',
            itemId: ITEM_ID,
            itemNameSnapshot: 'Лишняя строка',
            unit: 'kg',
            requestedQty: 1,
            receivedQty: 0,
          },
        ],
      }),
    ],
    [
      'duplicate line ID',
      canonicalOrderRow({
        lines: [
          ...(canonicalOrderRow().lines as unknown[]),
          {
            lineId: PO_LINE_ID,
            itemId: 'item-other',
            itemNameSnapshot: 'Другая строка',
            unit: 'kg',
            requestedQty: 1,
            receivedQty: 0,
          },
        ],
      }),
    ],
    [
      'non-finite quantity',
      canonicalOrderRow({
        lines: [
          {
            ...(canonicalOrderRow().lines as Array<Record<string, unknown>>)[0],
            requestedQty: Number.NaN,
          },
        ],
      }),
    ],
  ])('rejects %s', (_label, row) => {
    const ack =
      row === null
        ? ({
            ...orderAck(),
            procurement: { orders: [canonicalOrderRow(), canonicalOrderRow()] },
          } satisfies G5AckPayload)
        : orderAck(row)
    expect(
      validateG5ProcurementOrderAck(ack, PREVIOUS_REVISION, expectedCreate()),
    ).toEqual({ ok: false, error: 'procurement_order_ack_mismatch' })
  })

  it('requires exact server line IDs for edit/status ACKs', () => {
    const expected = {
      operation: 'edit' as const,
      orderId: ORDER_ID,
      status: 'draft',
      lines: [{ lineId: PO_LINE_ID, itemId: ITEM_ID, requestedQty: 12.5, unit: 'kg' }],
    }
    expect(
      validateG5ProcurementOrderAck(orderAck(), PREVIOUS_REVISION, expected),
    ).toMatchObject({ ok: true })
    expect(
      validateG5ProcurementOrderAck(
        orderAck(
          canonicalOrderRow({
            lines: [
              {
                ...(canonicalOrderRow().lines as Array<Record<string, unknown>>)[0],
                lineId: 'pol-replaced-by-server',
              },
            ],
          }),
        ),
        PREVIOUS_REVISION,
        expected,
      ),
    ).toEqual({ ok: false, error: 'procurement_order_ack_mismatch' })
  })
})

describe('R3.1C authoritative full purchase receipt', () => {
  it('plans exactly all remaining quantity with existing catalogue identities only', () => {
    const store = storeWithCanonicalReceiptInputs()
    const itemIdsBefore = store.warehouse.items.map((item) => item.id)

    const plan = buildAuthoritativePurchaseOrderReceiptPlan(store, ORDER_ID, {
      date: DATE,
      locationIdByLine: { [PO_LINE_ID]: LOCATION_ID },
    })

    expect(plan).toEqual({
      ok: true,
      purchaseOrderId: ORDER_ID,
      warehouseId: WAREHOUSE_ID,
      date: DATE,
      lines: [
        {
          lineId: PO_LINE_ID,
          itemId: ITEM_ID,
          quantity: 10,
          unit: 'kg',
          locationId: LOCATION_ID,
          expectedReceivedQty: 12.5,
        },
      ],
    })
    expect(store.warehouse.items.map((item) => item.id)).toEqual(itemIdsBefore)
  })

  it('fails closed when a PO line has no exact existing catalogue item', () => {
    const store = storeWithCanonicalReceiptInputs()
    store.procurement.orders[0]!.lines[0]!.warehouseItemId = 'item-not-in-catalogue'
    const itemIdsBefore = store.warehouse.items.map((item) => item.id)

    expect(
      buildAuthoritativePurchaseOrderReceiptPlan(store, ORDER_ID, { date: DATE }),
    ).toEqual({ ok: false, error: 'procurement.receive.errCatalogueItemRequired' })
    expect(store.warehouse.items.map((item) => item.id)).toEqual(itemIdsBefore)
  })

  it('validates the exact posted receipt document, lines, movements, and PO readback', () => {
    const expected = {
      purchaseOrderId: ORDER_ID,
      warehouseId: WAREHOUSE_ID,
      date: DATE,
      lines: [
        {
          lineId: PO_LINE_ID,
          itemId: ITEM_ID,
          quantity: 10,
          unit: 'kg',
          locationId: LOCATION_ID,
        },
      ],
    }
    const receivedOrder = canonicalOrderRow({
      status: 'received',
      revision: 1,
      warehouseDocumentIds: [DOCUMENT_ID],
      lines: [
        {
          ...(canonicalOrderRow().lines as Array<Record<string, unknown>>)[0],
          receivedQty: 12.5,
        },
      ],
    })
    const ack = {
      purchaseOrderId: ORDER_ID,
      documentId: DOCUMENT_ID,
      number: 'ПР-2026-0042',
      status: 'received',
      movementsCount: 1,
      order: receivedOrder,
      criticalRevision: PREVIOUS_REVISION + 1,
      procurement: { orders: [receivedOrder] },
      warehouse: {
        documents: [
          {
            id: DOCUMENT_ID,
            number: 'ПР-2026-0042',
            type: 'receipt',
            purpose: 'purchase',
            docRole: 'procurement_receipt',
            status: 'posted',
            purchaseOrderId: ORDER_ID,
            warehouseId: WAREHOUSE_ID,
            date: DATE,
            lines: [
              {
                lineId: DOCUMENT_LINE_ID,
                purchaseOrderLineId: PO_LINE_ID,
                itemId: ITEM_ID,
                quantity: 10,
                unitSnapshot: 'kg',
                locationId: LOCATION_ID,
              },
            ],
          },
        ],
        movements: [
          {
            id: MOVEMENT_ID,
            documentId: DOCUMENT_ID,
            documentLineId: DOCUMENT_LINE_ID,
            purchaseOrderId: ORDER_ID,
            purchaseOrderLineId: PO_LINE_ID,
            warehouseId: WAREHOUSE_ID,
            itemId: ITEM_ID,
            quantity: 10,
            unitSnapshot: 'kg',
            type: 'receipt',
            date: DATE,
            locationId: LOCATION_ID,
          },
        ],
      },
    } satisfies G5AckPayload
    ack.document = ack.warehouse.documents[0]
    ack.movements = ack.warehouse.movements

    expect(
      validateG5ProcurementReceiptAck(ack, PREVIOUS_REVISION, expected),
    ).toMatchObject({
      ok: true,
      criticalRevision: PREVIOUS_REVISION + 1,
      documentId: DOCUMENT_ID,
      documentNumber: 'ПР-2026-0042',
    })

    const extraMovement = {
      ...ack,
      warehouse: {
        ...ack.warehouse,
        movements: [
          ...ack.warehouse.movements,
          { ...ack.warehouse.movements[0], id: 'mov-extra' },
        ],
      },
    } satisfies G5AckPayload
    expect(
      validateG5ProcurementReceiptAck(extraMovement, PREVIOUS_REVISION, expected),
    ).toEqual({ ok: false, error: 'procurement_receipt_ack_mismatch' })

    expect(
      validateG5ProcurementReceiptAck(
        {
          ...ack,
          document: { ...ack.document, number: 'ПР-FORGED' },
        },
        PREVIOUS_REVISION,
        expected,
      ),
    ).toEqual({ ok: false, error: 'procurement_receipt_ack_mismatch' })
  })
})
