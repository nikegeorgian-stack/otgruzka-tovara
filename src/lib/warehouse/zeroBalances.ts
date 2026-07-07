import { appendWarehouseAudit } from './audit'
import { computeItemBalance } from './stock'
import type { StockMovement, WarehouseStore } from './types'

/** Инвентаризация до нуля по всем складам (одноразовая миграция данных). */
export function zeroAllWarehouseBalances(
  warehouse: WarehouseStore,
  date: string,
): WarehouseStore {
  const warehouseIds = new Set<string>()
  for (const loc of warehouse.locations) warehouseIds.add(loc.id)
  for (const item of warehouse.items) {
    if (item.warehouseId) warehouseIds.add(item.warehouseId)
  }
  for (const m of warehouse.movements) warehouseIds.add(m.warehouseId)

  const now = new Date().toISOString()
  const newMovements: StockMovement[] = []

  for (const warehouseId of warehouseIds) {
    for (const item of warehouse.items) {
      if (!item.active) continue
      const bal = computeItemBalance(item.id, warehouse.movements, warehouseId).balance
      if (Math.abs(bal) < 1e-9) continue
      newMovements.push({
        id: crypto.randomUUID(),
        itemId: item.id,
        warehouseId,
        type: 'inventory',
        quantity: -bal,
        date,
        comment: 'Обнуление остатков по складам',
        createdAt: now,
      })
    }
  }

  if (newMovements.length === 0) return warehouse

  let next: WarehouseStore = {
    ...warehouse,
    movements: [...warehouse.movements, ...newMovements],
  }
  next = appendWarehouseAudit(next, {
    action: 'inventory',
    detail: `Обнуление остатков: ${newMovements.length} корректировок`,
  })
  return next
}
