import { describe, expect, it } from 'vitest'
import { buildCalendarMonth, buildMonthReport } from '@/lib/planner/stats'
import type { ProductionOrder } from '@/lib/planner/types'

function order(partial: Partial<ProductionOrder> & Pick<ProductionOrder, 'id'>): ProductionOrder {
  return {
    id: partial.id,
    orderNumber: partial.orderNumber ?? 'PO-X',
    productName: partial.productName ?? 'EDU',
    status: partial.status ?? 'draft',
    startDate: partial.startDate as string,
    endDate: partial.endDate as string,
    dayPlans: partial.dayPlans ?? [],
    ...partial,
  } as ProductionOrder
}

describe('R29K planner stats harden against missing dates', () => {
  it('buildMonthReport does not throw when start/end dates are missing', () => {
    const planner = {
      orders: [
        order({ id: 'bad-1', startDate: undefined as unknown as string, endDate: undefined as unknown as string }),
        order({
          id: 'ok-1',
          startDate: '2026-09-01',
          endDate: '2026-09-10',
          status: 'active',
        }),
      ],
      nextOrderSeq: 0,
    }
    const report = buildMonthReport(planner, [], '2026-09')
    expect(report.activeOrders).toBe(1)
    expect(report.orders.map((o) => o.order.id)).toEqual(['ok-1'])
  })

  it('buildCalendarMonth skips dayPlans with missing date', () => {
    const planner = {
      orders: [
        order({
          id: 'bad-dp',
          startDate: '2026-09-01',
          endDate: '2026-09-02',
          dayPlans: [{ date: undefined as unknown as string, operationalPlanMp: 1 } as never],
        }),
        order({
          id: 'ok-dp',
          startDate: '2026-09-01',
          endDate: '2026-09-02',
          dayPlans: [{ date: '2026-09-08', operationalPlanMp: 2 } as never],
        }),
      ],
      nextOrderSeq: 0,
    }
    const cells = buildCalendarMonth(planner, [], '2026-09')
    expect(cells.map((c) => c.date)).toEqual(['2026-09-08'])
  })
})
