import { dayDateKey, daysInMonth, parseMonthKey } from './dates'
import { isGeorgiaPublicHoliday } from './georgiaCalendar'
import type { AppStore, MonthSheet } from './types'
import {
  is52Schedule,
  is22Schedule,
  scheduleObservesPublicHolidays,
} from './schedules'

/**
 * Проставить «В» в плане (и факте без override) на праздники месяца.
 * Только график 5/2 — на 2/2 и 1/1 праздники не распространяются.
 * `brigades` — если задан, только строки этих бригад (область ACL).
 */
export function applyHolidayVForAll(
  sheet: MonthSheet,
  brigades?: string[] | null,
  employees?: AppStore['employees'],
): MonthSheet {
  const brigadeSet =
    brigades && brigades.length > 0 ? new Set(brigades) : null
  const empById = new Map((employees ?? []).map((e) => [e.id, e]))
  const { year, month } = parseMonthKey(sheet.month)
  const days = daysInMonth(year, month)
  let next = { ...sheet, plan: { ...sheet.plan }, fact: { ...sheet.fact } }

  for (const row of sheet.rows) {
    if (!row.employeeId) continue
    if (brigadeSet && (!row.brigade || !brigadeSet.has(row.brigade))) continue
    const emp = empById.get(row.employeeId)
    if (emp && !scheduleObservesPublicHolidays(emp.schedule)) continue
    // Без карточки сотрудника — не трогаем (раньше ставили всем; 2/2 не должны получать «В»)
    if (!emp) continue

    const planRow = { ...(next.plan[row.id] ?? {}) }
    const factRow = { ...(next.fact[row.id] ?? {}) }

    for (let d = 1; d <= days; d++) {
      const dk = dayDateKey(year, month, d)
      if (!isGeorgiaPublicHoliday(dk)) continue
      planRow[dk] = 'В'
      const oKey = `${row.id}|${dk}`
      if (!next.factOverrides.includes(oKey)) {
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
  if (scope === '52') return is52Schedule(emp.schedule)
  if (scope === '22') return is22Schedule(emp.schedule)
  if (scope === '11') return emp.schedule === '1/1 11ч'
  if (scope === 'brigade') return !!brigade && row.brigade === brigade
  return true
}

function omitKeysByPrefixes<T>(
  record: Record<string, T> | undefined,
  prefixes: string[],
): Record<string, T> {
  const src = record ?? {}
  const out: Record<string, T> = {}
  for (const [key, value] of Object.entries(src)) {
    if (prefixes.some((p) => key.startsWith(p))) continue
    out[key] = value
  }
  return out
}

/**
 * Скопировать план → факт по затронутым строкам.
 * Полный сброс факта: коды, overrides, +N / точные часы, замены и дневные переводы
 * этих сотрудников (иначе часы остаются «хвостом» после сброса кодов).
 */
export function copyPlanToFact(
  sheet: MonthSheet,
  employees: AppStore['employees'],
  scope: CopyPlanToFactScope,
  brigade?: string,
): MonthSheet {
  const touchedRowIds: string[] = []
  const touchedEmployeeIds: string[] = []

  const nextFact: MonthSheet['fact'] = { ...sheet.fact }
  let nextOverrides = [...sheet.factOverrides]

  for (const row of sheet.rows) {
    const emp = employees.find((e) => e.id === row.employeeId)
    if (!rowMatchesCopyScope(row, emp, scope, brigade)) continue

    touchedRowIds.push(row.id)
    if (row.employeeId) touchedEmployeeIds.push(row.employeeId)

    nextFact[row.id] = { ...(sheet.plan[row.id] ?? {}) }
    nextOverrides = nextOverrides.filter((k) => !k.startsWith(`${row.id}|`))
  }

  if (!touchedRowIds.length) return sheet

  const rowPrefixes = touchedRowIds.map((id) => `${id}|`)
  const empPrefixes = touchedEmployeeIds.map((id) => `${id}|`)

  return {
    ...sheet,
    fact: nextFact,
    factOverrides: nextOverrides,
    factExtraHours: omitKeysByPrefixes(sheet.factExtraHours, rowPrefixes),
    factHoursOverride: omitKeysByPrefixes(sheet.factHoursOverride, rowPrefixes),
    substitutions: omitKeysByPrefixes(sheet.substitutions, rowPrefixes),
    dayTransfers: omitKeysByPrefixes(sheet.dayTransfers, empPrefixes),
  }
}

/** Сколько людей попадёт под массовое копирование план→факт. */
export function countCopyPlanToFactPeople(
  sheet: MonthSheet,
  employees: AppStore['employees'],
  scope: CopyPlanToFactScope,
  brigade?: string,
): number {
  let n = 0
  for (const row of sheet.rows) {
    const emp = employees.find((e) => e.id === row.employeeId)
    if (!rowMatchesCopyScope(row, emp, scope, brigade)) continue
    n += 1
  }
  return n
}

/**
 * Мягкий копир: план → факт только там, где факт ещё не задан явно
 * (нет override). Уже введённый факт, +часы, замены не трогает.
 */
export function copyPlanToFactEmptyOnly(
  sheet: MonthSheet,
  employees: AppStore['employees'],
  scope: CopyPlanToFactScope,
  brigade?: string,
): { sheet: MonthSheet; filledCells: number; people: number } {
  const { year, month } = parseMonthKey(sheet.month)
  const days = daysInMonth(year, month)
  const nextFact: MonthSheet['fact'] = { ...sheet.fact }
  const overrideSet = new Set(sheet.factOverrides)
  let filledCells = 0
  let people = 0

  for (const row of sheet.rows) {
    const emp = employees.find((e) => e.id === row.employeeId)
    if (!rowMatchesCopyScope(row, emp, scope, brigade)) continue

    const planRow = sheet.plan[row.id] ?? {}
    const factRow = { ...(nextFact[row.id] ?? {}) }
    let touched = false

    for (let d = 1; d <= days; d++) {
      const dk = dayDateKey(year, month, d)
      const oKey = `${row.id}|${dk}`
      if (overrideSet.has(oKey)) continue
      const planCode = planRow[dk] ?? ''
      if (!planCode) continue
      factRow[dk] = planCode
      overrideSet.add(oKey)
      filledCells += 1
      touched = true
    }

    if (touched) {
      nextFact[row.id] = factRow
      people += 1
    }
  }

  if (filledCells === 0) {
    return { sheet, filledCells: 0, people: 0 }
  }

  return {
    sheet: {
      ...sheet,
      fact: nextFact,
      factOverrides: [...overrideSet],
    },
    filledCells,
    people,
  }
}

/** Сколько пустых (без override) ячеек заполнит мягкий копир. */
export function countCopyPlanToFactEmptyCells(
  sheet: MonthSheet,
  employees: AppStore['employees'],
  scope: CopyPlanToFactScope,
  brigade?: string,
): { cells: number; people: number } {
  const r = copyPlanToFactEmptyOnly(sheet, employees, scope, brigade)
  return { cells: r.filledCells, people: r.people }
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
