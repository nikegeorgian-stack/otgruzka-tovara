import type {
  FinanceAdjustment,
  FinanceAdvance,
  FinanceAdvanceAccrualDocument,
  FinanceAdvanceDocument,
  FinancePayoutDocument,
  FinancePayout,
  FinanceStore,
  PayrollSnapshot,
  SickConfirmation,
  VacationConfirmation,
} from './types'
import { migrateAdvanceOrPayoutDocument } from './disbursementDocStatus'

export function createDefaultFinanceStore(): FinanceStore {
  return {
    advances: [],
    advanceDocuments: [],
    advanceAccruals: [],
    payoutDocuments: [],
    adjustments: [],
    payouts: [],
    sickConfirmations: [],
    vacationConfirmations: [],
    snapshots: {},
    snapshotHistory: {},
  }
}

/**
 * Защитная нормализация финансового стора при загрузке.
 * Поле добавлено аддитивно (без подъёма версии схемы), поэтому у старых
 * данных его может не быть — возвращаем дефолт.
 */
export function normalizeFinanceStore(raw: unknown): FinanceStore {
  const base = createDefaultFinanceStore()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Partial<FinanceStore>
  return {
    advances: Array.isArray(r.advances) ? (r.advances as FinanceAdvance[]) : [],
    advanceDocuments: Array.isArray(r.advanceDocuments)
      ? (r.advanceDocuments as FinanceAdvanceDocument[]).map(migrateAdvanceOrPayoutDocument)
      : [],
    advanceAccruals: Array.isArray(r.advanceAccruals)
      ? (r.advanceAccruals as FinanceAdvanceAccrualDocument[])
      : [],
    payoutDocuments: Array.isArray(r.payoutDocuments)
      ? (r.payoutDocuments as FinancePayoutDocument[]).map(migrateAdvanceOrPayoutDocument)
      : [],
    adjustments: Array.isArray(r.adjustments) ? (r.adjustments as FinanceAdjustment[]) : [],
    payouts: Array.isArray(r.payouts) ? (r.payouts as FinancePayout[]) : [],
    sickConfirmations: Array.isArray(r.sickConfirmations)
      ? (r.sickConfirmations as SickConfirmation[])
      : [],
    vacationConfirmations: Array.isArray(r.vacationConfirmations)
      ? (r.vacationConfirmations as VacationConfirmation[])
      : [],
    snapshots:
      r.snapshots && typeof r.snapshots === 'object'
        ? (r.snapshots as Record<string, PayrollSnapshot>)
        : {},
    snapshotHistory:
      r.snapshotHistory && typeof r.snapshotHistory === 'object' ? r.snapshotHistory : {},
  }
}
