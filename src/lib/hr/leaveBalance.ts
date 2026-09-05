/**
 * Остаток отпускных дней.
 *
 * Правило начисления (FiberCell / Otgruzka):
 * за каждый **полный календарный месяц** в штате → +LEAVE_DAYS_PER_FULL_MONTH дней.
 * Месяц полный, если hireDate ≤ 1-е число месяца и увольнение отсутствует
 * либо terminationDate > последний день месяца.
 * Месяц приёма/увольнения «посередине» не даёт дней.
 *
 * Списание: дни отпусков (hrAbsences type=vacation), workDays или длина периода.
 * Ручные движения: leaveLedger (opening / adjustment / payout).
 */

import { daysInMonth, monthKey, parseMonthKey, shiftMonth } from '@/lib/dates'
import {
  LEAVE_DAYS_PER_FULL_MONTH,
  type LeaveLedgerEntry,
  type LeaveLedgerKind,
} from '@/lib/hr/types'
import type { Employee } from '@/lib/types'

export type LeaveBalanceBreakdown = {
  opening: number
  adjustments: number
  accrued: number
  /** Число полных месяцев, давших начисление. */
  accruedMonths: number
  used: number
  paidOut: number
  /** Текущий остаток (может быть отрицательным при перерасходе). */
  balance: number
  asOf: string
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function monthStart(month: string): string {
  return `${month}-01`
}

function monthEnd(month: string): string {
  const { year, month: m } = parseMonthKey(month)
  const d = daysInMonth(year, m)
  return `${month}-${String(d).padStart(2, '0')}`
}

function iterateMonthsInclusive(fromMonth: string, toMonth: string): string[] {
  if (!fromMonth || !toMonth || fromMonth > toMonth) return []
  const out: string[] = []
  let cur = fromMonth
  while (cur <= toMonth) {
    out.push(cur)
    cur = shiftMonth(cur, 1)
  }
  return out
}

/** Месяц полностью отработан в штате → даёт +2 дня. */
export function isFullCalendarMonthWorked(emp: Employee, month: string): boolean {
  const hire = emp.hireDate?.trim()
  if (!hire) return false
  const start = monthStart(month)
  const end = monthEnd(month)
  if (hire > start) return false
  const term = emp.terminationDate?.trim()
  if (term && term <= end) return false
  return true
}

export function listAccrualMonths(emp: Employee, asOf: string): string[] {
  const hire = emp.hireDate?.trim()
  if (!hire) return []
  const asOfDay = asOf.trim() || todayIso()
  const term = emp.terminationDate?.trim()
  const lastDay = term && term < asOfDay ? term : asOfDay
  // Начисление только за полностью закрытые месяцы к дате asOf
  // (месяц asOf считается, если asOf ≥ последний день месяца).
  const hireMonth = hire.slice(0, 7)
  let toMonth = lastDay.slice(0, 7)
  if (lastDay < monthEnd(toMonth)) {
    toMonth = shiftMonth(toMonth, -1)
  }
  if (toMonth < hireMonth) return []

  // Стартовый остаток уже включает начисление до даты opening — не дублируем.
  const openingAsOf = latestOpeningAsOf(emp)

  return iterateMonthsInclusive(hireMonth, toMonth).filter((m) => {
    if (!isFullCalendarMonthWorked(emp, m)) return false
    if (openingAsOf && monthEnd(m) <= openingAsOf) return false
    return true
  })
}

function latestOpeningAsOf(emp: Employee): string | undefined {
  let best: string | undefined
  for (const e of emp.leaveLedger ?? []) {
    if (e.kind !== 'opening') continue
    const d = e.date?.trim()
    if (!d) continue
    if (!best || d > best) best = d
  }
  return best
}

function vacationUsedDays(emp: Employee): number {
  let sum = 0
  for (const a of emp.hrAbsences ?? []) {
    if (a.type !== 'vacation') continue
    if (a.workDays != null && Number.isFinite(a.workDays)) {
      sum += Math.max(0, a.workDays)
      continue
    }
    // fallback: календарные дни включительно
    const t0 = Date.parse(a.startDate)
    const t1 = Date.parse(a.endDate)
    if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0) continue
    sum += Math.floor((t1 - t0) / 86400000) + 1
  }
  return sum
}

function sumLedger(
  ledger: LeaveLedgerEntry[] | undefined,
  kind: LeaveLedgerKind | LeaveLedgerKind[],
): number {
  const kinds = new Set(Array.isArray(kind) ? kind : [kind])
  let s = 0
  for (const e of ledger ?? []) {
    if (!kinds.has(e.kind)) continue
    s += e.days
  }
  return s
}

export function computeLeaveBalance(
  emp: Employee,
  asOf: string = todayIso(),
): LeaveBalanceBreakdown {
  const months = listAccrualMonths(emp, asOf)
  const accrued = months.length * LEAVE_DAYS_PER_FULL_MONTH
  const opening = sumLedger(emp.leaveLedger, 'opening')
  const adjustments = sumLedger(emp.leaveLedger, 'adjustment')
  const paidOutRaw = sumLedger(emp.leaveLedger, 'payout')
  // payout entries should be negative; take absolute for display
  const paidOut = Math.abs(paidOutRaw)
  const used = vacationUsedDays(emp)
  const balance = opening + adjustments + accrued - used + paidOutRaw
  return {
    opening,
    adjustments,
    accrued,
    accruedMonths: months.length,
    used,
    paidOut,
    balance,
    asOf: asOf.trim() || todayIso(),
  }
}

/** Оценка компенсации неиспользованных дней (среднедневной = оклад / 30). */
export function estimateUnusedLeavePay(
  emp: Employee,
  balanceDays: number,
): { days: number; dailyRate: number; amount: number } {
  const days = Math.max(0, Math.round(balanceDays * 100) / 100)
  const salary = emp.monthlySalary ?? 0
  const dailyRate = salary > 0 ? Math.round((salary / 30) * 100) / 100 : 0
  const amount = Math.round(days * dailyRate * 100) / 100
  return { days, dailyRate, amount }
}

export function newLeaveLedgerEntry(input: {
  kind: LeaveLedgerKind
  days: number
  date?: string
  note?: string
  byName?: string
}): LeaveLedgerEntry {
  return {
    id: crypto.randomUUID(),
    date: input.date?.trim() || todayIso(),
    kind: input.kind,
    days: input.days,
    note: input.note?.trim() || undefined,
    byName: input.byName,
    at: new Date().toISOString(),
  }
}

export { monthKey }
