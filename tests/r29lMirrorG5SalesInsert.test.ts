/**
 * G5 draft.save ack must insert new sales orders into the soft UI store.
 * Update-only mirror leaves Director with stale soft rows (qty 0) after authoritative save.
 */
import { describe, expect, it } from 'vitest'
import { createDefaultStore } from '@/lib/storage'
import { mirrorG5Ack } from '@/lib/planner/g5ServerClient'

describe('R2.9L mirrorG5Ack inserts new sales orders', () => {
  it('adds a G5 draft that was not present locally', () => {
    const store = createDefaultStore()
    store.sales.orders = [
      {
        id: 'soft-stale',
        orderNumber: 'ЗК-2026-001',
        status: 'confirmed',
        commercialStatus: 'confirmed',
        fulfillmentStatus: 'unplanned',
        priority: 'normal',
        orderDate: '2026-09-08',
        lines: [
          {
            id: 'ln-soft',
            productName: 'stale',
            category: 'ratl1',
            qtyMp: 0,
            productionOrderIds: [],
            progress: {
              orderedQty: 0,
              cancelledQty: 0,
              reservedFinishedGoodsQty: 0,
              productionAllocatedQty: 0,
              productionStartedQty: 0,
              producedGoodQty: 0,
              qcApprovedQty: 0,
              readyToShipQty: 0,
              shipmentReservedQty: 0,
              shippedQty: 0,
              remainingToPlanQty: 0,
              remainingToProduceQty: 0,
              remainingToShipQty: 0,
            },
          },
        ],
        history: [],
        createdAt: '2026-09-08T00:00:00.000Z',
        updatedAt: '2026-09-08T00:00:00.000Z',
        customer: '',
      },
    ]

    const next = mirrorG5Ack(store, {
      ok: true,
      id: 'a0f76b52-2d77-4733-a2af-7cbb85e7eef6',
      status: 'draft',
      salesPlanningActive: true,
      sales: {
        orders: [
          {
            id: 'a0f76b52-2d77-4733-a2af-7cbb85e7eef6',
            status: 'draft',
            customerId: 'edu-cello-customer-20260908',
            priority: 1,
            lines: [
              {
                lineId: '58992bc4-e5da-4e8b-b1d9-cd500a673d97',
                finishedProductId: 'edu-cello-fp-160-10-20260908',
                quantity: 12.5,
                unit: 'm2',
              },
            ],
            updatedAt: '2026-09-08T18:12:00.000Z',
            createdAt: '2026-09-08T18:12:00.000Z',
          },
        ],
      },
    })

    const draft = next.sales.orders.find((o) => o.id === 'a0f76b52-2d77-4733-a2af-7cbb85e7eef6')
    expect(draft, 'authoritative draft must appear in UI store').toBeTruthy()
    expect(draft!.status).toBe('draft')
    expect(draft!.counterpartyId).toBe('edu-cello-customer-20260908')
    expect(draft!.lines[0]?.qtyMp).toBe(12.5)
    expect(draft!.lines[0]?.finishedProductId).toBe('edu-cello-fp-160-10-20260908')
  })

  it('replaceSalesOrders drops soft-only rows when hydrating from G1', () => {
    const store = createDefaultStore()
    store.sales.orders = [
      {
        id: 'edu-cello-sales-order-20260908',
        orderNumber: 'ЗК-2026-001',
        status: 'confirmed',
        commercialStatus: 'confirmed',
        fulfillmentStatus: 'unplanned',
        priority: 'normal',
        orderDate: '2026-09-08',
        lines: [
          {
            id: 'ln-soft',
            productName: 'stale',
            category: 'ratl1',
            qtyMp: 0,
            finishedProductId: 'edu-cello-fp-160-10-20260908',
            productionOrderIds: [],
            progress: {
              orderedQty: 0,
              cancelledQty: 0,
              reservedFinishedGoodsQty: 0,
              productionAllocatedQty: 0,
              productionStartedQty: 0,
              producedGoodQty: 0,
              qcApprovedQty: 0,
              readyToShipQty: 0,
              shipmentReservedQty: 0,
              shippedQty: 0,
              remainingToPlanQty: 0,
              remainingToProduceQty: 0,
              remainingToShipQty: 0,
            },
          },
        ],
        history: [],
        createdAt: '2026-09-08T00:00:00.000Z',
        updatedAt: '2026-09-08T00:00:00.000Z',
        customer: '',
      },
    ]

    const next = mirrorG5Ack(store, {
      ok: true,
      salesPlanningActive: true,
      replaceSalesOrders: true,
      sales: {
        orders: [
          {
            id: 'a0f76b52-2d77-4733-a2af-7cbb85e7eef6',
            status: 'draft',
            customerId: 'edu-cello-customer-20260908',
            lines: [
              {
                lineId: '58992bc4-e5da-4e8b-b1d9-cd500a673d97',
                finishedProductId: 'edu-cello-fp-160-10-20260908',
                quantity: 12.5,
                unit: 'm2',
              },
            ],
          },
        ],
      },
    })

    expect(next.sales.orders.map((o) => o.id)).toEqual([
      'a0f76b52-2d77-4733-a2af-7cbb85e7eef6',
    ])
    expect(next.sales.orders[0]!.lines[0]!.qtyMp).toBe(12.5)
  })
})
