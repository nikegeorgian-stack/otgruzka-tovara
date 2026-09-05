import type { DayCode, Employee, ScheduleType, ShiftMode } from './types'

export const SCHEDULE_OPTIONS: { value: ScheduleType; label: string }[] = [
  { value: '5/2 8ч', label: '5/2 8ч' },
  { value: '2/2 11ч', label: '2/2 11ч' },
  { value: '1/1 11ч', label: '1/1 11ч (через день)' },
]

/** Варианты длительности смены для графика 5/2. */
export const SHIFT_HOURS_OPTIONS_52 = [4, 6, 8] as const

/** Варианты длительности смены для графика 2/2. */
export const SHIFT_HOURS_OPTIONS_22 = [4, 8, 10, 11, 12] as const

export function is52Schedule(schedule: ScheduleType): boolean {
  return schedule === '5/2 8ч'
}

export function is22Schedule(schedule: ScheduleType): boolean {
  return schedule === '2/2 11ч'
}

/** Госпраздники Грузии → «В» только для 5/2; на 2/2 и 1/1 не влияют. */
export function scheduleObservesPublicHolidays(schedule: ScheduleType): boolean {
  return is52Schedule(schedule)
}

export function supportsShiftHours(schedule: ScheduleType): boolean {
  return is52Schedule(schedule) || is22Schedule(schedule)
}

export function defaultShiftHours(schedule: ScheduleType): number {
  if (is52Schedule(schedule)) return 8
  if (is22Schedule(schedule) || schedule === '1/1 11ч') return 11
  return 8
}

export function effectiveShiftHours(
  emp: Pick<Employee, 'schedule' | 'shiftHours'>,
): number {
  const def = defaultShiftHours(emp.schedule)
  const h = emp.shiftHours
  if (h == null || !Number.isFinite(h) || h <= 0) return def
  return h
}

export function scheduleDisplayLabel(
  emp: Pick<Employee, 'schedule' | 'shiftHours'>,
): string {
  const h = effectiveShiftHours(emp)
  const def = defaultShiftHours(emp.schedule)
  if (h === def) return emp.schedule
  if (is52Schedule(emp.schedule)) return `5/2 ${h}ч`
  if (is22Schedule(emp.schedule)) return `2/2 ${h}ч`
  if (emp.schedule === '1/1 11ч') return `1/1 ${h}ч`
  return emp.schedule
}

export function workCodeForHours(hours: number, shiftMode?: ShiftMode): DayCode {
  if (shiftMode === 'night') return 'Н'
  const map: Record<number, DayCode> = {
    4: '4',
    6: '6',
    8: '8',
    10: '10',
    11: '11',
    12: '12',
  }
  return map[hours] ?? '8'
}

export function isCyclicSchedule(schedule: ScheduleType): boolean {
  return schedule === '2/2 11ч' || schedule === '1/1 11ч'
}

export function usesShiftMode(schedule: ScheduleType): boolean {
  return schedule === '2/2 11ч' || schedule === '1/1 11ч'
}

export function usesGroup2x2(schedule: ScheduleType): boolean {
  return schedule === '2/2 11ч' || schedule === '1/1 11ч'
}

export function scheduleShortLabel(schedule: ScheduleType): string {
  if (schedule === '5/2 8ч') return '5/2'
  if (schedule === '1/1 11ч') return '1/1'
  return '2/2'
}
