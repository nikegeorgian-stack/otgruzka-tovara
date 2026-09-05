import { resolveCabinetAsOfDate } from '@/lib/employeeCabinet/asOf'
import { monthStatement, type StatementRow } from '@/lib/finance/calc'
import type { BrigadierPayDetail, PayrollHourDetail } from '@/lib/finance/payrollDetail'
import { isMonthClosed } from '@/lib/monthManage'
import type { PayBreakdown } from '@/lib/payroll'
import { employeeStaffRate } from '@/lib/payrollRates'
import type { AppStore } from '@/lib/types'

export type EmployeePayDetail = {
  month: string
  rateLabel: string
  schedule: string
  staffRate: number
  breakdown: PayBreakdown
  hourDetail: PayrollHourDetail
  brigadierBonus: number
  autoBonus: number
  productivityBonus: number
  otherManualBonus: number
  /** Сумма составляющих breakdown (без премий/бригадирских). */
  payrollAmount: number
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

function addBreakdown(a: PayBreakdown, b: PayBreakdown): PayBreakdown {
  return {
    base: a.base + b.base,
    night: a.night + b.night,
    overtime: a.overtime + b.overtime,
    ot110: a.ot110 + b.ot110,
    ot115: a.ot115 + b.ot115,
    ot120: a.ot120 + b.ot120,
    idle: a.idle + b.idle,
    vacation: a.vacation + b.vacation,
    sick: a.sick + b.sick,
    nightLineBonus: a.nightLineBonus + b.nightLineBonus,
  }
}

function roundBreakdown(b: PayBreakdown): PayBreakdown {
  const r = (n: number) => Math.round(n * 100) / 100
  return {
    base: r(b.base),
    night: r(b.night),
    overtime: r(b.overtime),
    ot110: r(b.ot110),
    ot115: r(b.ot115),
    ot120: r(b.ot120),
    idle: r(b.idle),
    vacation: r(b.vacation),
    sick: r(b.sick),
    nightLineBonus: r(b.nightLineBonus),
  }
}

function mergeBrigadier(
  parts: Array<BrigadierPayDetail | null | undefined>,
): BrigadierPayDetail | null {
  const list = parts.filter((x): x is BrigadierPayDetail => Boolean(x))
  if (!list.length) return null
  if (list.length === 1) return list[0]!
  const first = list[0]!
  return {
    fullMonthlyAmount: first.fullMonthlyAmount,
    brigadierDays: list.reduce((s, b) => s + b.brigadierDays, 0),
    planBrigHours: list.reduce((s, b) => s + b.planBrigHours, 0),
    factBrigHours: list.reduce((s, b) => s + b.factBrigHours, 0),
    overtimeBrigHours: list.reduce((s, b) => s + b.overtimeBrigHours, 0),
    hourlySupplement: first.hourlySupplement,
    amount: list.reduce((s, b) => s + b.amount, 0),
    designatedBrigadier: list.some((b) => b.designatedBrigadier),
  }
}

function mergeHourDetails(rows: StatementRow[]): PayrollHourDetail {
  const details = rows.map((r) => r.hourDetail)
  const sum = (pick: (h: PayrollHourDetail) => number) =>
    Math.round(details.reduce((s, h) => s + pick(h), 0) * 10) / 10
  return {
    planHours: sum((h) => h.planHours),
    factHours: sum((h) => h.factHours),
    workFactHours: sum((h) => h.workFactHours),
    baseHours: sum((h) => h.baseHours),
    overtimeHours: sum((h) => h.overtimeHours),
    monthDeltaOtHours: sum((h) => h.monthDeltaOtHours),
    otDayHours: sum((h) => h.otDayHours),
    otNightHours: sum((h) => h.otNightHours),
    nightShiftHours: sum((h) => h.nightShiftHours),
    idleHours: sum((h) => h.idleHours),
    hourlyRate: details[0]?.hourlyRate ?? 0,
    nightMultiplier: details[0]?.nightMultiplier ?? 1.25,
    idleMultiplier: details[0]?.idleMultiplier ?? 0.3,
    otDayMultiplier: details[0]?.otDayMultiplier ?? 1.1,
    otNightMultiplier: details[0]?.otNightMultiplier ?? 1.35,
    nightLineNights: sum((h) => h.nightLineNights),
    nightLineFixedGel: details[0]?.nightLineFixedGel ?? 20,
    nightLineBonus: sum((h) => h.nightLineBonus),
    brigadier: mergeBrigadier(details.map((h) => h.brigadier)),
  }
}

/**
 * Полная детализация часов и составляющих начисления для «Моё».
 * Склеивает все строки табеля сотрудника за месяц (перевод бригады).
 */
export function buildEmployeePayDetail(
  store: AppStore,
  employeeId: string,
  month: string,
): EmployeePayDetail | null {
  const asOfDate = isMonthClosed(store, month) ? undefined : resolveCabinetAsOfDate(month)
  const rows = monthStatement(store, month, asOfDate).filter((r) => r.employeeId === employeeId)
  if (!rows.length) return null

  const home =
    rows.find((r) => r.brigade === r.emp.brigade) ??
    rows.find((r) => r.paid > 0 || r.advance > 0 || r.bonus > 0) ??
    rows[0]!

  let breakdown = emptyBreakdown()
  for (const r of rows) breakdown = addBreakdown(breakdown, r.breakdown)
  breakdown = roundBreakdown(breakdown)

  const payrollAmount =
    Math.round(
      (breakdown.base +
        breakdown.night +
        breakdown.ot110 +
        breakdown.ot115 +
        breakdown.ot120 +
        (breakdown.ot110 === 0 && breakdown.ot115 === 0 && breakdown.ot120 === 0
          ? breakdown.overtime
          : 0) +
        breakdown.idle +
        breakdown.vacation +
        breakdown.sick +
        breakdown.nightLineBonus) *
        100,
    ) / 100

  return {
    month,
    rateLabel: home.rateLabel,
    schedule: home.schedule,
    staffRate: employeeStaffRate(home.emp),
    breakdown,
    hourDetail: mergeHourDetails(rows),
    brigadierBonus: rows.reduce((s, r) => s + r.brigadierBonus, 0),
    autoBonus: rows.reduce((s, r) => s + r.autoBonus, 0),
    productivityBonus: rows.reduce((s, r) => s + r.productivityBonus, 0),
    otherManualBonus: rows.reduce((s, r) => s + r.otherManualBonus, 0),
    payrollAmount,
  }
}
