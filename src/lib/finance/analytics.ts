import { monthStatement, statementTotals, getFinance } from './calc'
import { monthStats } from '../stats'
import { isMonthClosed } from '../monthManage'
import { employeeActiveInMonth } from '../hr/employeeActive'
import { isPayableInMonth } from '../payroll'
import type { AppStore } from '@/lib/types'
import type { FinanceAdvance, FinancePaymentMethod, FinancePayout } from './types'

export type FinanceDebtRow = {
  employeeId: string
  name: string
  brigade: string
  remaining: number
  net: number
  paid: number
}

export type FinanceBrigadeBar = {
  label: string
  headcount: number
  factHours: number
}

export type FinancePayrollFlow = {
  key: 'accrued' | 'bonus' | 'penalty' | 'advance' | 'paid' | 'remaining'
  amount: number
}

export type FinancePayoutDay = {
  date: string
  advances: number
  payouts: number
  total: number
}

export type FinancePaymentJournalRow = {
  id: string
  at: string
  date: string
  kind: 'advance' | 'payout'
  employeeId: string
  employeeName: string
  amount: number
  method: FinancePaymentMethod
  note?: string
  byName?: string
}

export type FinanceDashboard = {
  month: string
  monthClosed: boolean
  readyToClose: boolean
  activeEmployees: number
  payrollRows: number
  totalAccrued: number
  totalBonus: number
  totalPenalty: number
  totalAdvance: number
  totalNet: number
  totalPaid: number
  totalRemaining: number
  employeesWithDebt: number
  sickPending: number
  noRateCount: number
  planHours: number
  factHours: number
  fillRatePct: number
  debtRows: FinanceDebtRow[]
  brigadeBars: FinanceBrigadeBar[]
  payrollFlow: FinancePayrollFlow[]
  payoutByDay: FinancePayoutDay[]
}

function sickDaysUnconfirmed(store: AppStore, month: string): number {
  const sheet = store.months[month]
  if (!sheet) return 0
  const fin = store.finance
  let n = 0
  for (const row of sheet.rows) {
    if (!row.employeeId) continue
    const emp = store.employees.find((e) => e.id === row.employeeId)
    if (!emp || !isPayableInMonth(emp, month)) continue
    const confirmed = fin?.sickConfirmations.some(
      (c) => c.employeeId === emp.id && c.month === month,
    )
    if (confirmed) continue
    const hasSick = Object.values(sheet.fact[row.id] ?? {}).some((m) => m === 'Б')
    if (hasSick) n++
  }
  return n
}

function employeeHasRate(emp: AppStore['employees'][0]): boolean {
  if (emp.schedule === '5/2 8ч') return (emp.monthlySalary ?? 0) > 0
  return (emp.hourlyRate ?? 0) > 0
}

function empName(store: AppStore, id: string): string {
  return store.employees.find((e) => e.id === id)?.fullName ?? id
}

function buildPayoutByDay(
  advances: FinanceAdvance[],
  payouts: FinancePayout[],
  month: string,
): FinancePayoutDay[] {
  const map = new Map<string, { advances: number; payouts: number }>()
  for (const a of advances) {
    if (a.month !== month) continue
    const cur = map.get(a.date) ?? { advances: 0, payouts: 0 }
    cur.advances += a.amount
    map.set(a.date, cur)
  }
  for (const p of payouts) {
    if (p.month !== month) continue
    const cur = map.get(p.date) ?? { advances: 0, payouts: 0 }
    cur.payouts += p.amount
    map.set(p.date, cur)
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
      advances: v.advances,
      payouts: v.payouts,
      total: v.advances + v.payouts,
    }))
}

/** Журнал исходящих выплат и авансов за месяц. */
export function financePaymentJournal(store: AppStore, month: string, asOfDate?: string): FinancePaymentJournalRow[] {
  const fin = getFinance(store)
  const rows: FinancePaymentJournalRow[] = []
  for (const a of fin.advances) {
    if (a.month !== month) continue
    if (asOfDate && a.date > asOfDate) continue
    rows.push({
      id: a.id,
      at: a.at,
      date: a.date,
      kind: 'advance',
      employeeId: a.employeeId,
      employeeName: empName(store, a.employeeId),
      amount: a.amount,
      method: a.method,
      note: a.note,
      byName: a.byName,
    })
  }
  for (const p of fin.payouts) {
    if (p.month !== month) continue
    if (asOfDate && p.date > asOfDate) continue
    rows.push({
      id: p.id,
      at: p.at,
      date: p.date,
      kind: 'payout',
      employeeId: p.employeeId,
      employeeName: empName(store, p.employeeId),
      amount: p.amount,
      method: p.method,
      note: p.note,
      byName: p.byName,
    })
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at))
}

/** Сводка для аналитического дашборда финансового отдела. */
export function computeFinanceDashboard(
  store: AppStore,
  month: string,
  asOfDate?: string,
): FinanceDashboard {
  const rows = monthStatement(store, month, asOfDate)
  const totals = statementTotals(rows)
  const sheet = store.months[month]
  const mStats = sheet ? monthStats(sheet, store.employees) : null

  const debtRows: FinanceDebtRow[] = rows
    .filter((r) => r.remaining > 0.01)
    .map((r) => ({
      employeeId: r.employeeId,
      name: r.emp.fullName,
      brigade: r.brigade || '—',
      remaining: r.remaining,
      net: r.net,
      paid: r.paid,
    }))
    .sort((a, b) => b.remaining - a.remaining)

  const brigadeMap = new Map<string, { headcount: number; factHours: number }>()
  for (const r of rows) {
    const key = r.brigade?.trim() || '—'
    const cur = brigadeMap.get(key) ?? { headcount: 0, factHours: 0 }
    cur.headcount++
    cur.factHours += r.factHours
    brigadeMap.set(key, cur)
  }
  const brigadeBars: FinanceBrigadeBar[] = [...brigadeMap.entries()]
    .map(([label, v]) => ({ label, ...v }))
    .sort((a, b) => b.factHours - a.factHours)

  const activeEmployees = store.employees.filter((e) => employeeActiveInMonth(e, month)).length
  const payrollEmpIds = new Set(rows.map((r) => r.employeeId))
  const noRateCount = store.employees.filter(
    (e) => employeeActiveInMonth(e, month) && payrollEmpIds.has(e.id) && !employeeHasRate(e),
  ).length

  const fin = getFinance(store)
  const monthClosed = isMonthClosed(store, month)
  const readyToClose =
    !monthClosed &&
    rows.length > 0 &&
    totals.remaining < 0.01 &&
    sickDaysUnconfirmed(store, month) === 0

  return {
    month,
    monthClosed,
    readyToClose,
    activeEmployees,
    payrollRows: rows.length,
    totalAccrued: totals.accrued,
    totalBonus: totals.bonus + totals.brigadierBonus,
    totalPenalty: totals.penalty,
    totalAdvance: totals.advance,
    totalNet: totals.net,
    totalPaid: totals.paid,
    totalRemaining: totals.remaining,
    employeesWithDebt: debtRows.length,
    sickPending: sickDaysUnconfirmed(store, month),
    noRateCount,
    planHours: mStats?.planHours ?? 0,
    factHours: mStats?.factHours ?? 0,
    fillRatePct: mStats ? Math.round(mStats.fillRate * 100) : 0,
    debtRows,
    brigadeBars,
    payrollFlow: [
      { key: 'accrued', amount: totals.accrued },
      { key: 'bonus', amount: totals.bonus + totals.brigadierBonus },
      { key: 'penalty', amount: totals.penalty },
      { key: 'advance', amount: totals.advance },
      { key: 'paid', amount: totals.paid },
      { key: 'remaining', amount: totals.remaining },
    ],
    payoutByDay: buildPayoutByDay(fin.advances, fin.payouts, month),
  }
}
