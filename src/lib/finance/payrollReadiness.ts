import { collectUnsignedBrigades } from '@/lib/brigadeSignoff'
import { isWorkCode, factWorkedHours } from '@/lib/factExtra'
import { isTransferredOut } from '@/lib/dayTransfer'
import { getFactMark } from '@/lib/stats'
import { timesheetDateInRow } from '@/lib/timesheetEntries/cellState'
import { parseTimesheetDraft, timesheetDraftStorageKey } from '@/lib/timesheetDraftStorage'
import type { AppStore } from '@/lib/types'

export type PayrollReadiness = {
  unconfirmed: number
  missingEmployees: number
  overlaps: number
  unsignedBrigades: string[]
  drafts: number
}
export function payrollReadiness(
  store: AppStore,
  month: string,
  userId?: string,
): PayrollReadiness {
  const sheet = store.months[month]
  const result: PayrollReadiness = {
    unconfirmed: 0,
    missingEmployees: 0,
    overlaps: 0,
    unsignedBrigades: collectUnsignedBrigades(store, month),
    drafts: (store.timesheetEntries?.documents ?? []).filter(
      (d) => d.month === month && d.status === 'draft',
    ).length,
  }
  if (userId && typeof localStorage !== 'undefined') {
    try {
      result.drafts += parseTimesheetDraft(
        localStorage.getItem(
          timesheetDraftStorageKey(
            import.meta.env.VITE_FIREBASE_PROJECT_ID || 'desktop',
            userId,
            month,
          ),
        ),
        month,
      ).length
    } catch {
      result.drafts += 1
    }
  }
  if (!sheet) {
    result.missingEmployees++
    return result
  }
  const worked = new Set<string>()
  const overrides = new Set(sheet.factOverrides)
  for (const row of sheet.rows) {
    if (!row.employeeId) continue
    if (!store.employees.some((e) => e.id === row.employeeId)) {
      result.missingEmployees++
      continue
    }
    for (const date of new Set([
      ...Object.keys(sheet.plan[row.id] ?? {}),
      ...Object.keys(sheet.fact[row.id] ?? {}),
    ])) {
      if (isTransferredOut(sheet, row.id, date)) continue
      const code = getFactMark(sheet, row.id, date)
      if (!code || code === 'В') continue
      if (!timesheetDateInRow(sheet, row.id, date)) {
        result.overlaps++
        continue
      }
      if (!overrides.has(`${row.id}|${date}`)) result.unconfirmed++
      if (isWorkCode(code) && factWorkedHours(sheet, row.id, date, code) > 0) {
        const key = `${row.employeeId}|${date}`
        if (worked.has(key)) result.overlaps++
        worked.add(key)
      }
    }
  }
  return result
}
export function payrollReady(result: PayrollReadiness): boolean {
  return (
    !result.unconfirmed &&
    !result.missingEmployees &&
    !result.overlaps &&
    !result.unsignedBrigades.length &&
    !result.drafts
  )
}
