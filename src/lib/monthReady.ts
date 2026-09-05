import { syncAllBrigadesIntoMonths } from '@/lib/brigadeManage'
import { normalizeBrigadeSlots } from '@/lib/brigadeRows'
import { shiftMonth } from '@/lib/dates'
import { ensureWorkingMonths } from '@/lib/monthPurge'
import { ensureMonth } from '@/lib/monthSheet'
import {
  repairMonthSheetPlans,
  withScheduleDefaults,
} from '@/lib/scheduleHeal'
import type { AppStore } from '@/lib/types'

/** Синхронизировать бригады в месяцах и нормализовать слоты строк. */
export function ensureMonthReady(store: AppStore, month?: string): AppStore {
  let next = month ? ensureWorkingMonths(store, month) : store
  next = syncAllBrigadesIntoMonths(next)
  const healKeys = month
    ? [...new Set([month, shiftMonth(month, 1)])].filter((k) => next.months[k])
    : Object.keys(next.months)

  const refMonth = month ?? healKeys[healKeys.length - 1]
  let employeesChanged = false
  const healedEmployees = next.employees.map((e) => {
    const h = withScheduleDefaults(e, refMonth)
    if (h !== e) employeesChanged = true
    return h
  })
  if (employeesChanged) {
    next = { ...next, employees: healedEmployees }
  }

  for (const key of healKeys) {
    const base = ensureMonth(next, key)
    const sheet = base.months[key]
    if (!sheet) continue

    let updated = sheet
    for (const brigade of base.brigades) {
      const normalized = normalizeBrigadeSlots(updated, brigade)
      if (normalized !== updated) updated = normalized
    }

    const repaired = repairMonthSheetPlans(updated, base.employees)
    if (repaired !== updated) updated = repaired

    if (updated !== sheet) {
      next = { ...base, months: { ...base.months, [key]: updated } }
    } else if (base !== next) {
      next = base
    }
  }

  return next
}
