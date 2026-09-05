import { monthKey, parseMonthKey } from './dates'
import { syncPlanRow } from './monthSheet'
import { buildPlanRow, resolveCycleStart } from './schedule'
import { isCyclicSchedule, is52Schedule } from './schedules'
import { WORK_DAY_CODES } from './codes'
import type { DayCode, Employee, MonthSheet } from './types'

function hasWorkCodes(plan: Record<string, DayCode> | undefined): boolean {
  if (!plan) return false
  return Object.values(plan).some((c) => WORK_DAY_CODES.has(c))
}

/** Записать cycleStart в карточку, если график цикличный, а дата не задана. */
export function withScheduleDefaults(emp: Employee, refMonthKey?: string): Employee {
  if (!isCyclicSchedule(emp.schedule)) return emp
  if (emp.cycleStart?.trim()) return emp

  const now = new Date()
  const mk =
    refMonthKey ??
    monthKey(now.getFullYear(), now.getMonth() + 1)
  const { year, month } = parseMonthKey(mk)
  const cycleStart = resolveCycleStart(emp, year, month)
  if (!cycleStart) return emp
  return { ...emp, cycleStart }
}

/** План пустой или без рабочих смен, хотя по графику они должны быть. */
export function planRowNeedsRepair(
  sheet: MonthSheet,
  rowId: string,
  emp: Employee,
): boolean {
  if (is52Schedule(emp.schedule)) {
    return !hasWorkCodes(sheet.plan[rowId])
  }
  if (!isCyclicSchedule(emp.schedule)) return false

  const built = buildPlanRow(emp, sheet.month)
  if (!hasWorkCodes(built)) return false
  return !hasWorkCodes(sheet.plan[rowId])
}

/** Пересчитать строки с «битым» планом (типично: нет cycleStart при сохранении). */
export function repairMonthSheetPlans(
  sheet: MonthSheet,
  employees: Employee[],
): MonthSheet {
  // После админской очистки пустой план — намеренный, не «лечить» из графиков.
  if (sheet.resetAt) return sheet

  const byId = new Map(employees.map((e) => [e.id, e]))
  let next = sheet
  let changed = false

  for (const row of sheet.rows) {
    if (!row.employeeId) continue
    const emp = byId.get(row.employeeId)
    if (!emp || !planRowNeedsRepair(next, row.id, emp)) continue
    next = syncPlanRow(next, row.id, emp)
    changed = true
  }

  return changed ? next : sheet
}

/** Дополнить cycleStart у всех сотрудников с циклическим графиком. */
export function healEmployeeScheduleCatalog(
  employees: Employee[],
  refMonthKey?: string,
): Employee[] {
  return employees.map((e) => withScheduleDefaults(e, refMonthKey))
}
