import { cellLookupKey } from './factExtra'
import { getFactMark } from './stats'
import { isWorkCode } from './factExtra'
import type { DayCode, MonthSheet } from './types'

export type DayTransfer = {
  fromRowId: string
  toRowId: string
  toBrigade: string
}

export function dayTransferKey(employeeId: string, dateKey: string): string {
  return `${employeeId}|${dateKey}`
}

export function getDayTransfer(
  sheet: MonthSheet,
  employeeId: string,
  dateKey: string,
): DayTransfer | undefined {
  return sheet.dayTransfers?.[dayTransferKey(employeeId, dateKey)]
}

/** Сотрудник ушёл в другую бригаду в этот день — часы считаются только там. */
export function isTransferredOut(
  sheet: MonthSheet,
  rowId: string,
  dateKey: string,
): boolean {
  const row = sheet.rows.find((r) => r.id === rowId)
  if (!row?.employeeId) return false
  const tr = getDayTransfer(sheet, row.employeeId, dateKey)
  return tr?.fromRowId === rowId
}

export function isTransferredIn(
  sheet: MonthSheet,
  rowId: string,
  dateKey: string,
): boolean {
  const row = sheet.rows.find((r) => r.id === rowId)
  if (!row?.employeeId) return false
  const tr = getDayTransfer(sheet, row.employeeId, dateKey)
  return tr?.toRowId === rowId
}

/** Есть ли рабочий план/факт в другой бригаде в этот день. */
export function findHomeWorkRow(
  sheet: MonthSheet,
  employeeId: string,
  dateKey: string,
  excludeBrigade: string,
): string | undefined {
  for (const row of sheet.rows) {
    if (row.employeeId !== employeeId || row.brigade === excludeBrigade) continue
    const mark = getFactMark(sheet, row.id, dateKey)
    const plan = sheet.plan[row.id]?.[dateKey] ?? ''
    if (isWorkCode(mark) || isWorkCode(plan)) return row.id
  }
  return undefined
}

export function withDayTransfer(
  sheet: MonthSheet,
  employeeId: string,
  dateKey: string,
  transfer: DayTransfer,
): MonthSheet {
  const key = dayTransferKey(employeeId, dateKey)
  return {
    ...sheet,
    dayTransfers: { ...(sheet.dayTransfers ?? {}), [key]: transfer },
  }
}

export function clearDayTransfer(
  sheet: MonthSheet,
  employeeId: string,
  dateKey: string,
): MonthSheet {
  const key = dayTransferKey(employeeId, dateKey)
  if (!sheet.dayTransfers?.[key]) return sheet
  const dayTransfers = { ...sheet.dayTransfers }
  delete dayTransfers[key]
  return { ...sheet, dayTransfers }
}

export function setFactWithOverride(
  sheet: MonthSheet,
  rowId: string,
  dateKey: string,
  code: DayCode,
): MonthSheet {
  const oKey = cellLookupKey(rowId, dateKey)
  return {
    ...sheet,
    fact: {
      ...sheet.fact,
      [rowId]: { ...(sheet.fact[rowId] ?? {}), [dateKey]: code },
    },
    factOverrides: sheet.factOverrides.includes(oKey)
      ? sheet.factOverrides
      : [...sheet.factOverrides, oKey],
  }
}
