import { applyPlanDayMark } from '@/lib/monthSheet'
import { isWorkCode } from '@/lib/factExtra'
import { getFactMark } from '@/lib/stats'
import type { DayCode, MonthSheet } from '@/lib/types'
import type { TimesheetEntryChange } from '@/lib/timesheetEntries/types'

export type TimesheetDraftChange = TimesheetEntryChange

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

  let next = sheet
  for (const ch of changes) {
    if (ch.mode === 'plan') {
      next = applyPlanDayMark(next, ch.rowId, ch.dateKey, ch.after)
      continue
    }
    const key = `${ch.rowId}|${ch.dateKey}`
    const extra = { ...next.factExtraHours },
      exact = { ...next.factHoursOverride }
    if (!isWorkCode(ch.after)) {
      delete extra[key]
      delete exact[key]
    }
    next = {
      ...next,
      fact: { ...next.fact, [ch.rowId]: { ...next.fact[ch.rowId], [ch.dateKey]: ch.after } },
      factOverrides: [...new Set([...next.factOverrides, key])],
      factExtraHours: extra,
      factHoursOverride: exact,
    }
  }
  return next
}
