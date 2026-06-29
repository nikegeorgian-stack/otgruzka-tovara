import type {
  ItAssetCatalogItem,
  ItAssetKind,
  ItConsumableSpec,
  ItLocation,
  ItOfficeStore,
} from './types'

function newId(): string {
  return crypto.randomUUID()
}

const DEFAULT_LOCATIONS: Omit<ItLocation, 'id'>[] = [
  { name: 'IT-комната / склад', sortOrder: 0 },
  { name: 'Офис — open space', sortOrder: 1 },
  { name: 'Производство — офис', sortOrder: 2 },
  { name: 'Серверная', sortOrder: 3 },
]

type CatalogSeed = {
  name: string
  kind: ItAssetKind
  manufacturer?: string
  model?: string
}

const DEFAULT_CATALOG: CatalogSeed[] = [
  { name: 'Ноутбук Lenovo ThinkPad', kind: 'laptop', manufacturer: 'Lenovo', model: 'ThinkPad' },
  { name: 'Ноутбук HP ProBook', kind: 'laptop', manufacturer: 'HP', model: 'ProBook' },
  { name: 'Планшет', kind: 'tablet', manufacturer: 'Samsung', model: 'Galaxy Tab' },
  { name: 'Принтер HP LaserJet', kind: 'printer', manufacturer: 'HP', model: 'LaserJet' },
  { name: 'МФУ Canon', kind: 'printer', manufacturer: 'Canon', model: 'i-SENSYS' },
  { name: 'Монитор 24"', kind: 'monitor', manufacturer: 'Dell', model: 'P2422H' },
  { name: 'IP-телефон', kind: 'phone' },
  { name: 'ИБП', kind: 'ups' },
  { name: 'Wi-Fi роутер', kind: 'router' },
  { name: 'Коммутатор', kind: 'switch' },
  { name: 'Проектор', kind: 'projector' },
  { name: 'Сканер', kind: 'scanner' },
]

const DEFAULT_CONSUMABLES: Omit<ItConsumableSpec, 'id' | 'compatibleCatalogIds' | 'compatibleAssetIds'>[] = [
  { name: 'Картридж чёрный (универсальный)', sku: 'TONER-BK', minStock: 2, unit: 'шт', active: true },
  { name: 'Картридж цветной', sku: 'TONER-C', minStock: 1, unit: 'шт', active: true },
  { name: 'Барабан', sku: 'DRUM', minStock: 1, unit: 'шт', active: true },
  { name: 'Бумага A4', sku: 'PAPER-A4', minStock: 10, unit: 'уп', active: true },
  { name: 'Кабель HDMI', sku: 'HDMI', minStock: 3, unit: 'шт', active: true },
  { name: 'Кабель USB-C', sku: 'USBC', minStock: 5, unit: 'шт', active: true },
]

function buildCatalog(seeds: CatalogSeed[]): ItAssetCatalogItem[] {
  return seeds.map((s, i) => ({
    id: `it-cat-${i + 1}`,
    name: s.name,
    kind: s.kind,
    manufacturer: s.manufacturer,
    model: s.model,
    active: true,
    sortOrder: i,
  }))
}

export function createDefaultItOfficeStore(): ItOfficeStore {
  const catalog = buildCatalog(DEFAULT_CATALOG)
  const printerCatalogIds = catalog.filter((c) => c.kind === 'printer').map((c) => c.id)
  const locations = DEFAULT_LOCATIONS.map((l) => ({ ...l, id: newId() }))
  const mainLoc = locations[0]!.id

  return {
    catalog,
    locations,
    assets: [],
    acts: [],
    maintenance: [],
    consumableSpecs: DEFAULT_CONSUMABLES.map((c, i) => ({
      ...c,
      id: `it-cons-${i + 1}`,
      compatibleCatalogIds: c.name.includes('Картридж') || c.name.includes('Барабан') ? printerCatalogIds : [],
      compatibleAssetIds: [],
    })),
    consumableBalances: DEFAULT_CONSUMABLES.map((_, i) => ({
      specId: `it-cons-${i + 1}`,
      locationId: mainLoc,
      qty: 0,
    })),
    consumableIssues: [],
    attachments: [],
    nextInventorySeq: 1,
  }
}

export function normalizeItOfficeStore(raw: ItOfficeStore | undefined): ItOfficeStore {
  if (!raw?.catalog?.length) return createDefaultItOfficeStore()
  return {
    catalog: raw.catalog ?? [],
    locations: raw.locations?.length ? raw.locations : createDefaultItOfficeStore().locations,
    assets: raw.assets ?? [],
    acts: raw.acts ?? [],
    maintenance: raw.maintenance ?? [],
    consumableSpecs: raw.consumableSpecs ?? [],
    consumableBalances: raw.consumableBalances ?? [],
    consumableIssues: raw.consumableIssues ?? [],
    attachments: raw.attachments ?? [],
    nextInventorySeq: raw.nextInventorySeq ?? 1,
  }
}

export function nextInventoryNo(store: ItOfficeStore): { no: string; nextSeq: number } {
  const seq = store.nextInventorySeq
  return { no: `IT-${String(seq).padStart(5, '0')}`, nextSeq: seq + 1 }
}

export function emptyAsset(store: ItOfficeStore, kind: ItAssetKind = 'laptop') {
  const { no, nextSeq } = nextInventoryNo(store)
  const now = new Date().toISOString()
  return {
    asset: {
      id: newId(),
      kind,
      name: '',
      inventoryNo: no,
      status: 'stock' as const,
      locationId: store.locations[0]?.id,
      createdAt: now,
      updatedAt: now,
    },
    nextSeq,
  }
}
