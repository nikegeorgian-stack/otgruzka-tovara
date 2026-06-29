import { totalFactMpForOrder } from '@/lib/planner/plan'
import type { ProductionOrder } from '@/lib/planner/types'
import type { ProductionRequest } from '@/lib/production/types'
import type { ItemBalance } from '@/lib/warehouse/types'
import type { FinishedProduct } from './types'

export type FinishedProductStockRow = {
  product: FinishedProduct
  warehouseBalance?: number
  warehouseAvailable?: number
  producedMp: number
}

export function producedMpForProduct(
  productId: string,
  orders: ProductionOrder[],
  requests: ProductionRequest[],
): number {
  let total = 0
  for (const order of orders) {
    if (order.finishedProductId !== productId) continue
    total += totalFactMpForOrder(order, requests)
  }
  return Math.round(total * 10) / 10
}

export function buildFinishedProductStockRows(
  products: FinishedProduct[],
  orders: ProductionOrder[],
  requests: ProductionRequest[],
  balances: Map<string, ItemBalance>,
): FinishedProductStockRow[] {
  return products
    .filter((p) => p.active)
    .map((product) => {
      const b = product.warehouseItemId
        ? balances.get(product.warehouseItemId)
        : undefined
      return {
        product,
        warehouseBalance: b?.balance,
        warehouseAvailable: b?.available,
        producedMp: producedMpForProduct(product.id, orders, requests),
      }
    })
    .sort((a, b) => a.product.name.localeCompare(b.product.name, 'ru'))
}
