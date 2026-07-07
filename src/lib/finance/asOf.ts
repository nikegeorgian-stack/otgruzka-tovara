import { getFinance } from './calc'
import type { FinanceAdjustment } from './types'
import type { AppStore } from '@/lib/types'

export type FinanceAsOfTotals = {
  advances: number
  payouts: number
  bonus: number
  penalty: number
}

function sumByDate<T extends { date: string; amount: number }>(
  rows: T[],
  asOfDate: string,
): number {
  return rows
    .filter((r) => r.date <= asOfDate)
    .reduce((s, r) => s + r.amount, 0)
}

/** Суммы финансовых операций сотрудника за месяц на дату (включительно). */
export function financeTotalsAsOf(
  store: AppStore,
  employeeId: string,
  month: string,
  asOfDate: string,
): FinanceAsOfTotals {
  const fin = getFinance(store)
  const advances = sumByDate(
    fin.advances.filter((a) => a.employeeId === employeeId && a.month === month),
    asOfDate,
  )
  const payouts = sumByDate(
    fin.payouts.filter((p) => p.employeeId === employeeId && p.month === month),
    asOfDate,
  )
  const bonus = sumByDate(
    fin.adjustments.filter(
      (a) => a.employeeId === employeeId && a.month === month && a.kind === 'bonus',
    ),
    asOfDate,
  )
  const penalty = sumByDate(
    fin.adjustments.filter(
      (a) => a.employeeId === employeeId && a.month === month && a.kind === 'penalty',
    ),
    asOfDate,
  )
  return { advances, payouts, bonus, penalty }
}

/** Все авансы/выплаты/корректировки месяца на дату (для сводки). */
export function financeMonthTotalsAsOf(
  store: AppStore,
  month: string,
  asOfDate: string,
): FinanceAsOfTotals {
  const fin = getFinance(store)
  const inMonth = <T extends { month: string; date: string; amount: number }>(rows: T[]) =>
    rows.filter((r) => r.month === month)

  return {
    advances: sumByDate(inMonth(fin.advances), asOfDate),
    payouts: sumByDate(inMonth(fin.payouts), asOfDate),
    bonus: sumByDate(
      inMonth(fin.adjustments.filter((a) => a.kind === 'bonus')) as FinanceAdjustment[],
      asOfDate,
    ),
    penalty: sumByDate(
      inMonth(fin.adjustments.filter((a) => a.kind === 'penalty')) as FinanceAdjustment[],
      asOfDate,
    ),
  }
}
