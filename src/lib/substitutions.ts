import { setCellComment } from './bulkOps'
import type { DayCode, DaySubstitution, Employee, MonthSheet } from './types'

export const ABSENCE_CODES: DayCode[] = ['Б', 'ОТ', 'ОО', 'В', 'X', 'ПР']
export const SUBSTITUTE_WORK_CODES: DayCode[] = ['8', '11', 'Н', '22']

export function substitutionKey(rowId: string, dateKey: string): string {
  return `${rowId}|${dateKey}`
}

export function getSubstitution(
  sheet: MonthSheet,
  rowId: string,
  dateKey: string,
): DaySubstitution | undefined {
  return sheet.substitutions[substitutionKey(rowId, dateKey)]
}

function ensureOverride(overrides: string[], rowId: string, dateKey: string): string[] {
  const oKey = substitutionKey(rowId, dateKey)
  return overrides.includes(oKey) ? overrides : [...overrides, oKey]
}

function setFactCode(
  sheet: MonthSheet,
  rowId: string,
  dateKey: string,
  code: DayCode,
): MonthSheet {
  const fact = { ...sheet.fact }
  const row = { ...(fact[rowId] ?? {}) }
  row[dateKey] = code
  fact[rowId] = row
  return {
    ...sheet,
    fact,
    factOverrides: ensureOverride(sheet.factOverrides, rowId, dateKey),
  }
}

export function defaultSubstituteCode(
  sheet: MonthSheet,
  substituteRowId: string,
  dateKey: string,
): DayCode {
  const plan = sheet.plan[substituteRowId]?.[dateKey]
  if (plan && SUBSTITUTE_WORK_CODES.includes(plan)) return plan
  const fact = sheet.fact[substituteRowId]?.[dateKey]
  if (fact && SUBSTITUTE_WORK_CODES.includes(fact)) return fact
  return '8'
}

export function findRowByEmployeeId(
  sheet: MonthSheet,
  employeeId: string,
): string | undefined {
  return sheet.rows.find((r) => r.employeeId === employeeId)?.id
}

export type ApplySubstitutionResult = {
  sheet: MonthSheet
  /** substitute has no row in this month */
  warningNoRow?: boolean
}

export function applySubstitution(
  sheet: MonthSheet,
  employees: Employee[],
  absentRowId: string,
  dateKey: string,
  sub: DaySubstitution,
): ApplySubstitutionResult {
  const key = substitutionKey(absentRowId, dateKey)
  let next = setFactCode(sheet, absentRowId, dateKey, sub.absentCode)

  const subRowId = findRowByEmployeeId(next, sub.substituteEmployeeId)
  let warningNoRow = false
  if (subRowId) {
    next = setFactCode(next, subRowId, dateKey, sub.substituteCode)
  } else {
    warningNoRow = true
  }

  const subEmp = employees.find((e) => e.id === sub.substituteEmployeeId)
  const autoComment =
    sub.note?.trim() ||
    (subEmp ? `Замена: ${subEmp.fullName} (${sub.substituteCode})` : '')
  if (autoComment) {
    next = setCellComment(next, absentRowId, dateKey, autoComment)
  }

  next = {
    ...next,
    substitutions: { ...next.substitutions, [key]: sub },
  }

  return { sheet: next, warningNoRow }
}

export function clearSubstitution(
  sheet: MonthSheet,
  rowId: string,
  dateKey: string,
): MonthSheet {
  const key = substitutionKey(rowId, dateKey)
  if (!sheet.substitutions[key]) return sheet
  const substitutions = { ...sheet.substitutions }
  delete substitutions[key]
  return { ...sheet, substitutions }
}

export function substitutionLabel(
  sheet: MonthSheet,
  employees: Employee[],
  rowId: string,
  dateKey: string,
): string | undefined {
  const sub = getSubstitution(sheet, rowId, dateKey)
  if (!sub) return undefined
  const emp = employees.find((e) => e.id === sub.substituteEmployeeId)
  const name = emp?.fullName ?? '—'
  return `${sub.absentCode} → ${name}, ${sub.substituteCode}`
}
