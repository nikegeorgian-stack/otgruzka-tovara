import { appendWarehouseAudit } from '@/lib/warehouse/audit'
import { computeAllBalances } from '@/lib/warehouse/stock'
import type { StockMovement, WarehouseStore } from '@/lib/warehouse/types'
import { materialLinesForOrder } from './materialNeeds'
import { availabilityForOrderLine, reservedQtyForOrder } from './materialStock'
import type { ProductionOrder } from './types'

export type MaterialReserveLineResult = {
  itemId: string
  itemName: string
  requested: number
  reserved: number
  skipped: number
}

export type MaterialReserveResult = {
  ok: boolean
  lines: MaterialReserveLineResult[]
  messageKey?: string
  messageVars?: Record<string, string | number>
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function buildReserveMovements(
  order: ProductionOrder,
  warehouse: WarehouseStore,
  date = todayIso(),
): { movements: StockMovement[]; lines: MaterialReserveLineResult[] } {
  const items = warehouse.items
  const lines = materialLinesForOrder(order, items)
  const movements: StockMovement[] = []
  const results: MaterialReserveLineResult[] = []

  for (const line of lines) {
    const row = availabilityForOrderLine(order, line, warehouse)
    const toReserve = row.canReserve
    const skipped = Math.max(0, row.quantity - row.reservedForOrder - toReserve)
    results.push({
      itemId: line.itemId,
      itemName: line.itemName,
      requested: row.quantity - row.reservedForOrder,
      reserved: toReserve,
      skipped,
    })
    if (toReserve <= 0) continue
    const item = items.find((i) => i.id === line.itemId)
    movements.push({
      id: crypto.randomUUID(),
      itemId: line.itemId,
      warehouseId: item?.warehouseId || warehouse.locations[0]?.id || '',
      type: 'reserve',
      quantity: toReserve,
      date,
      productionOrderId: order.id,
      comment: `${order.orderNumber} · ${line.role}`,
      createdAt: new Date().toISOString(),
    })
  }

  return { movements, lines: results }
}

export function buildUnreserveMovements(
  order: ProductionOrder,
  warehouse: WarehouseStore,
  date = todayIso(),
): StockMovement[] {
  const movements: StockMovement[] = []
  const itemIds = new Set<string>()
  for (const m of warehouse.movements) {
    if (m.productionOrderId === order.id) itemIds.add(m.itemId)
  }
  for (const line of materialLinesForOrder(order, warehouse.items)) {
    itemIds.add(line.itemId)
  }

  for (const itemId of itemIds) {
    const qty = reservedQtyForOrder(warehouse.movements, order.id, itemId)
    if (qty <= 0) continue
    const item = warehouse.items.find((i) => i.id === itemId)
    movements.push({
      id: crypto.randomUUID(),
      itemId,
      warehouseId: item?.warehouseId || warehouse.locations[0]?.id || '',
      type: 'unreserve',
      quantity: qty,
      date,
      productionOrderId: order.id,
      comment: `${order.orderNumber} · снятие резерва`,
      createdAt: new Date().toISOString(),
    })
  }
  return movements
}

export function applyWarehouseMovements(
  warehouse: WarehouseStore,
  additions: StockMovement[],
): WarehouseStore {
  let next: WarehouseStore = {
    ...warehouse,
    movements: [...warehouse.movements, ...additions],
  }
  for (const m of additions) {
    next = appendWarehouseAudit(next, {
      action: 'movement_add',
      detail: `${m.type} · ${m.comment ?? m.itemId} · ${m.quantity}`,
      itemId: m.itemId,
    })
  }
  return next
}

export function reserveOrderMaterialsInStore(
  order: ProductionOrder,
  warehouse: WarehouseStore,
): MaterialReserveResult {
  if (!materialLinesForOrder(order, warehouse.items).length) {
    return { ok: false, lines: [], messageKey: 'planner.material.noLines' }
  }

  const { lines } = buildReserveMovements(order, warehouse)
  const totalReserved = lines.reduce((s, l) => s + l.reserved, 0)
  if (totalReserved <= 0) {
    const hasShortage = lines.some((l) => l.skipped > 0)
    return {
      ok: false,
      lines,
      messageKey: hasShortage ? 'planner.material.reserveNone' : 'planner.material.alreadyReserved',
    }
  }

  return { ok: true, lines, messageKey: 'planner.material.reserved' }
}

export function historyNoteForReserve(lines: MaterialReserveLineResult[]): string {
  const parts = lines
    .filter((l) => l.reserved > 0)
    .map((l) => `${l.itemName} ${l.reserved}`)
  return `Резерв материалов: ${parts.join(', ')}`
}

export function historyNoteForUnreserve(order: ProductionOrder, warehouse: WarehouseStore): string {
  const itemIds = new Set<string>()
  for (const line of materialLinesForOrder(order, warehouse.items)) {
    itemIds.add(line.itemId)
  }
  const parts: string[] = []
  for (const itemId of itemIds) {
    const qty = reservedQtyForOrder(warehouse.movements, order.id, itemId)
    if (qty > 0) {
      const name = warehouse.items.find((i) => i.id === itemId)?.name ?? itemId
      parts.push(`${name} ${qty}`)
    }
  }
  return parts.length ? `Снят резерв: ${parts.join(', ')}` : 'Снят резерв материалов'
}

/** Проверка перед резервом без записи */
export function previewReserve(order: ProductionOrder, warehouse: WarehouseStore) {
  const balances = computeAllBalances(warehouse)
  return materialLinesForOrder(order, warehouse.items).map((line) => {
    const row = availabilityForOrderLine(order, line, warehouse)
    return { ...row, balance: balances.get(line.itemId)?.balance ?? 0 }
  })
}
