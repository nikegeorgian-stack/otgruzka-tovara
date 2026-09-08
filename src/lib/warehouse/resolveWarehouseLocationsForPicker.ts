import type { WarehouseLocation, WarehouseStore } from './types'

/**
 * Prefer catalogue locations. If empty (partial G2/cloud overlay), recover ids from
 * documents / movements / accounting so document editor remains usable.
 */
export function resolveWarehouseLocationsForPicker(
  warehouse: Pick<
    WarehouseStore,
    'locations' | 'documents' | 'movements' | 'accountingByWarehouse' | 'items'
  >,
): WarehouseLocation[] {
  if (warehouse.locations?.length) {
    return [...warehouse.locations].sort((a, b) => a.sortOrder - b.sortOrder)
  }
  const ids = new Set<string>()
  for (const d of warehouse.documents ?? []) {
    if (d.warehouseId) ids.add(String(d.warehouseId))
    if (d.targetWarehouseId) ids.add(String(d.targetWarehouseId))
  }
  for (const m of warehouse.movements ?? []) {
    if (m.warehouseId) ids.add(String(m.warehouseId))
  }
  for (const a of warehouse.accountingByWarehouse ?? []) {
    if (a.warehouseId) ids.add(String(a.warehouseId))
  }
  for (const item of warehouse.items ?? []) {
    if (item.warehouseId) ids.add(String(item.warehouseId))
  }
  return [...ids].map((id, i) => ({
    id,
    name: id.length > 12 ? `${id.slice(0, 8)}…` : id,
    sortOrder: i,
    kind: 'other' as const,
  }))
}
