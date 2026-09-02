import { getFactMark } from '@/lib/stats'
import type { DayCode, MonthSheet } from '@/lib/types'

export type TimesheetDraftChange = {
  rowId: string
  dateKey: string
  mode: 'plan' | 'fact'
  /** Значение в сторе до начала сессии правки. */
  before: DayCode
  after: DayCode
}

export function draftCellKey(mode: 'plan' | 'fact', rowId: string, dateKey: string): string {
  return `${mode}|${rowId}|${dateKey}`
}

export function readSheetCellCode(
  sheet: MonthSheet,
  rowId: string,
  dateKey: string,
  mode: 'plan' | 'fact',
): DayCode {
  if (mode === 'plan') return (sheet.plan[rowId]?.[dateKey] ?? '') as DayCode
  return (getFactMark(sheet, rowId, dateKey) ?? '') as DayCode
}

/** Наложить черновик на лист для отображения (без записи в стор). */
export function mergeTimesheetDraft(
  sheet: MonthSheet,
  changes: TimesheetDraftChange[],
): MonthSheet {
  if (changes.length === 0) return sheet

  const plan = { ...sheet.plan }
  const fact = { ...sheet.fact }
  const factOverrides = [...sheet.factOverrides]

  for (const ch of changes) {
    if (ch.mode === 'plan') {
      plan[ch.rowId] = { ...(plan[ch.rowId] ?? {}), [ch.dateKey]: ch.after }
      continue
    }
    fact[ch.rowId] = { ...(fact[ch.rowId] ?? {}), [ch.dateKey]: ch.after }
    const oKey = `${ch.rowId}|${ch.dateKey}`
    if (!factOverrides.includes(oKey)) factOverrides.push(oKey)
  }

  return { ...sheet, plan, fact, factOverrides }
}
