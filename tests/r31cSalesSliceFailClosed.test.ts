import { beforeEach, describe, expect, it, vi } from 'vitest'

import { emptySalesOrder } from '@/lib/sales/init'
import { createDefaultStore } from '@/lib/storage'
import { createSalesSlice } from '@/store/slices/salesSlice'
import type { AppStore } from '@/lib/types'

const gateway = vi.hoisted(() => ({
  execute: vi.fn(),
  mirror: vi.fn((store: AppStore) => store),
}))

vi.mock('@/lib/planner/g5ServerClient', () => ({
  isG5WebPath: () => true,
  executeG5Command: (...args: unknown[]) => gateway.execute(...args),
  mirrorG5Ack: (...args: unknown[]) => gateway.mirror(...args),
}))

const DATE = '2026-09-10'

function fixture() {
  let store = createDefaultStore() as AppStore
  store = {
    ...store,
    production: {
      ...store.production,
      g5SalesPlanningActive: true,
      g5CriticalRevision: 62,
    } as typeof store.production,
  }
  const order = emptySalesOrder(DATE)
  order.id = 'sales-c'
  order.counterpartyId = 'customer-c'
  order.customer = 'Учебный клиент'
  order.lines[0] = {
    ...order.lines[0],
    id: 'client-line-c',
    finishedProductId: 'fp-c',
    productName: 'Celloplex 160',
    qtyMp: 10,
    unit: 'm2',
  }
  const slice = createSalesSlice({
    getStore: () => store,
    setStore: (update) => {
      store = typeof update === 'function' ? update(store) : update
    },
    getActor: () => ({ id: 'sales-user', name: 'Sales' }),
  })
  return { order, slice, read: () => store }
}

describe('R3.1C sales slice authoritative ACK gate', () => {
  beforeEach(() => {
    gateway.execute.mockReset()
    gateway.mirror.mockClear()
  })

  it.each([
    ['missing authoritative row', { id: 'sales-c', status: 'draft', criticalRevision: 63, salesPlanningActive: true, sales: { orders: [] } }],
    ['missing human number', { id: 'sales-c', status: 'draft', criticalRevision: 63, salesPlanningActive: true, sales: { orders: [{ id: 'sales-c' }] } }],
    ['stale revision', { id: 'sales-c', status: 'draft', criticalRevision: 62, salesPlanningActive: true, sales: { orders: [] } }],
  ])('does not mirror or fabricate on 2xx with %s', async (_label, data) => {
    const { order, slice, read } = fixture()
    const before = structuredClone(read().sales)
    gateway.execute.mockResolvedValue({ ok: true, data })

    await expect(slice.upsertSalesOrder(order)).rejects.toThrow(
      'sales_order_draft_ack_mismatch',
    )
    expect(gateway.mirror).not.toHaveBeenCalled()
    expect(read().sales).toEqual(before)
  })
})

