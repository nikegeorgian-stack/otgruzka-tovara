import type { FinanceAdjustment } from './types'

/** Маркер причины в adjustment.reason — не показывать пользователю как есть. */
export const PRODUCTIVITY_BONUS_REASON = '__productivity__'

export function isProductivityBonusReason(reason: string): boolean {
  return reason === PRODUCTIVITY_BONUS_REASON
}

export function sumProductivityBonus(
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
        isProductivityBonusReason(a.reason) &&
        (!asOfDate || a.date <= asOfDate),
    )
    .reduce((s, a) => s + a.amount, 0)
}

export function adjustmentReasonLabel(
  reason: string,
  t: (key: string) => string,
): string {
  if (isProductivityBonusReason(reason)) return t('fin.col.productivityBonus')
  return reason
}
