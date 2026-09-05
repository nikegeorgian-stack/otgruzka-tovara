import { getFactExtraHours } from '@/lib/factExtra'
import { getFactMark } from '@/lib/stats'
import type { DayCode, MonthSheet } from '@/lib/types'

export type MonthCellSnapshot = {
  code: DayCode
  extraHours: number
}

export function readMonthCellSnapshot(
  sheet: MonthSheet,
  rowId: string,
  dateKey: string,
  mode: 'plan' | 'fact',
): MonthCellSnapshot {
  if (mode === 'plan') {
    return { code: sheet.plan[rowId]?.[dateKey] ?? '', extraHours: 0 }
  }
  return {
    code: getFactMark(sheet, rowId, dateKey),
    extraHours: getFactExtraHours(sheet, rowId, dateKey),
  }
}

export function monthCellSnapshotEqual(a: MonthCellSnapshot, b: MonthCellSnapshot): boolean {
  return a.code === b.code && a.extraHours === b.extraHours
}

export type RemoteCellConflictInfo = {
  rowId: string
  dateKey: string
  was: DayCode
  now: DayCode
  mode: 'plan' | 'fact'
}
