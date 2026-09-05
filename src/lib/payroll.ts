import { hoursForCode } from './codes'
import { dayDateKey } from './dates'
import { isTransferredOut } from './dayTransfer'
import { sumWorkFactHours } from './finance/rowHours'
import { computeNightLineFixedPay } from './finance/nightLineBonus'
import {
  DEFAULT_PAYROLL_ACCRUAL_RULES,
  type PayrollAccrualRules,
} from './finance/payrollAccrualRules'
import {
  factWorkedHours,
  isWorkCode,
} from './factExtra'
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
    base: Math.round(bd.base),
    night: Math.round(bd.night),
    overtime: Math.round(bd.overtime),
    ot110: Math.round(bd.ot110),
    ot115: Math.round(bd.ot115),
    ot120: Math.round(bd.ot120),
    idle: Math.round(bd.idle),
    vacation: Math.round(bd.vacation),
    sick: Math.round(bd.sick),
    nightLineBonus: Math.round(bd.nightLineBonus),
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

/** Часы смены по коду факта + override + явные +N ч. */
function dayWorkedHours(
  sheet: MonthSheet,
  rowId: string,
  dateKey: string,
  code: ReturnType<typeof getFactMark>,
): number {
  if (!isWorkCode(code)) return 0
  return factWorkedHours(sheet, rowId, dateKey, code)
}

/** @deprecated Импортируйте из `@/lib/finance/rowHours`. */
export { sumWorkFactHours } from './finance/rowHours'

/** Доплата за ночь сверх уже учтённой базы (при месячной Δ). */
function addNightPremiumOnly(
  bd: PayBreakdown,
  sheet: MonthSheet,
  rowId: string,
  year: number,
  month: number,
  days: number,
  rate: number,
  emp: Employee,
  accrual: PayrollAccrualRules,
  asOfDate?: string,
): void {
  if (rate <= 0) return
  for (let d = 1; d <= days; d++) {
    const key = dayDateKey(year, month, d)
    if (asOfDate && key > asOfDate) continue
    if (isTransferredOut(sheet, rowId, key)) continue
    const code = getFactMark(sheet, rowId, key)
    if (code !== 'Н') continue
    const worked = dayWorkedHours(sheet, rowId, key, code)
    if (worked <= 0) continue
    const shiftH = emp.shiftHours ?? hoursForCode(code)
    const nightH = Math.min(worked, shiftH)
    bd.night += nightH * rate * (accrual.nightMultiplier - 1)
    const extraH = Math.max(0, worked - shiftH)
    if (extraH > 0) {
      bd.night += extraH * rate * (accrual.otNightMultiplier - accrual.otDayMultiplier)
      bd.ot120 += extraH * rate * (accrual.otNightMultiplier - accrual.otDayMultiplier)
    }
  }
}

/**
 * Начисление за рабочий день: база 100% до нормы кода; сверх — OT day/night.
 */
function accrueWorkDay(
  bd: PayBreakdown,
  sheet: MonthSheet,
  rowId: string,
  dateKey: string,
  code: ReturnType<typeof getFactMark>,
  rate: number,
  emp: Employee,
  accrual: PayrollAccrualRules,
): void {
  if (!isWorkCode(code) || rate <= 0) return

  const worked = dayWorkedHours(sheet, rowId, dateKey, code)
  if (worked <= 0) return

  const normH = hoursForCode(code)

  if (code === 'Н') {
    const shiftH = emp.shiftHours ?? hoursForCode(code)
    const nightH = Math.min(worked, shiftH)
    bd.night += nightH * rate * accrual.nightMultiplier
    const extraH = Math.max(0, worked - shiftH)
    if (extraH > 0) addOvertimePay(bd, extraH, rate, true, accrual)
    return
  }

  const baseH = Math.min(worked, normH)
  const extraH = Math.max(0, worked - normH)
  bd.base += baseH * rate
  if (extraH > 0) addOvertimePay(bd, extraH, rate, false, accrual)
}

/**
 * Месячная Δ (факт-работа > план): оклад = plan×rate, OT = Δ.
 * Часы ПР/ОТ/Б из плана вычитаем из base и кладём в свои строки.
 */
function accrueMonthDelta(
  bd: PayBreakdown,
  sheet: MonthSheet,
  rowId: string,
  year: number,
  month: number,
  days: number,
  emp: Employee,
  planH: number,
  rate: number,
  workFactH: number,
  vacationHours: number,
  sickHours: number,
  accrual: PayrollAccrualRules,
  asOfDate?: string,
): void {
  if (rate <= 0 || planH <= 0) return

  let idleInPlan = 0
  let idleOutsidePlan = 0
  for (let d = 1; d <= days; d++) {
    const key = dayDateKey(year, month, d)
    if (asOfDate && key > asOfDate) continue
    if (getFactMark(sheet, rowId, key) !== 'ПР') continue
    const planned = planShiftHours(sheet, rowId, key)
    const h = idleShiftHours(sheet, rowId, key, emp)
    if (planned > 0) idleInPlan += planned
    else idleOutsidePlan += h
  }

  const reclassH = idleInPlan + vacationHours + sickHours
  // Норма работы после вычета ОТ/Б/ПР из плана — переработка сверх неё, не сверх полного плана.
  const workNormH = Math.max(0, planH - reclassH)
  bd.base = workNormH * rate
  bd.idle = (idleInPlan + idleOutsidePlan) * rate * accrual.idleMultiplier
  bd.vacation = vacationHours * rate
  bd.sick = sickHours * rate
  addOvertimePay(bd, workFactH - workNormH, rate, false, accrual)
  addNightPremiumOnly(bd, sheet, rowId, year, month, days, rate, emp, accrual, asOfDate)
}

/**
 * Часы плана в табеле (с усечением по приёму / периоду строки) — для переработки Δ.
 * Перевод бригады: сумма по всем строкам сотрудника.
 */
function sheetPlanHoursForEmployee(
  sheet: MonthSheet,
  rowId: string,
  emp: Employee,
  year: number,
  month: number,
  days: number,
  sickConfirmed: boolean,
  vacationConfirmed: boolean,
  asOfDate?: string,
): number {
  const confirm = { sickConfirmed, vacationConfirmed }
  let total = 0
  for (const r of sheet.rows) {
    if (r.employeeId !== emp.id) continue
    total += rowStats(sheet, r.id, days, year, month, emp, confirm, asOfDate).planHours
  }
  if (total > 0) return total
  return rowStats(sheet, rowId, days, year, month, emp, confirm, asOfDate).planHours
}

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
  /** План в табеле (может быть меньше нормы при приёме с середины месяца). */
  const sheetPlanH = sheetPlanHoursForEmployee(
    sheet,
    rowId,
    rowEmp,
    year,
    month,
    days,
    sickConfirmed,
    vacationConfirmed,
    asOfDate,
  )
  const salary = payRate.monthly
  const rate = resolveRowHourlyRate(rowEmp, year, month)
  const workFactH = sumWorkFactHours(sheet, rowId, year, month, days, asOfDate)
  // При разбиении месяца на 2+ строки (перевод бригады) — только посуточный путь,
  // иначе Δ «факт строки vs норма всего месяца» ломает сверхурочные.
  const splitRows =
    sheet.rows.filter((r) => r.employeeId === emp.id).length > 1
  // Переработка — сверх плана табеля, не сверх календарной нормы.
  const useMonthDelta =
    !splitRows && salary > 0 && sheetPlanH > 0 && workFactH > sheetPlanH
  const rateLabel =
    salary > 0 && normH > 0
      ? `${payRate.label} (${Math.round((salary / normH) * 100) / 100} ₾/ч · норма ${normH} ч${
          sheetPlanH > 0 && sheetPlanH !== normH ? ` · план ${sheetPlanH} ч` : ''
        })`
      : payRate.label

  if (useMonthDelta && rate > 0) {
    accrueMonthDelta(
      bd,
      sheet,
      rowId,
      year,
      month,
      days,
      rowEmp,
      sheetPlanH,
      rate,
      workFactH,
      vacationHours,
      sickHours,
      accrual,
      asOfDate,
    )
  } else {
    for (let d = 1; d <= days; d++) {
      const key = dayDateKey(year, month, d)
      if (asOfDate && key > asOfDate) continue
      if (isTransferredOut(sheet, rowId, key)) continue
      const code = getFactMark(sheet, rowId, key)

      if (code === 'ПР' && rate > 0) {
        bd.idle += idleShiftHours(sheet, rowId, key, rowEmp) * rate * accrual.idleMultiplier
      } else if (isWorkCode(code) && rate > 0) {
        accrueWorkDay(bd, sheet, rowId, key, code, rate, rowEmp, accrual)
      }
    }
    bd.vacation = vacationHours * rate
    bd.sick = sickHours * rate
  }

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
    amount,
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
