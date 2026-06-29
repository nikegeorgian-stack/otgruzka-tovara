import type { Dispatch, SetStateAction } from 'react'
import { purgeExpiredTrash } from '@/lib/trash'
import type { AppStore } from '@/lib/types'
import type { WarehouseStore } from '@/lib/warehouse/types'
import type { WorkwearStore } from '@/lib/workwear/types'

export type SetStore = Dispatch<SetStateAction<AppStore>>
export type GetStore = () => AppStore

export type StoreSliceDeps = {
  setStore: SetStore
  getStore: GetStore
}

export function patchStore(setStore: SetStore, fn: (s: AppStore) => AppStore): void {
  setStore((s) => purgeExpiredTrash(fn(s)))
}

export function patchWarehouse(
  setStore: SetStore,
  fn: (w: WarehouseStore) => WarehouseStore,
): void {
  setStore((s) => ({ ...s, warehouse: fn(s.warehouse) }))
}

export function patchWorkwear(
  setStore: SetStore,
  fn: (w: WorkwearStore) => WorkwearStore,
): void {
  setStore((s) => ({ ...s, workwear: fn(s.workwear) }))
}
