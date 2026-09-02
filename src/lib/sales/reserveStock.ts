import type { StockMovement, WarehouseStore } from '@/lib/warehouse/types'

/** Добавить движение reserve под ЗК (снижает available). */
export function appendSalesFgReserveMovement(
  warehouse: WarehouseStore,
  input: {
    warehouseItemId: string
    quantity: number
    comment: string
    date?: string
  },
): { store: WarehouseStore; movement: StockMovement } | null {
  const qty = Math.max(0, Number(input.quantity) || 0)
  if (qty <= 0) return null
  const item = warehouse.items.find((i) => i.id === input.warehouseItemId)
  if (!item) return null
  const now = new Date().toISOString()
  const movement: StockMovement = {
    id: crypto.randomUUID(),
    itemId: item.id,
    warehouseId: item.warehouseId,
    type: 'reserve',
    quantity: qty,
    date: (input.date ?? now).slice(0, 10),
    comment: input.comment,
    createdAt: now,
  }
  return {
    store: {
      ...warehouse,
      movements: [...(warehouse.movements ?? []), movement],
    },
    movement,
  }
}
