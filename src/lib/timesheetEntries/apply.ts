import { PLAN_CYCLE } from '@/lib/codes'
import { cellLookupKey, isWorkCode } from '@/lib/factExtra'
import { applyPlanDayMark } from '@/lib/monthSheet'
import { getFactMark } from '@/lib/stats'
import type { AppStore, DayCode, MonthSheet } from '@/lib/types'
import type { TimesheetEntryAppliedMark, TimesheetEntryChange } from './types'
import {
  restoreTimesheetCellState,
  sameTimesheetCellState,
  timesheetCellState,
  timesheetDateInRow,
} from './cellState'

function readCell(
  sheet: MonthSheet,
  rowId: string,
  dateKey: string,
  mode: 'plan' | 'fact',
): DayCode {
  if (mode === 'plan') return (sheet.plan[rowId]?.[dateKey] ?? '') as DayCode
  return (getFactMark(sheet, rowId, dateKey) ?? '') as DayCode
}

function writeFact(sheet: MonthSheet, rowId: string, dateKey: string, code: DayCode): MonthSheet {
  const oKey = `${rowId}|${dateKey}`
  const factExtraHours = { ...(sheet.factExtraHours ?? {}) }
  const factHoursOverride = { ...(sheet.factHoursOverride ?? {}) }
  if (!isWorkCode(code)) {
    delete factExtraHours[cellLookupKey(rowId, dateKey)]
    delete factHoursOverride[cellLookupKey(rowId, dateKey)]
  }
  return {
    ...sheet,
    fact: {
      ...sheet.fact,
      [rowId]: { ...(sheet.fact[rowId] ?? {}), [dateKey]: code },
    },
    factOverrides: sheet.factOverrides.includes(oKey)
      ? sheet.factOverrides
      : [...sheet.factOverrides, oKey],
    factExtraHours,
    factHoursOverride,
  }
}

export type ApplyEntryBatchResult = {
  sheet: MonthSheet
  applied: TimesheetEntryAppliedMark[]
  skipped: number
}

/**
 * Применить пакет: только если current === change.before (иначе skip).
 * allowRow — ACL; false → skip.
 */
export function applyTimesheetEntryChanges(
  sheet: MonthSheet,
  changes: TimesheetEntryChange[],
  allowRow: (rowId: string) => boolean,
): ApplyEntryBatchResult {
  let next = sheet
  const applied: TimesheetEntryAppliedMark[] = []
  let skipped = 0
  const seen = new Set<string>()

  for (const ch of changes) {
    if (ch.before === ch.after && !ch.confirmFact) continue
    const key = `${ch.mode}|${ch.rowId}|${ch.dateKey}`
    if (
      !PLAN_CYCLE.includes(ch.before) ||
      !PLAN_CYCLE.includes(ch.after) ||
      seen.has(key) ||
      !allowRow(ch.rowId)
    ) {
      skipped += 1
      continue
    }
    const row = next.rows.find((r) => r.id === ch.rowId)
    if (
      !row ||
      !timesheetDateInRow(next, ch.rowId, ch.dateKey) ||
      (ch.expectedEmployeeId !== undefined && (row.employeeId ?? null) !== ch.expectedEmployeeId)
    ) {
      skipped += 1
      continue
    }
    const original = timesheetCellState(sheet, ch.rowId, ch.dateKey)
    if (
      readCell(sheet, ch.rowId, ch.dateKey, ch.mode) !== ch.before ||
      (ch.beforeState && !sameTimesheetCellState(original, ch.beforeState))
    ) {
      skipped += 1
      continue
    }
    seen.add(key)
    const current = readCell(next, ch.rowId, ch.dateKey, ch.mode)
    const beforeState = timesheetCellState(next, ch.rowId, ch.dateKey)
    if (ch.confirmFact && (ch.mode !== 'fact' || !row.employeeId || !ch.after)) {
      skipped += 1
      continue
    }
    if (ch.confirmFact && beforeState.override && current === ch.after) continue
    if (ch.mode === 'plan') {
      next = applyPlanDayMark(next, ch.rowId, ch.dateKey, ch.after)
    } else {
      next = writeFact(next, ch.rowId, ch.dateKey, ch.after)
    }
    applied.push({
      rowId: ch.rowId,
      dateKey: ch.dateKey,
      mode: ch.mode,
      before: current,
      after: ch.after,
      employeeId: row.employeeId ?? ch.employeeId,
      brigade: row.brigade ?? ch.brigade,
      confirmFact: ch.confirmFact,
      expectedEmployeeId: row.employeeId ?? null,
      beforeState,
      afterState: timesheetCellState(next, ch.rowId, ch.dateKey),
    })
  }

  return { sheet: next, applied, skipped }
}

export type RevertEntryBatchResult = {
  sheet: MonthSheet
  reverted: number
  skipped: number
  voidDetail: string
}

/** Void: откат только если current === applied.after. */
export function revertTimesheetEntryApplied(
  sheet: MonthSheet,
  applied: TimesheetEntryAppliedMark[],
): RevertEntryBatchResult {
  let next = sheet
  let reverted = 0
  let skipped = 0
  const notes: string[] = []

  for (const mark of [...applied].reverse()) {
    const current = readCell(next, mark.rowId, mark.dateKey, mark.mode)
    const row = next.rows.find((r) => r.id === mark.rowId)
    if (
      !row ||
      !timesheetDateInRow(next, mark.rowId, mark.dateKey) ||
      (mark.expectedEmployeeId !== undefined &&
        (row.employeeId ?? null) !== mark.expectedEmployeeId) ||
      current !== mark.after ||
      (mark.afterState &&
        !sameTimesheetCellState(
          timesheetCellState(next, mark.rowId, mark.dateKey),
          mark.afterState,
        ))
    ) {
      skipped += 1
      notes.push(`${mark.dateKey}/${mark.mode}: уже ${current || '·'}`)
      continue
    }
    if (mark.beforeState && mark.afterState) {
      next = restoreTimesheetCellState(next, mark.rowId, mark.dateKey, mark.beforeState)
    } else if (mark.mode === 'plan') {
      next = applyPlanDayMark(next, mark.rowId, mark.dateKey, mark.before)
    } else {
      next = writeFact(next, mark.rowId, mark.dateKey, mark.before)
    }
    reverted += 1
  }

  return {
    sheet: next,
    reverted,
    skipped,
    voidDetail: notes.slice(0, 8).join('; '),
  }
}

export function storeWithMonthSheet(store: AppStore, month: string, sheet: MonthSheet): AppStore {
  return { ...store, months: { ...store.months, [month]: sheet } }
}
