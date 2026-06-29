import {
  postWorkwearIssuance,
  upsertWorkwearCatalogWithWarehouse,
  type PostWorkwearIssueResult,
} from '@/lib/workwear/issue'
import type { WorkwearCatalogItem } from '@/lib/workwear/types'
import { patchStore, type StoreSliceDeps } from '../storeApi'

export function createWorkwearSlice({ setStore, getStore }: StoreSliceDeps) {
  return {
    upsertWorkwearCatalogItem(item: WorkwearCatalogItem) {
      patchStore(setStore, (s) => {
        const { workwear, warehouse } = upsertWorkwearCatalogWithWarehouse(
          s.workwear,
          s.warehouse,
          item,
        )
        return { ...s, workwear, warehouse }
      })
    },

    archiveWorkwearCatalogItem(id: string, archived: boolean) {
      patchStore(setStore, (s) => {
        const item = s.workwear.catalog.find((c) => c.id === id)
        if (!item) return s
        const nextItem = { ...item, active: !archived }
        const { workwear, warehouse } = upsertWorkwearCatalogWithWarehouse(
          s.workwear,
          s.warehouse,
          nextItem,
        )
        return { ...s, workwear, warehouse }
      })
    },

    postWorkwearIssuance(
      input: Omit<
        Parameters<typeof postWorkwearIssuance>[3],
        'issuedBy' | 'issuedByName'
      > & { issuedBy: string; issuedByName: string },
    ): PostWorkwearIssueResult {
      let result: PostWorkwearIssueResult = { ok: false, error: 'unknown' }
      patchStore(setStore, (s) => {
        const r = postWorkwearIssuance(s.workwear, s.warehouse, s.employees, input)
        result = r.result
        if (!r.result.ok) return s
        return { ...s, workwear: r.workwear, warehouse: r.warehouse }
      })
      return result
    },

    removeWorkwearIssuance(id: string): boolean {
      const store = getStore()
      const iss = store.workwear.issuances.find((i) => i.id === id)
      if (!iss) return false
      patchStore(setStore, (s) => ({
        ...s,
        workwear: {
          ...s.workwear,
          issuances: s.workwear.issuances.filter((i) => i.id !== id),
        },
      }))
      return true
    },
  }
}
