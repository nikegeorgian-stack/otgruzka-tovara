import type { WarehouseItem } from '@/lib/warehouse/types'
import { nextDocumentNumber } from './docNumbering'

export function normSearch(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim()
}

export function searchNomenclature(
  items: WarehouseItem[],
  query: string,
  opts?: {
    categoryNames?: Map<string, string>
    warehouseId?: string
    limit?: number
  },
): WarehouseItem[] {
  const limit = opts?.limit ?? 25
  const active = items.filter((i) => i.active)
  const q = normSearch(query)

  if (!q) {
    return active
      .filter((i) => !opts?.warehouseId || i.warehouseId === opts.warehouseId)
      .slice(0, limit)
  }

  const scored: { item: WarehouseItem; score: number }[] = []

  for (const item of active) {
    const name = normSearch(item.name)
    const sku = normSearch(item.sku ?? '')
    const barcode = normSearch(item.barcode ?? '')
    const internalCode = normSearch(item.internalCode ?? '')
    const cat = normSearch(opts?.categoryNames?.get(item.categoryId) ?? '')

    let score = 0
    if (internalCode === q || sku === q || barcode === q) score = 100
    else if (name.startsWith(q)) score = 80
    else if (internalCode.startsWith(q) || sku.startsWith(q) || barcode.startsWith(q))
      score = 75
    else if (name.includes(q)) score = 60
    else if (cat.includes(q)) score = 40
    else if (internalCode.includes(q) || sku.includes(q) || barcode.includes(q)) score = 35
    else continue

    if (opts?.warehouseId && item.warehouseId === opts.warehouseId) score += 5
    scored.push({ item, score })
  }

  scored.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name, 'ru'))
  return scored.slice(0, limit).map((s) => s.item)
}

export function suggestDocNumber(
  documents: { type: string; date: string; number: string; status?: string }[],
  type: 'receipt' | 'issue',
  date: string,
): string {
  return nextDocumentNumber(documents as import('./types').WarehouseDocument[], type, date)
}
