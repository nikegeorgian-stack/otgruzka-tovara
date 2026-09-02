import { computeAllBalances, formatQty } from '@/lib/warehouse/stock'
import {
  isWarehouseAccountingActive,
} from '@/lib/warehouse/accountingStatus'
import type { StockMovement, WarehouseItem, WarehouseStore } from '@/lib/warehouse/types'
import {
  materialLinesForOrder,
  type OrderMaterialLine,
  type MaterialRole,
} from './materialNeeds'
import type { ProductionOrder } from './types'

export type WarehouseStockView = Pick<
  WarehouseStore,
  'items' | 'movements' | 'accountingByWarehouse'
>

export type MaterialStockTrust = 'verified' | 'unverified'

function balancesFor(warehouse: WarehouseStockView, warehouseId?: string) {
  return computeAllBalances(warehouse as WarehouseStore, warehouseId)
}

/** When warehouseId omitted: unverified if ANY location lacks active accounting, or if no accounting data. */
export function materialStockTrust(
  warehouse: WarehouseStockView,
  warehouseId?: string,
): MaterialStockTrust {
  if (warehouseId) {
    return isWarehouseAccountingActive(warehouse, warehouseId) ? 'verified' : 'unverified'
  }
  const states = warehouse.accountingByWarehouse ?? []
  if (states.length === 0) return 'unverified'
  // Without a specific warehouse, require every known accounting row to be active
  // and treat missing ledger as unverified (legacy).
  if (!states.every((s) => s.status === 'active')) return 'unverified'
  return 'verified'
}

export type MaterialAvailabilityRow = OrderMaterialLine & {
  orderId: string
  orderNumber: string
  productName: string
  /** null when warehouse stock is not verified — do not treat as zero */
  available: number | null
  reservedForOrder: number
  /** 0 when unverified — never invent a shortage from unknown stock */
  shortage: number
  canReserve: number
  stockTrust: MaterialStockTrust
}

export type ItemDemandSummary = {
  itemId: string
  itemName: string
  unit: string
  role: MaterialRole
  totalNeed: number
  totalReserved: number
  available: number | null
  shortage: number
  stockTrust: MaterialStockTrust
}

export function reservedQtyForOrder(
  movements: StockMovement[],
  orderId: string,
  itemId?: string,
): number {
  let net = 0
  for (const m of movements) {
    if (m.productionOrderId !== orderId) continue
    if (itemId && m.itemId !== itemId) continue
    if (m.type === 'reserve') net += Math.abs(m.quantity)
    else if (m.type === 'unreserve') net -= Math.abs(m.quantity)
  }
  return Math.max(0, net)
}

export function availabilityForOrderLine(
  order: ProductionOrder,
  line: OrderMaterialLine,
  warehouse: WarehouseStockView,
  warehouseId?: string,
): Omit<MaterialAvailabilityRow, 'orderId' | 'orderNumber' | 'productName'> & {
  orderId: string
  orderNumber: string
  productName: string
} {
  const trust = materialStockTrust(warehouse, warehouseId)
  const reservedForOrder = reservedQtyForOrder(warehouse.movements, order.id, line.itemId)

  if (trust === 'unverified') {
    return {
      ...line,
      orderId: order.id,
      orderNumber: order.orderNumber,
      productName: order.productName,
      available: null,
      reservedForOrder,
      shortage: 0,
      canReserve: 0,
      stockTrust: 'unverified',
    }
  }

  const balances = balancesFor(warehouse, warehouseId)
  const available = balances.get(line.itemId)?.available ?? 0
  const stillNeed = Math.max(0, line.quantity - reservedForOrder)
  const shortage = Math.max(0, stillNeed - available)
  const canReserve = Math.min(stillNeed, available)

  return {
    ...line,
    orderId: order.id,
    orderNumber: order.orderNumber,
    productName: order.productName,
    available,
    reservedForOrder,
    shortage,
    canReserve,
    stockTrust: 'verified',
  }
}

export function materialAvailabilityForOrder(
  order: ProductionOrder,
  warehouse: WarehouseStockView,
  items: WarehouseItem[],
  warehouseId?: string,
): MaterialAvailabilityRow[] {
  return materialLinesForOrder(order, items).map((line) =>
    availabilityForOrderLine(order, line, warehouse, warehouseId),
  )
}

export function orderHasMaterialShortage(
  order: ProductionOrder,
  warehouse: WarehouseStockView,
  items: WarehouseItem[],
): boolean {
  return materialAvailabilityForOrder(order, warehouse, items).some(
    (r) => r.stockTrust === 'verified' && r.shortage > 0,
  )
}

export function aggregateItemDemand(
  orders: ProductionOrder[],
  warehouse: WarehouseStockView,
  items: WarehouseItem[],
  warehouseId?: string,
): ItemDemandSummary[] {
  const trust = materialStockTrust(warehouse, warehouseId)
  const balances = trust === 'verified' ? balancesFor(warehouse, warehouseId) : null
  const map = new Map<
    string,
    ItemDemandSummary & { roles: Set<MaterialRole> }
  >()

  for (const order of orders) {
    for (const row of materialAvailabilityForOrder(order, warehouse, items, warehouseId)) {
      const prev = map.get(row.itemId)
      if (!prev) {
        map.set(row.itemId, {
          itemId: row.itemId,
          itemName: row.itemName,
          unit: row.unit,
          role: row.role,
          totalNeed: row.quantity,
          totalReserved: row.reservedForOrder,
          available: row.available,
          shortage: 0,
          stockTrust: row.stockTrust,
          roles: new Set([row.role]),
        })
      } else {
        prev.totalNeed += row.quantity
        prev.totalReserved += row.reservedForOrder
        prev.roles.add(row.role)
      }
    }
  }

  return [...map.values()]
    .map((entry) => {
      const { roles: _roles, ...row } = entry
      void _roles
      if (trust === 'unverified' || !balances) {
        return { ...row, available: null, shortage: 0, stockTrust: 'unverified' as const }
      }
      const available = balances.get(row.itemId)?.available ?? 0
      const shortage = Math.max(0, row.totalNeed - row.totalReserved - available)
      return { ...row, available, shortage, stockTrust: 'verified' as const }
    })
    .sort((a, b) => b.shortage - a.shortage || a.itemName.localeCompare(b.itemName, 'ru'))
}

export function formatMaterialShortage(row: MaterialAvailabilityRow): string {
  if (row.stockTrust === 'unverified') return `${row.itemName}: ?`
  return `${row.itemName}: ${formatQty(row.shortage)} ${row.unit}`
}
