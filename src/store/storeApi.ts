import type { Dispatch, SetStateAction } from 'react'
import { purgeExpiredTrash } from '@/lib/trash'
import type { AppStore } from '@/lib/types'
import type { WarehouseStore } from '@/lib/warehouse/types'
import type { WorkwearStore } from '@/lib/workwear/types'
import type { TimesheetActor } from '@/lib/access/timesheetGuard'

/** Kept for modern product call sites; ignored (no dirty-ops pipeline in P). */
export type StoreMutationOrigin =
  | 'user'
  | 'hydration'
  | 'import'
  | 'restore'
  | 'reset'
  | 'system'
  | 'clear_months'
export type StoreUpdateMeta = { origin?: StoreMutationOrigin }

export type SetStore = {
  (action: SetStateAction<AppStore>, meta?: StoreUpdateMeta): void
}
export type GetStore = () => AppStore

export type StoreSliceDeps = {
  setStore: SetStore
  getStore: GetStore
  getActor?: () => TimesheetActor | null
}

export function applyTrackedStoreUpdate(
  _prev: AppStore,
  _next: AppStore,
  _origin: StoreMutationOrigin,
): void {
  // no-op in P (cloud dirty tracker removed)
}

export function patchStore(
  setStore: SetStore,
  fn: (s: AppStore) => AppStore,
  _meta?: StoreUpdateMeta,
): void {
  setStore((s) => purgeExpiredTrash(fn(s)))
}

export function patchWarehouse(
  setStore: SetStore,
  fn: (w: WarehouseStore) => WarehouseStore,
  _meta?: StoreUpdateMeta,
): void {
  setStore((s) => ({ ...s, warehouse: fn(s.warehouse) }))
}

export function patchWorkwear(
  setStore: SetStore,
  fn: (w: WorkwearStore) => WorkwearStore,
  _meta?: StoreUpdateMeta,
): void {
  setStore((s) => ({ ...s, workwear: fn(s.workwear) }))
}

/** @deprecated Dispatch alias — prefer SetStore with optional meta. */
export type LegacySetStore = Dispatch<SetStateAction<AppStore>>
