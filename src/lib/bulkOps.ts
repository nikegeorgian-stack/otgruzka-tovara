import { dayDateKey, daysInMonth, parseMonthKey } from './dates'
import { isGeorgiaPublicHoliday } from './georgiaCalendar'
import type { AppStore, MonthSheet } from './types'

/** Проставить «В» в плане (и факте без override) на все праздники месяца */
export function applyHolidayVForAll(sheet: MonthSheet): MonthSheet {
  const { year, month } = parseMonthKey(sheet.month)
  const days = daysInMonth(year, month)
  let next = { ...sheet, plan: { ...sheet.plan }, fact: { ...sheet.fact } }

  for (const row of sheet.rows) {
    if (!row.employeeId) continue
    const planRow = { ...(next.plan[row.id] ?? {}) }
    const factRow = { ...(next.fact[row.id] ?? {}) }

    for (let d = 1; d <= days; d++) {
      const dk = dayDateKey(year, month, d)
      if (!isGeorgiaPublicHoliday(dk)) continue
      planRow[dk] = 'В'
      const oKey = `${row.id}|${dk}`
      if (!sheet.factOverrides.includes(oKey)) {
        factRow[dk] = 'В'
      }
    }
    next.plan[row.id] = planRow
    next.fact[row.id] = factRow
  }
  return next
}

export type CopyPlanToFactScope = 'all' | '52' | '22' | '11' | 'brigade'

function rowMatchesCopyScope(
  row: MonthSheet['rows'][number],
  emp: AppStore['employees'][number] | undefined,
  scope: CopyPlanToFactScope,
  brigade?: string,
): boolean {
  if (!row.employeeId || !emp) return false
  if (scope === '52') return emp.schedule === '5/2 8ч'
  if (scope === '22') return emp.schedule === '2/2 11ч'
  if (scope === '11') return emp.schedule === '1/1 11ч'
  if (scope === 'brigade') return !!brigade && row.brigade === brigade
  return true
}

/** Скопировать план → факт (сброс ручных правок факта по затронутым строкам) */
export function copyPlanToFact(
  sheet: MonthSheet,
  employees: AppStore['employees'],
  scope: CopyPlanToFactScope,
  brigade?: string,
): MonthSheet {
  let next: MonthSheet = {
    ...sheet,
    fact: { ...sheet.fact },
    factOverrides: [...sheet.factOverrides],
  }

  for (const row of sheet.rows) {
    const emp = employees.find((e) => e.id === row.employeeId)
    if (!rowMatchesCopyScope(row, emp, scope, brigade)) continue

    const planRow = sheet.plan[row.id] ?? {}
    next.fact[row.id] = { ...planRow }
    next.factOverrides = next.factOverrides.filter((k) => !k.startsWith(`${row.id}|`))
  }
  return next
}

/** @deprecated use copyPlanToFact(..., '52') */
export function copyPlanToFactFor52(
  sheet: MonthSheet,
  employees: AppStore['employees'],
): MonthSheet {
  return copyPlanToFact(sheet, employees, '52')
}

export function setCellComment(
  sheet: MonthSheet,
  rowId: string,
  dateKey: string,
  text: string,
): MonthSheet {
  const key = `${rowId}|${dateKey}`
  const comments = { ...sheet.comments }
  if (text.trim()) comments[key] = text.trim()
  else delete comments[key]
  return { ...sheet, comments }
}

export function getCellComment(
  sheet: MonthSheet,
  rowId: string,
  dateKey: string,
): string {
  return sheet.comments[`${rowId}|${dateKey}`] ?? ''
}
