/**
 * PHASE W2 — inventory adjustment draft (no stock change until post).
 */
import { saveWarehouseDocumentDraft, type PostDocumentResult } from './documents'
import { nextDocumentNumber } from './docNumbering'
import { computeItemBalance } from './stock'
import type { WarehouseDocumentLine, WarehouseStore } from './types'

export type InventoryAdjustmentLineInput = {
  itemId: string
  counted: number
  comment?: string
}

/**
 * Create a draft inventory document with bookQty + counted quantity.
 * Does not create movements or change balances.
 */
export function createInventoryAdjustmentDraft(
  store: WarehouseStore,
  args: {
    warehouseId: string
    date: string
    comment?: string
    lines: InventoryAdjustmentLineInput[]
    actor?: { actorId?: string; actorName?: string }
  },
): { store: WarehouseStore; result: PostDocumentResult } {
  const lines: WarehouseDocumentLine[] = []
  for (const row of args.lines) {
    if (!Number.isFinite(row.counted) || row.counted < 0) continue
    const book = computeItemBalance(row.itemId, store.movements, args.warehouseId).balance
    if (Math.abs(row.counted - book) < 1e-9) continue
    lines.push({
      lineId: crypto.randomUUID(),
      itemId: row.itemId,
      quantity: row.counted,
      bookQty: book,
      plannedQty: book,
      actualQty: row.counted,
      comment: row.comment,
    })
  }
  if (lines.length === 0) {
    return { store, result: { ok: false, error: 'warehouse.inventory.emptyDelta' } }
  }
  return saveWarehouseDocumentDraft(
    store,
    {
      type: 'inventory',
      number: nextDocumentNumber(store.documents, 'inventory', args.date),
      date: args.date,
      warehouseId: args.warehouseId,
      purpose: 'other',
      comment: args.comment ?? 'Корректировка по пересчёту',
      lines,
      createdBy: args.actor?.actorId,
      createdByName: args.actor?.actorName,
    },
    args.actor,
  )
}
