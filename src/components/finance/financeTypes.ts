import type {
  AddAdjustmentInput,
  AddPayoutInput,
  ConfirmSickInput,
  GiveAdvanceInput,
} from '@/store/slices/financeSlice'

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
  /** Полная бригадирская премия за месяц (₾). */
  onSetBrigadierBonus: (amount: number) => void
}
