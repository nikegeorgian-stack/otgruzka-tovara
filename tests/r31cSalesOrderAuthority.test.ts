import { describe, expect, it } from 'vitest'

import { mirrorG5Ack, type G5AckPayload } from '@/lib/planner/g5ServerClient'
import {
  G5_SALES_ORDER_CONTRACT_VERSION,
  coerceG5SalesOrderRow,
  validateG5SalesConfirmAck,
  validateG5SalesDraftSaveAck,
} from '@/lib/sales/g5SalesOrderAuthority'
import { createDefaultStore } from '@/lib/storage'

const DATE = '2026-09-10'
const ORDER_ID = 'sales-c-1'
const LINE_ID = 'sol-server-c-1'
const CUSTOMER_ID = 'customer-c-1'
const PRODUCT_ID = 'fp-c-1'
const FINGERPRINT = 'g5:sales.order.draft.save:v1:sha256:abc123'

function row(overrides: Record<string, unknown> = {}) {
  return {
    salesOrderContractVersion: G5_SALES_ORDER_CONTRACT_VERSION,
    id: ORDER_ID,
    orderNumber: 'ЗК-2026-001',
    status: 'draft',
    customerId: CUSTOMER_ID,
    customerCodeSnapshot: 'EDU-C',
    customerNameSnapshot: 'Учебный клиент',
    priority: 1,
    orderDate: DATE,
    revision: 0,
    lines: [
      {
        lineId: LINE_ID,
        finishedProductId: PRODUCT_ID,
        productCodeSnapshot: 'CP160',
        productNameSnapshot: 'Celloplex 160',
        unit: 'm2',
        quantity: 120,
        requestedShipDate: DATE,
        linkedProductionOrderIds: [],
        producedQty: 0,
        releasedQty: 0,
        shippedQty: 0,
        remainingQty: 120,
      },
    ],
    createdAt: `${DATE}T08:00:00.000Z`,
    updatedAt: `${DATE}T08:00:00.000Z`,
    ...overrides,
  }
}

function ack(overrides: Partial<G5AckPayload> = {}): G5AckPayload {
  const authoritative = row()
  return {
    id: ORDER_ID,
    status: 'draft',
    orderNumber: 'ЗК-2026-001',
    criticalRevision: 63,
    commandFingerprint: FINGERPRINT,
    salesPlanningActive: true,
    order: authoritative,
    sales: { orders: [authoritative] },
    ...overrides,
  }
}

function expected() {
  return {
    orderId: ORDER_ID,
    customerId: CUSTOMER_ID,
    priority: 1 as const,
    orderDate: DATE,
    commandFingerprint: FINGERPRINT,
    lines: [
      {
        lineId: 'client-line-is-not-authority',
        finishedProductId: PRODUCT_ID,
        quantity: 120,
        unit: 'm2',
        requestedShipDate: DATE,
        productionOrderIds: [],
      },
    ],
  }
}

describe('R3.1C versioned G5 sales projection', () => {
  it('maps a complete authoritative v1 order without inventing identities', () => {
    const order = coerceG5SalesOrderRow(row())
    expect(order).toMatchObject({
      id: ORDER_ID,
      orderNumber: 'ЗК-2026-001',
      counterpartyId: CUSTOMER_ID,
      customer: 'Учебный клиент',
      orderDate: DATE,
      dueDate: DATE,
      priority: 'normal',
    })
    expect(order.lines).toEqual([
      expect.objectContaining({
        id: LINE_ID,
        finishedProductId: PRODUCT_ID,
        productName: 'Celloplex 160',
        qtyMp: 120,
        unit: 'm2',
        productionOrderIds: [],
      }),
    ])
  })

  it.each([
    ['unknown schema version', row({ salesOrderContractVersion: 'g5-sales-order-v99' })],
    ['missing human number', row({ orderNumber: '' })],
    ['unknown priority', row({ priority: 7 })],
    ['invalid date', row({ orderDate: '2026-02-31' })],
    ['non-finite quantity', row({ lines: [{ ...(row().lines as object[])[0], quantity: 'NaN' }] })],
    [
      'duplicate line id',
      row({
        lines: [
          (row().lines as object[])[0],
          { ...(row().lines as object[])[0], finishedProductId: 'fp-other' },
        ],
      }),
    ],
  ])('rejects %s', (_label, authoritative) => {
    expect(() => coerceG5SalesOrderRow(authoritative)).toThrow()
  })

  it('does not partially mirror a malformed authoritative snapshot', () => {
    const store = createDefaultStore()
    const before = structuredClone(store.sales)
    expect(() =>
      mirrorG5Ack(store, {
        replaceSalesOrders: true,
        salesPlanningActive: true,
        sales: { orders: [row(), row({ id: 'other', orderNumber: '' })] },
      }),
    ).toThrow('sales_order_schema_mismatch')
    expect(store.sales).toEqual(before)
  })
})

describe('R3.1C sales draft ACK', () => {
  it('accepts exactly one server-owned draft and line identity', () => {
    expect(validateG5SalesDraftSaveAck(ack(), 62, expected())).toMatchObject({
      ok: true,
      criticalRevision: 63,
      order: { id: ORDER_ID, orderNumber: 'ЗК-2026-001' },
    })
  })

  it('accepts only the exact server-validated production links in the draft ACK', () => {
    const linkedLine = {
      ...(row().lines as Record<string, unknown>[])[0],
      linkedProductionOrderIds: ['po-wip-c-1'],
    }
    const linkedRow = row({ lines: [linkedLine] })
    const linkedAck = ack({ order: linkedRow, sales: { orders: [linkedRow] } })
    const linkedExpected = expected()
    linkedExpected.lines[0].productionOrderIds = ['po-wip-c-1']
    expect(validateG5SalesDraftSaveAck(linkedAck, 62, linkedExpected)).toMatchObject({
      ok: true,
      order: { lines: [expect.objectContaining({ productionOrderIds: ['po-wip-c-1'] })] },
    })
    expect(validateG5SalesDraftSaveAck(linkedAck, 62, expected())).toEqual({
      ok: false,
      error: 'sales_order_draft_ack_mismatch',
    })
  })

  it.each([
    ['missing row', ack({ sales: { orders: [] } })],
    ['stale non-replay revision', ack({ criticalRevision: 62 })],
    ['wrong command fingerprint', ack({ commandFingerprint: 'wrong' })],
    ['wrong customer', ack({ sales: { orders: [row({ customerId: 'other' })] } })],
    [
      'duplicate order id',
      ack({ sales: { orders: [row(), row({ orderNumber: 'ЗК-2026-002' })] } }),
    ],
    [
      'payload quantity mismatch',
      ack({
        order: row({
          lines: [{ ...(row().lines as object[])[0], quantity: 121, remainingQty: 121 }],
        }),
        sales: {
          orders: [
            row({
              lines: [{ ...(row().lines as object[])[0], quantity: 121, remainingQty: 121 }],
            }),
          ],
        },
      }),
    ],
    [
      'trusted progress in a draft',
      ack({
        order: row({
          lines: [{ ...(row().lines as object[])[0], producedQty: 1 }],
        }),
        sales: {
          orders: [row({ lines: [{ ...(row().lines as object[])[0], producedQty: 1 }] })],
        },
      }),
    ],
  ])('blocks %s without yielding a mirrorable order', (_label, authoritative) => {
    expect(validateG5SalesDraftSaveAck(authoritative, 62, expected())).toEqual({
      ok: false,
      error: 'sales_order_draft_ack_mismatch',
    })
  })

  it('accepts an exact replay at the same revision only when flagged idempotent', () => {
    expect(
      validateG5SalesDraftSaveAck(
        ack({ criticalRevision: 62, idempotent: true }),
        62,
        expected(),
      ),
    ).toMatchObject({ ok: true, criticalRevision: 62 })
  })
})

describe('R3.1C sales confirm ACK', () => {
  it('requires the exact confirmed authoritative order at a monotonic revision', () => {
    const previousOrder = coerceG5SalesOrderRow(row())
    const confirmed = row({ status: 'confirmed', revision: 1 })
    const data = {
      ...ack(),
      status: 'confirmed',
      commandFingerprint: 'g5:sales.order.confirm:v1:sha256:confirm',
      order: confirmed,
      sales: { orders: [confirmed] },
    }
    expect(
      validateG5SalesConfirmAck(data, 62, {
        commandFingerprint: 'g5:sales.order.confirm:v1:sha256:confirm',
        previousOrder,
      }),
    ).toMatchObject({ ok: true, order: { id: ORDER_ID, status: 'confirmed' } })
    expect(
      validateG5SalesConfirmAck(
        { ...data, sales: { orders: [] } },
        62,
        {
          commandFingerprint: 'g5:sales.order.confirm:v1:sha256:confirm',
          previousOrder,
        },
      ),
    ).toEqual({ ok: false, error: 'sales_order_confirm_ack_mismatch' })
  })

  it('requires confirm to preserve the exact authoritative production linkage', () => {
    const linkedLine = {
      ...(row().lines as Record<string, unknown>[])[0],
      linkedProductionOrderIds: ['po-wip-c-1'],
    }
    const previousOrder = coerceG5SalesOrderRow(row({ lines: [linkedLine] }))
    const confirmed = row({ status: 'confirmed', revision: 1, lines: [linkedLine] })
    const data = {
      ...ack(),
      status: 'confirmed',
      commandFingerprint: 'g5:sales.order.confirm:v1:sha256:linked',
      order: confirmed,
      sales: { orders: [confirmed] },
    }
    expect(
      validateG5SalesConfirmAck(data, 62, {
        commandFingerprint: 'g5:sales.order.confirm:v1:sha256:linked',
        previousOrder,
      }),
    ).toMatchObject({
      ok: true,
      order: { lines: [expect.objectContaining({ productionOrderIds: ['po-wip-c-1'] })] },
    })

    const unlinked = row({ status: 'confirmed', revision: 1 })
    expect(
      validateG5SalesConfirmAck(
        { ...data, order: unlinked, sales: { orders: [unlinked] } },
        62,
        {
          commandFingerprint: 'g5:sales.order.confirm:v1:sha256:linked',
          previousOrder,
        },
      ),
    ).toEqual({ ok: false, error: 'sales_order_confirm_ack_mismatch' })
  })
})
