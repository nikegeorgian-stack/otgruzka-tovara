/**
 * PHASE W0.5 — per-warehouse accounting verification status.
 * Missing legacy records are treated as uninitialized (not active).
 */
import type {
  WarehouseAccountingState,
  WarehouseAccountingStatus,
  WarehouseStore,
} from './types'

/** Machine error code for blocked auto-issue before activation. */
export const WAREHOUSE_NOT_INITIALIZED = 'warehouse_not_initialized' as const

export function getWarehouseAccountingState(
  store: Pick<WarehouseStore, 'accountingByWarehouse'>,
  warehouseId: string,
): WarehouseAccountingState {
  const found = store.accountingByWarehouse?.find((s) => s.warehouseId === warehouseId)
  if (found) {
    return found.id ? found : { ...found, id: found.warehouseId }
  }
  return { id: warehouseId, warehouseId, status: 'uninitialized' }
}

export function getWarehouseAccountingStatus(
  store: Pick<WarehouseStore, 'accountingByWarehouse'>,
  warehouseId: string,
): WarehouseAccountingStatus {
  return getWarehouseAccountingState(store, warehouseId).status
}

/** Stock issue / auto consumption allowed only when accounting is active. */
export function isWarehouseAccountingActive(
  store: Pick<WarehouseStore, 'accountingByWarehouse'>,
  warehouseId: string,
): boolean {
  return getWarehouseAccountingStatus(store, warehouseId) === 'active'
}

export function assertWarehouseAllowsStockIssue(
  store: Pick<WarehouseStore, 'accountingByWarehouse'>,
  warehouseId: string,
): { ok: true } | { ok: false; error: typeof WAREHOUSE_NOT_INITIALIZED } {
  if (!warehouseId || !isWarehouseAccountingActive(store, warehouseId)) {
    return { ok: false, error: WAREHOUSE_NOT_INITIALIZED }
  }
  return { ok: true }
}

export function upsertWarehouseAccountingState(
  store: WarehouseStore,
  next: WarehouseAccountingState,
): WarehouseStore {
  const row: WarehouseAccountingState = {
    ...next,
    id: next.id || next.warehouseId,
    warehouseId: next.warehouseId,
  }
  const list = [...(store.accountingByWarehouse ?? [])]
  const idx = list.findIndex((s) => s.warehouseId === row.warehouseId)
  if (idx >= 0) list[idx] = { ...list[idx], ...row }
  else list.push(row)
  return { ...store, accountingByWarehouse: list }
}

export function setWarehouseAccountingStatus(
  store: WarehouseStore,
  warehouseId: string,
  status: WarehouseAccountingStatus,
  patch?: Partial<WarehouseAccountingState>,
): WarehouseStore {
  const prev = getWarehouseAccountingState(store, warehouseId)
  return upsertWarehouseAccountingState(store, {
    ...prev,
    ...patch,
    id: warehouseId,
    warehouseId,
    status,
  })
}

/** True if any selected warehouses are not yet active (legacy = uninitialized). */
export function hasUnverifiedWarehouses(
  store: Pick<WarehouseStore, 'locations' | 'accountingByWarehouse'>,
  warehouseIds?: string[],
): boolean {
  const ids =
    warehouseIds && warehouseIds.length > 0
      ? warehouseIds
      : store.locations.map((l) => l.id)
  return ids.some((id) => !isWarehouseAccountingActive(store, id))
}

/** Convenience for tests / migration helpers: mark warehouses active. */
export function withActiveWarehouses(
  store: WarehouseStore,
  warehouseIds: string[],
  actor?: { actorId?: string; actorName?: string },
): WarehouseStore {
  let next = store
  const now = new Date().toISOString()
  for (const id of warehouseIds) {
    next = setWarehouseAccountingStatus(next, id, 'active', {
      activatedAt: now,
      activatedBy: actor?.actorId,
      activatedByName: actor?.actorName,
      note: 'test_or_helper_activation',
    })
  }
  return next
}
