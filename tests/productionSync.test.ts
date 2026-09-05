import { describe, expect, it } from 'vitest'
import { emptyProductionRequest } from '@/lib/production/init'
import { applyProductionPostToSales } from '@/lib/sales/productionSync'
import type { AppStore } from '@/lib/types'
import type { SalesProductionAllocation } from '@/lib/sales/types'

function minimalStore(allocation: SalesProductionAllocation): AppStore {
  return {
    employees: [],
    brigades: [],
    brigadeHasBrigadier: {},
    months: {},
    production: {
      requests: [],
      planner: { orders: [{ id: allocation.productionOrderId } as never], nextOrderNumber: 1 },
    },
    sales: {
      orders: [
        {
          id: allocation.salesOrderId,
          orderNumber: 'ZK-1',
          customer: 'Test',
          commercialStatus: 'confirmed',
          fulfillmentStatus: 'planned',
          status: 'confirmed',
          lines: [
            {
              id: allocation.salesLineId,
              productName: 'Mesh',
              category: 'ratl1',
              qtyMp: 1000,
              productionOrderIds: [allocation.productionOrderId],
              progress: {
                orderedQty: 1000,
                cancelledQty: 0,
                reservedFinishedGoodsQty: 0,
                productionAllocatedQty: 500,
                productionStartedQty: 0,
                producedGoodQty: 0,
                qcApprovedQty: 0,
                readyToShipQty: 0,
                shipmentReservedQty: 0,
                shippedQty: 0,
                remainingToPlanQty: 500,
                remainingToProduceQty: 1000,
                remainingToShipQty: 1000,
              },
            },
          ],
          history: [],
          createdAt: '2026-09-01T00:00:00.000Z',
          updatedAt: '2026-09-01T00:00:00.000Z',
        },
      ],
      allocations: [allocation],
      reservations: [],
    },
  } as unknown as AppStore
}

describe('applyProductionPostToSales', () => {
  it('updates producedAllocatedQty after impregnation line post', () => {
    const alloc: SalesProductionAllocation = {
      id: 'A1',
      salesOrderId: 'O1',
      salesLineId: 'L1',
      productionOrderId: 'PO1',
      plannedGoodQty: 500,
      producedAllocatedQty: 0,
      readyAllocatedQty: 0,
      shippedQty: 0,
      status: 'active',
      createdAt: '2026-09-01T00:00:00.000Z',
    }
    const store = minimalStore(alloc)
    const req = {
      ...emptyProductionRequest('2026-09-01', '1'),
      orderId: 'PO1',
      status: 'posted' as const,
      factRows: [
        {
          ...emptyProductionRequest('2026-09-01').factRows[0],
          ratl1: { qtyMp: 200 },
        },
      ],
    }

    const next = applyProductionPostToSales(store, req)
    const updated = next.sales.allocations!.find((a) => a.id === 'A1')!
    expect(updated.producedAllocatedQty).toBe(200)
    expect(next.sales.orders[0]!.lines[0]!.progress!.producedGoodQty).toBe(200)
    expect(next.sales.orders[0]!.lines[0]!.progress!.productionStartedQty).toBe(200)
  })

  it('updates readyAllocatedQty after pack line post', () => {
    const alloc: SalesProductionAllocation = {
      id: 'A1',
      salesOrderId: 'O1',
      salesLineId: 'L1',
      productionOrderId: 'PO1',
      plannedGoodQty: 500,
      producedAllocatedQty: 200,
      readyAllocatedQty: 0,
      shippedQty: 0,
      status: 'active',
      createdAt: '2026-09-01T00:00:00.000Z',
    }
    const store = minimalStore(alloc)
    const req = {
      ...emptyProductionRequest('2026-09-01', 'pack'),
      orderId: 'PO1',
      status: 'posted' as const,
      packaging: {
        thermoFilm: '',
        stretch: '',
        rolls: [{ id: 'r1', name: 'Mesh', colorLogo: '', factQty: 150 }],
        boxes: [],
        pallets: [],
      },
      factRows: [
        {
          ...emptyProductionRequest('2026-09-01').factRows[0],
          ratl1: { qtyMp: 150 },
        },
      ],
    }

    const next = applyProductionPostToSales(store, req)
    const updated = next.sales.allocations!.find((a) => a.id === 'A1')!
    expect(updated.readyAllocatedQty).toBe(150)
    expect(next.sales.orders[0]!.lines[0]!.progress!.readyToShipQty).toBeGreaterThanOrEqual(150)
  })
})
