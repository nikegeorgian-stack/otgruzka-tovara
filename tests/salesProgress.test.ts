import { describe, expect, it } from 'vitest'
import {
  emptyLineProgress,
  fulfillmentFromProgress,
  recalculateSalesOrderLineProgress,
} from '@/lib/sales/progress'
import { deriveLegacySalesStatus, splitLegacySalesStatus } from '@/lib/sales/statuses'
import type { SalesLineProgress, SalesProductionAllocation, SalesStockReservation } from '@/lib/sales/types'

describe('sales statuses dual model', () => {
  it('splits legacy in_production without completing commercial', () => {
    const s = splitLegacySalesStatus('in_production')
    expect(s.commercialStatus).toBe('confirmed')
    expect(s.fulfillmentStatus).toBe('in_production')
  })

  it('does not mark in_production from planned alone', () => {
    expect(deriveLegacySalesStatus('confirmed', 'planned')).toBe('confirmed')
    expect(deriveLegacySalesStatus('confirmed', 'partially_planned')).toBe('confirmed')
    expect(deriveLegacySalesStatus('confirmed', 'in_production')).toBe('in_production')
  })
})

describe('sales line progress', () => {
  it('remaining to plan excludes reserve + allocation', () => {
    const line = {
      id: 'L1',
      productName: 'Mesh',
      category: 'ratl1' as const,
      qtyMp: 1000,
      productionOrderIds: [],
      progress: emptyLineProgress(1000),
    }
    const reservations: SalesStockReservation[] = [
      {
        id: 'R1',
        salesOrderId: 'O1',
        salesLineId: 'L1',
        warehouseItemId: 'W1',
        quantity: 400,
        reservationType: 'sales_order',
        status: 'active',
        createdAt: '2026-08-20T00:00:00.000Z',
      },
    ]
    const allocations: SalesProductionAllocation[] = [
      {
        id: 'A1',
        salesOrderId: 'O1',
        salesLineId: 'L1',
        productionOrderId: 'PO1',
        plannedGoodQty: 500,
        producedAllocatedQty: 0,
        readyAllocatedQty: 0,
        shippedQty: 0,
        status: 'active',
        createdAt: '2026-08-20T00:00:00.000Z',
      },
    ]
    const p = recalculateSalesOrderLineProgress(line, allocations, reservations)
    expect(p.reservedFinishedGoodsQty).toBe(400)
    expect(p.productionAllocatedQty).toBe(500)
    expect(p.remainingToPlanQty).toBe(100)
  })

  it('fulfillment stays planned without production start', () => {
    const lines: { progress: SalesLineProgress }[] = [
      {
        progress: {
          ...emptyLineProgress(1000),
          reservedFinishedGoodsQty: 200,
          productionAllocatedQty: 800,
          remainingToPlanQty: 0,
        },
      },
    ]
    expect(fulfillmentFromProgress(lines)).toBe('planned')
  })

  it('fulfillment becomes in_production only after start/produced', () => {
    const lines: { progress: SalesLineProgress }[] = [
      {
        progress: {
          ...emptyLineProgress(1000),
          productionAllocatedQty: 1000,
          productionStartedQty: 10,
          remainingToPlanQty: 0,
        },
      },
    ]
    expect(fulfillmentFromProgress(lines)).toBe('in_production')
  })
})
