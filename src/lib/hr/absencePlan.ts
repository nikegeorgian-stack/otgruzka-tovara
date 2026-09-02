import { hoursForCode } from '@/lib/codes'
import { dayDateKey } from '@/lib/dates'
import { isWorkCode } from '@/lib/factExtra'
import {
  autoCodeForDay,
  resolveCycleStart,
} from '@/lib/schedule'
import { effectiveShiftHours } from '@/lib/schedules'
import type { DayCode, Employee, HrAbsenceType } from '@/lib/types'
import { isScheduledWorkDay } from './sickWorkDays'

const ABSENCE_TO_CODE: Partial<Record<HrAbsenceType, DayCode>> = {
  vacation: 'ОТ',
  sick: 'Б',
}

/**
 * Код табеля для HR-отсутствия на дату.
 * Больничный «Б» и отпуск «ОТ» — только в дни смены по графику
 * (выходные/праздники остаются «В»).
 */
export function absenceCodeForDate(emp: Employee, dateKey: string): DayCode | null {
  let found: DayCode | null = null
  for (const a of emp.hrAbsences ?? []) {
    if (dateKey < a.startDate || dateKey > a.endDate) continue
    const code = ABSENCE_TO_CODE[a.type]
    if (!code) continue
    if (
      (a.type === 'sick' || a.type === 'vacation') &&
      !isScheduledWorkDay(emp, dateKey)
    ) {
      continue
    }
    found = code
  }
  return found
}

/**
 * Часы плана для ячейки: для Б/ОТ/ОО берём норму смены по графику
 * (чтобы в итоге плана часы считались, хотя в ячейке — больничный/отпуск).
 */
export function planHoursForCode(
  emp: Employee,
  year: number,
  month: number,
  day: number,
  code: DayCode,
): number {
  if (code === 'Б' || code === 'ОТ' || code === 'ОО') {
    const cycleStart = resolveCycleStart(emp, year, month)
    const workCode = autoCodeForDay(
      emp.schedule,
      cycleStart,
      year,
      month,
      day,
      emp.shiftMode ?? 'day',
      effectiveShiftHours(emp),
    )
    if (isWorkCode(workCode)) return hoursForCode(workCode)
    return 0
  }
  return hoursForCode(code)
}

export function sumPlanHours(
  emp: Employee,
  plan: Record<string, DayCode>,
  year: number,
  month: number,
  days: number,
  asOfDate?: string,
): number {
  let total = 0
  for (let d = 1; d <= days; d++) {
    const key = dayDateKey(year, month, d)
    if (asOfDate && key > asOfDate) continue
    total += planHoursForCode(emp, year, month, d, plan[key] ?? '')
  }
  return total
}
