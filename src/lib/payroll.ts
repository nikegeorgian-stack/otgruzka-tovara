import { dayDateKey } from './dates'
import { isTransferredOut } from './dayTransfer'
import { computeNightLineFixedPay } from './finance/nightLineBonus'
import {
  DEFAULT_PAYROLL_ACCRUAL_RULES,
  type PayrollAccrualRules,
} from './finance/payrollAccrualRules'
import { isWorkCode } from './factExtra'
import { hoursForCode } from './codes'
import { payrollWorkHours } from './finance/payrollWorkHours'
import { roundMoney } from './finance/money'
import { employeeActiveInMonth } from '@/lib/hr/employeeActive'
import { planHoursForCode } from '@/lib/hr/absencePlan'
import {
  resolvePayRate,
} from './payrollRates'
import { fullScheduleMonthHours } from './schedule'
import { effectiveShiftHours } from './schedules'
import { employeeForTimesheetRow } from './rowSchedule'
import { getFactMark, rowStats } from './stats'
import type { Employee, MonthSheet } from './types'

export {
  NIGHT_MULTIPLIER,
  SHIFT_MONTH_HOURS,
  hourlyRateFromMonthly,
  resolvePayRate,
  syncHourlyFromMonthly,
  employeeStaffRate,
  effectiveMonthlySalary,
  effectiveSalaryWithBonus,
  normalizeStaffRate,
  STAFF_RATE_PRESETS,
  DEFAULT_STAFF_RATE,
} from './payrollRates'

/** Разбивка начисления по составляющим (gross, ₾). */
export type PayBreakdown = {
  base: number
  night: number
  overtime: number
  ot110: number
  ot115: number
  ot120: number
  idle: number
  vacation: number
  sick: number
  /** Фикс за ночи на линии (пропитка), поверх % за часы Н. */
  nightLineBonus: number
}

export type PayRowResult = {
  factHours: number
  planHours: number
  amount: number
  rateLabel: string
  /** Почасовая ставка месяца (оклад ÷ норма графика). */
  hourlyRate: number
  breakdown: PayBreakdown
}

export type PayCalcOptions = {
  sickConfirmed?: boolean
  vacationConfirmed?: boolean
  /** Коэффициенты из справочника; иначе дефолты. */
  accrual?: PayrollAccrualRules
  /** Срез «на дату»: часы и начисление только по дням ≤ даты (для «Моё» / as-of). */
  asOfDate?: string
}

function emptyBreakdown(): PayBreakdown {
  return {
    base: 0,
    night: 0,
    overtime: 0,
    ot110: 0,
    ot115: 0,
    ot120: 0,
    idle: 0,
    vacation: 0,
    sick: 0,
    nightLineBonus: 0,
  }
}

function planShiftHours(sheet: MonthSheet, rowId: string, dateKey: string): number {
  const planMark = sheet.plan[rowId]?.[dateKey] ?? ''
  return isWorkCode(planMark) ? hoursForCode(planMark) : 0
}

function idleShiftHours(
  sheet: MonthSheet,
  rowId: string,
  dateKey: string,
  emp: Employee,
): number {
  const fromPlan = planShiftHours(sheet, rowId, dateKey)
  if (fromPlan > 0) return fromPlan
  return effectiveShiftHours(emp)
}

function addOvertimePay(
  bd: PayBreakdown,
  extraHours: number,
  rate: number,
  nightShift: boolean,
  accrual: PayrollAccrualRules,
): void {
  if (extraHours <= 0 || rate <= 0) return
  const mult = nightShift ? accrual.otNightMultiplier : accrual.otDayMultiplier
  const amount = extraHours * rate * mult
  bd.overtime += amount
  if (nightShift) bd.ot120 += amount
  else bd.ot110 += amount
}

function roundBreakdown(bd: PayBreakdown): PayBreakdown {
  return {
    base: roundMoney(bd.base),
    night: roundMoney(bd.night),
    overtime: roundMoney(roundMoney(bd.ot110) + roundMoney(bd.ot115) + roundMoney(bd.ot120)),
    ot110: roundMoney(bd.ot110),
    ot115: roundMoney(bd.ot115),
    ot120: roundMoney(bd.ot120),
    idle: roundMoney(bd.idle),
    vacation: roundMoney(bd.vacation),
    sick: roundMoney(bd.sick),
    nightLineBonus: roundMoney(bd.nightLineBonus),
  }
}

/** Почасовая ставка строки: оклад ÷ полная норма графика месяца. */
export function resolveRowHourlyRate(emp: Employee, year: number, month: number): number {
  const payRate = resolvePayRate(emp)
  const normH = fullScheduleMonthHours(emp, year, month)
  const salary = payRate.monthly
  if (salary > 0 && normH > 0) return salary / normH
  if (salary > 0) return 0
  return payRate.perHour
}

export function formatHourlyRate(rate: number): string {
  const n = Math.round(rate * 100) / 100
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** @deprecated Импортируйте из `@/lib/finance/rowHours`. */
export { sumWorkFactHours } from './finance/rowHours'

/**
 * Норма для ставки ₾/ч = полный месяц по графику (5/2 будни / цикл 2/2),
 * не урезанный план с даты приёма. Иначе приём с 10-го даёт оклад÷128 вместо оклад÷184.
 */
function monthNormHoursForRate(emp: Employee, year: number, month: number): number {
  return fullScheduleMonthHours(emp, year, month)
}

export function calculateRowPay(
  emp: Employee,
  sheet: MonthSheet,
  rowId: string,
  year: number,
  month: number,
  opts?: PayCalcOptions,
): PayRowResult {
  const rowEmp = employeeForTimesheetRow(emp, sheet, rowId)
  const days = new Date(year, month, 0).getDate()
  const sickConfirmed = opts?.sickConfirmed ?? false
  const vacationConfirmed = opts?.vacationConfirmed ?? false
  const accrual = opts?.accrual ?? DEFAULT_PAYROLL_ACCRUAL_RULES
  const asOfDate = opts?.asOfDate
  const payRate = resolvePayRate(rowEmp)
  const rs = rowStats(sheet, rowId, days, year, month, rowEmp, {
    sickConfirmed,
    vacationConfirmed,
  }, asOfDate)

  let vacationHours = 0
  let sickHours = 0
  for (let d = 1; d <= days; d++) {
    const key = dayDateKey(year, month, d)
    if (asOfDate && key > asOfDate) continue
    if (isTransferredOut(sheet, rowId, key)) continue
    const code = getFactMark(sheet, rowId, key)
    // Часы ОТ/Б = норма смены по графику (как в табеле), не только если план ещё «рабочий».
    if (code === 'ОТ' && vacationConfirmed) {
      vacationHours += planHoursForCode(rowEmp, year, month, d, code)
    } else if (code === 'Б' && sickConfirmed) {
      sickHours += planHoursForCode(rowEmp, year, month, d, code)
    }
  }

  const bd = emptyBreakdown()

  /** Ставка: оклад ÷ полная норма графика этой строки (снимок при смене расписания). */
  const normH = monthNormHoursForRate(rowEmp, year, month)
  const sheetPlanH = rs.planHours
  const salary = payRate.monthly
  const rate = resolveRowHourlyRate(rowEmp, year, month)
  const work = payrollWorkHours(sheet, rowId, emp, year, month, { sickConfirmed, vacationConfirmed }, asOfDate)
  const rateLabel =
    salary > 0 && normH > 0
      ? `${payRate.label} (${Math.round((salary / normH) * 100) / 100} ₾/ч · норма ${normH} ч${
          sheetPlanH > 0 && sheetPlanH !== normH ? ` · план ${sheetPlanH} ч` : ''
        })`
      : payRate.label

  bd.base = work.baseHours * rate
  bd.night = work.nightShiftHours * rate * accrual.nightMultiplier
  addOvertimePay(bd, work.otDayHours, rate, false, accrual)
  addOvertimePay(bd, work.otNightHours, rate, true, accrual)
  for (let d = 1; d <= days; d++) {
    const key = dayDateKey(year, month, d)
    if ((asOfDate && key > asOfDate) || isTransferredOut(sheet, rowId, key)) continue
    if (getFactMark(sheet, rowId, key) === 'ПР') {
      bd.idle += idleShiftHours(sheet, rowId, key, rowEmp) * rate * accrual.idleMultiplier
    }
  }
  bd.vacation = vacationHours * rate
  bd.sick = sickHours * rate

  const rowBrigade = sheet.rows.find((r) => r.id === rowId)?.brigade ?? rowEmp.brigade
  const nightLine = computeNightLineFixedPay({
    sheet,
    rowId,
    brigade: rowBrigade,
    year,
    month,
    fixedGel: accrual.nightLineFixedGel,
    asOfDate,
  })
  bd.nightLineBonus = nightLine.amount

  const rounded = roundBreakdown(bd)
  const amount =
    rounded.base +
    rounded.night +
    rounded.overtime +
    rounded.idle +
    rounded.vacation +
    rounded.sick +
    rounded.nightLineBonus

  return {
    factHours: rs.factHours,
    planHours: rs.planHours,
    amount: roundMoney(amount),
    rateLabel,
    hourlyRate: rate,
    breakdown: rounded,
  }
}

export function formatGel(n: number): string {
  return `${n.toLocaleString('ru-RU')} ₾`
}

export function isPayableInMonth(emp: Employee, month: string): boolean {
  return employeeActiveInMonth(emp, month)
}
