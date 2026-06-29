import seedWarehouse from '@/data/seed-warehouse.json'
import { ensureProductionWarehouseLocations } from '@/lib/warehouse/productionLocations'
import { assignMissingInternalCodes, formatInternalCode } from './itemHistory'
import { normalizeLocationKind } from './locationKinds'
import type {
  WarehouseCategory,
  WarehouseDocumentStatus,
  WarehouseItem,
  WarehouseLocation,
  WarehouseStore,
} from './types'

function newId(): string {
  return crypto.randomUUID()
}

export const DEFAULT_WAREHOUSE_LOCATIONS: Omit<WarehouseLocation, 'id'>[] = [
  { name: 'Основной', sortOrder: 0, kind: 'raw' },
  { name: 'Офис', sortOrder: 1, kind: 'office' },
  { name: 'Химия', sortOrder: 2, kind: 'chemistry' },
]

type SeedItem = { name: string; category: string; unit: string }

type SeedWarehouse = {
  categories?: string[]
  items: SeedItem[]
}

const seed = seedWarehouse as SeedWarehouse

const LEGACY_BAD_CATEGORY =
  /PIGMARAMA|Пистолет для скотча|Дирокол|Резиновые сапог|Уксусная кислота|Очки защитные|Респираторы|Уголки \(пластиковые\)/i

function defaultLocations(): WarehouseLocation[] {
  return DEFAULT_WAREHOUSE_LOCATIONS.map((l) => ({ ...l, id: newId() }))
}

function normalizeUnit(unit: string): string {
  const u = (unit ?? 'шт').trim()
  if (!u || /^\d+(\.\d+)?$/.test(u)) return 'шт'
  return u
}

function seedCategoryNames(): string[] {
  if (seed.categories?.length) return seed.categories
  return [...new Set(seed.items.map((i) => i.category || 'Прочее'))].sort((a, b) =>
    a.localeCompare(b, 'ru'),
  )
}

function buildCategories(names: string[]): WarehouseCategory[] {
  return names.map((name, sortOrder) => ({
    id: newId(),
    name,
    sortOrder,
  }))
}

function buildItemsFromSeed(
  categories: WarehouseCategory[],
  warehouseId: string,
): WarehouseItem[] {
  const catByName = new Map(categories.map((c) => [c.name, c.id]))
  const fallbackCat = categories[0]?.id ?? newId()

  const now = new Date().toISOString()
  return seed.items.map((it, sortOrder) => ({
    id: newId(),
    internalCode: formatInternalCode(sortOrder + 1),
    name: it.name.trim(),
    categoryId: catByName.get(it.category || 'Прочее') ?? fallbackCat,
    warehouseId,
    unit: normalizeUnit(it.unit),
    active: true,
    sortOrder,
    createdAt: now,
  }))
}

export function createDefaultWarehouse(): WarehouseStore {
  const locations = defaultLocations()
  const mainWh = locations[0]!.id
  const categories = buildCategories(seedCategoryNames())
  const items = buildItemsFromSeed(categories, mainWh)

  return {
    locations,
    categories,
    items,
    movements: [],
    documents: [],
    invoiceRegistry: [],
    auditLog: [],
    nextInternalCode: items.length + 1,
    itemHistories: {},
  }
}

function needsCatalogMigration(store: WarehouseStore): boolean {
  if (store.categories.some((c) => LEGACY_BAD_CATEGORY.test(c.name))) return true
  if (store.categories.length > 35) return true
  return false
}

/** Обновляет названия и категории из seed, сохраняя id позиций и движения. */
function migrateCatalog(store: WarehouseStore): WarehouseStore {
  const fresh = createDefaultWarehouse()
  if (store.items.length !== fresh.items.length) return store

  const catByName = new Map(fresh.categories.map((c) => [c.name, c.id]))

  const items = store.items.map((item, i) => {
    const ref = seed.items[i]!
    const freshItem = fresh.items[i]!
    return {
      ...item,
      name: freshItem.name,
      categoryId: catByName.get(ref.category) ?? fresh.categories[0]!.id,
      unit: freshItem.unit,
    }
  })

  return {
    ...store,
    categories: fresh.categories,
    items,
  }
}

export function normalizeWarehouse(raw: Partial<WarehouseStore> | undefined): WarehouseStore {
  if (!raw?.items?.length) return createDefaultWarehouse()

  let locations: WarehouseLocation[] = (raw.locations ?? []).map((l, i) => ({
    id: l.id || newId(),
    name: l.name?.trim() || 'Склад',
    sortOrder: l.sortOrder ?? i,
    kind: normalizeLocationKind(l.kind, l.name?.trim() || 'Склад'),
  }))
  if (!locations.length) locations = defaultLocations()

  const mainWh = locations[0]!.id

  let categories = (raw.categories ?? []).map((c, i) => ({
    id: c.id || newId(),
    name: c.name?.trim() || 'Прочее',
    sortOrder: c.sortOrder ?? i,
  }))

  const catIds = new Set(categories.map((c) => c.id))
  const fallbackCat = categories[0]?.id ?? newId()
  if (!categories.length) {
    categories.push({ id: fallbackCat, name: 'Прочее', sortOrder: 0 })
  }

  const locIds = new Set(locations.map((l) => l.id))

  const items = raw.items.map((it, i) => ({
    id: it.id || newId(),
    internalCode: it.internalCode?.trim() ?? '',
    name: it.name?.trim() || '—',
    categoryId: catIds.has(it.categoryId) ? it.categoryId : fallbackCat,
    warehouseId: locIds.has(it.warehouseId) ? it.warehouseId : mainWh,
    unit: normalizeUnit(it.unit),
    sku: it.sku,
    barcode: it.barcode,
    price: it.price,
    weightKg: it.weightKg && it.weightKg > 0 ? it.weightKg : undefined,
    minStock: it.minStock,
    note: it.note,
    photoDataUrl: it.photoDataUrl,
    unitConversions: it.unitConversions,
    active: it.active !== false,
    sortOrder: it.sortOrder ?? i,
    createdAt: it.createdAt,
  }))

  const itemIds = new Set(items.map((i) => i.id))
  const movements = (raw.movements ?? [])
    .filter((m) => itemIds.has(m.itemId))
    .map((m) => ({
      ...m,
      warehouseId: locIds.has(m.warehouseId) ? m.warehouseId : mainWh,
    }))

  const documents = (raw.documents ?? []).map((d) => ({
    ...d,
    warehouseId: locIds.has(d.warehouseId) ? d.warehouseId : mainWh,
    lines: d.lines.filter((l) => itemIds.has(l.itemId)),
    status: (d.status === 'cancelled' ? 'cancelled' : 'posted') as WarehouseDocumentStatus,
  }))

  let store: WarehouseStore = {
    locations,
    categories,
    items,
    movements,
    documents,
    invoiceRegistry: raw.invoiceRegistry ?? [],
    auditLog: raw.auditLog ?? [],
    dailyIssueSessions: raw.dailyIssueSessions ?? [],
    nextInternalCode: raw.nextInternalCode,
    itemHistories: raw.itemHistories ?? {},
    itemRequests: Array.isArray(raw.itemRequests) ? raw.itemRequests : [],
    itemRenameRequests: Array.isArray(raw.itemRenameRequests) ? raw.itemRenameRequests : [],
    replenishmentRequests: Array.isArray(raw.replenishmentRequests) ? raw.replenishmentRequests : [],
    loadingShipments: Array.isArray(raw.loadingShipments) ? raw.loadingShipments : [],
  }

  if (needsCatalogMigration(store)) {
    store = migrateCatalog(store)
  }

  return ensureProductionWarehouseLocations(assignMissingInternalCodes(store))
}
