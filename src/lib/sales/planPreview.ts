import { computeAllBalances } from '@/lib/warehouse/stock'
import type { WarehouseStore } from '@/lib/warehouse/types'
import type { FinishedProduct } from '@/lib/finishedProducts/types'
import type {
  SalesOrder,
  SalesOrderLine,
  SalesProductionAllocation,
  SalesStockReservation,
} from './types'
import { recalculateSalesOrderLineProgress } from './progress'

export type PlanSalesLinePreview = {
  orderedMp: number
  alreadyReservedMp: number
  alreadyAllocatedMp: number
  remainingToEnsureMp: number
  availableFgMp: number
  proposeReserveMp: number
  proposeProduceMp: number
  hasWarehouseItem: boolean
  finishedProductId?: string
  warehouseItemId?: string
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** Доступная ГП на складе (available уже без активных warehouse reserve). */
export function availableFinishedGoodsMp(input: {
  warehouse: WarehouseStore
  finishedProducts: FinishedProduct[]
  finishedProductId?: string
}): number {
  const fp = input.finishedProducts.find((p) => p.id === input.finishedProductId)
  if (!fp?.warehouseItemId) return 0
  const balances = computeAllBalances(input.warehouse)
  const bal = balances.get(fp.warehouseItemId)
  return Math.max(0, round1(bal?.available ?? 0))
}

export function buildPlanSalesLinePreview(input: {
  order: SalesOrder
  line: SalesOrderLine
  warehouse: WarehouseStore
  finishedProducts: FinishedProduct[]
  reservations: SalesStockReservation[]
  allocations: SalesProductionAllocation[]
}): PlanSalesLinePreview {
  const progress = recalculateSalesOrderLineProgress(
    input.line,
    input.allocations.filter((a) => a.salesLineId === input.line.id),
    input.reservations.filter((r) => r.salesLineId === input.line.id),
  )
  const remaining = progress.remainingToPlanQty
  const fp = input.finishedProducts.find((p) => p.id === input.line.finishedProductId)
  const availableFgMp = availableFinishedGoodsMp({
    warehouse: input.warehouse,
    finishedProducts: input.finishedProducts,
    finishedProductId: input.line.finishedProductId,
  })
  const proposeReserveMp = round1(Math.min(remaining, availableFgMp))
  const proposeProduceMp = round1(Math.max(0, remaining - proposeReserveMp))
  return {
    orderedMp: progress.orderedQty,
    alreadyReservedMp: progress.reservedFinishedGoodsQty,
    alreadyAllocatedMp: progress.productionAllocatedQty,
    remainingToEnsureMp: remaining,
    availableFgMp,
    proposeReserveMp,
    proposeProduceMp,
    hasWarehouseItem: !!fp?.warehouseItemId,
    finishedProductId: input.line.finishedProductId,
    warehouseItemId: fp?.warehouseItemId,
  }
}
