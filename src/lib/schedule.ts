import type { DayCode, Employee, ScheduleType, ShiftMode } from './types'
import { dayDateKey, parseMonthKey } from './dates'
import { isGeorgiaPublicHoliday } from './georgiaCalendar'

export function isEmployeeAvailableOnDay(emp: Employee, dateKey: string): boolean {
  if (!emp.active) return false
  const st = emp.employmentStatus ?? 'active'
  if (st === 'terminated') return false
  if ((st === 'vacation' || st === 'maternity') && emp.statusUntil) {
    if (dateKey <= emp.statusUntil) return false
  }
  return true
}

function unavailableCode(emp: Employee): DayCode {
  const st = emp.employmentStatus ?? 'active'
  if (st === 'vacation' || st === 'maternity') return 'ОТ'
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

function workCode2x2(shiftMode: ShiftMode | undefined): DayCode {
  return shiftMode === 'night' ? 'Н' : '11'
}

export function autoCodeForDay(
  schedule: ScheduleType,
  cycleStart: string,
  year: number,
  month: number,
  day: number,
  shiftMode?: ShiftMode,
): DayCode {
  const dateKey = dayDateKey(year, month, day)

  if (isGeorgiaPublicHoliday(dateKey)) {
    return 'В'
  }

  if (schedule === '5/2 8ч') {
    return weekdayMonFirst(year, month, day) <= 5 ? '8' : 'В'
  }
  if (schedule === '2/2 11ч') {
    if (!cycleStart) return ''
    const start = new Date(cycleStart + 'T12:00:00')
    const current = new Date(year, month - 1, day)
    const mod = ((daysBetween(start, current) % 4) + 4) % 4
    return mod < 2 ? workCode2x2(shiftMode) : 'В'
  }
  if (schedule === '1/1 11ч') {
    if (!cycleStart) return ''
    const start = new Date(cycleStart + 'T12:00:00')
    const current = new Date(year, month - 1, day)
    const mod = ((daysBetween(start, current) % 2) + 2) % 2
    return mod === 0 ? workCode2x2(shiftMode) : 'В'
  }
  return ''
}

export function buildPlanRow(
  employee: Employee,
  monthKey: string,
): Record<string, DayCode> {
  const { year, month } = parseMonthKey(monthKey)
  const days = new Date(year, month, 0).getDate()
  const row: Record<string, DayCode> = {}
  for (let d = 1; d <= days; d++) {
    const key = dayDateKey(year, month, d)
    if (!isEmployeeAvailableOnDay(employee, key)) {
      row[key] = unavailableCode(employee)
      continue
    }
    row[key] = autoCodeForDay(
      employee.schedule,
      employee.cycleStart,
      year,
      month,
      d,
      employee.shiftMode ?? 'day',
    )
  }
  return row
}
