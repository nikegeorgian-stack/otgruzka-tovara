import { computeAllBalances } from '@/lib/warehouse/stock'
import type { WarehouseStore } from '@/lib/warehouse/types'
import type { PurchaseOrder } from './types'

export type ProcurementStockRow = {
  key: string
  warehouseItemId?: string
  name: string
  unit: string
  supplierSku?: string
  onOrderQty: number
  receivedQty: number
  pendingQty: number
  warehouseBalance?: number
  warehouseAvailable?: number
  orderCount: number
}

/** Остатки склада vs объёмы в открытых импортных заказах. */
export function computeProcurementStockRows(
  orders: PurchaseOrder[],
  warehouse: WarehouseStore,
): ProcurementStockRow[] {
  const balances = computeAllBalances(warehouse)
  const itemMap = new Map(warehouse.items.map((i) => [i.id, i]))
  const agg = new Map<string, ProcurementStockRow>()

  const activeIntl = orders.filter(
    (o) =>
      o.scope === 'international' &&
      o.status !== 'received' &&
      o.status !== 'cancelled',
  )

  for (const order of activeIntl) {
    for (const line of order.lines) {
      const key = line.warehouseItemId ?? `name:${line.name.trim().toLowerCase()}`
      const cur = agg.get(key) ?? {
        key,
        warehouseItemId: line.warehouseItemId,
        name: line.name,
        unit: line.unit,
        supplierSku: line.supplierSku,
        onOrderQty: 0,
        receivedQty: 0,
        pendingQty: 0,
        warehouseBalance: undefined,
        warehouseAvailable: undefined,
        orderCount: 0,
      }
      cur.onOrderQty += line.quantity
      cur.receivedQty += line.receivedQty
      cur.pendingQty += Math.max(0, line.quantity - line.receivedQty)
      cur.orderCount++
      if (line.supplierSku && !cur.supplierSku) cur.supplierSku = line.supplierSku
      agg.set(key, cur)
    }
  }

  for (const row of agg.values()) {
    if (row.warehouseItemId) {
      const item = itemMap.get(row.warehouseItemId)
      const bal = balances.get(row.warehouseItemId)
      if (item) row.name = item.name
      row.warehouseBalance = bal?.balance
      row.warehouseAvailable = bal?.available
    }
  }

  return [...agg.values()].sort((a, b) => {
    if (b.pendingQty !== a.pendingQty) return b.pendingQty - a.pendingQty
    return a.name.localeCompare(b.name, 'ru')
  })
}

export function countTrackedContainers(orders: PurchaseOrder[]): number {
  return orders.filter(
    (o) =>
      o.status !== 'received' &&
      o.status !== 'cancelled' &&
      o.containerTracking?.enabled &&
      o.containerTracking.reference.trim(),
  ).length
}
