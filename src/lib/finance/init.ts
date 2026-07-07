import type {
  FinanceAdjustment,
  FinanceAdvance,
  FinancePayout,
  FinanceStore,
  PayrollSnapshot,
  SickConfirmation,
} from './types'

export function createDefaultFinanceStore(): FinanceStore {
  return {
    advances: [],
    adjustments: [],
    payouts: [],
    sickConfirmations: [],
    snapshots: {},
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
    adjustments: Array.isArray(r.adjustments) ? (r.adjustments as FinanceAdjustment[]) : [],
    payouts: Array.isArray(r.payouts) ? (r.payouts as FinancePayout[]) : [],
    sickConfirmations: Array.isArray(r.sickConfirmations)
      ? (r.sickConfirmations as SickConfirmation[])
      : [],
    snapshots:
      r.snapshots && typeof r.snapshots === 'object'
        ? (r.snapshots as Record<string, PayrollSnapshot>)
        : {},
  }
}
