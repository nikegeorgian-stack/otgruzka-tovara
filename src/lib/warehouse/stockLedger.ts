import { movementDelta } from './stock'
import type { StockMovement } from './types'

export type StockLedgerRow = {
  movement: StockMovement
  /** Знаковая дельта к остатку (+ приход, − расход). */
  delta: number
  /** Остаток после этой операции (по хронологии). */
  balanceAfter: number
}

/**
 * Карточка учёта (stock ledger) по позиции: хронология движений с нарастающим остатком.
 * Принцип ERPClaw SLE: история иммутабельна; остаток = сумма дельт.
 */
export function buildItemStockLedger(
  itemId: string,
  movements: StockMovement[],
  opts?: {
    warehouseId?: string
    asOfIso?: string | null
    /** newestFirst (default) — для UI журнала; false — хронология для отчётов. */
    newestFirst?: boolean
  },
): StockLedgerRow[] {
  const warehouseId = opts?.warehouseId
  const asOfIso = opts?.asOfIso
  const newestFirst = opts?.newestFirst !== false

  const chrono = movements
    .filter((m) => m.itemId === itemId)
    .filter((m) => !warehouseId || m.warehouseId === warehouseId)
    .filter((m) => !asOfIso || m.createdAt <= asOfIso)
    .slice()
    .sort((a, b) => {
      const byCreated = a.createdAt.localeCompare(b.createdAt)
      if (byCreated !== 0) return byCreated
      return a.id.localeCompare(b.id)
    })

  let bal = 0
  const rows: StockLedgerRow[] = chrono.map((movement) => {
    const delta = movementDelta(movement.type, movement.quantity)
    bal += delta
    return { movement, delta, balanceAfter: bal }
  })

  return newestFirst ? rows.reverse() : rows
}
