import {
  applyAppStoreSeeds,
  createDefaultStore,
  type SaveStoreResult,
} from '@/lib/storage'
import { purgeExpiredTrash } from '@/lib/trash'
import {
  addMonthToStore,
  clearMonthTimesheetInStore,
  clearMonthsBeforeInStore,
  isMonthArchived,
  isMonthClosed,
  setMonthArchived,
  setMonthClosed,
} from '@/lib/monthManage'
import { appendAudit } from '@/lib/audit'
import { buildPayrollSnapshot, getFinance } from '@/lib/finance/calc'
import { ensureMonthReady } from '@/lib/monthReady'
import { prepareArchiveMonthInStore, syncMonthRosterFromHrInStore } from '@/lib/monthArchive'
import { trashMonth } from '@/lib/trash'
import { applyStoreUpdate } from '@/lib/safeStoreUpdate'
import {
  clearBulkStoreOverwrite,
  tryBeginBulkStoreOverwrite,
  type BulkOverwriteKind,
  type BulkStartResult,
} from '@/lib/cloud/bulkStoreOverwrite'
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
  { setStore, getStore, getActor }: StoreSliceDeps,
  { getActiveMonth, setActiveMonth }: SettingsSliceExtras,
) {
  return {
    patch(fn: (s: AppStore) => AppStore) {
      patchStore(setStore, fn)
    },

    /**
     * Cloud hydration / pull — never opens bulk gate, never creates dirty ops.
     * Origin is passed explicitly (safe across startTransition).
     */
    applyCloudStore(next: AppStore) {
      const seeded = applyAppStoreSeeds(purgeExpiredTrash(next))
      setStore(ensureMonthReady(seeded, getActiveMonth()), { origin: 'hydration' })
    },

    /** Import / restore / reset preview only — blocks autosave until cancel. */
    replaceStoreForBulk(
      next: AppStore,
      kind: BulkOverwriteKind = 'import',
    ): BulkStartResult {
      const started = tryBeginBulkStoreOverwrite(
        kind,
        { employees: next.employees?.length ?? 0 },
        getStore(),
      )
      if (!started.ok) return started
      const seeded = applyAppStoreSeeds(purgeExpiredTrash(next))
      setStore(ensureMonthReady(seeded, getActiveMonth()), { origin: kind })
      return { ok: true }
    },

    /** @deprecated Prefer replaceStoreForBulk; kept for Settings import wiring. */
    replaceStore(next: AppStore): BulkStartResult {
      const started = tryBeginBulkStoreOverwrite(
        'import',
        { employees: next.employees?.length ?? 0 },
        getStore(),
      )
      if (!started.ok) return started
      const seeded = applyAppStoreSeeds(purgeExpiredTrash(next))
      setStore(ensureMonthReady(seeded, getActiveMonth()), { origin: 'import' })
      return { ok: true }
    },

    cancelBulkPreview() {
      clearBulkStoreOverwrite()
    },

    resetStore(): BulkStartResult {
      const started = tryBeginBulkStoreOverwrite('reset', undefined, getStore())
      if (!started.ok) return started
      for (const key of LEGACY_STORAGE_KEYS) {
        localStorage.removeItem(key)
      }
      setStore(createDefaultStore(), { origin: 'reset' })
      return { ok: true }
    },

    addMonth(month: string) {
      applyStoreUpdate(setStore, (s) => ensureMonthReady(addMonthToStore(s, month), month))
    },

    /**
     * Техническая очистка табеля за месяц (только для sysadmin из UI).
     * Пустые бригады и ячейки; финансы не трогает.
     */
    clearMonthTimesheet(month: string) {
      applyStoreUpdate(setStore, (s) => {
        let next = clearMonthTimesheetInStore(s, month)
        const a = getActor?.() ?? null
        next = appendAudit(next, {
          action: 'month_clear',
          month,
          by: a?.id,
          byName: a?.name,
          detail: `Табель очищен · бригады и ячейки пустые${a?.name ? ` · ${a.name}` : ''}`,
        })
        return next
      })
    },

    /**
     * Preview-only: очистить месяцы до beforeMonth — блокирует autosave до Cancel.
     * Refuses when pending ops / conflicts / active outbox / other bulk preview exist.
     */
    clearMonthsBefore(beforeMonth: string): BulkStartResult | { ok: true; cleared: string[] } {
      const current = getStore()
      const { store: clearedStore, cleared } = clearMonthsBeforeInStore(current, beforeMonth)
      if (!cleared.length) return { ok: true, cleared: [] }
      const started = tryBeginBulkStoreOverwrite(
        'clear_months',
        {
          months: cleared.length,
          monthKeys: cleared.length,
        },
        current,
      )
      if (!started.ok) return started
      const a = getActor?.() ?? null
      const preview = appendAudit(clearedStore, {
        action: 'month_clear',
        month: beforeMonth,
        by: a?.id,
        byName: a?.name,
        detail: `Предпросмотр: очищены месяцы до ${beforeMonth}: ${cleared.join(', ')}${a?.name ? ` · ${a.name}` : ''}`,
      })
      setStore(ensureMonthReady(preview, getActiveMonth()), { origin: 'clear_months' })
      return { ok: true, cleared }
    },

    removeMonth(month: string) {
      let nextActive: string | undefined
      applyStoreUpdate(setStore, (s) => {
        if (isMonthArchived(s, month) || isMonthClosed(s, month)) throw new Error('archived')
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

    syncMonthRosterFromHr(month: string) {
      applyStoreUpdate(setStore, (s) => syncMonthRosterFromHrInStore(s, month))
    },

    prepareArchiveMonth(month: string) {
      applyStoreUpdate(setStore, (s) => prepareArchiveMonthInStore(s, month))
    },

    setMonthClosed(
      month: string,
      closed: boolean,
      actor?: { id?: string; name?: string },
    ) {
      applyStoreUpdate(setStore, (s) => {
        let next = setMonthClosed(s, month, closed, actor)
        if (next === s) return s
        if (closed) {
          // Фиксируем снимок расчёта ЗП — поздние правки ставок не меняют прошлое.
          const snapshot = buildPayrollSnapshot(next, month, actor)
          const fin = getFinance(next)
          next = {
            ...next,
            finance: {
              ...fin,
              snapshots: { ...fin.snapshots, [month]: snapshot },
            },
          }
          next = appendAudit(next, {
            action: 'payroll_snapshot',
            month,
            by: actor?.id,
            byName: actor?.name,
            detail: `Зафиксирован расчёт ЗП: ${snapshot.rows.length} сотр.${actor?.name ? ` · ${actor.name}` : ''}`,
          })
        }
        return appendAudit(next, {
          action: closed ? 'month_close' : 'month_reopen',
          month,
          by: actor?.id,
          byName: actor?.name,
          detail: closed
            ? `Месяц закрыт${actor?.name ? ` · ${actor.name}` : ''}`
            : `Месяц переоткрыт${actor?.name ? ` · ${actor.name}` : ''}`,
        })
      })
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
          employer: patchSettings.employer
            ? { ...s.settings.employer, ...patchSettings.employer }
            : s.settings.employer,
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
