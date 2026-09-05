import { describe, expect, it } from 'vitest'
import { buildPlanSalesLinePreview } from '@/lib/sales/planPreview'
import { emptySalesOrder, emptySalesLine, normalizeSalesStore } from '@/lib/sales/init'
import type { FinishedProduct } from '@/lib/finishedProducts/types'
import type { WarehouseStore } from '@/lib/warehouse/types'
import { createDefaultWarehouse } from '@/lib/warehouse/init'

function whWithFg(itemId: string, availableQty: number): WarehouseStore {
  const base = createDefaultWarehouse()
  const warehouseId = base.locations[0]?.id ?? 'wh1'
  const locId = warehouseId
  return {
    ...base,
    items: [
      {
        id: itemId,
        internalCode: 'FG-1',
        name: 'Mesh FG',
        categoryId: base.categories[0]?.id ?? 'c1',
        warehouseId: locId,
        unit: 'mp',
        active: true,
        sortOrder: 1,
      },
    ],
    movements:
      availableQty > 0
        ? [
            {
              id: 'm1',
              itemId,
              warehouseId: locId,
              type: 'receipt',
              quantity: availableQty,
              date: '2026-08-01',
              createdAt: '2026-08-01T00:00:00.000Z',
            },
          ]
        : [],
  }
}

describe('planSalesLine preview', () => {
  it('proposes reserve from stock and PO only for remainder', () => {
    const order = {
      ...emptySalesOrder('2026-08-20'),
      commercialStatus: 'confirmed' as const,
      fulfillmentStatus: 'unplanned' as const,
      status: 'confirmed' as const,
    }
    const line = {
      ...emptySalesLine(),
      finishedProductId: 'fp1',
      productName: 'Mesh',
      qtyMp: 1000,
    }
    const fp: FinishedProduct = {
      id: 'fp1',
      code: 'ГП-1',
      name: 'Mesh',
      category: 'ratl1',
      warehouseItemId: 'item1',
      unit: 'mp',
      active: true,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    }
    const preview = buildPlanSalesLinePreview({
      order: { ...order, lines: [line] },
      line,
      warehouse: whWithFg('item1', 350),
      finishedProducts: [fp],
      reservations: [],
      allocations: [],
    })
    expect(preview.proposeReserveMp).toBe(350)
    expect(preview.proposeProduceMp).toBe(650)
  })

  it('normalize heals dual statuses and progress', () => {
    const raw = {
      orders: [
        {
          id: 'o1',
          orderNumber: 'ЗК-2026-001',
          customer: 'Test',
          status: 'in_production' as const,
          priority: 'normal' as const,
          orderDate: '2026-08-01',
          lines: [
            {
              id: 'l1',
              productName: 'X',
              category: 'ratl1' as const,
              qtyMp: 100,
              productionOrderIds: ['po1'],
            },
          ],
          history: [],
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
      nextOrderSeq: 2,
    }
    const store = normalizeSalesStore(raw)
    const o = store.orders[0]!
    expect(o.commercialStatus).toBe('confirmed')
    expect(o.allocations?.length ?? store.allocations?.length).toBeGreaterThan(0)
    expect(store.allocations!.some((a) => a.productionOrderId === 'po1')).toBe(true)
    // healed allocation = full qty → planned, not in_production (no start)
    expect(o.fulfillmentStatus).toBe('planned')
    expect(o.status).toBe('confirmed')
  })
})
