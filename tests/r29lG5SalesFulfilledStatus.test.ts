/**
 * G5 sales status `fulfilled` must not collapse to soft `draft` on hydrate.
 */
import { describe, expect, it } from 'vitest'
import { createDefaultStore } from '@/lib/storage'
import { mirrorG5Ack } from '@/lib/planner/g5ServerClient'

describe('R2.9L G5 sales status hydrate', () => {
  it('maps fulfilled → completed (not draft)', () => {
    const store = createDefaultStore()
    const next = mirrorG5Ack(store, {
      replaceSalesOrders: true,
      sales: {
        orders: [
          {
            id: 'a0f76b52-2d77-4733-a2af-7cbb85e7eef6',
            status: 'fulfilled',
            customerId: 'edu-cello-customer-20260908',
            lines: [
              {
                lineId: '58992bc4-e5da-4e8b-b1d9-cd500a673d97',
                finishedProductId: 'edu-cello-fp-160-10-20260908',
                unit: 'm2',
                quantity: 12.5,
                shippedQty: 12.5,
                remainingQty: 0,
              },
            ],
          },
        ],
      },
    })
    const order = next.sales.orders.find((o) => o.id === 'a0f76b52-2d77-4733-a2af-7cbb85e7eef6')
    expect(order?.status).toBe('completed')
    expect(order?.status).not.toBe('draft')
    expect(order?.commercialStatus).toBe('completed')
  })
})
