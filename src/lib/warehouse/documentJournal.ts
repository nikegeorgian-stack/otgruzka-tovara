import { itemStockValue, toBaseQty } from './stock'
import type { WarehouseDocument, WarehouseStore } from './types'

export type DocumentJournalRow = {
  doc: WarehouseDocument
  warehouseName: string
  lineCount: number
  totalQty: number
  totalSum: number
}

export function buildDocumentJournalRows(
  store: WarehouseStore,
  docs: WarehouseDocument[],
): DocumentJournalRow[] {
  const itemMap = new Map(store.items.map((i) => [i.id, i]))
  const locMap = new Map(store.locations.map((l) => [l.id, l.name]))

  return docs.map((doc) => {
    let totalQty = 0
    let totalSum = 0
    for (const line of doc.lines) {
      const item = itemMap.get(line.itemId)
      if (!item) continue
      const qty = toBaseQty(item, line.quantity, line.inputUnit)
      totalQty += qty
      totalSum += itemStockValue(item, qty)
    }
    return {
      doc,
      warehouseName: locMap.get(doc.warehouseId) ?? doc.warehouseId,
      lineCount: doc.lines.length,
      totalQty,
      totalSum,
    }
  })
}
