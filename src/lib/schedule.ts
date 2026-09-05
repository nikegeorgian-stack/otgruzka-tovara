import type { DayCode, Employee, MonthRowBounds, ScheduleType, ShiftMode } from './types'
import { hoursForCode, isWorkDayCode } from './codes'
import { dayDateKey, parseMonthKey } from './dates'
import { absenceCodeForDate } from './hr/absencePlan'
import { isGeorgiaPublicHoliday } from './georgiaCalendar'
import { isRowActiveOnDay } from './rowPeriod'
import {
  defaultShiftHours,
  effectiveShiftHours,
  is52Schedule,
  workCodeForHours,
} from './schedules'

/**
 * Доступен ли сотрудник «по статусу занятость» вне HR-отсутствий.
 * Больничный/отпуск в табеле ведут hrAbsences (absenceCodeForDate), а не этот флаг.
 * maternity — только legacy/декрет без записи в absences.
 */
export function isEmployeeAvailableOnDay(emp: Employee, dateKey: string): boolean {
  if (!emp.active) return false
  const st = emp.employmentStatus ?? 'active'
  if (st === 'terminated') return false
  if (st === 'maternity' && emp.statusUntil) {
    if (dateKey <= emp.statusUntil) return false
  }
  return true
}

function unavailableCode(emp: Employee): DayCode {
  const st = emp.employmentStatus ?? 'active'
  if (st === 'maternity') return 'ОТ'
  return ''
}

function weekdayMonFirst(year: number, month: number, day: number): number {
  const d = new Date(year, month - 1, day).getDay()
  return d === 0 ? 7 : d
}

function daysBetween(a: Date, b: Date): number {
  const ms = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
    Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
  return Math.round(ms / 86400000)
}

function workCode2x2(shiftMode: ShiftMode | undefined, shiftHours: number): DayCode {
  return workCodeForHours(shiftHours, shiftMode)
}

/** Старт цикла 2/2 или 1/1 для группы А/Б относительно якорного дня месяца. */
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

/** День в периоде работы (приём / увольнение). */
export function isEmployedOnDay(emp: Employee, dateKey: string): boolean {
  const hire = emp.hireDate?.trim()
  if (hire && dateKey < hire) return false
  const term = emp.terminationDate?.trim()
  if (term && dateKey > term) return false
  if ((emp.hrStatus ?? 'active') === 'fired' || emp.employmentStatus === 'terminated') {
    if (term) return dateKey <= term
    return false
  }
  return true
}

/**
 * Старт цикла смен: явный cycleStart → hireDate → группа А/Б → 1-е число месяца.
 * Без этого график 2/2 даёт пустые ячейки.
 */
/**
 * Старт цикла для нормы ЗП за полный месяц — без привязки к hireDate
 * (иначе при приёме с 10-го норма сжимается вместе с планом).
 */
export function resolveCycleStartForMonthNorm(
  emp: Pick<Employee, 'schedule' | 'group2x2' | 'cycleStart'>,
  year: number,
  month: number,
): string {
  const explicit = emp.cycleStart?.trim()
  if (explicit) return explicit

  const group = emp.group2x2
  if (
    (group === 'А' || group === 'Б') &&
    (emp.schedule === '2/2 11ч' || emp.schedule === '1/1 11ч')
  ) {
    return cycleStartForGroup(emp.schedule, group, year, month, 1)
  }

  if (emp.schedule === '2/2 11ч' || emp.schedule === '1/1 11ч') {
    return dayDateKey(year, month, 1)
  }

  return ''
}

export function resolveCycleStart(emp: Employee, year: number, month: number): string {
  const explicit = emp.cycleStart?.trim()
  if (explicit) return explicit

  const hire = emp.hireDate?.trim()
  if (hire && (emp.schedule === '2/2 11ч' || emp.schedule === '1/1 11ч')) {
    return hire
  }

  return resolveCycleStartForMonthNorm(emp, year, month)
}

/**
 * Полная норма часов по графику за календарный месяц (будни / цикл 2/2),
 * без усечения по дате приёма, увольнения и периоду строки.
 * Ставка оклада: monthlySalary / fullScheduleMonthHours.
 */
export function fullScheduleMonthHours(
  emp: Pick<Employee, 'schedule' | 'shiftHours' | 'group2x2' | 'shiftMode' | 'cycleStart'>,
  year: number,
  month: number,
): number {
  const days = new Date(year, month, 0).getDate()
  const cycleStart = resolveCycleStartForMonthNorm(emp, year, month)
  const shiftH = effectiveShiftHours(emp)
  let total = 0
  for (let d = 1; d <= days; d++) {
    const code = autoCodeForDay(
      emp.schedule,
      cycleStart,
      year,
      month,
      d,
      emp.shiftMode ?? 'day',
      shiftH,
    )
    if (isWorkDayCode(code)) total += hoursForCode(code)
  }
  return total
}

export function autoCodeForDay(
  schedule: ScheduleType,
  cycleStart: string,
  year: number,
  month: number,
  day: number,
  shiftMode?: ShiftMode,
  shiftHours?: number,
): DayCode {
  const hours = shiftHours ?? defaultShiftHours(schedule)
  const dateKey = dayDateKey(year, month, day)

  if (is52Schedule(schedule)) {
    // 5/2: гос. праздник = выходной «В» (даже если выпал на будний день)
    if (isGeorgiaPublicHoliday(dateKey)) return 'В'
    return weekdayMonFirst(year, month, day) <= 5
      ? workCodeForHours(hours, shiftMode)
      : 'В'
  }
  // 2/2 и 1/1: праздники не влияют — только цикл смен
  if (schedule === '2/2 11ч') {
    if (!cycleStart) return ''
    const start = new Date(cycleStart + 'T12:00:00')
    const current = new Date(year, month - 1, day)
    const mod = ((daysBetween(start, current) % 4) + 4) % 4
    return mod < 2 ? workCode2x2(shiftMode, hours) : 'В'
  }
  if (schedule === '1/1 11ч') {
    if (!cycleStart) return ''
    const start = new Date(cycleStart + 'T12:00:00')
    const current = new Date(year, month - 1, day)
    const mod = ((daysBetween(start, current) % 2) + 2) % 2
    return mod === 0 ? workCode2x2(shiftMode, hours) : 'В'
  }
  return ''
}

/**
 * План месяца:
 * 1) период строки / приём-увольнение
 * 2) HR-отсутствия (больничный «Б» только в рабочие дни графика)
 * 3) legacy maternity без absences
 * 4) график
 */
export function buildPlanRow(
  employee: Employee,
  monthKey: string,
  rowBounds?: MonthRowBounds,
): Record<string, DayCode> {
  const { year, month } = parseMonthKey(monthKey)
  const days = new Date(year, month, 0).getDate()
  const row: Record<string, DayCode> = {}
  const cycleStart = resolveCycleStart(employee, year, month)
  for (let d = 1; d <= days; d++) {
    const key = dayDateKey(year, month, d)
    if (!isRowActiveOnDay(employee, key, rowBounds)) {
      row[key] = ''
      continue
    }
    const absenceCode = absenceCodeForDate(employee, key)
    if (absenceCode) {
      row[key] = absenceCode
      continue
    }
    if (!isEmployeeAvailableOnDay(employee, key)) {
      row[key] = unavailableCode(employee)
      continue
    }
    row[key] = autoCodeForDay(
      employee.schedule,
      cycleStart,
      year,
      month,
      d,
      employee.shiftMode ?? 'day',
      effectiveShiftHours(employee),
    )
  }
  return row
}
