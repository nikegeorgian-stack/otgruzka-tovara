import type { WorkwearIssuance } from './types'

export type WorkwearAmortizationState = {
  totalCost: number
  monthsElapsed: number
  amortizationMonths: number
  depreciated: number
  residualValue: number
  fullyAmortized: boolean
  monthlyDepreciation: number
}

function monthsBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T12:00:00`)
  const to = new Date(`${toIso}T12:00:00`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0
  let months =
    (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth())
  if (to.getDate() < from.getDate()) months -= 1
  return Math.max(0, months)
}

/** Линейная амортизация от даты выдачи */
export function calcWorkwearAmortization(
  issuance: Pick<
    WorkwearIssuance,
    'issueDate' | 'unitPrice' | 'quantity' | 'amortizationMonths'
  >,
  asOfDate: string,
): WorkwearAmortizationState {
  const totalCost = issuance.unitPrice * issuance.quantity
  const amortizationMonths = Math.max(1, issuance.amortizationMonths)
  const monthsElapsed = monthsBetween(issuance.issueDate, asOfDate)
  const monthlyDepreciation = totalCost / amortizationMonths
  const depreciated = Math.min(monthsElapsed, amortizationMonths) * monthlyDepreciation
  const residualValue = Math.max(0, totalCost - depreciated)
  return {
    totalCost,
    monthsElapsed,
    amortizationMonths,
    depreciated,
    residualValue,
    fullyAmortized: monthsElapsed >= amortizationMonths,
    monthlyDepreciation,
  }
}

/** Сумма удержания при увольнении (остаточная стоимость всех невыработанных выдач) */
export function calcWorkwearWithholding(
  issuances: WorkwearIssuance[],
  asOfDate: string,
): number {
  return issuances.reduce((sum, iss) => {
    const { residualValue, fullyAmortized } = calcWorkwearAmortization(iss, asOfDate)
    return sum + (fullyAmortized ? 0 : residualValue)
  }, 0)
}
