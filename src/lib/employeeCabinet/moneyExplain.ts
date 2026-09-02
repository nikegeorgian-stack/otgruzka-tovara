import { employeeAdvanceSummary, listAdvanceAccruals } from '@/lib/finance/advanceAccrual'
import { listAdvanceDocuments } from '@/lib/finance/advanceDocuments'
import {
  financeEntriesFor,
  getFinance,
  monthStatement,
} from '@/lib/finance/calc'
import { listPayoutDocuments } from '@/lib/finance/payoutDocuments'
import { resolveCabinetAsOfDate } from '@/lib/employeeCabinet/asOf'
import { isMonthClosed } from '@/lib/monthManage'
import type { AppStore } from '@/lib/types'

export type MoneyEventKind =
  | 'accrual'
  | 'advance_accrued'
  | 'advance_paid'
  | 'bonus'
  | 'penalty'
  | 'payout'
  | 'pending_advance'
  | 'pending_salary'

export type MoneyTimelineEvent = {
  id: string
  date: string
  at: string
  kind: MoneyEventKind
  amount: number
  /** i18n key */
  titleKey: string
  titleVars?: Record<string, string>
  note?: string
  docNumber?: string
  /** done = произошло; pending = ещё не получил; info = оценка */
  status: 'done' | 'pending' | 'info'
}

export type MoneyExplainReason = {
  key: string
  vars?: Record<string, string | number>
}

export type MoneyExplainStatus = {
  key: string
  vars?: Record<string, string | number>
  tone: 'ok' | 'wait' | 'warn' | 'info'
}

export type EmployeeMoneyExplain = {
  month: string
  accrued: number
  bonus: number
  brigadierBonus: number
  penalty: number
  advancePaid: number
  advanceAccrued: number
  advanceRemaining: number
  salaryPaid: number
  net: number
  remaining: number
  frozen: boolean
  monthClosed: boolean
  status: MoneyExplainStatus
  reasons: MoneyExplainReason[]
  timeline: MoneyTimelineEvent[]
}

/**
 * Понятный разбор денег сотрудника за месяц:
 * что начислено, что уже выплачено, что ещё ждёт и почему.
 */
export function buildEmployeeMoneyExplain(
  store: AppStore,
  employeeId: string,
  month: string,
): EmployeeMoneyExplain {
  const asOfDate = isMonthClosed(store, month) ? undefined : resolveCabinetAsOfDate(month)
  const rows = monthStatement(store, month, asOfDate).filter((r) => r.employeeId === employeeId)
  const statement =
    rows.find((r) => r.brigade === r.emp.brigade) ??
    rows.find((r) => r.paid > 0 || r.advance > 0 || r.bonus > 0) ??
    rows[0]
  const fin = getFinance(store)
  const entries = financeEntriesFor(store, employeeId, month)
  const monthClosed = isMonthClosed(store, month)
  const advance = employeeAdvanceSummary(store, employeeId, month)

  const accrued = rows.reduce((s, r) => s + r.accrued, 0)
  const bonus = statement?.bonus ?? 0
  const brigadierBonus = rows.reduce((s, r) => s + r.brigadierBonus, 0)
  const penalty = statement?.penalty ?? 0
  const salaryPaid = statement?.paid ?? 0
  const advancePaid = advance.paid
  const advanceAccrued = advance.accrued
  const advanceRemaining = advance.remainingToPay
  const net =
    Math.round((accrued + bonus + brigadierBonus - penalty - advancePaid) * 100) / 100
  const remaining = Math.max(0, Math.round((net - salaryPaid) * 100) / 100)
  const frozen = statement?.frozen === true

  const timeline: MoneyTimelineEvent[] = []

  if (accrued > 0) {
    timeline.push({
      id: `acc-${month}`,
      date: `${month}-01`,
      at: frozen
        ? (fin.snapshots[month]?.at ?? `${month}-28T12:00:00`)
        : `${month}-15T12:00:00`,
      kind: 'accrual',
      amount: accrued,
      titleKey: frozen ? 'my.money.event.accrualFrozen' : 'my.money.event.accrualEstimate',
      status: frozen ? 'done' : 'info',
    })
  }

  for (const doc of listAdvanceAccruals(fin, { month, includeVoid: false })) {
    if (doc.status !== 'posted') continue
    const line = doc.lines.find((l) => l.employeeId === employeeId && l.amount > 0)
    if (!line) continue
    const at = doc.postedAt ?? doc.readyAt ?? doc.at
    const date = (at.slice(0, 10) || `${month}-10`) as string
    timeline.push({
      id: `na-${doc.id}`,
      date,
      at,
      kind: 'advance_accrued',
      amount: Math.round(line.amount),
      titleKey: 'my.money.event.advanceAccrued',
      titleVars: { number: doc.number },
      docNumber: doc.number,
      note: line.note,
      status: 'done',
    })
  }

  for (const doc of listAdvanceDocuments(fin, { month, includeVoid: false })) {
    if (doc.status !== 'posted') continue
    const line = doc.lines.find((l) => l.employeeId === employeeId && l.amount > 0)
    if (!line) continue
    timeline.push({
      id: `av-${doc.id}`,
      date: doc.date,
      at: doc.postedAt ?? doc.at,
      kind: 'advance_paid',
      amount: Math.round(line.amount),
      titleKey: 'my.money.event.advancePaid',
      titleVars: { number: doc.number },
      docNumber: doc.number,
      note: line.note,
      status: 'done',
    })
  }

  // Fallback: advances without document (legacy)
  for (const a of entries.advances) {
    if (a.documentId) continue
    timeline.push({
      id: `adv-${a.id}`,
      date: a.date,
      at: a.at,
      kind: 'advance_paid',
      amount: a.amount,
      titleKey: 'my.money.event.advancePaidPlain',
      note: a.note,
      status: 'done',
    })
  }

  for (const b of entries.bonuses) {
    timeline.push({
      id: `bon-${b.id}`,
      date: b.date,
      at: b.at,
      kind: 'bonus',
      amount: b.amount,
      titleKey: 'my.money.event.bonus',
      note: b.reason,
      status: 'done',
    })
  }

  for (const p of entries.penalties) {
    timeline.push({
      id: `pen-${p.id}`,
      date: p.date,
      at: p.at,
      kind: 'penalty',
      amount: p.amount,
      titleKey: 'my.money.event.penalty',
      note: p.reason,
      status: 'done',
    })
  }

  for (const doc of listPayoutDocuments(fin, { month, includeVoid: false })) {
    if (doc.status !== 'posted') continue
    const line = doc.lines.find((l) => l.employeeId === employeeId && l.amount > 0)
    if (!line) continue
    timeline.push({
      id: `zp-${doc.id}`,
      date: doc.date,
      at: doc.postedAt ?? doc.at,
      kind: 'payout',
      amount: Math.round(line.amount),
      titleKey: 'my.money.event.salaryPaid',
      titleVars: { number: doc.number },
      docNumber: doc.number,
      note: line.note,
      status: 'done',
    })
  }

  for (const p of entries.payouts) {
    if (p.documentId) continue
    timeline.push({
      id: `pay-${p.id}`,
      date: p.date,
      at: p.at,
      kind: 'payout',
      amount: p.amount,
      titleKey: 'my.money.event.salaryPaidPlain',
      note: p.note,
      status: 'done',
    })
  }

  if (advanceRemaining > 0.5) {
    timeline.push({
      id: `pend-adv-${month}`,
      date: `${month}-15`,
      at: `${month}-15T23:59:00`,
      kind: 'pending_advance',
      amount: advanceRemaining,
      titleKey: 'my.money.event.pendingAdvance',
      status: 'pending',
    })
  }

  if (remaining > 0.5) {
    timeline.push({
      id: `pend-sal-${month}`,
      date: `${month}-28`,
      at: `${month}-28T23:59:00`,
      kind: 'pending_salary',
      amount: remaining,
      titleKey: monthClosed
        ? 'my.money.event.pendingSalaryClosed'
        : 'my.money.event.pendingSalaryOpen',
      status: 'pending',
    })
  }

  timeline.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))

  const reasons: MoneyExplainReason[] = []
  if (accrued <= 0) {
    reasons.push({ key: 'my.money.reason.noAccrual' })
  } else if (!frozen && !monthClosed) {
    reasons.push({ key: 'my.money.reason.estimateOnly' })
  }
  if (advanceAccrued > 0 && advancePaid <= 0) {
    reasons.push({
      key: 'my.money.reason.advanceNotPaid',
      vars: { amount: Math.round(advanceAccrued) },
    })
  } else if (advanceRemaining > 0.5) {
    reasons.push({
      key: 'my.money.reason.advancePartial',
      vars: { amount: Math.round(advanceRemaining) },
    })
  }
  if (remaining > 0.5) {
    if (!monthClosed) {
      reasons.push({ key: 'my.money.reason.salaryAfterClose' })
    } else if (salaryPaid <= 0) {
      reasons.push({ key: 'my.money.reason.salaryDocPending' })
    } else {
      reasons.push({
        key: 'my.money.reason.salaryPartial',
        vars: { amount: Math.round(remaining) },
      })
    }
  }
  if (statement?.sickDates.length && !statement.sickConfirmed) {
    reasons.push({ key: 'my.money.reason.sickPending' })
  }
  if (statement?.vacationDates.length && !statement.vacationConfirmed) {
    reasons.push({ key: 'my.money.reason.vacationPending' })
  }

  let status: MoneyExplainStatus
  if (remaining <= 0.5 && advanceRemaining <= 0.5 && (salaryPaid > 0 || advancePaid > 0 || accrued <= 0)) {
    if (accrued <= 0 && salaryPaid <= 0 && advancePaid <= 0) {
      status = { key: 'my.money.status.empty', tone: 'info' }
    } else {
      status = { key: 'my.money.status.settled', tone: 'ok' }
    }
  } else if (remaining > 0.5 && !monthClosed) {
    status = { key: 'my.money.status.waitClose', tone: 'wait' }
  } else if (remaining > 0.5 && monthClosed) {
    status = { key: 'my.money.status.waitPayout', tone: 'wait' }
  } else if (advanceRemaining > 0.5) {
    status = { key: 'my.money.status.waitAdvance', tone: 'wait' }
  } else {
    status = { key: 'my.money.status.inProgress', tone: 'info' }
  }

  return {
    month,
    accrued,
    bonus,
    brigadierBonus,
    penalty,
    advancePaid,
    advanceAccrued,
    advanceRemaining,
    salaryPaid,
    net,
    remaining,
    frozen,
    monthClosed,
    status,
    reasons,
    timeline,
  }
}
