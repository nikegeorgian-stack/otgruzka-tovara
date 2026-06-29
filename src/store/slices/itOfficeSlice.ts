import {
  postItHandoverAct,
  removeItAsset,
  removeItHandoverActDraft,
  upsertItAsset,
  upsertItHandoverActDraft,
  type PostItHandoverActResult,
  type UpsertItHandoverActInput,
} from '@/lib/itOffice/acts'
import { postConsumableIssue, setConsumableBalance, type IssueConsumableInput } from '@/lib/itOffice/consumables'
import { upsertItMaintenance, removeItMaintenance } from '@/lib/itOffice/maintenance'
import type { ItAsset, ItAssetCatalogItem, ItConsumableSpec, ItMaintenanceRecord } from '@/lib/itOffice/types'
import { patchStore, type StoreSliceDeps } from '../storeApi'

export function createItOfficeSlice({ setStore }: StoreSliceDeps) {
  return {
    upsertItAsset(asset: ItAsset, nextSeq?: number) {
      patchStore(setStore, (s) => ({
        ...s,
        itOffice: upsertItAsset(s.itOffice, { ...asset, updatedAt: new Date().toISOString() }, nextSeq),
      }))
    },

    removeItAsset(assetId: string) {
      patchStore(setStore, (s) => ({ ...s, itOffice: removeItAsset(s.itOffice, assetId) }))
    },

    upsertItCatalogItem(item: ItAssetCatalogItem) {
      patchStore(setStore, (s) => {
        const exists = s.itOffice.catalog.some((c) => c.id === item.id)
        const catalog = exists
          ? s.itOffice.catalog.map((c) => (c.id === item.id ? item : c))
          : [...s.itOffice.catalog, item]
        return { ...s, itOffice: { ...s.itOffice, catalog } }
      })
    },

    upsertItHandoverActDraft(input: UpsertItHandoverActInput) {
      patchStore(setStore, (s) => ({
        ...s,
        itOffice: upsertItHandoverActDraft(s.itOffice, input),
      }))
    },

    postItHandoverAct(actId: string): PostItHandoverActResult {
      let result: PostItHandoverActResult = { ok: false, error: 'unknown' }
      patchStore(setStore, (s) => {
        const r = postItHandoverAct(s.itOffice, s.employees, actId)
        result = r.result
        if (!r.result.ok) return s
        return { ...s, itOffice: r.store }
      })
      return result
    },

    removeItHandoverActDraft(actId: string) {
      patchStore(setStore, (s) => ({
        ...s,
        itOffice: removeItHandoverActDraft(s.itOffice, actId),
      }))
    },

    upsertItMaintenance(record: ItMaintenanceRecord) {
      patchStore(setStore, (s) => ({
        ...s,
        itOffice: upsertItMaintenance(s.itOffice, record),
      }))
    },

    removeItMaintenance(id: string) {
      patchStore(setStore, (s) => ({
        ...s,
        itOffice: removeItMaintenance(s.itOffice, id),
      }))
    },

    upsertItConsumableSpec(spec: ItConsumableSpec) {
      patchStore(setStore, (s) => {
        const exists = s.itOffice.consumableSpecs.some((c) => c.id === spec.id)
        const consumableSpecs = exists
          ? s.itOffice.consumableSpecs.map((c) => (c.id === spec.id ? spec : c))
          : [...s.itOffice.consumableSpecs, spec]
        return { ...s, itOffice: { ...s.itOffice, consumableSpecs } }
      })
    },

    setItConsumableBalance(specId: string, locationId: string, qty: number) {
      patchStore(setStore, (s) => ({
        ...s,
        itOffice: setConsumableBalance(s.itOffice, specId, locationId, qty),
      }))
    },

    postItConsumableIssue(input: IssueConsumableInput) {
      let error = ''
      patchStore(setStore, (s) => {
        const r = postConsumableIssue(s.itOffice, input)
        if (!r.result.ok) {
          error = r.result.error
          return s
        }
        return { ...s, itOffice: r.store }
      })
      return error || null
    },
  }
}
