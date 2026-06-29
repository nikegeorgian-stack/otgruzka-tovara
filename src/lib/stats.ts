import { hoursForCode } from './codes'
import { daysInMonth, parseMonthKey } from './dates'
import { getFactExtraHours } from './factExtra'
import { NO_STRUCTURAL_UNIT_ID } from './monthViewOptions'
import type { DayCode, Employee, MonthSheet } from './types'

export type RowStats = {
  planHours: number
  factHours: number
  planShifts: number
  factShifts: number
  v: number
  ot: number
  oo: number
  b: number
  x: number
  pr: number
  mismatches: number
}

export type MonthStats = {
  planHours: number
  factHours: number
  deviation: number
  fillRate: number
  mismatches: number
  absences: number
  factShifts: number
  readiness: 'ready' | 'review' | 'incomplete'
  control: 'ok' | 'mismatch'
}

function countCode(marks: Record<string, DayCode>, code: DayCode): number {
  return Object.values(marks).filter((c) => c === code).length
}

function sumHours(marks: Record<string, DayCode>): number {
  return Object.values(marks).reduce((s, c) => s + hoursForCode(c), 0)
}

function workShifts(marks: Record<string, DayCode>): number {
  return Object.values(marks).filter((c) => c === '8' || c === '11' || c === 'Н' || c === '22').length
}

export function getFactMark(
  sheet: MonthSheet,
  rowId: string,
  dateKey: string,
): DayCode {
  const overrideKey = `${rowId}|${dateKey}`
  if (sheet.factOverrides.includes(overrideKey)) {
    return sheet.fact[rowId]?.[dateKey] ?? ''
  }
  return sheet.fact[rowId]?.[dateKey] ?? sheet.plan[rowId]?.[dateKey] ?? ''
}

export function rowStats(
  sheet: MonthSheet,
  rowId: string,
  days: number,
  year: number,
  month: number,
): RowStats {
  const plan = sheet.plan[rowId] ?? {}
  let factHours = 0
  let factShifts = 0
  let mismatches = 0
  const factAgg: Record<string, DayCode> = {}

  for (let d = 1; d <= days; d++) {
    const key = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const p = plan[key] ?? ''
    const f = getFactMark(sheet, rowId, key)
    factAgg[key] = f
    factHours += hoursForCode(f) + getFactExtraHours(sheet, rowId, key)
    if (f === '8' || f === '11' || f === 'Н' || f === '22') factShifts++
    if (p !== f) mismatches++
  }

  return {
    planHours: sumHours(plan),
    factHours,
    planShifts: workShifts(plan),
    factShifts,
    v: countCode(plan, 'В'),
    ot: countCode(factAgg, 'ОТ'),
    oo: countCode(factAgg, 'ОО'),
    b: countCode(factAgg, 'Б'),
    x: countCode(factAgg, 'X'),
    pr: countCode(factAgg, 'ПР'),
    mismatches,
  }
}

export type MonthStatsFilter = {
  brigades?: string[]
  structuralUnitIds?: string[]
}

export function monthStats(
  sheet: MonthSheet,
  employees: Employee[],
  filter?: MonthStatsFilter | string[],
): MonthStats {
  const { year, month } = parseMonthKey(sheet.month)
  const days = daysInMonth(year, month)
  let planHours = 0
  let factHours = 0
  let mismatches = 0
  let absences = 0
  let factShifts = 0
  let filled = 0
  let total = 0

  const brigadeList = Array.isArray(filter) ? filter : filter?.brigades
  const unitList = Array.isArray(filter) ? undefined : filter?.structuralUnitIds
  const brigadeSet = brigadeList?.length ? new Set(brigadeList) : null
  const unitSet = unitList?.length ? new Set(unitList) : null

  for (const row of sheet.rows) {
    if (brigadeSet && !brigadeSet.has(row.brigade)) continue
    if (!row.employeeId) continue
    const emp = employees.find((e) => e.id === row.employeeId)
    if (!emp?.active) continue
    if (unitSet) {
      const unitKey = emp.structuralUnitId ?? NO_STRUCTURAL_UNIT_ID
      if (!unitSet.has(unitKey)) continue
    }
    const rs = rowStats(sheet, row.id, days, year, month)
    planHours += rs.planHours
    factHours += rs.factHours
    mismatches += rs.mismatches
    absences += rs.ot + rs.oo + rs.b + rs.x + rs.pr
    factShifts += rs.factShifts
    for (let d = 1; d <= days; d++) {
      total++
      const key = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      if (getFactMark(sheet, row.id, key)) filled++
    }
  }

  const fillRate = total ? filled / total : 0
  const deviation = factHours - planHours

  return {
    planHours,
    factHours,
    deviation,
    fillRate,
    mismatches,
    absences,
    factShifts,
    readiness:
      fillRate >= 0.98 ? 'ready' : fillRate >= 0.8 ? 'review' : 'incomplete',
    control: mismatches === 0 ? 'ok' : 'mismatch',
  }
}
