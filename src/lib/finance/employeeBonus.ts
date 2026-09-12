import type { FinanceAdjustment } from './types'
import { sumProductivityBonus } from './adjustmentReasons'
import { roundMoney } from './money'
import type { Employee } from '@/lib/types'

export const SALARY_BONUS_PERCENT = 10

export type EmployeeBonusBreakdown = {
  /** 10% от начисленного (+ раньше сюда же входил бонус к зарплате — теперь он в ставке). */
  auto: number
  /** Единоразовая премия за месяц (monthPremiums). */
  monthPremium: number
  productivity: number
  otherManual: number
  total: number
}

function sumManualBonuses(
  list: FinanceAdjustment[],
  employeeId: string,
  month: string,
  asOfDate?: string,
): number {
  return list
    .filter(
      (a) =>
        a.employeeId === employeeId &&
        a.month === month &&
        a.kind === 'bonus' &&
        (!asOfDate || a.date <= asOfDate),
    )
    .reduce((s, a) => s + a.amount, 0)
}

/** Бонус к зарплате ₾/мес (фиксированный; входит в ставку, не в колонку «премии»). */
export function individualMonthlyBonus(emp: Employee): number {
  if (!emp.individualBonus) return 0
  const v = emp.monthlyBonus ?? 0
  return Number.isFinite(v) && v > 0 ? roundMoney(v) : 0
}

/** Единоразовая премия за конкретный месяц (₾). */
export function oneTimeMonthPremium(emp: Employee, month: string): number {
  const v = emp.monthPremiums?.[month]
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? roundMoney(v) : 0
}

/** 10% от начисленного по табелю (gross accrued), если включена галочка. */
export function salaryPercentBonus(emp: Employee, accruedGross: number): number {
  if (!emp.bonusPercentFromSalary || accruedGross <= 0) return 0
  return roundMoney((accruedGross * SALARY_BONUS_PERCENT) / 100)
}

/**
 * Авто-надбавки в колонке премий: 10% + единоразовая премия месяца.
 * Бонус к зарплате сюда не входит — он уже в ставке (начислено).
 */
export function autoEmployeeBonuses(
  emp: Employee,
  accruedGross: number,
  month?: string,
): number {
  const percent = salaryPercentBonus(emp, accruedGross)
  const premium = month ? oneTimeMonthPremium(emp, month) : 0
  return percent + premium
}

/** Разбивка премий: 10%, единоразово, по выработке, прочие разовые. */
export function employeeBonusBreakdown(
  emp: Employee,
  accruedGross: number,
  adjustments: FinanceAdjustment[],
  employeeId: string,
  month: string,
  asOfDate?: string,
  totalBonus?: number,
): EmployeeBonusBreakdown {
  const productivity = sumProductivityBonus(adjustments, employeeId, month, asOfDate)
  const monthPremium = oneTimeMonthPremium(emp, month)
  const percent = salaryPercentBonus(emp, accruedGross)
  const auto = percent + monthPremium
  if (totalBonus !== undefined) {
    const otherManual = Math.max(0, totalBonus - auto - productivity)
    return { auto, monthPremium, productivity, otherManual, total: totalBonus }
  }
  const allManual = sumManualBonuses(adjustments, employeeId, month, asOfDate)
  const otherManual = allManual - productivity
  return { auto, monthPremium, productivity, otherManual, total: auto + allManual }
}

export function normalizeMonthPremiums(
  raw: unknown,
): Record<string, number> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}$/.test(k)) continue
    const n = typeof v === 'number' ? v : Number(v)
    if (Number.isFinite(n) && n > 0) out[k] = Math.round(n)
  }
  return Object.keys(out).length ? out : undefined
}
