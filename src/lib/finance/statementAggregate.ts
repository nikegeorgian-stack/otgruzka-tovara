import type { StatementRow } from './calc'
import type { PayBreakdown } from '@/lib/payroll'
import { roundMoney } from './money'

/** One stable owner of employee-level transactions, independent of current HR brigade. */
export function financeOwnerRows(
  rows: { id: string; employeeId?: string | null }[],
): Map<string, string> {
  const owners = new Map<string, string>()
  for (const row of [...rows].sort((a, b) => a.id.localeCompare(b.id))) {
    if (row.employeeId && !owners.has(row.employeeId)) owners.set(row.employeeId, row.id)
  }
  return owners
}

/** Row-level brigade reporting stays intact; the personal payslip sums all periods. */
export function aggregateEmployeeStatementRows(rows: StatementRow[]): StatementRow | undefined {
  const first = rows[0]
  if (!first || rows.length === 1) return first
  const total = structuredClone(first)
  const amountKeys = [
    'accrued',
    'bonus',
    'autoBonus',
    'productivityBonus',
    'otherManualBonus',
    'brigadierBonus',
    'penalty',
    'advance',
    'mealDeduction',
    'net',
    'paid',
    'remaining',
  ] as const
  const hourKeys = [
    'planHours',
    'factHours',
    'workFactHours',
    'baseHours',
    'overtimeHours',
    'monthDeltaOtHours',
    'otDayHours',
    'otNightHours',
    'nightShiftHours',
    'idleHours',
    'nightLineNights',
    'nightLineBonus',
  ] as const
  for (const key of amountKeys)
    total[key] = roundMoney(rows.reduce((sum, row) => sum + row[key], 0))
  total.factHours = rows.reduce((sum, row) => sum + row.factHours, 0)
  for (const key of Object.keys(total.breakdown) as (keyof PayBreakdown)[]) {
    total.breakdown[key] = roundMoney(rows.reduce((sum, row) => sum + row.breakdown[key], 0))
  }
  for (const key of hourKeys)
    total.hourDetail[key] = rows.reduce((sum, row) => sum + row.hourDetail[key], 0)
  const sameRate = rows.every((row) => row.hourDetail.hourlyRate === first.hourDetail.hourlyRate)
  total.hourDetail.mixedRates = !sameRate
  if (!sameRate) total.hourDetail.hourlyRate = 0
  total.hourDetail.unavailable = rows.some((row) => row.hourDetail.unavailable)
  const brig = rows.flatMap((row) => (row.hourDetail.brigadier ? [row.hourDetail.brigadier] : []))
  total.hourDetail.brigadier = brig.length
    ? {
        ...brig[0],
        brigadierDays: brig.reduce((s, b) => s + b.brigadierDays, 0),
        planBrigHours: brig.reduce((s, b) => s + b.planBrigHours, 0),
        factBrigHours: brig.reduce((s, b) => s + b.factBrigHours, 0),
        overtimeBrigHours: brig.reduce((s, b) => s + b.overtimeBrigHours, 0),
        amount: roundMoney(brig.reduce((s, b) => s + b.amount, 0)),
        hourlySupplement: brig.every((b) => b.hourlySupplement === brig[0].hourlySupplement)
          ? brig[0].hourlySupplement
          : 0,
      }
    : null
  total.brigade = [...new Set(rows.map((row) => row.brigade))].join(' / ')
  total.schedule = [...new Set(rows.map((row) => row.schedule))].join(' / ')
  total.rateLabel = [...new Set(rows.map((row) => row.rateLabel).filter(Boolean))].join(' / ')
  total.sickDates = [...new Set(rows.flatMap((row) => row.sickDates))].sort()
  total.vacationDates = [...new Set(rows.flatMap((row) => row.vacationDates))].sort()
  total.sickConfirmed = rows.every((row) => row.sickConfirmed || !row.sickDates.length)
  total.vacationConfirmed = rows.every((row) => row.vacationConfirmed || !row.vacationDates.length)
  total.frozen = rows.every((row) => row.frozen)
  return total
}
