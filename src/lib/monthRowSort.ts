import { employeeName, employeePosition } from '@/i18n'
import type { Locale } from '@/i18n/types'
import type { Employee, TimesheetRow } from './types'

export type MonthRowSortKey = 'default' | 'name' | 'tab' | 'position' | 'schedule'
export type MonthRowSortDir = 'asc' | 'desc'

export type MonthRowSort = {
  key: MonthRowSortKey
  dir: MonthRowSortDir
}

export const DEFAULT_MONTH_ROW_SORT: MonthRowSort = { key: 'default', dir: 'asc' }

function rowHasEmployee(row: TimesheetRow): boolean {
  return !!row.employeeId
}

export function compareTimesheetRows(
  a: TimesheetRow,
  b: TimesheetRow,
  employeesById: Map<string, Employee>,
  sort: MonthRowSort,
  locale: Locale,
): number {
  const aEmpty = !rowHasEmployee(a)
  const bEmpty = !rowHasEmployee(b)
  if (aEmpty !== bEmpty) return aEmpty ? 1 : -1
  if (aEmpty && bEmpty) return a.sortOrder - b.sortOrder

  const empA = employeesById.get(a.employeeId!)!
  const empB = employeesById.get(b.employeeId!)!

  let cmp = 0
  switch (sort.key) {
    case 'name':
      cmp = employeeName(empA, locale).localeCompare(employeeName(empB, locale), 'ru')
      break
    case 'tab':
      cmp = empA.tabNumber.localeCompare(empB.tabNumber, 'ru', { numeric: true })
      break
    case 'position':
      cmp = employeePosition(empA, locale).localeCompare(employeePosition(empB, locale), 'ru')
      break
    case 'schedule':
      cmp = empA.schedule.localeCompare(empB.schedule, 'ru')
      break
    default:
      cmp = a.sortOrder - b.sortOrder
      break
  }

  if (cmp === 0) cmp = a.sortOrder - b.sortOrder
  if (sort.key === 'default') {
    return sort.dir === 'asc' ? cmp : -cmp
  }
  return sort.dir === 'asc' ? cmp : -cmp
}

export function sortTimesheetRows(
  rows: TimesheetRow[],
  employeesById: Map<string, Employee>,
  sort: MonthRowSort,
  locale: Locale,
): TimesheetRow[] {
  if (sort.key === 'default' && sort.dir === 'asc') return rows
  return [...rows].sort((a, b) => compareTimesheetRows(a, b, employeesById, sort, locale))
}

export function toggleMonthRowSort(
  current: MonthRowSort,
  key: MonthRowSortKey,
): MonthRowSort {
  if (current.key === key) {
    return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  }
  return { key, dir: 'asc' }
}
