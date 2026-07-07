import { hoursForCode } from './codes'
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

/** Точное число отработанных часов за смену (если задано вручную), иначе null. */
export function getFactHoursOverride(
  sheet: MonthSheet,
  rowId: string,
  dateKey: string,
): number | null {
  const v = sheet.factHoursOverride?.[cellLookupKey(rowId, dateKey)]
  return typeof v === 'number' ? v : null
}

/**
 * Эффективные отработанные часы за день для строки.
 * Для рабочих кодов: ручной override (если задан) либо норма кода + сверхурочные.
 * Для нерабочих кодов всегда 0.
 */
export function factWorkedHours(
  sheet: MonthSheet,
  rowId: string,
  dateKey: string,
  code: DayCode,
): number {
  if (!isWorkCode(code)) return 0
  const override = getFactHoursOverride(sheet, rowId, dateKey)
  if (override != null) return override
  return hoursForCode(code) + getFactExtraHours(sheet, rowId, dateKey)
}

export function formatFactCellCode(code: DayCode, extraHours: number): string {
  if (!code) return ''
  if (extraHours > 0 && isWorkCode(code)) return `${code}+${extraHours}`
  return code
}
