import { hoursForCode } from './codes'
import { dayDateKey } from './dates'
import {
  getFactExtraHours,
  isWorkCode,
  OVERTIME_EXTRA_MULTIPLIER,
} from './factExtra'
import { getFactMark, rowStats } from './stats'
import { employeeActiveInMonth } from '@/lib/hr/employeeActive'
import type { Employee, MonthSheet } from './types'

/** Множитель ночной смены (код Н). */
export const NIGHT_MULTIPLIER = 1.25

/** Разбивка начисления по составляющим (gross, ₾). */
export type PayBreakdown = {
  /** Обычные смены 8/11/22. */
  base: number
  /** Ночные смены Н (с учётом +25%). */
  night: number
  /** Доп. часы сверх нормы (×1,5). */
  overtime: number
  /** Отпускные (ОТ — оплата как рабочий день по плановым часам). */
  vacation: number
  /** Больничные (Б — только после подтверждения). */
  sick: number
}

export type PayRowResult = {
  /** Отработанные часы факта (без отпуска/больничного). */
  factHours: number
  planHours: number
  /** Начислено (gross) — сумма всех составляющих. */
  amount: number
  rateLabel: string
  breakdown: PayBreakdown
}

export type PayCalcOptions = {
  /** Подтверждён ли больничный за этот месяц (тогда дни «Б» оплачиваются). */
  sickConfirmed?: boolean
}

function emptyBreakdown(): PayBreakdown {
  return { base: 0, night: 0, overtime: 0, vacation: 0, sick: 0 }
}

/**
 * Плановые часы смены для дня — основа оплаты отпуска/больничного как
 * рабочего дня. Берём плановый код; если день по плану нерабочий (В/пусто) —
 * 0 (отсутствует смена → нет оплаты отгула).
 */
function planShiftHours(sheet: MonthSheet, rowId: string, dateKey: string): number {
  const planMark = sheet.plan[rowId]?.[dateKey] ?? ''
  return isWorkCode(planMark) ? hoursForCode(planMark) : 0
}

export function calculateRowPay(
  emp: Employee,
  sheet: MonthSheet,
  rowId: string,
  year: number,
  month: number,
  opts?: PayCalcOptions,
): PayRowResult {
  const days = new Date(year, month, 0).getDate()
  const rs = rowStats(sheet, rowId, days, year, month)
  const sickConfirmed = opts?.sickConfirmed ?? false

  // Часы отпуска / подтверждённого больничного (по плановой смене).
  let vacationHours = 0
  let sickHours = 0
  for (let d = 1; d <= days; d++) {
    const key = dayDateKey(year, month, d)
    const code = getFactMark(sheet, rowId, key)
    if (code === 'ОТ') vacationHours += planShiftHours(sheet, rowId, key)
    else if (code === 'Б' && sickConfirmed) sickHours += planShiftHours(sheet, rowId, key)
  }

  const bd = emptyBreakdown()

  if (emp.schedule === '5/2 8ч') {
    const salary = emp.monthlySalary ?? 0
    const perHour = rs.planHours > 0 ? salary / rs.planHours : 0
    bd.base = perHour * rs.factHours
    bd.vacation = perHour * vacationHours
    bd.sick = perHour * sickHours
    const amount = Math.round(bd.base + bd.vacation + bd.sick)
    return {
      factHours: rs.factHours,
      planHours: rs.planHours,
      amount,
      rateLabel: salary ? `${salary.toLocaleString('ru-RU')} ₾/мес` : '—',
      breakdown: {
        base: Math.round(bd.base),
        night: 0,
        overtime: 0,
        vacation: Math.round(bd.vacation),
        sick: Math.round(bd.sick),
      },
    }
  }

  const rate = emp.hourlyRate ?? 0
  for (let d = 1; d <= days; d++) {
    const key = dayDateKey(year, month, d)
    const code = getFactMark(sheet, rowId, key)
    const hours = hoursForCode(code)
    if (hours && rate) {
      if (code === 'Н') bd.night += hours * rate * NIGHT_MULTIPLIER
      else if (code === '8' || code === '11' || code === '22') bd.base += hours * rate
    }
    const extra = getFactExtraHours(sheet, rowId, key)
    if (extra > 0 && isWorkCode(code)) {
      bd.overtime += extra * rate * OVERTIME_EXTRA_MULTIPLIER
    }
  }
  bd.vacation = vacationHours * rate
  bd.sick = sickHours * rate

  const amount = Math.round(bd.base + bd.night + bd.overtime + bd.vacation + bd.sick)

  return {
    factHours: rs.factHours,
    planHours: rs.planHours,
    amount,
    rateLabel: rate ? `${rate.toLocaleString('ru-RU')} ₾/ч` : '—',
    breakdown: {
      base: Math.round(bd.base),
      night: Math.round(bd.night),
      overtime: Math.round(bd.overtime),
      vacation: Math.round(bd.vacation),
      sick: Math.round(bd.sick),
    },
  }
}

export function formatGel(n: number): string {
  return `${n.toLocaleString('ru-RU')} ₾`
}

/**
 * Подлежит ли сотрудник оплате за месяц с учётом увольнения.
 * Уволенному платим по месяц увольнения включительно (он отработал часть месяца),
 * после — не платим. Для не уволенных — по флагу active.
 */
export function isPayableInMonth(emp: Employee, month: string): boolean {
  return employeeActiveInMonth(emp, month)
}
