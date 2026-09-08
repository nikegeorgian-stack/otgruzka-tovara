import type {
  WarehouseCategory,
  WarehouseDocument,
  WarehouseItem,
  WarehouseLocation,
  WarehouseLocationKind,
  StockMovement,
} from './types'

/** Эвристика: какие названия категорий типичны для зоны склада */
const KIND_CATEGORY_PATTERNS: Record<Exclude<WarehouseLocationKind, 'other'>, RegExp[]> = {
  raw: [/нит/i, /ровинг/i, /стеклоткан/i, /сетк/i, /ткан/i, /simo/i, /xinbei/i, /суров/i, /брак/i],
  chemistry: [/хим/i, /пигмент/i, /красит/i, /пропит/i, /лабор/i, /добав/i],
  packaging: [/упаков/i, /скотч/i, /лент/i, /этикет/i, /короб/i, /паллет/i, /плён/i, /плен/i],
  wip: [/выработ/i, /полуфаб/i, /незаверш/i],
  finished: [/готов/i, /продукц/i, /celloplex/i, /стеклоплекс/i],
  office: [/канц/i, /кухн/i, /хоз/i, /убор/i, /мебел/i, /аптеч/i, /сиз/i, /спецод/i, /оборуд/i],
}

export function categoryMatchesLocationKind(
  categoryName: string,
  kind: WarehouseLocationKind,
): boolean {
  if (kind === 'other') return true
  const patterns = KIND_CATEGORY_PATTERNS[kind]
  return patterns.some((p) => p.test(categoryName))
}

export function filterItemsByLocationKind(
  items: WarehouseItem[],
  categories: WarehouseCategory[],
  location: WarehouseLocation | undefined,
): WarehouseItem[] {
  if (!location?.kind || location.kind === 'other') return items
  const catNames = new Map(categories.map((c) => [c.id, c.name]))
  return items.filter((item) => {
    const name = catNames.get(item.categoryId) ?? ''
    return categoryMatchesLocationKind(name, location.kind!)
  })
}

/**
 * Item ids that have authoritative G2 activity on a warehouse
 * (movements and/or document lines) — used for legacy items with no warehouseId.
 */
export function collectItemIdsWithWarehouseEvidence(
  warehouseId: string,
  evidence: {
    movements?: Pick<StockMovement, 'itemId' | 'warehouseId'>[]
    documents?: Pick<WarehouseDocument, 'warehouseId' | 'lines'>[]
  },
): Set<string> {
  const ids = new Set<string>()
  for (const m of evidence.movements ?? []) {
    if (m.warehouseId === warehouseId && m.itemId) ids.add(m.itemId)
  }
  for (const d of evidence.documents ?? []) {
    if (d.warehouseId !== warehouseId) continue
    for (const line of d.lines ?? []) {
      if (line.itemId) ids.add(line.itemId)
    }
  }
  return ids
}

/** Whether an item may appear in the document picker for the selected warehouse. */
export function itemAllowedForDocumentWarehouse(
  item: WarehouseItem,
  warehouseId: string | undefined,
  legacyAllowedIds?: Set<string>,
): boolean {
  if (!warehouseId) return true
  if (item.warehouseId === warehouseId) return true
  if (item.warehouseId) return false
  return legacyAllowedIds?.has(item.id) === true
}

export type DocumentPickerWarehouseEvidence = {
  movements?: Pick<StockMovement, 'itemId' | 'warehouseId'>[]
  documents?: Pick<WarehouseDocument, 'warehouseId' | 'lines'>[]
}

/**
 * Resolve warehouse for an item: card warehouseId if set, else unique G2
 * warehouse from movements/document lines (legacy null-warehouse items).
 */
export function resolveWarehouseIdForItem(
  itemId: string,
  itemWarehouseId: string | null | undefined,
  evidence?: DocumentPickerWarehouseEvidence,
  preferredWarehouseId?: string,
): string | undefined {
  const card = typeof itemWarehouseId === 'string' ? itemWarehouseId.trim() : ''
  if (card) return card
  if (!evidence) return undefined
  const candidates = new Set<string>()
  for (const m of evidence.movements ?? []) {
    if (m.itemId === itemId && m.warehouseId) candidates.add(m.warehouseId)
  }
  for (const d of evidence.documents ?? []) {
    if (!d.warehouseId) continue
    if ((d.lines ?? []).some((l) => l.itemId === itemId)) candidates.add(d.warehouseId)
  }
  if (preferredWarehouseId && candidates.has(preferredWarehouseId)) {
    return preferredWarehouseId
  }
  if (candidates.size === 0) return undefined
  return [...candidates].sort()[0]
}

export function filterItemsForDocumentPicker(
  items: WarehouseItem[],
  categories: WarehouseCategory[],
  warehouseId: string | undefined,
  location: WarehouseLocation | undefined,
  evidence?: DocumentPickerWarehouseEvidence,
): WarehouseItem[] {
  // На общем складе (other / без kind) — все категории. Доп. склады с типом
  // (химия, ГП…) по-прежнему можно сужать по kind, если задан.
  // Legacy warehouseId=null: only when G2 movements/docs exist on the selected WH.
  const legacyAllowed =
    warehouseId && evidence
      ? collectItemIdsWithWarehouseEvidence(warehouseId, evidence)
      : undefined
  const list = items.filter((i) => itemAllowedForDocumentWarehouse(i, warehouseId, legacyAllowed))
  if (!location?.kind || location.kind === 'other') return list
  return filterItemsByLocationKind(list, categories, location)
}

export function itemIsFinishedProduct(
  item: WarehouseItem,
  categories: WarehouseCategory[],
  locations?: WarehouseLocation[],
): boolean {
  const loc = locations?.find((l) => l.id === item.warehouseId)
  if (loc?.kind === 'finished') return true
  const catName = categories.find((c) => c.id === item.categoryId)?.name ?? ''
  if (/^готов/i.test(catName) && /продукц/i.test(catName)) return true
  if (/^готовая\s+продукц/i.test(catName)) return true
  return false
}

/** Расходники и материалы — всё, кроме готовой продукции */
export function filterConsumableItems(
  items: WarehouseItem[],
  categories: WarehouseCategory[],
  warehouseId?: string,
  locations?: WarehouseLocation[],
): WarehouseItem[] {
  let list = items.filter(
    (i) => i.active && !itemIsFinishedProduct(i, categories, locations),
  )
  if (warehouseId) list = list.filter((i) => i.warehouseId === warehouseId)
  return list
}

/** Только готовая продукция — для отгрузки / погрузки */
export function filterFinishedProductItems(
  items: WarehouseItem[],
  categories: WarehouseCategory[],
  warehouseId?: string,
  locations?: WarehouseLocation[],
): WarehouseItem[] {
  let list = items.filter((i) => i.active && itemIsFinishedProduct(i, categories, locations))
  if (warehouseId) list = list.filter((i) => i.warehouseId === warehouseId)
  return list
}
