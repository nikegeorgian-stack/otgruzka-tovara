import {
  applyAppStoreSeeds,
  createDefaultStore,
  type SaveStoreResult,
} from '@/lib/storage'
import { purgeExpiredTrash } from '@/lib/trash'
import {
  addMonthToStore,
  isMonthArchived,
  setMonthArchived,
} from '@/lib/monthManage'
import { ensureMonthReady } from '@/lib/monthReady'
import { trashMonth } from '@/lib/trash'
import { applyStoreUpdate } from '@/lib/safeStoreUpdate'
import type { AppStore } from '@/lib/types'
import { STORAGE_KEY } from '@/lib/types'
import { patchStore, type StoreSliceDeps } from '../storeApi'

const LEGACY_STORAGE_KEYS = [
  STORAGE_KEY,
  'fibercell-tabel-v6',
  'fibercell-tabel-v5',
  'fibercell-tabel-v4',
  'fibercell-tabel-v3',
  'fibercell-tabel-v2',
  'tabel-local-v1',
]

export type SettingsSliceExtras = {
  getActiveMonth: () => string
  setActiveMonth: (month: string) => void
}

export function createSettingsSlice(
  { setStore }: StoreSliceDeps,
  { getActiveMonth, setActiveMonth }: SettingsSliceExtras,
) {
  return {
    patch(fn: (s: AppStore) => AppStore) {
      patchStore(setStore, fn)
    },

    replaceStore(next: AppStore) {
      setStore(applyAppStoreSeeds(purgeExpiredTrash(next)))
    },

    resetStore() {
      for (const key of LEGACY_STORAGE_KEYS) {
        localStorage.removeItem(key)
      }
      setStore(createDefaultStore())
    },

    addMonth(month: string) {
      applyStoreUpdate(setStore, (s) => ensureMonthReady(addMonthToStore(s, month), month))
    },

    removeMonth(month: string) {
      let nextActive: string | undefined
      applyStoreUpdate(setStore, (s) => {
        if (isMonthArchived(s, month)) throw new Error('archived')
        const next = trashMonth(s, month)
        if (getActiveMonth() === month) {
          const keys = Object.keys(next.months).sort()
          if (keys.length > 0) {
            nextActive = keys[keys.length - 1]
          } else {
            const now = new Date()
            nextActive = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
          }
        }
        return next
      })
      if (nextActive) setActiveMonth(nextActive)
    },

    archiveMonth(month: string, archived: boolean) {
      applyStoreUpdate(setStore, (s) => setMonthArchived(s, month, archived))
    },

    updateSettings(patchSettings: Partial<AppStore['settings']>) {
      setStore((s) => ({
        ...s,
        settings: {
          ...s.settings,
          ...patchSettings,
          ai: patchSettings.ai ? { ...s.settings.ai, ...patchSettings.ai } : s.settings.ai,
          signatures: patchSettings.signatures
            ? { ...s.settings.signatures, ...patchSettings.signatures }
            : s.settings.signatures,
        },
      }))
    },

    setLocale(locale: AppStore['settings']['locale']) {
      setStore((s) => ({
        ...s,
        settings: { ...s.settings, locale },
      }))
    },
  }
}

export type SettingsUiSlice = {
  dismissLoadWarning: () => void
  dismissSaveError: () => void
  reportSaveError: (err: SaveStoreResult | null) => void
}
