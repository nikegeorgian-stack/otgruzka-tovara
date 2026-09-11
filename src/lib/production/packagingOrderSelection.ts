import type { ProductionOrder } from '@/lib/planner/types'

export type AuthoritativePackagingOrder = Partial<ProductionOrder> & Pick<ProductionOrder, 'id'>

/**
 * Join display-only planner rows to exact G3 rows after activation/reload.
 * Once G3 is authoritative, a missing or duplicate server row fails closed.
 */
export function mergeActivePackagingOrders(
  plannerOrders: ProductionOrder[],
  authoritativeOrders: AuthoritativePackagingOrder[],
  productionDomainActive: boolean,
): ProductionOrder[] {
  return plannerOrders
    .map((order): ProductionOrder | null => {
      const matches = authoritativeOrders.filter((candidate) => candidate.id === order.id)
      if (productionDomainActive && matches.length !== 1) return null
      if (matches.length !== 1) return order
      const server = matches[0]
      return {
        ...order,
        orderNumber: server.orderNumber ?? order.orderNumber,
        status: server.status ?? order.status,
        lineId: server.lineId ?? order.lineId,
        finishedProductId: server.finishedProductId,
        warehouseItemId: server.warehouseItemId,
        semiFinishedItemId: server.semiFinishedItemId,
        wipContractVersion: Number(server.wipContractVersion) >= 1 ? 1 : undefined,
        packagingBomRequired: server.packagingBomRequired,
        packagingBomSnapshot: server.packagingBomSnapshot,
      }
    })
    .filter(
      (order): order is ProductionOrder =>
        order != null && (order.status === 'active' || order.status === 'paused'),
    )
}
