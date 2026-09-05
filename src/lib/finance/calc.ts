import { daysInMonth, dayDateKey, parseMonthKey } from '../dates'
import { employeeActiveOnDate } from '../hr/employeeActive'
import { isMonthClosed } from '../monthManage'
import { resolvePayrollAccrualRules } from './payrollAccrualRules'
import { calculateRowPay, isPayableInMonth, type PayBreakdown } from '../payroll'
import { getFactMark } from '../stats'
import type { AppStore, Employee, MonthSheet } from '../types'
import { autoEmployeeBonuses, employeeBonusBreakdown } from './employeeBonus'
import { createDefaultFinanceStore } from './init'
import {
  brigadierBonusFromDetail,
  computeBrigadierPay,
  computePayrollHourDetail,
  type PayrollHourDetail,
} from './payrollDetail'
import { documentNumberForAdvance } from './advanceDocuments'
import { documentNumberForPayout } from './payoutDocuments'
import { employeeAcceptedMealDeduction } from '../meals/calc'
import type {
  FinanceAdjustment,
  FinanceAdvance,
  FinancePayout,
  FinanceStore,
  PayrollSnapshot,
  PayrollSnapshotRow,
  SickConfirmation,
  VacationConfirmation,
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

export function isVacationConfirmed(store: AppStore, employeeId: string, month: string): boolean {
  return getFinance(store).vacationConfirmations.some(
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

export function vacationConfirmationFor(
  store: AppStore,
  employeeId: string,
  month: string,
): VacationConfirmation | undefined {
  return getFinance(store).vacationConfirmations.find(
    (c) => c.employeeId === employeeId && c.month === month,
  )
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

/** Сколько дней «ОТ» в факте у строки за месяц. */
function vacationDays(store: AppStore, month: string, rowId: string): string[] {
  const sheet = store.months[month]
  if (!sheet) return []
  const { year, month: mo } = parseMonthKey(month)
  const days = daysInMonth(year, mo)
  const out: string[] = []
  for (let d = 1; d <= days; d++) {
    const key = dayDateKey(year, mo, d)
    if (getFactMark(sheet, rowId, key) === 'ОТ') out.push(key)
  }
  return out
}

const DEFAULT_BRIGADIER_BONUS = 300

/** Полная бригадирская премия за месяц (₾) из настроек, по умолчанию 300. */
export function brigadierBonusAmount(store: AppStore): number {
  const v = store.settings.brigadierBonus
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : DEFAULT_BRIGADIER_BONUS
}

export type { BrigadierPayDetail, PayrollHourDetail } from './payrollDetail'
export { brigadierDateKeys, computeBrigadierPay, computePayrollHourDetail } from './payrollDetail'

/** Бригадирская премия строки за месяц (₾). */
export function computeBrigadierBonus(
  store: AppStore,
  sheet: MonthSheet,
  rowId: string,
  year: number,
  month: number,
  emp?: Employee,
): number {
  if (!emp) {
    const row = sheet.rows.find((r) => r.id === rowId)
    if (!row?.employeeId) return 0
    emp = store.employees.find((e) => e.id === row.employeeId)
    if (!emp) return 0
  }
  return brigadierBonusFromDetail(computeBrigadierPay(store, sheet, rowId, emp, year, month))
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
  /** Автопремии (индивидуальная + 10%). */
  autoBonus: number
  /** Премия по выработке (разовая, ввод вручную). */
  productivityBonus: number
  /** Прочие разовые премии. */
  otherManualBonus: number
  /** Бригадирская премия (авторасчёт по дням бригадирства). */
  brigadierBonus: number
  penalty: number
  advance: number
  /** Удержание за принятые обеды (после принятия дня поваром). */
  mealDeduction: number
  /** К выплате = начислено + премии − штрафы − аванс − обеды. */
  net: number
  /** Уже выплачено. */
  paid: number
  /** Остаток к выплате. */
  remaining: number
  /** Значения взяты из снимка закрытого месяца. */
  frozen: boolean
  sickDates: string[]
  sickConfirmed: boolean
  vacationDates: string[]
  vacationConfirmed: boolean
  /** Детализация часов и бригадирской доплаты. */
  hourDetail: PayrollHourDetail
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
  const snapByRowId = new Map(
    (snapshot?.rows ?? [])
      .filter((r) => r.rowId)
      .map((r) => [r.rowId!, r]),
  )
  const snapByEmp = new Map((snapshot?.rows ?? []).map((r) => [r.employeeId, r]))
  const empRowCount = new Map<string, number>()
  for (const r of sheet.rows) {
    if (!r.employeeId) continue
    empRowCount.set(r.employeeId, (empRowCount.get(r.employeeId) ?? 0) + 1)
  }

  const rows: StatementRow[] = []
  for (const row of sheet.rows) {
    if (!row.employeeId) continue
    const emp = store.employees.find((e) => e.id === row.employeeId)
    if (!emp || !isPayableInMonth(emp, month)) continue
    if (asOfDate && !employeeActiveOnDate(emp, asOfDate)) continue

    const sickConfirmed = isSickConfirmed(store, emp.id, month)
    const vacationConfirmed = isVacationConfirmed(store, emp.id, month)
    const payOpts = {
      sickConfirmed,
      vacationConfirmed,
      accrual: resolvePayrollAccrualRules(store.settings),
      asOfDate,
    }
    const pay = calculateRowPay(emp, sheet, row.id, year, mo, payOpts)
    const sick = sickDays(store, month, row.id)
    const vacation = vacationDays(store, month, row.id)

    // Аванс/премии/выплаты — один раз на сотрудника (домашняя бригада после перевода).
    const splitCount = empRowCount.get(emp.id) ?? 0
    const isFinanceHome = splitCount <= 1 || row.brigade === emp.brigade
    const paid = isFinanceHome ? sumPayouts(fin.payouts, emp.id, month, asOfDate) : 0

    const liveManualBonus = isFinanceHome
      ? sumAdjustments(fin.adjustments, emp.id, month, 'bonus', asOfDate)
      : 0
    let autoBase = pay.amount
    if (isFinanceHome && splitCount > 1) {
      autoBase = 0
      for (const r of sheet.rows) {
        if (r.employeeId !== emp.id) continue
        autoBase += calculateRowPay(emp, sheet, r.id, year, mo, payOpts).amount
      }
    }
    const liveAutoBonus = isFinanceHome ? autoEmployeeBonuses(emp, autoBase, month) : 0
    const liveBonus = liveManualBonus + liveAutoBonus
    const livePenalty = isFinanceHome
      ? sumAdjustments(fin.adjustments, emp.id, month, 'penalty', asOfDate)
      : 0
    const liveAdvance = isFinanceHome ? sumAdvances(fin.advances, emp.id, month, asOfDate) : 0
    const liveMealDeduction = isFinanceHome
      ? employeeAcceptedMealDeduction(store, emp.id, month, asOfDate)
      : 0
    const liveBrigadierBonus = brigadierBonusFromDetail(
      computeBrigadierPay(store, sheet, row.id, emp, year, mo, asOfDate),
    )
    const hourDetail = computePayrollHourDetail(store, sheet, row.id, emp, year, mo, {
      sickConfirmed,
      vacationConfirmed,
      asOfDate,
    })

    const snap =
      closed
        ? snapByRowId.get(row.id) ??
          (splitCount <= 1 ? snapByEmp.get(emp.id) : undefined)
        : undefined
    const accrued = snap ? snap.accrued : pay.amount
    const bonus = snap ? snap.bonus : liveBonus
    const bonusParts = employeeBonusBreakdown(
      emp,
      isFinanceHome ? (splitCount > 1 ? autoBase : accrued) : accrued,
      fin.adjustments,
      emp.id,
      month,
      asOfDate,
      snap ? snap.bonus : undefined,
    )
    const brigadierBonus = snap ? (snap.brigadierBonus ?? 0) : liveBrigadierBonus
    const penalty = snap ? snap.penalty : livePenalty
    const advance = snap ? snap.advance : liveAdvance
    const mealDeduction = liveMealDeduction
    const factHours = snap ? snap.factHours : hourDetail.factHours
    const net = accrued + bonus + brigadierBonus - penalty - advance - mealDeduction

    rows.push({
      rowId: row.id,
      employeeId: emp.id,
      emp,
      brigade: row.brigade,
      schedule: emp.schedule,
      factHours,
      rateLabel: pay.rateLabel,
      breakdown: pay.breakdown,
      accrued,
      bonus,
      autoBonus: bonusParts.auto,
      productivityBonus: bonusParts.productivity,
      otherManualBonus: bonusParts.otherManual,
      brigadierBonus,
      penalty,
      advance,
      mealDeduction,
      net,
      paid,
      remaining: net - paid,
      frozen: !!snap,
      sickDates: sick,
      sickConfirmed,
      vacationDates: vacation,
      vacationConfirmed,
      hourDetail,
    })
  }
  return rows
}

/** Строка ведомости для одного сотрудника (предварительный или зафиксированный расчёт). */
export function statementRowForEmployee(
  store: AppStore,
  month: string,
  employeeId: string,
  asOfDate?: string,
): StatementRow | undefined {
  return monthStatement(store, month, asOfDate).find((r) => r.employeeId === employeeId)
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
    rowId: r.rowId,
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
  financeDocumentId?: string
  financeDocumentNumber?: string
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
      label: documentNumberForAdvance(fin, a)
        ? `Аванс · ${documentNumberForAdvance(fin, a)}`
        : 'Аванс',
      byName: a.byName,
      financeDocumentId: a.documentId,
      financeDocumentNumber: documentNumberForAdvance(fin, a),
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
      label: documentNumberForPayout(fin, p)
        ? `Выплата · ${documentNumberForPayout(fin, p)}`
        : 'Выплата',
      byName: p.byName,
      financeDocumentId: p.documentId,
      financeDocumentNumber: documentNumberForPayout(fin, p),
    })
  }

  return out.sort((a, b) => b.at.localeCompare(a.at))
}
