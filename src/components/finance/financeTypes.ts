import type {
  AddAdjustmentInput,
  AddPayoutInput,
  ConfirmSickInput,
  ConfirmVacationInput,
  GiveAdvanceInput,
  SaveAdvanceAccrualInput,
  SaveAdvanceDocumentInput,
  SavePayoutDocumentInput,
} from '@/store/slices/financeSlice'
import type { FinancePaymentMethod } from '@/lib/finance/types'

/** Колбэки финансовых операций (actor подставляется в App.tsx). */
export type FinanceActions = {
  onGiveAdvance: (input: GiveAdvanceInput) => void
  onRemoveAdvance: (id: string) => void
  onAddAdjustment: (input: AddAdjustmentInput) => void
  onRemoveAdjustment: (id: string) => void
  onAddPayout: (input: AddPayoutInput) => void
  onRemovePayout: (id: string) => void
  onConfirmSick: (input: ConfirmSickInput) => void
  onUnconfirmSick: (employeeId: string, month: string) => void
  onConfirmVacation: (input: ConfirmVacationInput) => void
  onUnconfirmVacation: (employeeId: string, month: string) => void
  /** Полная бригадирская премия за месяц (₾). */
  onSetBrigadierBonus: (amount: number) => void
}

export type FinanceDocumentActions = {
  onSaveAdvanceDocument: (input: SaveAdvanceDocumentInput) => void
  onPrepareAdvanceDocument: (id: string) => void
  onUnprepareAdvanceDocument: (id: string) => void
  onPostAdvanceDocument: (id: string) => void
  onVoidAdvanceDocument: (id: string, reason?: string) => void
  onDeleteAdvanceDocumentDraft: (id: string) => void
  onSaveAdvanceAccrual: (input: SaveAdvanceAccrualInput) => void
  onPostAdvanceAccrual: (id: string) => void
  onVoidAdvanceAccrual: (id: string, reason?: string) => void
  onDeleteAdvanceAccrualDraft: (id: string) => void
  onCreateDisbursementFromAccrual: (
    accrualId: string,
    opts: { date: string; method: FinancePaymentMethod; purpose?: string },
  ) => string | null
  onSavePayoutDocument: (input: SavePayoutDocumentInput) => void
  onPreparePayoutDocument: (id: string) => void
  onUnpreparePayoutDocument: (id: string) => void
  onPostPayoutDocument: (id: string) => void
  onVoidPayoutDocument: (id: string, reason?: string) => void
  onDeletePayoutDocumentDraft: (id: string) => void
  /** Отметить пакет АВ/ЗП/НА выгруженным бухгалтеру */
  onMarkFinanceDocExported?: (
    kind: 'advance' | 'payout' | 'accrual',
    id: string,
  ) => void
}
