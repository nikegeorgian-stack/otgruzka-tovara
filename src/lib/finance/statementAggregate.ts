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

/**
 * Multi-row employees: display/export/snapshot row tetri must sum to the same
 * once-rounded employee total (1840/176×16 → 167.27, not 83.64+83.64=167.28).
 * Adjusts last period row so accrued + breakdown match Σexact → roundMoney once.
 */
export function reconcileMultiRowEmployeeTetri(rows: StatementRow[]): StatementRow[] {
  const groups = new Map<string, StatementRow[]>()
  for (const row of rows) {
    const list = groups.get(row.employeeId) ?? []
    list.push(row)
    groups.set(row.employeeId, list)
  }
  const adjusted = new Map<string, StatementRow>()
  for (const group of groups.values()) {
    if (group.length < 2 || !group.every((r) => typeof r.accruedExact === 'number')) {
      for (const r of group) adjusted.set(r.rowId, r)
      continue
    }
    const targetAccrued = roundMoney(group.reduce((s, r) => s + (r.accruedExact ?? 0), 0))
    const bdKeys = Object.keys(group[0].breakdown) as (keyof PayBreakdown)[]
    const targetBd = {} as PayBreakdown
    for (const key of bdKeys) {
      targetBd[key] = roundMoney(
        group.reduce((s, r) => s + (r.breakdownExact?.[key] ?? r.breakdown[key]), 0),
      )
    }
    let accruedRun = 0
    const bdRun: Partial<Record<keyof PayBreakdown, number>> = {}
    for (let i = 0; i < group.length; i++) {
      const row = group[i]
      const isLast = i === group.length - 1
      const accrued = isLast
        ? roundMoney(targetAccrued - accruedRun)
        : roundMoney(row.accruedExact!)
      if (!isLast) accruedRun = roundMoney(accruedRun + accrued)
      const breakdown = { ...row.breakdown }
      for (const key of bdKeys) {
        if (isLast) {
          breakdown[key] = roundMoney(targetBd[key] - (bdRun[key] ?? 0))
        } else {
          const part = roundMoney(row.breakdownExact?.[key] ?? row.breakdown[key])
          breakdown[key] = part
          bdRun[key] = roundMoney((bdRun[key] ?? 0) + part)
        }
      }
      const net = roundMoney(
        accrued + row.bonus + row.brigadierBonus - row.penalty - row.advance - row.mealDeduction,
      )
      adjusted.set(row.rowId, {
        ...row,
        accrued,
        breakdown,
        net,
        remaining: roundMoney(net - row.paid),
      })
    }
  }
  return rows.map((r) => adjusted.get(r.rowId) ?? r)
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
  // Accrued / base: sum exact then round once so 8h+8h === one 16h row (1840/176*16 → 167.27).
  const hasExact = rows.every((row) => typeof row.accruedExact === 'number')
  if (hasExact) {
    total.accrued = roundMoney(rows.reduce((sum, row) => sum + (row.accruedExact ?? 0), 0))
  }
  total.factHours = rows.reduce((sum, row) => sum + row.factHours, 0)
  for (const key of Object.keys(total.breakdown) as (keyof PayBreakdown)[]) {
    const exactSum = rows.reduce((sum, row) => {
      const exact = row.breakdownExact?.[key]
      return sum + (typeof exact === 'number' ? exact : row.breakdown[key])
    }, 0)
    total.breakdown[key] = roundMoney(exactSum)
  }
  if (hasExact) {
    total.net = roundMoney(
      total.accrued +
        total.bonus +
        total.brigadierBonus -
        total.penalty -
        total.advance -
        total.mealDeduction,
    )
    total.remaining = roundMoney(total.net - total.paid)
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
