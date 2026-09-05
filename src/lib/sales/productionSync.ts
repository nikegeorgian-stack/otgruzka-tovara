import { linkedOrderIdsFromRequest } from '@/lib/planner/generateRequests'
import { summarizeRequest } from '@/lib/production/stats'
import type { ProductionRequest } from '@/lib/production/types'
import { recalculateSalesOrderProgress } from '@/lib/sales/progress'
import type { SalesProductionAllocation } from '@/lib/sales/types'
import type { AppStore } from '@/lib/types'

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function distributeQty(
  allocations: SalesProductionAllocation[],
  poId: string,
  qtyDelta: number,
  apply: (a: SalesProductionAllocation, delta: number) => SalesProductionAllocation,
): SalesProductionAllocation[] {
  const active = allocations.filter(
    (a) => a.productionOrderId === poId && a.status === 'active',
  )
  if (!active.length || qtyDelta <= 0) return allocations

  const totalPlanned = active.reduce((s, a) => s + (a.plannedGoodQty || 0), 0)
  let remaining = qtyDelta
  const activeIds = new Set(active.map((a) => a.id))

  return allocations.map((a) => {
    if (!activeIds.has(a.id)) return a
    const share =
      totalPlanned > 0
        ? (a.plannedGoodQty / totalPlanned) * qtyDelta
        : qtyDelta / active.length
    const delta = round1(Math.min(remaining, share))
    remaining = round1(Math.max(0, remaining - delta))
    return apply(a, delta)
  })
}

/**
 * После проводки сменной заявки обновляет allocations и пересчитывает прогресс строк ЗК.
 * Закрывает GAP-05/14: produced/ready qty синхронизируются с фактом линии/упаковки.
 */
export function applyProductionPostToSales(
  store: AppStore,
  request: ProductionRequest,
): AppStore {
  const linkedPoIds = [...linkedOrderIdsFromRequest(request)]
  if (request.orderId && !linkedPoIds.includes(request.orderId)) {
    linkedPoIds.push(request.orderId)
  }
  if (!linkedPoIds.length) return store

  const summary = summarizeRequest(request)
  const defectMp = summary.byCategory.defect?.qtyMp ?? 0
  const goodMp = Math.max(0, summary.factMp - defectMp)
  if (goodMp <= 0) return store

  const isPack = request.lineId === 'pack'
  let allocations = [...(store.sales.allocations ?? [])]
  const touchedOrderIds = new Set<string>()

  for (const poId of linkedPoIds) {
    const before = allocations
    allocations = distributeQty(allocations, poId, goodMp, (a, delta) => {
      touchedOrderIds.add(a.salesOrderId)
      if (isPack) {
        return {
          ...a,
          producedAllocatedQty: round1(
            Math.min(a.plannedGoodQty, (a.producedAllocatedQty || 0) + delta),
          ),
          readyAllocatedQty: round1(
            Math.min(a.plannedGoodQty, (a.readyAllocatedQty || 0) + delta),
          ),
        }
      }
      return {
        ...a,
        producedAllocatedQty: round1(
          Math.min(a.plannedGoodQty, (a.producedAllocatedQty || 0) + delta),
        ),
      }
    })
    if (allocations !== before) {
      // touched
    }
  }

  if (!touchedOrderIds.size) return store

  const reservations = store.sales.reservations ?? []
  const orders = store.sales.orders.map((order) => {
    if (!touchedOrderIds.has(order.id)) return order
    let updated = recalculateSalesOrderProgress(order, allocations, reservations)
    if (!isPack) {
      updated = {
        ...updated,
        lines: updated.lines.map((line) => {
          if (!line.progress) return line
          const produced = line.progress.producedGoodQty || 0
          if (produced <= 0) return line
          const started = Math.max(line.progress.productionStartedQty || 0, produced)
          if (started === line.progress.productionStartedQty) return line
          return {
            ...line,
            progress: { ...line.progress, productionStartedQty: started },
          }
        }),
      }
      updated = recalculateSalesOrderProgress(updated, allocations, reservations)
    }
    return updated
  })

  return {
    ...store,
    sales: {
      ...store.sales,
      allocations,
      orders,
    },
  }
}
