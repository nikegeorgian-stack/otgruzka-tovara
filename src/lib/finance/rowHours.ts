import { hoursForCode } from '@/lib/codes'
import { dayDateKey, daysInMonth } from '@/lib/dates'
import { isTransferredOut } from '@/lib/dayTransfer'
import { factWorkedHours, isWorkCode } from '@/lib/factExtra'
import { getFactMark, rowStats, type RowStats } from '@/lib/stats'
import type { AbsenceConfirmState } from '@/lib/absenceConfirm'
import type { Employee, MonthSheet } from '@/lib/types'

/** Сумма отработанных часов по рабочим кодам (без В/ОТ/Б/ОО/ПР). */
export function sumWorkFactHours(
  sheet: MonthSheet,
  rowId: string,
  year: number,
  month: number,
  days?: number,
  asOfDate?: string,
): number {
  const dayCount = days ?? daysInMonth(year, month)
  let total = 0
  for (let d = 1; d <= dayCount; d++) {
    const key = dayDateKey(year, month, d)
    if (asOfDate && key > asOfDate) continue
    if (isTransferredOut(sheet, rowId, key)) continue
    const code = getFactMark(sheet, rowId, key)
    if (
      !code ||
      code === 'В' ||
      code === 'ОТ' ||
      code === 'ОО' ||
      code === 'Б' ||
      code === 'X' ||
      code === 'ПР'
    ) {
      continue
    }
    if (!isWorkCode(code)) continue
    total += factWorkedHours(sheet, rowId, key, code)
  }
  return total
}

/** Часы ночных смен (код Н) по факту. */
export function sumNightFactHours(
  sheet: MonthSheet,
  rowId: string,
  year: number,
  month: number,
  days?: number,
  asOfDate?: string,
): number {
  const dayCount = days ?? daysInMonth(year, month)
  let total = 0
  for (let d = 1; d <= dayCount; d++) {
    const key = dayDateKey(year, month, d)
    if (asOfDate && key > asOfDate) continue
    if (isTransferredOut(sheet, rowId, key)) continue
    const code = getFactMark(sheet, rowId, key)
    if (code !== 'Н') continue
    total += factWorkedHours(sheet, rowId, key, code)
  }
  return total
}

export type RowHoursSnapshot = RowStats & {
  /** Рабочие часы факта (смены на производстве, без ОТ/Б/ПР). */
  workFactHours: number
  /**
   * Норма работы = план − подтверждённые ОТ/Б − ПР в плане.
   * Отпуск закрывает норму, но не входит в workFactHours.
   */
  workNormHours: number
  /** Рабочий факт − норма работы (отриц. = недоработка, положит. = переработка). */
  workHoursDelta: number
  /**
   * Переработка Δ: max(0, workHoursDelta).
   * Норма = план − подтверждённые ОТ/Б − ПР в плане (как в calculateRowPay).
   */
  monthDeltaOtHours: number
  /** Часы ночных смен (Н). */
  nightHours: number
}

/** Часы ПР в дни, где в плане была рабочая смена (уходят из базы оклада). */
export function sumIdleInPlanHours(
  sheet: MonthSheet,
  rowId: string,
  year: number,
  month: number,
  days?: number,
  asOfDate?: string,
): number {
  const dayCount = days ?? daysInMonth(year, month)
  let total = 0
  for (let d = 1; d <= dayCount; d++) {
    const key = dayDateKey(year, month, d)
    if (asOfDate && key > asOfDate) continue
    if (isTransferredOut(sheet, rowId, key)) continue
    if (getFactMark(sheet, rowId, key) !== 'ПР') continue
    const planMark = sheet.plan[rowId]?.[key] ?? ''
    if (!isWorkCode(planMark)) continue
    total += hoursForCode(planMark)
  }
  return total
}

/** Норма рабочих часов после вычета ОТ/Б/ПР из плана. */
export function monthWorkNormHours(planHours: number, reclassHours: number): number {
  return Math.max(0, planHours - Math.max(0, reclassHours))
}

/** Сверхурочные по месячной Δ относительно нормы работы (не полного плана). */
export function monthDeltaOtHours(
  workFactHours: number,
  planHours: number,
  reclassHours: number,
): number {
  if (planHours <= 0) return 0
  const workNorm = monthWorkNormHours(planHours, reclassHours)
  return workFactHours > workNorm ? workFactHours - workNorm : 0
}

/**
 * Единый снимок часов строки — те же цифры, что в итогах табеля (Пл.ч / Ф.ч).
 * Используется в расчётном листке и финансовых расчётах.
 */
export function getRowHoursSnapshot(
  sheet: MonthSheet,
  rowId: string,
  emp: Employee,
  year: number,
  month: number,
  confirm?: AbsenceConfirmState,
  asOfDate?: string,
): RowHoursSnapshot {
  const days = daysInMonth(year, month)
  const rs = rowStats(sheet, rowId, days, year, month, emp, confirm, asOfDate)
  const workFactHours = sumWorkFactHours(sheet, rowId, year, month, days, asOfDate)
  const nightHours = sumNightFactHours(sheet, rowId, year, month, days, asOfDate)
  const absenceCreditH = Math.max(0, rs.factHours - workFactHours)
  const idleInPlanH = sumIdleInPlanHours(sheet, rowId, year, month, days, asOfDate)
  const reclassH = absenceCreditH + idleInPlanH
  const workNormHours = monthWorkNormHours(rs.planHours, reclassH)
  const workHoursDelta = workFactHours - workNormHours
  return {
    ...rs,
    workFactHours,
    workNormHours,
    workHoursDelta,
    monthDeltaOtHours: monthDeltaOtHours(workFactHours, rs.planHours, reclassH),
    nightHours,
  }
}
