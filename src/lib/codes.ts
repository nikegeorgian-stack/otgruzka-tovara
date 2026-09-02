import type { DayCode } from './types'

export type CodeDef = {
  code: DayCode
  hours: number
  categoryKey: string
  labelKey: string
  schedule?: string
}

export const CODE_DEFS: CodeDef[] = [
  { code: '4', hours: 4, categoryKey: 'code.cat.work', labelKey: 'code.label.4', schedule: '5/2, 2/2' },
  { code: '6', hours: 6, categoryKey: 'code.cat.work', labelKey: 'code.label.6', schedule: '5/2' },
  { code: '8', hours: 8, categoryKey: 'code.cat.work', labelKey: 'code.label.8', schedule: '5/2 8ч' },
  { code: '10', hours: 10, categoryKey: 'code.cat.work', labelKey: 'code.label.10', schedule: '2/2' },
  { code: '11', hours: 11, categoryKey: 'code.cat.work', labelKey: 'code.label.11', schedule: '2/2 11ч, 1/1 11ч' },
  { code: '12', hours: 12, categoryKey: 'code.cat.work', labelKey: 'code.label.12', schedule: '2/2' },
  { code: 'Н', hours: 11, categoryKey: 'code.cat.night', labelKey: 'code.label.Н' },
  { code: '22', hours: 22, categoryKey: 'code.cat.overtime', labelKey: 'code.label.22' },
  { code: 'ОТ', hours: 0, categoryKey: 'code.cat.absence', labelKey: 'code.label.ОТ' },
  { code: 'ОО', hours: 0, categoryKey: 'code.cat.absence', labelKey: 'code.label.ОО' },
  { code: 'Б', hours: 0, categoryKey: 'code.cat.absence', labelKey: 'code.label.Б' },
  { code: 'X', hours: 0, categoryKey: 'code.cat.violation', labelKey: 'code.label.X' },
  { code: 'ПР', hours: 0, categoryKey: 'code.cat.idle', labelKey: 'code.label.ПР' },
  { code: 'В', hours: 0, categoryKey: 'code.cat.off', labelKey: 'code.label.В' },
]

export const PLAN_CYCLE: DayCode[] = [
  '',
  '4',
  '6',
  '8',
  '10',
  '11',
  '12',
  'Н',
  '22',
  'В',
  'ОТ',
  'ОО',
  'Б',
  'X',
  'ПР',
]

export const WORK_DAY_CODES: ReadonlySet<DayCode> = new Set([
  '4',
  '6',
  '8',
  '10',
  '11',
  '12',
  'Н',
  '22',
])

export function isWorkDayCode(code: DayCode): boolean {
  return WORK_DAY_CODES.has(code)
}

export function hoursForCode(code: DayCode): number {
  return CODE_DEFS.find((c) => c.code === code)?.hours ?? 0
}

/** Базовый рабочий код под точные часы (выходной / неполная смена). */
export function workCodeForExactHours(hours: number): DayCode {
  const h = Math.max(0, Math.min(24, Math.round(hours)))
  if (h === 4) return '4'
  if (h === 6) return '6'
  if (h === 10) return '10'
  if (h === 11) return '11'
  if (h === 12) return '12'
  return '8'
}

export function nextCode(current: DayCode): DayCode {
  const i = PLAN_CYCLE.indexOf(current)
  return PLAN_CYCLE[(i + 1) % PLAN_CYCLE.length]
}
