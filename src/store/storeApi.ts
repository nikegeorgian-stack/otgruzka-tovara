import type { Dispatch, SetStateAction } from 'react'
import { cloudDirtyTracker } from '@/lib/cloud/dirtyOperations'
import { diffStoreToOperations } from '@/lib/cloud/storeDiff'
import {
  shouldTrackDirtyOps,
  type StoreMutationOrigin,
  type StoreUpdateMeta,
} from '@/lib/cloud/storeMutationOrigin'
import { stampOpsWithTransactionGroup } from '@/lib/cloud/transactionGroups'
import { purgeExpiredTrash } from '@/lib/trash'
import type { AppStore } from '@/lib/types'
import type { WarehouseStore } from '@/lib/warehouse/types'
import type { WorkwearStore } from '@/lib/workwear/types'

/**
 * Session actor for store slice commands.
 * `login` is optional and used by recipe/auth resolution when Firebase UID ≠ access.users.id.
 * Timesheet code continues to resolve by `id` only via TimesheetActor.
 */
export type StoreActor = {
  id?: string
  name?: string
  /** Canonical AppUser.login (not displayName). */
  login?: string
}

export type SetStore = {
  (action: SetStateAction<AppStore>, meta?: StoreUpdateMeta): void
}
export type GetStore = () => AppStore

export type StoreSliceDeps = {
  setStore: SetStore
  getStore: GetStore
  getActor?: () => StoreActor | null
}

export function applyTrackedStoreUpdate(
  prev: AppStore,
  next: AppStore,
  originOrMeta: StoreMutationOrigin | StoreUpdateMeta,
): void {
  const meta: StoreUpdateMeta =
    typeof originOrMeta === 'string' ? { origin: originOrMeta } : originOrMeta
  if (!shouldTrackDirtyOps(meta.origin) || next === prev) return
  let ops = diffStoreToOperations(
    prev,
    next,
    cloudDirtyTracker.getBaseRevision(),
    meta.origin,
  )
  if (meta.atomic === true && meta.transactionGroupId) {
    ops = stampOpsWithTransactionGroup(
      ops,
      {
        transactionGroupId: meta.transactionGroupId,
        transactionGroupKind: meta.transactionGroupKind ?? 'warehouse',
        transactionGroupLabel: meta.transactionGroupLabel,
        atomic: true,
      },
      next,
      prev,
    )
  }
  cloudDirtyTracker.enqueue(ops)
}

export function patchStore(
  setStore: SetStore,
  fn: (s: AppStore) => AppStore,
  meta: StoreUpdateMeta = { origin: 'user' },
): void {
  setStore((s) => purgeExpiredTrash(fn(s)), meta)
}

export function patchWarehouse(
  setStore: SetStore,
  fn: (w: WarehouseStore) => WarehouseStore,
  meta: StoreUpdateMeta = { origin: 'user' },
): void {
  setStore((s) => ({ ...s, warehouse: fn(s.warehouse) }), meta)
}

export function patchWorkwear(
  setStore: SetStore,
  fn: (w: WorkwearStore) => WorkwearStore,
  meta: StoreUpdateMeta = { origin: 'user' },
): void {
  setStore((s) => ({ ...s, workwear: fn(s.workwear) }), meta)
}

/** @deprecated Dispatch alias — prefer SetStore with optional meta. */
export type LegacySetStore = Dispatch<SetStateAction<AppStore>>
