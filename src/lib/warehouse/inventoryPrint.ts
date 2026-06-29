import { computeAllBalances, formatQty } from '@/lib/warehouse/stock'
import type { WarehouseItem, WarehouseStore } from '@/lib/warehouse/types'

export type InventoryPrintOptions = {
  warehouseIds: Set<string>
  categoryIds: Set<string>
  onlyWithBalance: boolean
  groupByCategory: boolean
  showBookBalance: boolean
}

export type InventoryPrintRow = {
  item: WarehouseItem
  bookBalance: number
  categoryName: string
  warehouseName: string
}

export type InventoryPrintSection = {
  categoryId: string
  categoryName: string
  rows: InventoryPrintRow[]
}

export type InventoryPrintPayload = {
  sections: InventoryPrintSection[]
  flatRows: InventoryPrintRow[]
  totalItems: number
  warehouseNames: string[]
  categoryNames: string[]
}

export function defaultInventoryPrintSelection(store: WarehouseStore): {
  warehouseIds: Set<string>
  categoryIds: Set<string>
} {
  return {
    warehouseIds: new Set(store.locations.map((l) => l.id)),
    categoryIds: new Set(store.categories.map((c) => c.id)),
  }
}

export function countItemsForSelection(
  store: WarehouseStore,
  warehouseIds: Set<string>,
  categoryIds: Set<string>,
  onlyWithBalance: boolean,
): number {
  return filterInventoryItems(store, {
    warehouseIds,
    categoryIds,
    onlyWithBalance,
    groupByCategory: true,
    showBookBalance: true,
  }).length
}

export function categoryItemCounts(
  store: WarehouseStore,
  warehouseIds: Set<string>,
  onlyWithBalance: boolean,
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const item of filterInventoryItems(store, {
    warehouseIds,
    categoryIds: new Set(store.categories.map((c) => c.id)),
    onlyWithBalance,
    groupByCategory: false,
    showBookBalance: true,
  })) {
    counts.set(item.categoryId, (counts.get(item.categoryId) ?? 0) + 1)
  }
  return counts
}

export function filterInventoryItems(
  store: WarehouseStore,
  options: InventoryPrintOptions,
): WarehouseItem[] {
  const balances = computeAllBalances(store)
  const whAll = options.warehouseIds.size === 0
  const catAll = options.categoryIds.size === 0

  return store.items
    .filter((item) => {
      if (!item.active) return false
      if (!whAll && !options.warehouseIds.has(item.warehouseId)) return false
      if (!catAll && !options.categoryIds.has(item.categoryId)) return false
      if (options.onlyWithBalance) {
        const bal = balances.get(item.id)?.balance ?? 0
        if (Math.abs(bal) < 1e-9) return false
      }
      return true
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
}

export function buildInventoryPrintPayload(
  store: WarehouseStore,
  options: InventoryPrintOptions,
): InventoryPrintPayload {
  const catMap = new Map(store.categories.map((c) => [c.id, c]))
  const locMap = new Map(store.locations.map((l) => [l.id, l]))
  const balances = computeAllBalances(store)

  const items = filterInventoryItems(store, options)
  const flatRows: InventoryPrintRow[] = items.map((item) => ({
    item,
    bookBalance: balances.get(item.id)?.balance ?? 0,
    categoryName: catMap.get(item.categoryId)?.name ?? '—',
    warehouseName: locMap.get(item.warehouseId)?.name ?? '—',
  }))

  const whAll = options.warehouseIds.size === 0
  const catAll = options.categoryIds.size === 0
  const warehouseNames = whAll
    ? store.locations.map((l) => l.name)
    : store.locations.filter((l) => options.warehouseIds.has(l.id)).map((l) => l.name)
  const categoryNames = catAll
    ? store.categories.map((c) => c.name)
    : store.categories.filter((c) => options.categoryIds.has(c.id)).map((c) => c.name)

  if (!options.groupByCategory) {
    return {
      sections: [{ categoryId: '_all', categoryName: '', rows: flatRows }],
      flatRows,
      totalItems: flatRows.length,
      warehouseNames,
      categoryNames,
    }
  }

  const byCat = new Map<string, InventoryPrintRow[]>()
  for (const row of flatRows) {
    const list = byCat.get(row.item.categoryId) ?? []
    list.push(row)
    byCat.set(row.item.categoryId, list)
  }

  const sections: InventoryPrintSection[] = [...store.categories]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .filter((c) => byCat.has(c.id))
    .map((c) => ({
      categoryId: c.id,
      categoryName: c.name,
      rows: (byCat.get(c.id) ?? []).sort((a, b) =>
        a.item.name.localeCompare(b.item.name, 'ru'),
      ),
    }))

  return {
    sections,
    flatRows,
    totalItems: flatRows.length,
    warehouseNames,
    categoryNames,
  }
}

export function formatInventoryQty(n: number): string {
  return formatQty(n)
}
