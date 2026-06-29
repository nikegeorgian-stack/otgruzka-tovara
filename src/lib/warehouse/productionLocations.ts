import type { WarehouseLocation, WarehouseStore } from './types'

export const PRODUCTION_LOCATION_NAMES = {
  wip: 'Выработка',
  packaging: 'Упаковка',
  finished: 'Готовая продукция',
} as const

const EXTRA_LOCATIONS: Omit<WarehouseLocation, 'id'>[] = [
  { name: PRODUCTION_LOCATION_NAMES.wip, sortOrder: 10, kind: 'wip' },
  { name: PRODUCTION_LOCATION_NAMES.packaging, sortOrder: 11, kind: 'packaging' },
  { name: PRODUCTION_LOCATION_NAMES.finished, sortOrder: 12, kind: 'finished' },
]

export function ensureProductionWarehouseLocations(store: WarehouseStore): WarehouseStore {
  const names = new Set(store.locations.map((l) => l.name.trim().toLowerCase()))
  const toAdd = EXTRA_LOCATIONS.filter((l) => !names.has(l.name.toLowerCase()))
  if (!toAdd.length) return store
  const maxSort = Math.max(0, ...store.locations.map((l) => l.sortOrder))
  const added = toAdd.map((l, i) => ({
    ...l,
    id: crypto.randomUUID(),
    sortOrder: maxSort + 1 + i,
  }))
  return { ...store, locations: [...store.locations, ...added] }
}

export function warehouseLocationId(
  store: WarehouseStore,
  name: string,
): string | undefined {
  const n = name.trim().toLowerCase()
  return store.locations.find((l) => l.name.trim().toLowerCase() === n)?.id
}
