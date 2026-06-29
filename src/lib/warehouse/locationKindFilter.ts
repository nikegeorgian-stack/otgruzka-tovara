import type {
  WarehouseCategory,
  WarehouseItem,
  WarehouseLocation,
  WarehouseLocationKind,
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

export function filterItemsForDocumentPicker(
  items: WarehouseItem[],
  categories: WarehouseCategory[],
  warehouseId: string | undefined,
  location: WarehouseLocation | undefined,
): WarehouseItem[] {
  let list = items
  if (warehouseId) list = list.filter((i) => i.warehouseId === warehouseId)
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
