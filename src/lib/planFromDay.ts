import { dayDateKey, parseMonthKey } from './dates'
import { isCyclicSchedule } from './schedules'
import { autoCodeForDay, isEmployeeAvailableOnDay } from './schedule'
import type { DayCode, Employee, Group2x2, MonthSheet, ScheduleType, ShiftMode } from './types'

function unavailableCode(emp: Employee): DayCode {
  const st = emp.employmentStatus ?? 'active'
  if (st === 'vacation' || st === 'maternity') return 'ОТ'
  return ''
}

export function rebuildPlanFromDay(
  sheet: MonthSheet,
  rowId: string,
  employee: Employee,
  fromDay: number,
): MonthSheet {
  const { year, month } = parseMonthKey(sheet.month)
  const daysInMonth = new Date(year, month, 0).getDate()
  const startDay = Math.max(1, Math.min(fromDay, daysInMonth))

  const existingPlan = sheet.plan[rowId] ?? {}
  const nextPlan = { ...existingPlan }
  const nextFact = { ...sheet.fact }
  const factRow = { ...(nextFact[rowId] ?? {}) }

  for (let d = startDay; d <= daysInMonth; d++) {
    const key = dayDateKey(year, month, d)
    let code: DayCode
    if (!isEmployeeAvailableOnDay(employee, key)) {
      code = unavailableCode(employee)
    } else {
      code = autoCodeForDay(
        employee.schedule,
        employee.cycleStart,
        year,
        month,
        d,
        employee.shiftMode ?? 'day',
      )
    }
    nextPlan[key] = code
    const oKey = `${rowId}|${key}`
    if (!sheet.factOverrides.includes(oKey)) {
      factRow[key] = code
    }
  }

  nextFact[rowId] = factRow
  return { ...sheet, plan: { ...sheet.plan, [rowId]: nextPlan }, fact: nextFact }
}

export function employeeWithScheduleFromDay(
  emp: Employee,
  schedule: ScheduleType,
  fromDay: number,
  monthKeyStr: string,
): Employee {
  return employeeWithAttributesFromDay(emp, { schedule }, fromDay, monthKeyStr)
}

/** Старт цикла: группа Б смещена относительно А (2/2 — 2 дня, 1/1 — 1 день). */
export function cycleStartForGroup(
  schedule: ScheduleType,
  group: 'А' | 'Б',
  year: number,
  month: number,
  anchorDay: number,
): string {
  const base = new Date(year, month - 1, anchorDay)
  if (group === 'Б') {
    const offset = schedule === '1/1 11ч' ? 1 : 2
    base.setDate(base.getDate() - offset)
  }
  return dayDateKey(base.getFullYear(), base.getMonth() + 1, base.getDate())
}

/**
 * Старт цикла относительно конкретного дня:
 * - 'first' — день первый рабочий в смене (работает этот и следующие дни блока);
 * - 'last' — день последний рабочий (дальше выходные, затем цикл продолжается).
 */
export function cycleStartFromDay(
  schedule: ScheduleType,
  year: number,
  month: number,
  day: number,
  variant: 'first' | 'last',
): string {
  const base = new Date(year, month - 1, day)
  if (variant === 'last') {
    const workDays = schedule === '1/1 11ч' ? 1 : 2
    base.setDate(base.getDate() - (workDays - 1))
  }
  return dayDateKey(base.getFullYear(), base.getMonth() + 1, base.getDate())
}

/** @deprecated используйте cycleStartForGroup */
export function cycleStartFor2x2Group(
  group: 'А' | 'Б',
  year: number,
  month: number,
  anchorDay: number,
): string {
  return cycleStartForGroup('2/2 11ч', group, year, month, anchorDay)
}

export function employeeWithAttributesFromDay(
  emp: Employee,
  attrs: Partial<Pick<Employee, 'schedule' | 'group2x2' | 'shiftMode'>>,
  fromDay: number,
  monthKeyStr: string,
): Employee {
  const { year, month } = parseMonthKey(monthKeyStr)
  const next: Employee = { ...emp, ...attrs }
  const schedule = attrs.schedule ?? emp.schedule
  const scheduleChanged = attrs.schedule !== undefined
  const attrsTouched =
    scheduleChanged || attrs.group2x2 !== undefined || attrs.shiftMode !== undefined
  if ((schedule === '2/2 11ч' || schedule === '1/1 11ч') && attrsTouched) {
    const group = (attrs.group2x2 ?? next.group2x2) as 'А' | 'Б' | ''
    next.cycleStart =
      group === 'А' || group === 'Б'
        ? cycleStartForGroup(schedule, group, year, month, fromDay)
        : dayDateKey(year, month, fromDay)
  } else if (isCyclicSchedule(schedule) && scheduleChanged && !next.cycleStart) {
    next.cycleStart = dayDateKey(year, month, fromDay)
  }
  return next
}

export type EmployeeShiftPatch = {
  schedule?: ScheduleType
  group2x2?: Group2x2
  shiftMode?: ShiftMode
}
