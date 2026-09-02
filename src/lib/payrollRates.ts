/**
 * Ставки начисления зарплаты (FiberCell / Excel-ведомость).
 * Норма часов месяца = план сотрудника в табеле (не фиксированные 165/176).
 * ₾/ч в расчёте: monthlySalary / fullScheduleMonthHours (полная норма графика за месяц).
 * При смене графика с даты в середине месяца каждая строка табеля берёт снимок своего
 * графика (rowBounds) — ставка и норма считаются по правилам для этой половины.
 */

/** @deprecated Только справочно / старые карточки. Норма — из плана месяца. */
export const SHIFT_MONTH_HOURS = 165

/** @deprecated Только справочно. Норма — из плана месяца. */
export const SCHEDULE_52_MONTH_HOURS = 176

export const NIGHT_MULTIPLIER = 1.25
/** Простой (ПР): 30% от почасовой ставки. */
export const IDLE_MULTIPLIER = 0.3

/** Сверхурочные часы (+N) в дневной смене. */
export const OT_DAY_MULTIPLIER = 1.1
/** Сверхурочные на ночной смене (Н + +N): 125% + 10%. */
export const OT_NIGHT_MULTIPLIER = 1.35

/** @deprecated Используйте OT_DAY_MULTIPLIER / OT_NIGHT_MULTIPLIER */
export const OT_TIER_1_MULTIPLIER = 1.1
export const OT_TIER_2_MULTIPLIER = 1.15
export const OT_TIER_3_MULTIPLIER = 1.2

export type OvertimeTierBreakdown = {
  ot110: number
  ot115: number
  ot120: number
  total: number
}

/** Сверхурочные по ступеням: 1-й час 110%, 2-й 115%, 3+ 120%. */
export function overtimeTierAmount(
  extraHours: number,
  hourlyRate: number,
): OvertimeTierBreakdown {
  if (extraHours <= 0 || hourlyRate <= 0) {
    return { ot110: 0, ot115: 0, ot120: 0, total: 0 }
  }
  const h1 = Math.min(1, extraHours)
  const h2 = Math.min(1, Math.max(0, extraHours - 1))
  const h3 = Math.max(0, extraHours - 2)
  const ot110 = h1 * hourlyRate * OT_TIER_1_MULTIPLIER
  const ot115 = h2 * hourlyRate * OT_TIER_2_MULTIPLIER
  const ot120 = h3 * hourlyRate * OT_TIER_3_MULTIPLIER
  return { ot110, ot115, ot120, total: ot110 + ot115 + ot120 }
}

import { is52Schedule } from './schedules'
import type { Employee } from './types'

/** Доля штатной единицы по умолчанию (полная ставка). */
export const DEFAULT_STAFF_RATE = 1

/** Типовые значения для выбора в UI. */
export const STAFF_RATE_PRESETS = [1, 0.75, 0.5, 0.25] as const

/** Нормализация доли ставки: (0.1 … 2], шаг 0.01. */
export function normalizeStaffRate(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'))
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_STAFF_RATE
  return Math.min(2, Math.max(0.1, Math.round(n * 100) / 100))
}

/** Доля ставки сотрудника (`undefined` → 1). */
export function employeeStaffRate(emp: Pick<Employee, 'staffRate'>): number {
  if (emp.staffRate == null) return DEFAULT_STAFF_RATE
  return normalizeStaffRate(emp.staffRate)
}

/** Оклад с учётом доли ставки. */
export function effectiveMonthlySalary(emp: Pick<Employee, 'monthlySalary' | 'staffRate'>): number {
  const monthly = emp.monthlySalary ?? 0
  if (monthly <= 0) return 0
  return Math.round(monthly * employeeStaffRate(emp) * 100) / 100
}

/**
 * База для % аванса и для ставки ЗП: оклад×ставка + бонус к зарплате.
 * Бонус — фиксированные ₾/мес (не умножается на staffRate повторно).
 */
export function effectiveSalaryWithBonus(
  emp: Pick<Employee, 'monthlySalary' | 'staffRate' | 'monthlyBonus' | 'individualBonus'>,
): number {
  const salary = effectiveMonthlySalary(emp)
  if (!emp.individualBonus) return salary
  const bonus = emp.monthlyBonus ?? 0
  const b = Number.isFinite(bonus) && bonus > 0 ? Math.round(bonus) : 0
  return salary + b
}

/** Почасовая с учётом доли ставки. */
export function effectiveHourlyRate(emp: Pick<Employee, 'hourlyRate' | 'staffRate'>): number {
  const hourly = emp.hourlyRate ?? 0
  if (hourly <= 0) return 0
  return Math.round(hourly * employeeStaffRate(emp) * 100) / 100
}

/**
 * Ориентировочная ₾/ч из оклада (только UI/старые данные).
 * В расчёте ЗП используется оклад ÷ план-часы месяца.
 */
export function hourlyRateFromMonthly(
  monthlySalary: number,
  planHours: number = SHIFT_MONTH_HOURS,
): number {
  if (monthlySalary <= 0 || planHours <= 0) return 0
  return Math.round((monthlySalary / planHours) * 100) / 100
}

export type ResolvedPayRate = {
  /**
   * Запасная почасовая (если оклада нет).
   * При окладе в calculateRowPay ставка = monthly / planHours месяца.
   */
  perHour: number
  /** Эффективный оклад (уже × staffRate) + бонус к зарплате. */
  monthly: number
  /** Оклад в карточке без доли ставки. */
  monthlyFull: number
  /** Бонус к зарплате, включённый в monthly. */
  salaryBonus: number
  /** Доля штатной единицы. */
  staffRate: number
  /** Подпись для ведомости / таблицы. */
  label: string
}

/**
 * Источник ставки: оклад помесячно × доля ставки + бонус к зарплате; ₾/ч — от плана месяца.
 */
export function resolvePayRate(emp: Employee): ResolvedPayRate {
  const staffRate = employeeStaffRate(emp)
  const monthlyFull = emp.monthlySalary ?? 0
  const salaryOnly = effectiveMonthlySalary(emp)
  const withBonus = effectiveSalaryWithBonus(emp)
  const salaryBonus = Math.max(0, withBonus - salaryOnly)
  const monthly = withBonus

  if (is52Schedule(emp.schedule)) {
    return {
      perHour: 0,
      monthly,
      monthlyFull,
      salaryBonus,
      staffRate,
      label: formatMonthlyLabel(monthlyFull, salaryOnly, salaryBonus, staffRate),
    }
  }

  if (monthlyFull > 0 || salaryBonus > 0) {
    return {
      perHour: 0,
      monthly,
      monthlyFull,
      salaryBonus,
      staffRate,
      label: formatMonthlyLabel(monthlyFull, salaryOnly, salaryBonus, staffRate),
    }
  }

  const perHour = effectiveHourlyRate(emp)
  const hourlyFull = emp.hourlyRate ?? 0
  return {
    perHour,
    monthly: 0,
    monthlyFull: 0,
    salaryBonus: 0,
    staffRate,
    label:
      hourlyFull > 0
        ? staffRate !== DEFAULT_STAFF_RATE
          ? `${hourlyFull.toLocaleString('ru-RU')} ₾/ч × ${staffRate} = ${perHour.toLocaleString('ru-RU')} ₾/ч`
          : `${hourlyFull.toLocaleString('ru-RU')} ₾/ч`
        : '—',
  }
}

function formatMonthlyLabel(
  monthlyFull: number,
  salaryOnly: number,
  salaryBonus: number,
  staffRate: number,
): string {
  if (monthlyFull <= 0 && salaryBonus <= 0) return '—'
  const parts: string[] = []
  if (monthlyFull > 0) {
    parts.push(
      staffRate !== DEFAULT_STAFF_RATE
        ? `${monthlyFull.toLocaleString('ru-RU')} ₾/мес × ${staffRate} = ${salaryOnly.toLocaleString('ru-RU')} ₾`
        : `${monthlyFull.toLocaleString('ru-RU')} ₾/мес`,
    )
  }
  if (salaryBonus > 0) {
    parts.push(`+ бонус ${salaryBonus.toLocaleString('ru-RU')} ₾`)
  }
  return parts.join(' ')
}

/** Оклад задан — ₾/ч не фиксируем (/165); ставка из плана месяца. */
export function syncHourlyFromMonthly(emp: Employee): Employee {
  if (is52Schedule(emp.schedule)) return emp
  const monthly = emp.monthlySalary
  if (monthly == null || monthly <= 0) return emp
  return { ...emp, individualSalary: true }
}
