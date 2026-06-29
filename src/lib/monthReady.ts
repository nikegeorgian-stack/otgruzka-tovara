import { syncAllBrigadesIntoMonths } from '@/lib/brigadeManage'
import { normalizeBrigadeSlots } from '@/lib/brigadeRows'
import { ensureMonth } from '@/lib/monthSheet'
import type { AppStore } from '@/lib/types'

/** Синхронизировать бригады в месяцах и нормализовать слоты строк. */
export function ensureMonthReady(store: AppStore, month?: string): AppStore {
  let next = syncAllBrigadesIntoMonths(store)
  const monthKeys = month ? [month] : Object.keys(next.months)

  for (const key of monthKeys) {
    const base = ensureMonth(next, key)
    const sheet = base.months[key]
    if (!sheet) continue

    let updated = sheet
    for (const brigade of base.brigades) {
      const normalized = normalizeBrigadeSlots(updated, brigade)
      if (normalized !== updated) updated = normalized
    }

    if (updated !== sheet) {
      next = { ...base, months: { ...base.months, [key]: updated } }
    } else if (base !== next) {
      next = base
    }
  }

  return next
}
