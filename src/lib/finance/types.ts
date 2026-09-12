import type { StatementRow } from './calc'

/** Финансовый отдел: авансы, премии/штрафы, выплаты, подтверждение больничных, снимок начислений. */

export type FinancePaymentMethod = 'cash' | 'card' | 'bank'

export type FinanceActor = {
  byId?: string
  byName?: string
}

/**
 * АВ / ЗП (выдача денег):
 * draft → ready (к выплате, пакет бухгалтеру) → paid (отмечено выплаченным) | void
 * Legacy `posted` при загрузке мигрирует в `paid`.
 */
export type FinanceDisbursementDocStatus = 'draft' | 'ready' | 'paid' | 'void'

/**
 * НА (начисление аванса, без факта денег): draft → posted | void
 * Поле status на документах АВ/ЗП тоже использует этот union + ready/paid.
 */
export type FinanceAdvanceDocumentStatus =
  | FinanceDisbursementDocStatus
  | 'posted'

/** Строка журнального документа на выдачу авансов. */
export type FinanceAdvanceDocumentLine = {
  id: string
  employeeId: string
  amount: number
  note?: string
}

/** Журнальный документ: ведомость на выдачу авансов. */
export type FinanceAdvanceDocument = {
  id: string
  /** АВ-202606-001 */
  number: string
  /** Месяц начисления (YYYY-MM). */
  month: string
  /** Дата выдачи (YYYY-MM-DD). */
  date: string
  method: FinancePaymentMethod
  status: FinanceAdvanceDocumentStatus
  lines: FinanceAdvanceDocumentLine[]
  purpose?: string
  byId?: string
  byName?: string
  at: string
  /** Когда подготовлен к выплате (пакет бухгалтеру). */
  readyAt?: string
  /** Когда отмечен выплаченным (созданы факты аванса). Legacy: postedAt. */
  postedAt?: string
  /** Когда выгружен пакет (Excel/JSON) бухгалтеру / Balance. */
  exportedAt?: string
  exportedBy?: string
  exportedByName?: string
  voidedAt?: string
  voidReason?: string
}

/** Способ расчёта суммы аванса для сотрудника. */
export type AdvanceAccrualMode = 'percent' | 'fixed'

/** Строка ведомости начисления авансов (положено, ещё не выдача). */
export type FinanceAdvanceAccrualLine = {
  id: string
  employeeId: string
  amount: number
  mode: AdvanceAccrualMode
  /** % от оклада, если mode=percent. */
  percent?: number
  /** Оклад, от которого считали %. */
  salaryBase?: number
  note?: string
}

/** Ведомость начисления авансов за месяц (НА-…). */
export type FinanceAdvanceAccrualDocument = {
  id: string
  /** НА-202606-001 */
  number: string
  month: string
  status: FinanceAdvanceDocumentStatus
  lines: FinanceAdvanceAccrualLine[]
  purpose?: string
  /** Связанный документ выдачи АВ (если создали из начисления). */
  disbursementDocumentId?: string
  byId?: string
  byName?: string
  at: string
  /** Когда подготовлен к выплате (пакет бухгалтеру). */
  readyAt?: string
  /** Когда отмечен выплаченным (созданы факты аванса). Legacy: postedAt. */
  postedAt?: string
  /** Когда выгружен пакет бухгалтеру / Balance. */
  exportedAt?: string
  exportedBy?: string
  exportedByName?: string
  voidedAt?: string
  voidReason?: string
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
  /** Журнальный документ-основание (если есть). */
  documentId?: string
  lineId?: string
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

/** Строка журнального документа на выдачу зарплаты. */
export type FinancePayoutDocumentLine = {
  id: string
  employeeId: string
  amount: number
  note?: string
}

/** Журнальный документ: ведомость на выдачу зарплаты. */
export type FinancePayoutDocument = {
  id: string
  /** ЗП-202606-001 */
  number: string
  month: string
  date: string
  method: FinancePaymentMethod
  status: FinanceAdvanceDocumentStatus
  lines: FinancePayoutDocumentLine[]
  purpose?: string
  byId?: string
  byName?: string
  at: string
  /** Когда подготовлен к выплате (пакет бухгалтеру). */
  readyAt?: string
  /** Когда отмечен выплаченным (созданы факты аванса). Legacy: postedAt. */
  postedAt?: string
  /** Когда выгружен пакет бухгалтеру / Balance. */
  exportedAt?: string
  exportedBy?: string
  exportedByName?: string
  voidedAt?: string
  voidReason?: string
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
  /** Журнальный документ-основание (если есть). */
  documentId?: string
  lineId?: string
  byId?: string
  byName?: string
  at: string
}

/** Подтверждение больничного или отпуска (за месяц). */
export type AbsenceConfirmation = {
  id: string
  employeeId: string
  /** Месяц (YYYY-MM) — подтверждает все дни «Б» / «ОТ» этого месяца. */
  month: string
  confirmedAt: string
  byId?: string
  byName?: string
  /** Фото/скан документа (data URL). */
  fileUrl?: string
  fileName?: string
  note?: string
}

/** @deprecated Используйте AbsenceConfirmation */
export type SickConfirmation = AbsenceConfirmation

export type VacationConfirmation = AbsenceConfirmation

/** Строка зафиксированного расчёта за месяц. */
export type PayrollSnapshotRow = {
  employeeId: string
  /** Строка табеля — чтобы при переводе в две бригады не дублировать весь оклад. */
  rowId?: string
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
  /** V2: complete accrual explanation and employee identity, without live payments. */
  statement?: Omit<StatementRow, 'paid' | 'remaining' | 'frozen'>
}

/** Снимок расчёта при закрытии месяца — иммутабельная история. */
export type PayrollSnapshot = {
  version?: 2
  month: string
  at: string
  byId?: string
  byName?: string
  rows: PayrollSnapshotRow[]
}

export type FinanceStore = {
  advances: FinanceAdvance[]
  /** Журнальные документы на выдачу авансов. */
  advanceDocuments?: FinanceAdvanceDocument[]
  /** Ведомости начисления авансов (положено). */
  advanceAccruals?: FinanceAdvanceAccrualDocument[]
  /** Журнальные документы на выдачу зарплаты. */
  payoutDocuments?: FinancePayoutDocument[]
  adjustments: FinanceAdjustment[]
  payouts: FinancePayout[]
  sickConfirmations: SickConfirmation[]
  vacationConfirmations: VacationConfirmation[]
  /** Снимки начислений по месяцам (ключ — YYYY-MM). */
  snapshots: Record<string, PayrollSnapshot>
  /** Previous approved versions; never replaced by a recalculation. */
  snapshotHistory?: Record<string, PayrollSnapshot>
}
