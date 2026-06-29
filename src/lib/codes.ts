import type { DayCode } from './types'

export type CodeDef = {
  code: DayCode
  hours: number
  categoryKey: string
  labelKey: string
  schedule?: string
}

export const CODE_DEFS: CodeDef[] = [
  { code: '8', hours: 8, categoryKey: 'code.cat.work', labelKey: 'code.label.8', schedule: '5/2 8ч' },
  { code: '11', hours: 11, categoryKey: 'code.cat.work', labelKey: 'code.label.11', schedule: '2/2 11ч, 1/1 11ч' },
  { code: 'Н', hours: 11, categoryKey: 'code.cat.overtime', labelKey: 'code.label.Н' },
  { code: '22', hours: 22, categoryKey: 'code.cat.overtime', labelKey: 'code.label.22' },
  { code: 'ОТ', hours: 0, categoryKey: 'code.cat.absence', labelKey: 'code.label.ОТ' },
  { code: 'ОО', hours: 0, categoryKey: 'code.cat.absence', labelKey: 'code.label.ОО' },
  { code: 'Б', hours: 0, categoryKey: 'code.cat.absence', labelKey: 'code.label.Б' },
  { code: 'X', hours: 0, categoryKey: 'code.cat.violation', labelKey: 'code.label.X' },
  { code: 'ПР', hours: 0, categoryKey: 'code.cat.idle', labelKey: 'code.label.ПР' },
  { code: 'В', hours: 0, categoryKey: 'code.cat.off', labelKey: 'code.label.В' },
]

export const PLAN_CYCLE: DayCode[] = ['', '8', '11', 'Н', '22', 'В', 'ОТ', 'ОО', 'Б', 'X', 'ПР']

export function hoursForCode(code: DayCode): number {
  return CODE_DEFS.find((c) => c.code === code)?.hours ?? 0
}

export function nextCode(current: DayCode): DayCode {
  const i = PLAN_CYCLE.indexOf(current)
  return PLAN_CYCLE[(i + 1) % PLAN_CYCLE.length]
}
