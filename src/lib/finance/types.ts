/** Финансовый отдел: авансы, премии/штрафы, выплаты, подтверждение больничных, снимок начислений. */

export type FinancePaymentMethod = 'cash' | 'card' | 'bank'

export type FinanceActor = {
  byId?: string
  byName?: string
}

/** Выданный аванс (часть зарплаты вперёд). */
export type FinanceAdvance = {
  id: string
  employeeId: string
  /** Месяц начисления (YYYY-MM). */
  month: string
  /** Дата выдачи (YYYY-MM-DD). */
  date: string
  amount: number
  method: FinancePaymentMethod
  note?: string
  byId?: string
  byName?: string
  at: string
}

export type FinanceAdjustmentKind = 'bonus' | 'penalty'

/** Разовая премия (+) или штраф/удержание (−). */
export type FinanceAdjustment = {
  id: string
  employeeId: string
  month: string
  kind: FinanceAdjustmentKind
  /** Всегда положительное число; знак определяется kind. */
  amount: number
  reason: string
  date: string
  byId?: string
  byName?: string
  at: string
}

/** Факт выплаты «к выплате» за месяц (полностью или частично). */
export type FinancePayout = {
  id: string
  employeeId: string
  month: string
  date: string
  amount: number
  method: FinancePaymentMethod
  note?: string
  byId?: string
  byName?: string
  at: string
}

/** Подтверждение больничного (за месяц) с приложенным бюллетенем. */
export type SickConfirmation = {
  id: string
  employeeId: string
  /** Месяц (YYYY-MM) — подтверждает все дни «Б» этого месяца. */
  month: string
  confirmedAt: string
  byId?: string
  byName?: string
  /** Фото/скан бюллетеня (data URL). */
  fileUrl?: string
  fileName?: string
  note?: string
}

/** Строка зафиксированного расчёта за месяц. */
export type PayrollSnapshotRow = {
  employeeId: string
  /** Начислено (gross): база + ночь + сверхурочные + отпускные + больничные. */
  accrued: number
  bonus: number
  /** Бригадирская премия (авторасчёт). Опционально для совместимости со старыми снимками. */
  brigadierBonus?: number
  penalty: number
  advance: number
  /** К выплате = accrued + bonus + бригадирская − penalty − advance. */
  net: number
  factHours: number
}

/** Снимок расчёта при закрытии месяца — иммутабельная история. */
export type PayrollSnapshot = {
  month: string
  at: string
  byId?: string
  byName?: string
  rows: PayrollSnapshotRow[]
}

export type FinanceStore = {
  advances: FinanceAdvance[]
  adjustments: FinanceAdjustment[]
  payouts: FinancePayout[]
  sickConfirmations: SickConfirmation[]
  /** Снимки начислений по месяцам (ключ — YYYY-MM). */
  snapshots: Record<string, PayrollSnapshot>
}
