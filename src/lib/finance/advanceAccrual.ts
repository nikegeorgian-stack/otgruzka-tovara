import { filterEmployeesForMonth } from '@/lib/hr/employeeActive'
import { effectiveSalaryWithBonus } from '@/lib/payrollRates'
import type { AppStore, Employee } from '@/lib/types'
import { getFinance } from './calc'
import type {
  FinanceAdvanceAccrualDocument,
  FinanceAdvanceAccrualLine,
  FinanceAdvanceDocumentStatus,
  FinanceStore,
} from './types'

export const DEFAULT_ADVANCE_PERCENT = 30

export function defaultAdvancePercent(store: AppStore): number {
  const n = store.settings.defaultAdvancePercent
  if (typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100) return n
  return DEFAULT_ADVANCE_PERCENT
}

export type ResolvedAdvanceProposal = {
  employeeId: string
  employeeName: string
  amount: number
  mode: 'percent' | 'fixed'
  percent?: number
  salaryBase?: number
  skipped?: 'none' | 'no_salary'
}

/** Сколько аванса положено сотруднику по правилу (без округления до целых — округляем в propose). */
export function resolveEmployeeAdvanceAmount(
  emp: Employee,
  defaultPercent: number,
): ResolvedAdvanceProposal {
  const name = emp.fullName || emp.nameKa || emp.id.slice(0, 8)
  const rule = emp.advanceRule ?? 'default'
  const salary = effectiveSalaryWithBonus(emp)

  if (rule === 'none') {
    return { employeeId: emp.id, employeeName: name, amount: 0, mode: 'percent', skipped: 'none' }
  }
  if (rule === 'fixed') {
    const amount = Math.max(0, emp.advanceFixedAmount ?? 0)
    return {
      employeeId: emp.id,
      employeeName: name,
      amount,
      mode: 'fixed',
      skipped: amount > 0 ? undefined : 'no_salary',
    }
  }

  const percent =
    rule === 'percent' && typeof emp.advancePercent === 'number'
      ? emp.advancePercent
      : defaultPercent
  if (salary <= 0) {
    return {
      employeeId: emp.id,
      employeeName: name,
      amount: 0,
      mode: 'percent',
      percent,
      salaryBase: 0,
      skipped: 'no_salary',
    }
  }
  const amount = (salary * percent) / 100
  return {
    employeeId: emp.id,
    employeeName: name,
    amount,
    mode: 'percent',
    percent,
    salaryBase: salary,
  }
}

export function proposeAdvanceAccrualLines(
  store: AppStore,
  month: string,
): { lines: FinanceAdvanceAccrualLine[]; skipped: ResolvedAdvanceProposal[] } {
  const pct = defaultAdvancePercent(store)
  const emps = filterEmployeesForMonth(store.employees, month).filter((e) => e.active)
  const lines: FinanceAdvanceAccrualLine[] = []
  const skipped: ResolvedAdvanceProposal[] = []

  for (const emp of emps) {
    const proposal = resolveEmployeeAdvanceAmount(emp, pct)
    if (proposal.amount <= 0) {
      skipped.push(proposal)
      continue
    }
    lines.push({
      id: crypto.randomUUID(),
      employeeId: emp.id,
      amount: Math.round(proposal.amount),
      mode: proposal.mode,
      percent: proposal.percent,
      salaryBase: proposal.salaryBase,
    })
  }

  lines.sort((a, b) => {
    const na = store.employees.find((e) => e.id === a.employeeId)?.fullName ?? ''
    const nb = store.employees.find((e) => e.id === b.employeeId)?.fullName ?? ''
    return na.localeCompare(nb, 'ru')
  })
  return { lines, skipped }
}

export function advanceAccrualsList(fin: FinanceStore): FinanceAdvanceAccrualDocument[] {
  return fin.advanceAccruals ?? []
}

export function advanceAccrualById(
  fin: FinanceStore,
  id: string,
): FinanceAdvanceAccrualDocument | undefined {
  return advanceAccrualsList(fin).find((d) => d.id === id)
}

export function nextAdvanceAccrualNumber(fin: FinanceStore, month: string): string {
  const prefix = `НА-${month.replace('-', '')}-`
  const same = advanceAccrualsList(fin).filter((d) => d.number.startsWith(prefix))
  const maxSeq = same.reduce((max, d) => {
    const n = parseInt(d.number.slice(prefix.length), 10)
    return Number.isFinite(n) ? Math.max(max, n) : max
  }, 0)
  return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`
}

export function listAdvanceAccruals(
  fin: FinanceStore,
  opts: { month?: string; status?: FinanceAdvanceDocumentStatus | 'all'; includeVoid?: boolean } = {},
): FinanceAdvanceAccrualDocument[] {
  const { month, status = 'all', includeVoid = true } = opts
  let list = advanceAccrualsList(fin)
  if (month) list = list.filter((d) => d.month === month)
  if (status !== 'all') list = list.filter((d) => d.status === status)
  if (!includeVoid) list = list.filter((d) => d.status !== 'void')
  return list.sort((a, b) => b.number.localeCompare(a.number, 'ru'))
}

export function accrualLineTotal(lines: FinanceAdvanceAccrualLine[]): number {
  return lines.reduce((s, l) => s + Math.round(l.amount), 0)
}

export function normalizeAccrualLines(
  lines: {
    id?: string
    employeeId: string
    amount: number
    mode?: 'percent' | 'fixed'
    percent?: number
    salaryBase?: number
    note?: string
  }[],
): FinanceAdvanceAccrualLine[] {
  return lines
    .filter((l) => l.employeeId && l.amount > 0)
    .map((l) => ({
      id: l.id ?? crypto.randomUUID(),
      employeeId: l.employeeId,
      amount: Math.round(l.amount),
      mode: l.mode ?? 'percent',
      percent: l.percent,
      salaryBase: l.salaryBase,
      note: l.note?.trim() || undefined,
    }))
}

/** Сумма проведённых начислений аванса сотруднику за месяц. */
export function accruedAdvanceForEmployee(
  fin: FinanceStore,
  employeeId: string,
  month: string,
): number {
  let sum = 0
  for (const doc of advanceAccrualsList(fin)) {
    if (doc.month !== month || doc.status !== 'posted') continue
    for (const line of doc.lines) {
      if (line.employeeId === employeeId) sum += Math.round(line.amount)
    }
  }
  return sum
}

/** Сумма выданных авансов сотруднику за месяц. */
export function paidAdvanceForEmployee(
  fin: FinanceStore,
  employeeId: string,
  month: string,
): number {
  return fin.advances
    .filter((a) => a.employeeId === employeeId && a.month === month)
    .reduce((s, a) => s + Math.round(a.amount), 0)
}

export function employeeAdvanceSummary(store: AppStore, employeeId: string, month: string) {
  const fin = getFinance(store)
  const accrued = accruedAdvanceForEmployee(fin, employeeId, month)
  const paid = paidAdvanceForEmployee(fin, employeeId, month)
  return {
    accrued,
    paid,
    remainingToPay: Math.max(0, accrued - paid),
  }
}
