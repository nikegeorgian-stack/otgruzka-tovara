import { daysInMonth, dayDateKey, parseMonthKey } from '../dates'
import { factWorkedHours } from '../factExtra'
import { employeeActiveOnDate } from '../hr/employeeActive'
import { isMonthClosed } from '../monthManage'
import { calculateRowPay, isPayableInMonth, type PayBreakdown } from '../payroll'
import { getFactMark, rowStats } from '../stats'
import type { AppStore, Employee, MonthSheet } from '../types'
import { createDefaultFinanceStore } from './init'
import type {
  FinanceAdjustment,
  FinanceAdvance,
  FinancePayout,
  FinanceStore,
  PayrollSnapshot,
  PayrollSnapshotRow,
  SickConfirmation,
} from './types'

/** Безопасный доступ к финансовому стору (поле добавлено аддитивно). */
export function getFinance(store: AppStore): FinanceStore {
  return store.finance ?? createDefaultFinanceStore()
}

export function isSickConfirmed(store: AppStore, employeeId: string, month: string): boolean {
  return getFinance(store).sickConfirmations.some(
    (c) => c.employeeId === employeeId && c.month === month,
  )
}

export function sickConfirmationFor(
  store: AppStore,
  employeeId: string,
  month: string,
): SickConfirmation | undefined {
  return getFinance(store).sickConfirmations.find(
    (c) => c.employeeId === employeeId && c.month === month,
  )
}

function sumAdvances(
  list: FinanceAdvance[],
  employeeId: string,
  month: string,
  asOfDate?: string,
): number {
  return list
    .filter(
      (a) =>
        a.employeeId === employeeId &&
        a.month === month &&
        (!asOfDate || a.date <= asOfDate),
    )
    .reduce((s, a) => s + a.amount, 0)
}

function sumAdjustments(
  list: FinanceAdjustment[],
  employeeId: string,
  month: string,
  kind: 'bonus' | 'penalty',
  asOfDate?: string,
): number {
  return list
    .filter(
      (a) =>
        a.employeeId === employeeId &&
        a.month === month &&
        a.kind === kind &&
        (!asOfDate || a.date <= asOfDate),
    )
    .reduce((s, a) => s + a.amount, 0)
}

function sumPayouts(
  list: FinancePayout[],
  employeeId: string,
  month: string,
  asOfDate?: string,
): number {
  return list
    .filter(
      (p) =>
        p.employeeId === employeeId &&
        p.month === month &&
        (!asOfDate || p.date <= asOfDate),
    )
    .reduce((s, p) => s + p.amount, 0)
}

/** Сколько дней «Б» в факте у строки за месяц. */
function sickDays(store: AppStore, month: string, rowId: string): string[] {
  const sheet = store.months[month]
  if (!sheet) return []
  const { year, month: mo } = parseMonthKey(month)
  const days = daysInMonth(year, mo)
  const out: string[] = []
  for (let d = 1; d <= days; d++) {
    const key = dayDateKey(year, mo, d)
    if (getFactMark(sheet, rowId, key) === 'Б') out.push(key)
  }
  return out
}

const DEFAULT_BRIGADIER_BONUS = 300

/** Полная бригадирская премия за месяц (₾) из настроек, по умолчанию 300. */
export function brigadierBonusAmount(store: AppStore): number {
  const v = store.settings.brigadierBonus
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : DEFAULT_BRIGADIER_BONUS
}

/**
 * Бригадирская премия строки за месяц:
 * полная сумма × (факт. часы в дни бригадирства / план. часы строки), не более полной суммы.
 * «Был бригадиром весь месяц по плану и отработал» → полная сумма.
 */
export function computeBrigadierBonus(
  store: AppStore,
  sheet: MonthSheet,
  rowId: string,
  year: number,
  month: number,
): number {
  const marks = sheet.brigadierDays
  if (!marks) return 0
  const days = daysInMonth(year, month)
  let factBrigHours = 0
  let hasMark = false
  for (let d = 1; d <= days; d++) {
    const dateKey = dayDateKey(year, month, d)
    if (!marks[`${rowId}|${dateKey}`]) continue
    hasMark = true
    factBrigHours += factWorkedHours(
      sheet,
      rowId,
      dateKey,
      getFactMark(sheet, rowId, dateKey),
    )
  }
  if (!hasMark) return 0
  const planHours = rowStats(sheet, rowId, days, year, month).planHours
  if (planHours <= 0) return 0
  const ratio = Math.min(1, factBrigHours / planHours)
  return Math.round(brigadierBonusAmount(store) * ratio)
}

export type StatementRow = {
  rowId: string
  employeeId: string
  emp: Employee
  brigade: string
  schedule: string
  factHours: number
  rateLabel: string
  breakdown: PayBreakdown
  /** Начислено (gross). */
  accrued: number
  bonus: number
  /** Бригадирская премия (авторасчёт по дням бригадирства). */
  brigadierBonus: number
  penalty: number
  advance: number
  /** К выплате = начислено + премии − штрафы − аванс. */
  net: number
  /** Уже выплачено. */
  paid: number
  /** Остаток к выплате. */
  remaining: number
  /** Значения взяты из снимка закрытого месяца. */
  frozen: boolean
  sickDates: string[]
  sickConfirmed: boolean
}

/**
 * Ведомость за месяц. Если месяц закрыт и есть снимок — начислено/премии/штрафы/
 * аванс берём из снимка (иммутабельно); выплаты всегда живые.
 */
export function monthStatement(store: AppStore, month: string, asOfDate?: string): StatementRow[] {
  const sheet = store.months[month]
  if (!sheet) return []
  const fin = getFinance(store)
  const { year, month: mo } = parseMonthKey(month)
  const closed = isMonthClosed(store, month)
  const snapshot = fin.snapshots[month]
  const snapRows = new Map((snapshot?.rows ?? []).map((r) => [r.employeeId, r]))

  const rows: StatementRow[] = []
  for (const row of sheet.rows) {
    if (!row.employeeId) continue
    const emp = store.employees.find((e) => e.id === row.employeeId)
    if (!emp || !isPayableInMonth(emp, month)) continue
    if (asOfDate && !employeeActiveOnDate(emp, asOfDate)) continue

    const confirmed = isSickConfirmed(store, emp.id, month)
    const pay = calculateRowPay(emp, sheet, row.id, year, mo, { sickConfirmed: confirmed })
    const sick = sickDays(store, month, row.id)
    const paid = sumPayouts(fin.payouts, emp.id, month, asOfDate)

    const liveBonus = sumAdjustments(fin.adjustments, emp.id, month, 'bonus', asOfDate)
    const livePenalty = sumAdjustments(fin.adjustments, emp.id, month, 'penalty', asOfDate)
    const liveAdvance = sumAdvances(fin.advances, emp.id, month, asOfDate)
    const liveBrigadierBonus = computeBrigadierBonus(store, sheet, row.id, year, mo)

    const snap = closed ? snapRows.get(emp.id) : undefined
    const accrued = snap ? snap.accrued : pay.amount
    const bonus = snap ? snap.bonus : liveBonus
    const brigadierBonus = snap ? (snap.brigadierBonus ?? 0) : liveBrigadierBonus
    const penalty = snap ? snap.penalty : livePenalty
    const advance = snap ? snap.advance : liveAdvance
    const factHours = snap ? snap.factHours : pay.factHours
    const net = accrued + bonus + brigadierBonus - penalty - advance

    rows.push({
      rowId: row.id,
      employeeId: emp.id,
      emp,
      brigade: emp.brigade,
      schedule: emp.schedule,
      factHours,
      rateLabel: pay.rateLabel,
      breakdown: pay.breakdown,
      accrued,
      bonus,
      brigadierBonus,
      penalty,
      advance,
      net,
      paid,
      remaining: net - paid,
      frozen: !!snap,
      sickDates: sick,
      sickConfirmed: confirmed,
    })
  }
  return rows
}

export type StatementTotals = {
  accrued: number
  bonus: number
  brigadierBonus: number
  penalty: number
  advance: number
  net: number
  paid: number
  remaining: number
}

export function statementTotals(rows: StatementRow[]): StatementTotals {
  return rows.reduce<StatementTotals>(
    (acc, r) => ({
      accrued: acc.accrued + r.accrued,
      bonus: acc.bonus + r.bonus,
      brigadierBonus: acc.brigadierBonus + r.brigadierBonus,
      penalty: acc.penalty + r.penalty,
      advance: acc.advance + r.advance,
      net: acc.net + r.net,
      paid: acc.paid + r.paid,
      remaining: acc.remaining + r.remaining,
    }),
    { accrued: 0, bonus: 0, brigadierBonus: 0, penalty: 0, advance: 0, net: 0, paid: 0, remaining: 0 },
  )
}

/** Строит снимок начислений за месяц (вызывается при закрытии месяца). */
export function buildPayrollSnapshot(
  store: AppStore,
  month: string,
  actor?: { id?: string; name?: string },
): PayrollSnapshot {
  const rows = monthStatement(store, month)
  const snapRows: PayrollSnapshotRow[] = rows.map((r) => ({
    employeeId: r.employeeId,
    accrued: r.accrued,
    bonus: r.bonus,
    brigadierBonus: r.brigadierBonus,
    penalty: r.penalty,
    advance: r.advance,
    net: r.net,
    factHours: r.factHours,
  }))
  return {
    month,
    at: new Date().toISOString(),
    byId: actor?.id,
    byName: actor?.name,
    rows: snapRows,
  }
}

/** Детализация финопераций сотрудника за месяц (для расчётного листка). */
export type FinanceMonthEntries = {
  advances: FinanceAdvance[]
  bonuses: FinanceAdjustment[]
  penalties: FinanceAdjustment[]
  payouts: FinancePayout[]
}

export function financeEntriesFor(
  store: AppStore,
  employeeId: string,
  month: string,
): FinanceMonthEntries {
  const fin = getFinance(store)
  const match = <T extends { employeeId: string; month: string }>(x: T) =>
    x.employeeId === employeeId && x.month === month
  return {
    advances: fin.advances.filter(match),
    bonuses: fin.adjustments.filter((a) => match(a) && a.kind === 'bonus'),
    penalties: fin.adjustments.filter((a) => match(a) && a.kind === 'penalty'),
    payouts: fin.payouts.filter(match),
  }
}

export type LedgerEntry = {
  id: string
  /** id исходной записи (для удаления); у начислений отсутствует. */
  refId?: string
  at: string
  /** YYYY-MM-DD. */
  date: string
  month: string
  kind: 'accrual' | 'advance' | 'bonus' | 'penalty' | 'payout'
  amount: number
  label: string
  byName?: string
}

/** Лицевой счёт сотрудника — все финансовые движения по месяцам. */
export function employeeLedger(store: AppStore, employeeId: string, asOfDate?: string): LedgerEntry[] {
  const fin = getFinance(store)
  const out: LedgerEntry[] = []

  for (const month of Object.keys(store.months)) {
    const rows = monthStatement(store, month, asOfDate)
    const r = rows.find((x) => x.employeeId === employeeId)
    if (r && r.accrued > 0) {
      out.push({
        id: `acc-${month}-${employeeId}`,
        at: `${month}-28T23:59:59`,
        date: `${month}-01`,
        month,
        kind: 'accrual',
        amount: r.accrued,
        label: 'Начислено',
      })
    }
  }

  for (const a of fin.advances) {
    if (a.employeeId !== employeeId) continue
    if (asOfDate && a.date > asOfDate) continue
    out.push({
      id: `adv-${a.id}`,
      refId: a.id,
      at: a.at,
      date: a.date,
      month: a.month,
      kind: 'advance',
      amount: a.amount,
      label: 'Аванс',
      byName: a.byName,
    })
  }
  for (const adj of fin.adjustments) {
    if (adj.employeeId !== employeeId) continue
    if (asOfDate && adj.date > asOfDate) continue
    out.push({
      id: `adj-${adj.id}`,
      refId: adj.id,
      at: adj.at,
      date: adj.date,
      month: adj.month,
      kind: adj.kind,
      amount: adj.amount,
      label: adj.reason,
      byName: adj.byName,
    })
  }
  for (const p of fin.payouts) {
    if (p.employeeId !== employeeId) continue
    if (asOfDate && p.date > asOfDate) continue
    out.push({
      id: `pay-${p.id}`,
      refId: p.id,
      at: p.at,
      date: p.date,
      month: p.month,
      kind: 'payout',
      amount: p.amount,
      label: 'Выплата',
      byName: p.byName,
    })
  }

  return out.sort((a, b) => b.at.localeCompare(a.at))
}
