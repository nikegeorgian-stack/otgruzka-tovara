import type { AbsenceConfirmState } from '@/lib/absenceConfirm'
import { brigadeAllowsBrigadier } from '@/lib/brigadeHasBrigadier'
import { getRowHoursSnapshot } from '@/lib/finance/rowHours'
import { computeNightLineFixedPay } from '@/lib/finance/nightLineBonus'
import { resolvePayrollAccrualRules } from '@/lib/finance/payrollAccrualRules'
import { hoursForCode } from '@/lib/codes'
import { dayDateKey, daysInMonth } from '@/lib/dates'
import { factWorkedHours, isWorkCode } from '@/lib/factExtra'
import { resolveRowHourlyRate } from '@/lib/payroll'
import { effectiveShiftHours } from '@/lib/schedules'
import { getFactMark, rowStats } from '@/lib/stats'
import type { AppStore, DayCode, Employee, MonthSheet } from '@/lib/types'

const DEFAULT_BRIGADIER_BONUS = 300

export type BrigadierPayDetail = {
  fullMonthlyAmount: number
  brigadierDays: number
  planBrigHours: number
  factBrigHours: number
  overtimeBrigHours: number
  hourlySupplement: number
  amount: number
  designatedBrigadier: boolean
}

export type PayrollHourDetail = {
  planHours: number
  factHours: number
  /** Рабочие часы (без В/ОТ/Б/ПР). */
  workFactHours: number
  baseHours: number
  overtimeHours: number
  /** Сверхурочные по Δ месяца (рабочий факт − норма работы после ОТ/Б/ПР), 110%. */
  monthDeltaOtHours: number
  otDayHours: number
  otNightHours: number
  nightShiftHours: number
  /** Часы простоя ПР. */
  idleHours: number
  /** Почасовая ставка месяца ₾/ч. */
  hourlyRate: number
  nightMultiplier: number
  idleMultiplier: number
  otDayMultiplier: number
  otNightMultiplier: number
  nightLineNights: number
  nightLineFixedGel: number
  nightLineBonus: number
  brigadier: BrigadierPayDetail | null
}

export function brigadierBonusAmountFromStore(store: AppStore): number {
  const v = store.settings.brigadierBonus
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : DEFAULT_BRIGADIER_BONUS
}

function shiftNormHours(code: DayCode, emp: Employee): number {
  if (code === 'Н') return emp.shiftHours ?? hoursForCode(code)
  return hoursForCode(code)
}

function markedBrigadierDays(
  sheet: MonthSheet,
  rowId: string,
  asOfDate?: string,
): Set<string> {
  const keys = new Set<string>()
  const prefix = `${rowId}|`
  for (const [k, v] of Object.entries(sheet.brigadierDays ?? {})) {
    if (!v || !k.startsWith(prefix)) continue
    const dateKey = k.slice(prefix.length)
    if (asOfDate && dateKey > asOfDate) continue
    keys.add(dateKey)
  }
  return keys
}

/** Дни, где бригадиром на день отмечен кто-то другой из этой же бригады (замена в перекличке). */
function daysCoveredByOtherRows(
  sheet: MonthSheet,
  brigade: string,
  rowId: string,
): Set<string> {
  const dates = new Set<string>()
  if (!brigade) return dates
  const brigadeByRow = new Map(sheet.rows.map((r) => [r.id, r.brigade]))
  for (const [key, on] of Object.entries(sheet.brigadierDays ?? {})) {
    if (!on) continue
    const sep = key.indexOf('|')
    if (sep <= 0) continue
    const markRowId = key.slice(0, sep)
    if (markRowId === rowId) continue
    if (brigadeByRow.get(markRowId) !== brigade) continue
    dates.add(key.slice(sep + 1))
  }
  return dates
}

/** Рабочий день для доплаты: явный факт важнее плана; ПР/ОТ/Б не считаются. */
function isBrigadierWorkDay(sheet: MonthSheet, rowId: string, dateKey: string): boolean {
  const overrideKey = `${rowId}|${dateKey}`
  const hasFactOverride = sheet.factOverrides.includes(overrideKey)
  const factCode = sheet.fact[rowId]?.[dateKey]
  if (hasFactOverride || factCode) return isWorkCode(factCode ?? '')
  return isWorkCode(sheet.plan[rowId]?.[dateKey] ?? '')
}

/**
 * Даты бригадирства.
 * Назначенный без отметок «Бр»: все рабочие дни месяца (кроме простоя/отпуска в факте).
 * Если есть отметки «Бр» / «с этого дня» — только они (не с 1-го числа), минус простой.
 * Ночные (Н) — рабочие, входят в часы. Заместитель: только отметки.
 */
export function brigadierDateKeys(
  store: AppStore,
  sheet: MonthSheet,
  rowId: string,
  emp: Employee,
  year: number,
  month: number,
  asOfDate?: string,
): Set<string> {
  const keys = new Set<string>()
  const rowBrigade = sheet.rows.find((r) => r.id === rowId)?.brigade ?? emp.brigade
  if (!brigadeAllowsBrigadier(store, rowBrigade)) return keys

  const designated =
    Boolean(rowBrigade) &&
    brigadeAllowsBrigadier(store, rowBrigade) &&
    store.brigadiers?.[rowBrigade] === emp.id

  const marked = markedBrigadierDays(sheet, rowId, asOfDate)

  if (designated && marked.size === 0) {
    const coveredByOthers = daysCoveredByOtherRows(sheet, rowBrigade, rowId)
    const days = daysInMonth(year, month)
    for (let d = 1; d <= days; d++) {
      const dateKey = dayDateKey(year, month, d)
      if (asOfDate && dateKey > asOfDate) continue
      if (coveredByOthers.has(dateKey)) continue
      if (isBrigadierWorkDay(sheet, rowId, dateKey)) keys.add(dateKey)
    }
    return keys
  }

  for (const dateKey of marked) {
    if (isBrigadierWorkDay(sheet, rowId, dateKey)) keys.add(dateKey)
  }
  return keys
}

export function computeBrigadierPay(
  store: AppStore,
  sheet: MonthSheet,
  rowId: string,
  emp: Employee,
  year: number,
  month: number,
  asOfDate?: string,
): BrigadierPayDetail | null {
  const brigDates = brigadierDateKeys(store, sheet, rowId, emp, year, month, asOfDate)
  if (!brigDates.size) return null

  const rowBrigade = sheet.rows.find((r) => r.id === rowId)?.brigade ?? emp.brigade
  const designatedBrigadier = Boolean(rowBrigade) && store.brigadiers?.[rowBrigade] === emp.id

  const days = daysInMonth(year, month)
  // Доплата ₾/ч от полной месячной нормы (не срезаем asOf) — иначе ставка «прыгает» в течение месяца.
  const planHours = rowStats(sheet, rowId, days, year, month, emp).planHours
  if (planHours <= 0) return null

  const fullMonthlyAmount = brigadierBonusAmountFromStore(store)
  const hourlySupplement = fullMonthlyAmount / planHours

  let planBrigHours = 0
  let factBrigHours = 0
  let overtimeBrigHours = 0
  const plan = sheet.plan[rowId] ?? {}

  for (const dateKey of brigDates) {
    const planCode = plan[dateKey] ?? ''
    if (isWorkCode(planCode)) planBrigHours += hoursForCode(planCode)

    const factCode = getFactMark(sheet, rowId, dateKey)
    if (!isWorkCode(factCode)) continue
    const worked = factWorkedHours(sheet, rowId, dateKey, factCode)
    factBrigHours += worked
    overtimeBrigHours += Math.max(0, worked - shiftNormHours(factCode, emp))
  }

  if (factBrigHours <= 0) {
    return {
      fullMonthlyAmount,
      brigadierDays: brigDates.size,
      planBrigHours,
      factBrigHours: 0,
      overtimeBrigHours: 0,
      hourlySupplement,
      amount: 0,
      designatedBrigadier,
    }
  }

  return {
    fullMonthlyAmount,
    brigadierDays: brigDates.size,
    planBrigHours,
    factBrigHours,
    overtimeBrigHours,
    hourlySupplement,
    amount: Math.round(factBrigHours * hourlySupplement),
    designatedBrigadier,
  }
}

export function computePayrollHourDetail(
  store: AppStore,
  sheet: MonthSheet,
  rowId: string,
  emp: Employee,
  year: number,
  month: number,
  opts?: { sickConfirmed?: boolean; vacationConfirmed?: boolean; asOfDate?: string },
): PayrollHourDetail {
  const days = daysInMonth(year, month)
  const asOfDate = opts?.asOfDate
  const confirm: AbsenceConfirmState | undefined =
    opts?.sickConfirmed !== undefined || opts?.vacationConfirmed !== undefined
      ? { sickConfirmed: opts?.sickConfirmed, vacationConfirmed: opts?.vacationConfirmed }
      : undefined
  const hours = getRowHoursSnapshot(sheet, rowId, emp, year, month, confirm, asOfDate)
  const { planHours, factHours, workFactHours, monthDeltaOtHours } = hours

  let baseHours = 0
  let otDayHours = 0
  let otNightHours = 0
  let nightShiftHours = 0
  let idleHours = 0

  if (monthDeltaOtHours > 0) {
    // База = норма работы (план − ОТ/Б/ПР), не полный план.
    baseHours = Math.max(0, workFactHours - monthDeltaOtHours)
    otDayHours = monthDeltaOtHours
  } else {
    for (let d = 1; d <= days; d++) {
      const dateKey = dayDateKey(year, month, d)
      if (asOfDate && dateKey > asOfDate) continue
      const code = getFactMark(sheet, rowId, dateKey)
      if (!isWorkCode(code)) continue

      const worked = factWorkedHours(sheet, rowId, dateKey, code)
      if (worked <= 0) continue

      if (code === 'Н') {
        const shiftH = emp.shiftHours ?? hoursForCode(code)
        nightShiftHours += Math.min(worked, shiftH)
        const extraH = Math.max(0, worked - shiftH)
        if (extraH > 0) otNightHours += extraH
      } else {
        const normH = hoursForCode(code)
        baseHours += Math.min(worked, normH)
        const extraH = Math.max(0, worked - normH)
        if (extraH > 0) otDayHours += extraH
      }
    }
  }

  // Ночные смены учитываем отдельно даже при месячном Δ
  if (monthDeltaOtHours > 0) {
    for (let d = 1; d <= days; d++) {
      const dateKey = dayDateKey(year, month, d)
      if (asOfDate && dateKey > asOfDate) continue
      const code = getFactMark(sheet, rowId, dateKey)
      if (code !== 'Н') continue
      const worked = factWorkedHours(sheet, rowId, dateKey, code)
      if (worked <= 0) continue
      const shiftH = emp.shiftHours ?? hoursForCode(code)
      nightShiftHours += Math.min(worked, shiftH)
      const extraH = Math.max(0, worked - shiftH)
      if (extraH > 0) otNightHours += extraH
    }
  }

  for (let d = 1; d <= days; d++) {
    const dateKey = dayDateKey(year, month, d)
    if (asOfDate && dateKey > asOfDate) continue
    if (getFactMark(sheet, rowId, dateKey) !== 'ПР') continue
    const planMark = sheet.plan[rowId]?.[dateKey] ?? ''
    idleHours += isWorkCode(planMark) ? hoursForCode(planMark) : effectiveShiftHours(emp)
  }

  const accrual = resolvePayrollAccrualRules(store.settings)
  const rowBrigade = sheet.rows.find((r) => r.id === rowId)?.brigade ?? emp.brigade
  const nightLine = computeNightLineFixedPay({
    sheet,
    rowId,
    brigade: rowBrigade,
    year,
    month,
    fixedGel: accrual.nightLineFixedGel,
    asOfDate,
  })

  return {
    planHours,
    factHours,
    workFactHours,
    baseHours,
    overtimeHours: otDayHours + otNightHours,
    monthDeltaOtHours,
    otDayHours,
    otNightHours,
    nightShiftHours,
    idleHours,
    hourlyRate: resolveRowHourlyRate(emp, year, month),
    nightMultiplier: accrual.nightMultiplier,
    idleMultiplier: accrual.idleMultiplier,
    otDayMultiplier: accrual.otDayMultiplier,
    otNightMultiplier: accrual.otNightMultiplier,
    nightLineNights: nightLine.nights,
    nightLineFixedGel: accrual.nightLineFixedGel,
    nightLineBonus: nightLine.amount,
    brigadier: computeBrigadierPay(store, sheet, rowId, emp, year, month, asOfDate),
  }
}

export function brigadierBonusFromDetail(detail: BrigadierPayDetail | null): number {
  return detail?.amount ?? 0
}
