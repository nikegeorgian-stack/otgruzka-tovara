import { dayDateKey, daysInMonth, parseMonthKey } from './dates'
import { findRowByEmployeeId } from './substitutions'
import { getFactMark } from './stats'
import type { AppStore, MonthSheet } from './types'

export type MonthProblem = {
  id: string
  severity: 'warn' | 'info'
  messageKey: string
  count?: number
}

export function monthProblems(store: AppStore, sheet: MonthSheet): MonthProblem[] {
  const problems: MonthProblem[] = []
  const { year, month } = parseMonthKey(sheet.month)
  const days = daysInMonth(year, month)

  let mismatches = 0
  let emptyRows = 0
  let unfilled = 0
  let substitutionNoRow = 0

  for (const sub of Object.values(sheet.substitutions ?? {})) {
    if (!findRowByEmployeeId(sheet, sub.substituteEmployeeId)) substitutionNoRow++
  }

  for (const row of sheet.rows) {
    if (!row.employeeId) {
      emptyRows++
      continue
    }
    const emp = store.employees.find((e) => e.id === row.employeeId)
    if (!emp) continue

    for (let d = 1; d <= days; d++) {
      const dk = dayDateKey(year, month, d)
      const plan = sheet.plan[row.id]?.[dk] ?? ''
      const fact = getFactMark(sheet, row.id, dk)
      if (plan !== fact) mismatches++
      if (!fact && !plan) unfilled++
    }
  }

  if (mismatches > 0) {
    problems.push({
      id: 'mismatches',
      severity: 'warn',
      messageKey: 'problems.mismatches',
      count: mismatches,
    })
  }
  if (emptyRows > 0) {
    problems.push({
      id: 'emptyRows',
      severity: 'info',
      messageKey: 'problems.emptyRows',
      count: emptyRows,
    })
  }
  if (unfilled > 5) {
    problems.push({
      id: 'unfilled',
      severity: 'info',
      messageKey: 'problems.unfilled',
      count: unfilled,
    })
  }
  if (substitutionNoRow > 0) {
    problems.push({
      id: 'substitutionNoRow',
      severity: 'warn',
      messageKey: 'problems.substitutionNoRow',
      count: substitutionNoRow,
    })
  }

  const fillRate =
    sheet.rows.filter((r) => r.employeeId).length /
    Math.max(1, sheet.rows.length)
  if (fillRate < 0.5) {
    problems.push({
      id: 'lowFill',
      severity: 'warn',
      messageKey: 'problems.lowFill',
    })
  }

  return problems
}
