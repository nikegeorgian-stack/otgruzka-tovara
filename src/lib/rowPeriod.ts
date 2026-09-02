import { addDaysIso } from './dates'
import { isEmployedOnDay } from './schedule'
import type { Employee, MonthRowBounds } from './types'

/** Активен ли сотрудник в этой строке месяца в указанный день (приём/увольнение + отметки периода). */
export function isRowActiveOnDay(
  emp: Employee,
  dateKey: string,
  bounds?: MonthRowBounds,
): boolean {
  if (!isEmployedOnDay(emp, dateKey)) return false
  if (bounds?.inactiveFrom && dateKey >= bounds.inactiveFrom) return false
  if (bounds?.inactiveUntil && dateKey <= bounds.inactiveUntil) return false
  return true
}

/** День перед dateKey (YYYY-MM-DD). */
export function dayBefore(dateKey: string): string {
  return addDaysIso(dateKey, -1)
}

export function hasRowPeriodBounds(bounds?: MonthRowBounds): boolean {
  if (!bounds) return false
  return Boolean(bounds.inactiveFrom?.trim() || bounds.inactiveUntil?.trim())
}

export function rowPeriodOffReason(
  emp: Employee,
  dateKey: string,
  bounds?: MonthRowBounds,
): 'hire' | 'terminate' | 'inactiveFrom' | 'inactiveUntil' | null {
  if (!isEmployedOnDay(emp, dateKey)) {
    const hire = emp.hireDate?.trim()
    if (hire && dateKey < hire) return 'hire'
    return 'terminate'
  }
  if (bounds?.inactiveFrom && dateKey >= bounds.inactiveFrom) return 'inactiveFrom'
  if (bounds?.inactiveUntil && dateKey <= bounds.inactiveUntil) return 'inactiveUntil'
  return null
}
