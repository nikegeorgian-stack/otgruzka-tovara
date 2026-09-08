/**
 * Loading calc from G5-hydrated sales lines must derive packing fields from FP + qtyMp.
 */
import { describe, expect, it } from 'vitest'
import { buildLoadingShipmentInputFromSales } from '@/lib/sales/loadingLink'
import { createDefaultWarehouse } from '@/lib/warehouse/init'
import type { FinishedProduct } from '@/lib/finishedProducts/types'
import type { SalesOrder } from '@/lib/sales/types'
import { emptyLineProgress } from '@/lib/sales/progress'

describe('R2.9L loading from G5 sales line', () => {
  it('builds shipment when line has qtyMp + FP but empty name/rolls/area', () => {
    const warehouse = createDefaultWarehouse()
    // Ensure finished goods warehouse location exists like staging soft WH
    if (!warehouse.warehouses?.length) {
      warehouse.warehouses = [
        {
          id: '1bc8f872-ded1-4ee9-8ed8-f70d3c54027c',
          name: 'ГП',
          kind: 'finished',
          active: true,
          createdAt: '2026-09-08T00:00:00.000Z',
        } as (typeof warehouse.warehouses)[number],
      ]
    } else {
      warehouse.warehouses = warehouse.warehouses.map((w, i) =>
        i === 0 ? { ...w, kind: 'finished' as const } : w,
      )
    }

    const fp = {
      id: 'edu-cello-fp-160-10-20260908',
      code: 'ГП-000001',
      name: 'EDU Celloplex 160/10',
      category: 'ratl1',
      active: true,
      rollWidthM: 1.6,
      grammageGsm: 160,
      createdAt: '2026-09-08T00:00:00.000Z',
      updatedAt: '2026-09-08T00:00:00.000Z',
    } as FinishedProduct

    const order = {
      id: 'a0f76b52-2d77-4733-a2af-7cbb85e7eef6',
      orderNumber: 'ЗК-2026-002',
      counterpartyId: 'edu-cello-customer-20260908',
      customer: 'EDU-CUSTOMER-CELLOPLEX-160',
      status: 'confirmed',
      commercialStatus: 'confirmed',
      fulfillmentStatus: 'unplanned',
      priority: 'normal',
      orderDate: '2026-09-08',
      lines: [
        {
          id: '58992bc4-e5da-4e8b-b1d9-cd500a673d97',
          finishedProductId: fp.id,
          productName: '',
          category: 'ratl1',
          qtyMp: 12.5,
          productionOrderIds: [],
          progress: emptyLineProgress(12.5),
        },
      ],
      history: [],
      createdAt: '2026-09-08T00:00:00.000Z',
      updatedAt: '2026-09-08T00:00:00.000Z',
    } as SalesOrder

    const input = buildLoadingShipmentInputFromSales(order, order.lines[0]!, warehouse, [fp])
    expect(input, 'loading input must not be null for G5 qtyMp line').toBeTruthy()
    expect(input!.lines[0]!.name).toBe('EDU Celloplex 160/10')
    expect(input!.lines[0]!.rolls).toBeGreaterThan(0)
    expect(input!.lines[0]!.rollWidthM).toBe(1.6)
    expect(input!.salesOrderId).toBe(order.id)
  })
})
