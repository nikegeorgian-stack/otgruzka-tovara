import { dayDateKey, daysInMonth, parseMonthKey } from './dates'
import { getFactMark } from './stats'
import type { AppStore, MonthSheet } from './types'

/** Число назначенных строк бригады в листе месяца. */
export function brigadeAssignedCount(sheet: MonthSheet, brigade: string): number {
  return sheet.rows.filter((r) => r.brigade === brigade && r.employeeId).length
}

/** Число слотов (включая пустые) бригады. */
export function brigadeSlotCount(sheet: MonthSheet, brigade: string): number {
  return sheet.rows.filter((r) => r.brigade === brigade).length
}

/** Расхождения план↔факт по бригаде за месяц. */
export function brigadeMismatchCount(
  store: AppStore,
  sheet: MonthSheet,
  brigade: string,
): number {
  const { year, month } = parseMonthKey(sheet.month)
  const days = daysInMonth(year, month)
  let count = 0
  for (const row of sheet.rows) {
    if (row.brigade !== brigade || !row.employeeId) continue
    if (!store.employees.some((e) => e.id === row.employeeId)) continue
    for (let d = 1; d <= days; d++) {
      const dk = dayDateKey(year, month, d)
      const plan = sheet.plan[row.id]?.[dk] ?? ''
      const fact = getFactMark(sheet, row.id, dk)
      if (plan !== fact) count++
    }
  }
  return count
}
