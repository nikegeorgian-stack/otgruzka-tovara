import {
  IDLE_MULTIPLIER,
  NIGHT_MULTIPLIER,
  OT_DAY_MULTIPLIER,
  OT_NIGHT_MULTIPLIER,
  SCHEDULE_52_MONTH_HOURS,
  SHIFT_MONTH_HOURS,
} from '@/lib/payrollRates'
import type { AppStore } from '@/lib/types'

/** Коэффициенты и нормы начисления ЗП (справочник). */
export type PayrollAccrualRules = {
  /** Ночная смена «Н» (1.25 = 125%). */
  nightMultiplier: number
  /** Простой «ПР» (0.3 = 30%). */
  idleMultiplier: number
  /** Сверхурочные днём (1.1 = 110%). */
  otDayMultiplier: number
  /** Сверхурочные на ночной смене (1.35 = 135%). */
  otNightMultiplier: number
  /** Фикс ₾ за каждую ночную смену на линии (пропитка), поверх % за часы. */
  nightLineFixedGel: number
  /** Норма часов/мес для 2/2. */
  shiftMonthHours: number
  /** Норма часов/мес для 5/2. */
  schedule52MonthHours: number
}

export const DEFAULT_NIGHT_LINE_FIXED_GEL = 20

export const DEFAULT_PAYROLL_ACCRUAL_RULES: PayrollAccrualRules = {
  nightMultiplier: NIGHT_MULTIPLIER,
  idleMultiplier: IDLE_MULTIPLIER,
  otDayMultiplier: OT_DAY_MULTIPLIER,
  otNightMultiplier: OT_NIGHT_MULTIPLIER,
  nightLineFixedGel: DEFAULT_NIGHT_LINE_FIXED_GEL,
  shiftMonthHours: SHIFT_MONTH_HOURS,
  schedule52MonthHours: SCHEDULE_52_MONTH_HOURS,
}

function clampMult(n: unknown, fallback: number, min = 0, max = 5): number {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.min(max, Math.max(min, v))
}

function clampHours(n: unknown, fallback: number): number {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.min(400, Math.max(1, Math.round(v)))
}

function clampGel(n: unknown, fallback: number): number {
  if (n === undefined || n === null || n === '') return fallback
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.min(500, Math.max(0, Math.round(v)))
}

export function normalizePayrollAccrualRules(
  raw?: Partial<PayrollAccrualRules> | null,
): PayrollAccrualRules {
  const d = DEFAULT_PAYROLL_ACCRUAL_RULES
  return {
    nightMultiplier: clampMult(raw?.nightMultiplier, d.nightMultiplier, 1, 3),
    idleMultiplier: clampMult(raw?.idleMultiplier, d.idleMultiplier, 0, 2),
    otDayMultiplier: clampMult(raw?.otDayMultiplier, d.otDayMultiplier, 1, 3),
    otNightMultiplier: clampMult(raw?.otNightMultiplier, d.otNightMultiplier, 1, 3),
    nightLineFixedGel: clampGel(raw?.nightLineFixedGel, d.nightLineFixedGel),
    shiftMonthHours: clampHours(raw?.shiftMonthHours, d.shiftMonthHours),
    schedule52MonthHours: clampHours(raw?.schedule52MonthHours, d.schedule52MonthHours),
  }
}

export function resolvePayrollAccrualRules(
  settings?: AppStore['settings'] | null,
): PayrollAccrualRules {
  return normalizePayrollAccrualRules(settings?.payrollAccrual)
}

/** Множитель → проценты для UI (1.25 → 125). */
export function multiplierToPercent(m: number): number {
  return Math.round(m * 1000) / 10
}

/** Проценты UI → множитель (125 → 1.25). */
export function percentToMultiplier(p: number): number {
  if (!Number.isFinite(p)) return 0
  return Math.round((p / 100) * 1000) / 1000
}
