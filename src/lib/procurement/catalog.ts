import type {
  OrderCategory,
  ProcurementCategoryNode,
  ProcurementStore,
  RoutePoint,
  RoutePointKind,
  TransportMode,
} from './types'

type SeedCat = Omit<ProcurementCategoryNode, 'id' | 'parentId'> & {
  parentCode?: string
}

/** Стабильные корневые категории (как в 1С: код + имя). */
const SEED: SeedCat[] = [
  { code: '01', name: 'Сырьё', legacyKey: 'raw_material', active: true, sortOrder: 1 },
  { code: '01.01', name: 'Волокно / целлюлоза', parentCode: '01', active: true, sortOrder: 2 },
  { code: '01.02', name: 'Химия / связующие', parentCode: '01', active: true, sortOrder: 3 },
  { code: '01.03', name: 'Добавки', parentCode: '01', active: true, sortOrder: 4 },
  { code: '02', name: 'Упаковка', legacyKey: 'packaging', active: true, sortOrder: 10 },
  { code: '02.01', name: 'Плёнка / скотч', parentCode: '02', active: true, sortOrder: 11 },
  { code: '02.02', name: 'Поддоны / уголки', parentCode: '02', active: true, sortOrder: 12 },
  { code: '03', name: 'Запчасти', legacyKey: 'spare_parts', active: true, sortOrder: 20 },
  { code: '03.01', name: 'Механика', parentCode: '03', active: true, sortOrder: 21 },
  { code: '03.02', name: 'Электрика', parentCode: '03', active: true, sortOrder: 22 },
  { code: '04', name: 'Оборудование', legacyKey: 'equipment', active: true, sortOrder: 30 },
  { code: '05', name: 'Расходники', legacyKey: 'consumables', active: true, sortOrder: 40 },
  { code: '06', name: 'Прочее', legacyKey: 'other', active: true, sortOrder: 50 },
]

export const DEFAULT_PROCUREMENT_CATEGORIES = SEED

export function buildDefaultProcurementCategories(): ProcurementCategoryNode[] {
  const byCode = new Map<string, ProcurementCategoryNode>()
  for (const row of SEED) {
    const { parentCode: _pc, ...rest } = row
    byCode.set(row.code, {
      ...rest,
      id: `pcat-${row.code.replace(/\./g, '-')}`,
      parentId: undefined,
    })
  }
  for (const row of SEED) {
    if (!row.parentCode) continue
    const node = byCode.get(row.code)!
    const parent = byCode.get(row.parentCode)
    if (parent) node.parentId = parent.id
  }
  return [...byCode.values()].sort((a, b) => a.sortOrder - b.sortOrder)
}

export const DEFAULT_ROUTE_POINTS: Omit<RoutePoint, 'id'>[] = [
  {
    code: 'CNSHA',
    name: 'Shanghai',
    kind: 'port',
    transportModes: ['sea', 'mixed'],
    countryCode: 'CN',
    active: true,
    sortOrder: 1,
  },
  {
    code: 'CNNGB',
    name: 'Ningbo',
    kind: 'port',
    transportModes: ['sea', 'mixed'],
    countryCode: 'CN',
    active: true,
    sortOrder: 2,
  },
  {
    code: 'CNQIN',
    name: 'Qingdao',
    kind: 'port',
    transportModes: ['sea', 'mixed'],
    countryCode: 'CN',
    active: true,
    sortOrder: 3,
  },
  {
    code: 'GEPTI',
    name: 'Poti',
    kind: 'port',
    transportModes: ['sea', 'mixed'],
    countryCode: 'GE',
    active: true,
    sortOrder: 10,
  },
  {
    code: 'GEBUS',
    name: 'Batumi',
    kind: 'port',
    transportModes: ['sea', 'mixed'],
    countryCode: 'GE',
    active: true,
    sortOrder: 11,
  },
  {
    code: 'GETBS',
    name: 'Tbilisi',
    kind: 'station',
    transportModes: ['rail', 'mixed'],
    countryCode: 'GE',
    active: true,
    sortOrder: 20,
  },
  {
    code: 'GERUS',
    name: 'Rustavi',
    kind: 'station',
    transportModes: ['rail', 'mixed'],
    countryCode: 'GE',
    active: true,
    sortOrder: 21,
  },
  {
    code: 'TRKPY',
    name: 'Kapikule',
    kind: 'customs',
    transportModes: ['truck', 'rail', 'mixed'],
    countryCode: 'TR',
    active: true,
    sortOrder: 30,
  },
  {
    code: 'GESAR',
    name: 'Sarpi',
    kind: 'customs',
    transportModes: ['truck', 'mixed'],
    countryCode: 'GE',
    active: true,
    sortOrder: 31,
  },
  {
    code: 'GEPLT',
    name: 'Plant Fibercell',
    kind: 'warehouse',
    transportModes: ['truck', 'rail', 'mixed'],
    countryCode: 'GE',
    active: true,
    sortOrder: 40,
  },
  {
    code: 'CNPVG',
    name: 'Shanghai Pudong (PVG)',
    kind: 'terminal',
    transportModes: ['air', 'mixed'],
    countryCode: 'CN',
    active: true,
    sortOrder: 50,
  },
  {
    code: 'GETBS-AIR',
    name: 'Tbilisi Airport (TBS)',
    kind: 'terminal',
    transportModes: ['air', 'mixed'],
    countryCode: 'GE',
    active: true,
    sortOrder: 51,
  },
]

export function buildDefaultRoutePoints(): RoutePoint[] {
  return DEFAULT_ROUTE_POINTS.map((p) => ({
    ...p,
    id: `rpt-${p.code.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  }))
}

export function ensureProcurementCatalog(store: ProcurementStore): ProcurementStore {
  let categories = store.categories ?? []
  let routePoints = store.routePoints ?? []
  let changed = false

  if (!categories.length) {
    categories = buildDefaultProcurementCategories()
    changed = true
  } else {
    const codes = new Set(categories.map((c) => c.code))
    for (const seed of buildDefaultProcurementCategories()) {
      if (!codes.has(seed.code)) {
        categories = [...categories, seed]
        codes.add(seed.code)
        changed = true
      }
    }
  }

  if (!routePoints.length) {
    routePoints = buildDefaultRoutePoints()
    changed = true
  } else {
    const codes = new Set(routePoints.map((p) => p.code))
    for (const seed of buildDefaultRoutePoints()) {
      if (!codes.has(seed.code)) {
        routePoints = [...routePoints, seed]
        codes.add(seed.code)
        changed = true
      }
    }
  }

  if (!changed) return store
  return { ...store, categories, routePoints }
}

export function categoryLabel(
  node: ProcurementCategoryNode,
  opts?: { withCode?: boolean },
): string {
  return opts?.withCode === false ? node.name : `${node.code} · ${node.name}`
}

export function resolveCategoryNode(
  categories: ProcurementCategoryNode[],
  categoryId?: string,
  legacy?: OrderCategory,
): ProcurementCategoryNode | undefined {
  if (categoryId) {
    const byId = categories.find((c) => c.id === categoryId)
    if (byId) return byId
  }
  if (legacy) {
    return categories.find((c) => !c.parentId && c.legacyKey === legacy)
  }
  return undefined
}

export function legacyFromCategoryId(
  categories: ProcurementCategoryNode[],
  categoryId?: string,
): OrderCategory {
  const node = categories.find((c) => c.id === categoryId)
  if (!node) return 'other'
  if (node.legacyKey) return node.legacyKey
  if (node.parentId) {
    const parent = categories.find((c) => c.id === node.parentId)
    if (parent?.legacyKey) return parent.legacyKey
  }
  return 'other'
}

export function categoryOptionsFlat(
  categories: ProcurementCategoryNode[],
  opts?: { activeOnly?: boolean },
): ProcurementCategoryNode[] {
  const list = [...categories]
    .filter((c) => (opts?.activeOnly === false ? true : c.active !== false))
    .sort((a, b) => a.code.localeCompare(b.code, 'en'))
  return list
}

export function routePointsForMode(
  points: RoutePoint[],
  mode: TransportMode,
  kind?: RoutePointKind,
): RoutePoint[] {
  return [...points]
    .filter((p) => p.active !== false)
    .filter((p) => p.transportModes.includes(mode) || p.transportModes.includes('mixed'))
    .filter((p) => (kind ? p.kind === kind : true))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))
}

export function routePointLabel(p: RoutePoint): string {
  return `${p.code} · ${p.name}`
}

export function preferredRoutePointKind(mode: TransportMode): RoutePointKind | undefined {
  if (mode === 'sea') return 'port'
  if (mode === 'rail') return 'station'
  if (mode === 'air') return 'terminal'
  if (mode === 'truck') return undefined
  return undefined
}

export function nextCategoryCode(
  categories: ProcurementCategoryNode[],
  parentId?: string | null,
): string {
  if (!parentId) {
    const roots = categories.filter((c) => !c.parentId)
    const max = roots.reduce((m, c) => {
      const n = Number.parseInt(c.code, 10)
      return Number.isFinite(n) ? Math.max(m, n) : m
    }, 0)
    return String(max + 1).padStart(2, '0')
  }
  const parent = categories.find((c) => c.id === parentId)
  if (!parent) return '99.01'
  const kids = categories.filter((c) => c.parentId === parentId)
  const max = kids.reduce((m, c) => {
    const part = c.code.split('.').pop()
    const n = Number.parseInt(part ?? '', 10)
    return Number.isFinite(n) ? Math.max(m, n) : m
  }, 0)
  return `${parent.code}.${String(max + 1).padStart(2, '0')}`
}
