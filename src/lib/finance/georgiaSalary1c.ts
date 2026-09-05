/**
 * Данные для Excel «Salary Calculation» (шаблон Fibercell / 1С).
 *
 * В Excel формулы сами считают Gross / пенсию / WHT.
 * Из программы заполняем только входы: личный номер, валюта, дата курса,
 * питание (O), Net (Q = получил + получит), банк + справочник INFO.
 *
 * O = только пособие `mealAllowanceGel` (налог / шаблон 1С).
 * Заказы обедов после принятия дня уменьшают net → Q, в O их не кладём
 * (иначе Gross в Excel раздувается и удержание считается дважды).
 */

import { daysInMonth, parseMonthKey } from '@/lib/dates'
import { monthStatement, type StatementRow } from '@/lib/finance/calc'
import { primaryIbanRaw } from '@/lib/hr/employeeBank'
import type { AppStore, Employee } from '@/lib/types'

/** Строка листа месяца — только то, что вводят вручную в шаблоне. */
export type Salary1cInputRow = {
  no: number
  personalId: string
  currency: string
  rateDate: string
  mealEmployee: number
  /** Получил + получит (paid + remaining), ₾ — колонка Net Salary in GEL. */
  netSalaryGel: number
  bankAccount: string
}

export type Salary1cInfoRow = {
  personalId: string
  firstNameKa: string
  lastNameKa: string
  nameEn: string
  pensionScheme: 'YES' | 'NO'
  address: string
}

export type Salary1cBuildResult = {
  rows: Salary1cInputRow[]
  info: Salary1cInfoRow[]
  rateDate: string
  orgTitle: string
  monthKey: string
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Колонка O: пособие питания, не заказы обедов. */
export function mealBenefitFor1c(emp: Pick<Employee, 'mealAllowanceGel'>): number {
  return round2(emp.mealAllowanceGel ?? 0)
}

export function employeeInPensionScheme(emp: Employee): boolean {
  return emp.pensionScheme !== false
}

export function lastDayOfMonth(month: string): string {
  const { year, month: mo } = parseMonthKey(month)
  const d = daysInMonth(year, mo)
  return `${month}-${String(d).padStart(2, '0')}`
}

function displayNameEn(emp: Employee): string {
  return (
    emp.nameEn?.trim() ||
    emp.fullName?.trim() ||
    emp.nameKa?.trim() ||
    emp.id.slice(0, 8)
  )
}

function splitKaName(emp: Employee): { first: string; last: string } {
  const surname = emp.surnameKa?.trim() || ''
  const full = (emp.nameKa?.trim() || emp.fullName?.trim() || '').replace(/\s+/g, ' ')
  if (surname && full) {
    const without = full.replace(new RegExp(`\\s*${escapeReg(surname)}\\s*$`, 'i'), '').trim()
    if (without) return { first: without, last: surname }
  }
  const parts = full.split(' ').filter(Boolean)
  if (parts.length === 0) return { first: '', last: surname }
  if (parts.length === 1) return { first: parts[0], last: surname }
  return { first: parts[0], last: surname || parts.slice(1).join(' ') }
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

type EmpAgg = {
  emp: Employee
  paid: number
  remaining: number
  net: number
}

export function aggregatePayoutByEmployee(rows: StatementRow[]): Map<string, EmpAgg> {
  const map = new Map<string, EmpAgg>()
  for (const r of rows) {
    const prev = map.get(r.emp.id)
    if (!prev) {
      map.set(r.emp.id, {
        emp: r.emp,
        paid: r.paid,
        remaining: r.remaining,
        net: r.net,
      })
      continue
    }
    prev.paid += r.paid
    prev.remaining += r.remaining
    prev.net += r.net
  }
  return map
}

function infoFromEmployee(emp: Employee): Salary1cInfoRow | null {
  const personalId = emp.personalId?.trim() || ''
  if (!personalId) return null
  const { first, last } = splitKaName(emp)
  return {
    personalId,
    firstNameKa: first,
    lastNameKa: last,
    nameEn: displayNameEn(emp),
    pensionScheme: employeeInPensionScheme(emp) ? 'YES' : 'NO',
    address: (emp.registrationAddress || emp.actualAddress || emp.address || '').trim(),
  }
}

export function buildSalary1cRows(
  store: AppStore,
  month: string,
  rateDate: string,
): Salary1cBuildResult {
  const stmt = monthStatement(store, month)
  const byEmp = aggregatePayoutByEmployee(stmt)
  const rows: Salary1cInputRow[] = []
  const infoById = new Map<string, Salary1cInfoRow>()

  // INFO: все активные с личным номером + те, кто в ведомости
  for (const emp of store.employees) {
    const info = infoFromEmployee(emp)
    if (info) infoById.set(info.personalId, info)
  }

  const sorted = [...byEmp.values()].sort((a, b) =>
    displayNameEn(a.emp).localeCompare(displayNameEn(b.emp), 'en'),
  )

  let no = 0
  for (const { emp, paid, remaining, net } of sorted) {
    const payoutGel = round2(Math.max(0, paid + remaining))
    const payoutExact = round2(Math.max(0, Math.abs(net - payoutGel) < 0.02 ? net : payoutGel))
    if (payoutExact < 0.005) continue

    const personalId = emp.personalId?.trim() || emp.tabNumber?.trim() || ''
    if (!personalId) continue

    const info = infoFromEmployee(emp)
    if (info) infoById.set(info.personalId, info)

    no += 1
    rows.push({
      no,
      personalId,
      currency: (emp.currency ?? 'GEL').toUpperCase(),
      rateDate,
      mealEmployee: mealBenefitFor1c(emp),
      netSalaryGel: payoutExact,
      bankAccount: primaryIbanRaw(emp),
    })
  }

  const info = [...infoById.values()].sort((a, b) =>
    a.nameEn.localeCompare(b.nameEn, 'en'),
  )

  const employer = store.settings.employer
  const orgTitle =
    employer?.orgRu?.trim() || employer?.orgKa?.trim() || 'LLC Fibercell Technology'

  return {
    rows,
    info,
    rateDate,
    orgTitle,
    monthKey: month,
  }
}
