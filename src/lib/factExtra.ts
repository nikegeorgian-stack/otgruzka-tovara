import type { DayCode, MonthSheet } from './types'

export const FACT_EXTRA_HOURS_OPTIONS = [1, 2, 3, 4, 5, 6] as const
export type FactExtraHours = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** Множитель оплаты доп. часов сверх нормы смены */
export const OVERTIME_EXTRA_MULTIPLIER = 1.5

export function cellLookupKey(rowId: string, dateKey: string): string {
  return `${rowId}|${dateKey}`
}

export function isWorkCode(code: DayCode): boolean {
  return code === '8' || code === '11' || code === 'Н' || code === '22'
}

export function getFactExtraHours(
  sheet: MonthSheet,
  rowId: string,
  dateKey: string,
): number {
  const key = cellLookupKey(rowId, dateKey)
  return sheet.factExtraHours?.[key] ?? 0
}

export function formatFactCellCode(code: DayCode, extraHours: number): string {
  if (!code) return ''
  if (extraHours > 0 && isWorkCode(code)) return `${code}+${extraHours}`
  return code
}
