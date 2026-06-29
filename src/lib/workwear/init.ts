import type { WorkwearCatalogItem, WorkwearStore, WorkwearPpeCategory } from './types'
import { defaultSizeGridForCategory, sizesForGrid } from './sizes'
import { defaultSizesForCatalog } from './labels'

type SeedItem = {
  name: string
  ppeCategory: WorkwearPpeCategory
  season: WorkwearCatalogItem['season']
  unitPrice: number
}

const DEFAULT_CATALOG: SeedItem[] = [
  // Летний комплект (EN 340)
  { name: 'Кепка рабочая летняя', ppeCategory: 'headwear', season: 'summer', unitPrice: 25 },
  { name: 'Каскетка с сеткой', ppeCategory: 'headwear', season: 'summer', unitPrice: 30 },
  { name: 'Футболка рабочая', ppeCategory: 'upper', season: 'summer', unitPrice: 45 },
  { name: 'Поло рабочее', ppeCategory: 'upper', season: 'summer', unitPrice: 55 },
  { name: 'Халат лёгкий', ppeCategory: 'upper', season: 'summer', unitPrice: 70 },
  { name: 'Брюки рабочие летние', ppeCategory: 'pants', season: 'summer', unitPrice: 65 },
  { name: 'Полукомбинезон летний', ppeCategory: 'pants', season: 'summer', unitPrice: 85 },
  { name: 'Полуботинки летние', ppeCategory: 'footwear', season: 'summer', unitPrice: 75 },
  { name: 'Сандалии рабочие', ppeCategory: 'footwear', season: 'summer', unitPrice: 60 },
  { name: 'Перчатки трикотажные', ppeCategory: 'gloves', season: 'summer', unitPrice: 8 },
  { name: 'Перчатки с ПВХ-точкой', ppeCategory: 'gloves', season: 'summer', unitPrice: 12 },
  { name: 'Очки защитные', ppeCategory: 'eye', season: 'summer', unitPrice: 15 },
  { name: 'Наушники противошумные', ppeCategory: 'hearing', season: 'summer', unitPrice: 35 },
  // Зимний комплект
  { name: 'Шапка утеплённая', ppeCategory: 'headwear', season: 'winter', unitPrice: 35 },
  { name: 'Подшлемник утеплённый', ppeCategory: 'headwear', season: 'winter', unitPrice: 28 },
  { name: 'Куртка зимняя рабочая', ppeCategory: 'upper', season: 'winter', unitPrice: 180 },
  { name: 'Жилет утеплённый', ppeCategory: 'upper', season: 'winter', unitPrice: 95 },
  { name: 'Куртка флисовая', ppeCategory: 'upper', season: 'winter', unitPrice: 75 },
  { name: 'Брюки утеплённые', ppeCategory: 'pants', season: 'winter', unitPrice: 95 },
  { name: 'Полукомбинезон утеплённый', ppeCategory: 'pants', season: 'winter', unitPrice: 140 },
  { name: 'Ботинки утеплённые', ppeCategory: 'footwear', season: 'winter', unitPrice: 120 },
  { name: 'Сапоги резиновые утеплённые', ppeCategory: 'footwear', season: 'winter', unitPrice: 85 },
  { name: 'Перчатки утеплённые', ppeCategory: 'gloves', season: 'winter', unitPrice: 18 },
  { name: 'Перчатки зимние комбинированные', ppeCategory: 'gloves', season: 'winter', unitPrice: 22 },
  { name: 'Респиратор FFP2', ppeCategory: 'respiratory', season: 'winter', unitPrice: 5 },
]

function buildCatalogItem(seed: SeedItem, sortOrder: number): WorkwearCatalogItem {
  const sizeGrid = defaultSizeGridForCategory(seed.ppeCategory)
  return {
    id: `ww-default-${sortOrder + 1}`,
    name: seed.name,
    ppeCategory: seed.ppeCategory,
    season: seed.season,
    sizeGrid,
    unitPrice: seed.unitPrice,
    currency: 'GEL',
    sizes: defaultSizesForCatalog(seed.ppeCategory, sizeGrid),
    active: true,
    sortOrder,
  }
}

export function createDefaultWorkwear(): WorkwearStore {
  return {
    catalog: DEFAULT_CATALOG.map((item, i) => buildCatalogItem(item, i)),
    issuances: [],
  }
}

function inferPpeCategory(name: string): WorkwearPpeCategory {
  const n = name.toLowerCase()
  if (/кепк|шапк|каскет|подшлем|каск/.test(n)) return 'headwear'
  if (/ботин|обув|сапог|полубот|сандал/.test(n)) return 'footwear'
  if (/брюк|штаны|комбинезон/.test(n)) return 'pants'
  if (/перчат/.test(n)) return 'gloves'
  if (/очки/.test(n)) return 'eye'
  if (/респиратор|маск/.test(n)) return 'respiratory'
  if (/наушник/.test(n)) return 'hearing'
  if (/куртк|жилет|футболк|поло|халат|костюм/.test(n)) return 'upper'
  return 'other'
}

export function normalizeWorkwear(raw: WorkwearStore | undefined): WorkwearStore {
  if (!raw) return createDefaultWorkwear()
  const catalog = (raw.catalog ?? []).map((item, i) => {
    const ppeCategory = item.ppeCategory ?? inferPpeCategory(item.name)
    const sizeGrid = item.sizeGrid ?? defaultSizeGridForCategory(ppeCategory)
    const sizes =
      Array.isArray(item.sizes) && item.sizes.length > 0
        ? item.sizes
        : sizesForGrid(sizeGrid)
    return {
      ...item,
      ppeCategory,
      sizeGrid,
      sizes,
      active: item.active !== false,
      sortOrder: item.sortOrder ?? i,
      currency: item.currency ?? 'GEL',
      unitPrice: Number(item.unitPrice) || 0,
      warehouseItemId: item.warehouseItemId,
      warehouseId: item.warehouseId,
    }
  })
  const issuances = (raw.issuances ?? []).map((iss) => ({
    ...iss,
    quantity: Math.max(1, Number(iss.quantity) || 1),
    unitPrice: Number(iss.unitPrice) || 0,
    amortizationMonths: Number(iss.amortizationMonths) || 12,
    currency: iss.currency ?? 'GEL',
    ppeCategory: iss.ppeCategory ?? inferPpeCategory(''),
  }))
  return {
    catalog: catalog.length > 0 ? catalog : createDefaultWorkwear().catalog,
    issuances,
  }
}
