import type { ScheduleType } from './types'

export const SCHEDULE_OPTIONS: { value: ScheduleType; label: string }[] = [
  { value: '5/2 8ч', label: '5/2 8ч' },
  { value: '2/2 11ч', label: '2/2 11ч' },
  { value: '1/1 11ч', label: '1/1 11ч (через день)' },
]

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
