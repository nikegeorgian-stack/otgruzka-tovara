import type { WarehouseCategory, WarehouseLocation, WarehouseStore } from './types'

/** Номер склада: 01, 02… — для фильтров и отчётов, независимо от названия. */
export function formatWarehouseLocationCode(n: number): string {
  return String(Math.max(1, Math.floor(n))).padStart(2, '0')
}

export function formatWarehouseCategoryCode(n: number): string {
  return formatWarehouseLocationCode(n)
}

export function warehouseLocationLabel(
  loc: WarehouseLocation,
  opts?: { withCode?: boolean },
): string {
  const code = loc.code?.trim()
  if (opts?.withCode === false || !code) return loc.name
  return `${code} · ${loc.name}`
}

export function ensureWarehouseLocationCodes(store: WarehouseStore): WarehouseStore {
  let changed = false
  const used = new Set(
    store.locations.map((l) => l.code?.trim()).filter((c): c is string => Boolean(c)),
  )
  let next = 1
  const locations = store.locations.map((loc) => {
    if (loc.code?.trim()) return loc
    while (used.has(formatWarehouseLocationCode(next))) next += 1
    const code = formatWarehouseLocationCode(next)
    used.add(code)
    next += 1
    changed = true
    return { ...loc, code }
  })

  const catUsed = new Set(
    store.categories.map((c) => c.code?.trim()).filter((c): c is string => Boolean(c)),
  )
  let catNext = 1
  const categories = store.categories.map((cat) => {
    if (cat.code?.trim()) return cat
    while (catUsed.has(formatWarehouseCategoryCode(catNext))) catNext += 1
    const code = formatWarehouseCategoryCode(catNext)
    catUsed.add(code)
    catNext += 1
    changed = true
    return { ...cat, code }
  })

  if (!changed) return store
  return { ...store, locations, categories }
}

export function nextFreeLocationCode(locations: WarehouseLocation[]): string {
  const used = new Set(locations.map((l) => l.code?.trim()).filter(Boolean))
  let n = 1
  while (used.has(formatWarehouseLocationCode(n))) n += 1
  return formatWarehouseLocationCode(n)
}

export function nextFreeCategoryCode(categories: WarehouseCategory[]): string {
  const used = new Set(categories.map((c) => c.code?.trim()).filter(Boolean))
  let n = 1
  while (used.has(formatWarehouseCategoryCode(n))) n += 1
  return formatWarehouseCategoryCode(n)
}
