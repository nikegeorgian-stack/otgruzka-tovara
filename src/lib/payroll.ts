import { hoursForCode } from './codes'
import { dayDateKey } from './dates'
import {
  getFactExtraHours,
  isWorkCode,
  OVERTIME_EXTRA_MULTIPLIER,
} from './factExtra'
import { getFactMark, rowStats } from './stats'
import type { DayCode, Employee, MonthSheet } from './types'

export type PayRowResult = {
  factHours: number
  planHours: number
  amount: number
  rateLabel: string
}

function payForCode(code: DayCode, hourlyRate: number): number {
  const hours = hoursForCode(code)
  if (!hours || !hourlyRate) return 0
  if (code === 'Н') return hours * hourlyRate * 1.25
  if (code === '22') return hours * hourlyRate
  if (code === '8' || code === '11') return hours * hourlyRate
  return 0
}

export function calculateRowPay(
  emp: Employee,
  sheet: MonthSheet,
  rowId: string,
  year: number,
  month: number,
): PayRowResult {
  const days = new Date(year, month, 0).getDate()
  const rs = rowStats(sheet, rowId, days, year, month)

  if (emp.schedule === '5/2 8ч') {
    const salary = emp.monthlySalary ?? 0
    const amount =
      rs.planHours > 0 ? Math.round((salary * rs.factHours) / rs.planHours) : 0
    return {
      factHours: rs.factHours,
      planHours: rs.planHours,
      amount,
      rateLabel: salary ? `${salary.toLocaleString('ru-RU')} ₾/мес` : '—',
    }
  }

  const rate = emp.hourlyRate ?? 0
  let amount = 0
  for (let d = 1; d <= days; d++) {
    const key = dayDateKey(year, month, d)
    const code = getFactMark(sheet, rowId, key)
    amount += payForCode(code, rate)
    const extra = getFactExtraHours(sheet, rowId, key)
    if (extra > 0 && isWorkCode(code)) {
      amount += extra * rate * OVERTIME_EXTRA_MULTIPLIER
    }
  }

  return {
    factHours: rs.factHours,
    planHours: rs.planHours,
    amount: Math.round(amount),
    rateLabel: rate ? `${rate.toLocaleString('ru-RU')} ₾/ч` : '—',
  }
}

export function formatGel(n: number): string {
  return `${n.toLocaleString('ru-RU')} ₾`
}
