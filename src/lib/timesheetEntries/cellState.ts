import type { MonthSheet } from '@/lib/types'
import type { TimesheetEntryCellState } from './types'

export function timesheetCellState(
  sheet: MonthSheet,
  rowId: string,
  date: string,
): TimesheetEntryCellState {
  const key = `${rowId}|${date}`
  return {
    plan: sheet.plan[rowId]?.[date],
    fact: sheet.fact[rowId]?.[date],
    override: sheet.factOverrides.includes(key),
    extraHours: sheet.factExtraHours?.[key],
    hoursOverride: sheet.factHoursOverride?.[key],
  }
}
export function sameTimesheetCellState(
  a: TimesheetEntryCellState,
  b: TimesheetEntryCellState,
): boolean {
  return (
    a.plan === b.plan &&
    a.fact === b.fact &&
    a.override === b.override &&
    a.extraHours === b.extraHours &&
    a.hoursOverride === b.hoursOverride
  )
}
export function restoreTimesheetCellState(
  sheet: MonthSheet,
  rowId: string,
  date: string,
  state: TimesheetEntryCellState,
): MonthSheet {
  const key = `${rowId}|${date}`
  const plan = { ...(sheet.plan[rowId] ?? {}) },
    fact = { ...(sheet.fact[rowId] ?? {}) }
  const extra = { ...sheet.factExtraHours },
    hours = { ...sheet.factHoursOverride }
  if (state.plan === undefined) delete plan[date]
  else plan[date] = state.plan
  if (state.fact === undefined) delete fact[date]
  else fact[date] = state.fact
  if (state.extraHours === undefined) delete extra[key]
  else extra[key] = state.extraHours
  if (state.hoursOverride === undefined) delete hours[key]
  else hours[key] = state.hoursOverride
  return {
    ...sheet,
    plan: { ...sheet.plan, [rowId]: plan },
    fact: { ...sheet.fact, [rowId]: fact },
    factOverrides: state.override
      ? [...new Set([...sheet.factOverrides, key])]
      : sheet.factOverrides.filter((k) => k !== key),
    factExtraHours: extra,
    factHoursOverride: hours,
  }
}

export function timesheetDateInRow(sheet: MonthSheet, rowId: string, date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !date.startsWith(`${sheet.month}-`)) return false
  const at = new Date(`${date}T00:00:00Z`)
  if (!Number.isFinite(at.getTime()) || at.toISOString().slice(0, 10) !== date) return false
  const bound = sheet.rowBounds?.[rowId]
  return (
    !(bound?.inactiveFrom && date >= bound.inactiveFrom) &&
    !(bound?.inactiveUntil && date <= bound.inactiveUntil)
  )
}
