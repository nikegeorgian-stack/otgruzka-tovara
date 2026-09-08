/**
 * R2.9L — draft planner upsert must not stamp warehouse reservation atomic groups.
 * Reproduced on staging Preview: Save ЗП draft → domain_conflict with
 * warehouse::production_reservation_adjustment while no stock reservation ran.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createDefaultStore } from '@/lib/storage'
import { emptyProductionOrder } from '@/lib/planner/init'
import {
  cloudDirtyTracker,
  resetCloudDirtyTracker,
} from '@/lib/cloud/dirtyOperations'
import { createProductionSlice } from '@/store/slices/productionSlice'
import { applyTrackedStoreUpdate, type SetStore } from '@/store/storeApi'
import type { AppStore } from '@/lib/types'

describe('R29L planner upsertProductionOrder dirty groups', () => {
  beforeEach(() => {
    resetCloudDirtyTracker()
  })

  function trackedSlice() {
    let store = createDefaultStore() as AppStore
    cloudDirtyTracker.setBaselineStore(store)
    cloudDirtyTracker.setBaseRevision(1)
    const setStore: SetStore = (updater, meta) => {
      const prev = store
      const next = typeof updater === 'function' ? updater(store) : updater
      store = next
      applyTrackedStoreUpdate(prev, next, meta ?? { origin: 'user' })
    }
    const slice = createProductionSlice({
      setStore,
      getStore: () => store,
      getActor: () => ({ actorId: 'u1', actorName: 'Test' }),
    })
    return { store: () => store, slice }
  }

  it('draft create does not stamp production_reservation_adjustment', () => {
    const { slice } = trackedSlice()
    const draft = emptyProductionOrder('2026-09-08', '2026-09-15')
    draft.totalQtyMp = 100
    draft.productName = 'EDU Celloplex'
    draft.status = 'draft'
    slice.upsertProductionOrder(draft)

    const pending = cloudDirtyTracker.getPending()
    expect(pending.length).toBeGreaterThan(0)
    expect(
      pending.some((op) => op.transactionGroupKind === 'production_reservation_adjustment'),
    ).toBe(false)
    expect(pending.every((op) => !op.atomic)).toBe(true)
    expect(
      pending.some(
        (op) =>
          op.domain === 'production.planner.orders' || op.domain.startsWith('production'),
      ),
    ).toBe(true)
  })

  it('active order material change stamps production_reservation_adjustment', () => {
    const { slice, store } = trackedSlice()
    const draft = emptyProductionOrder('2026-09-08', '2026-09-15')
    draft.totalQtyMp = 100
    draft.status = 'draft'
    slice.upsertProductionOrder(draft)
    resetCloudDirtyTracker()
    cloudDirtyTracker.setBaselineStore(store())
    cloudDirtyTracker.setBaseRevision(2)

    const active = {
      ...store().production.planner.orders.find((o) => o.id === draft.id)!,
      status: 'active' as const,
    }
    // Seed active without reservation group (status transition without sync).
    slice.upsertProductionOrder(active)
    resetCloudDirtyTracker()
    cloudDirtyTracker.setBaselineStore(store())
    cloudDirtyTracker.setBaseRevision(3)

    const bumped = {
      ...store().production.planner.orders.find((o) => o.id === draft.id)!,
      totalQtyMp: 120,
      status: 'active' as const,
    }
    slice.upsertProductionOrder(bumped)

    const pending = cloudDirtyTracker.getPending()
    expect(
      pending.some((op) => op.transactionGroupKind === 'production_reservation_adjustment'),
    ).toBe(true)
    expect(
      pending.some((op) => op.transactionGroupId?.includes('production_reservation_adjustment')),
    ).toBe(true)
  })
})
