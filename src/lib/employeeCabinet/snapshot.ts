import { absenceConfirmForEmployee } from '@/lib/absenceConfirm'
import { dayDateKey, daysInMonth, isoDateLocal, parseMonthKey } from '@/lib/dates'
import { isTransferredOut } from '@/lib/dayTransfer'
import { resolveCabinetAsOfDate } from '@/lib/employeeCabinet/asOf'
import {
  factWorkedHours,
  getFactExtraHours,
  isWorkCode,
} from '@/lib/factExtra'
import { resolvePayrollAccrualRules } from '@/lib/finance/payrollAccrualRules'
import { brigadierDateKeys } from '@/lib/finance/payrollDetail'
import { getRowHoursSnapshot } from '@/lib/finance/rowHours'
import { calculateRowPay } from '@/lib/payroll'
import { hoursForCode } from '@/lib/codes'
import { effectiveShiftHours } from '@/lib/schedules'
import { getFactMark } from '@/lib/stats'
import type { AppStore, DayCode, Employee, MonthSheet, TimesheetRow } from '@/lib/types'

export type AbsenceGateStatus = 'none' | 'pending' | 'confirmed'

/** Визуальный тип дня в личном календаре. */
export type CabinetDayKind =
  | 'empty'
  | 'off'
  | 'planned'
  | 'work'
  | 'overtime'
  | 'night'
  | 'double'
  | 'vacation'
  | 'sick'
  | 'idle'
  | 'absent'
  | 'missed'
  | 'diff'

export type CabinetDayRow = {
  dateKey: string
  day: number
  plan: DayCode
  fact: DayCode
  planWork: boolean
  /** План был рабочий, а факт не отмечен как выход (пусто / В) — только прошлые дни. */
  missed: boolean
  idle: boolean
  extraHours: number
  workedHours: number
  /** Часы по коду плана (если план рабочий). */
  planHours: number
  kind: CabinetDayKind
  /** День отмечен / считается днём бригадирства. */
  isBrigadier: boolean
  /** Бригада строки табеля в этот день (при переводе может меняться). */
  brigade?: string
}

export type EmployeeCabinetSnapshot = {
  month: string
  employee: Employee
  rowId: string | null
  /** Все строки сотрудника в месяце (перевод бригады). */
  rowIds: string[]
  brigades: string[]
  inMonth: boolean
  /** Дата среза (сегодня в текущем месяце); undefined = полный месяц. */
  asOfDate?: string
  /** План часов на дату среза (для отклонения факт vs план). */
  planHours: number
  /** План на весь месяц (для «осталось отработать»). */
  monthPlanHours: number
  factHours: number
  workFactHours: number
  /** Сколько часов осталось до плана месяца (факт + подтверждённые ОТ/Б за весь месяц). */
  hoursShort: number
  /**
   * Факт часов за весь месяц с зачётом подтверждённых ОТ/Б
   * (для «осталось» — не путать с factHours «на сегодня»).
   */
  monthFactHours: number
  /** Отклонение: факт − план на сегодня (отриц. = отставание). */
  planDeltaHours: number
  /** Оценка числа доп. смен (по длительности смены). */
  shiftsShort: number
  shiftHours: number
  estimatedPay: number
  sickStatus: AbsenceGateStatus
  vacationStatus: AbsenceGateStatus
  missedPlanDays: number
  idleDays: number
  overtimeHours: number
  workDaysCount: number
  /** Дней бригадирства в месяце. */
  brigadierDaysCount: number
  /** Часы факта в дни бригадирства. */
  brigadierHours: number
  days: CabinetDayRow[]
}

function employeeRows(sheet: MonthSheet | undefined, employeeId: string): TimesheetRow[] {
  return sheet?.rows.filter((r) => r.employeeId === employeeId) ?? []
}

function absenceGate(
  hasCode: boolean,
  confirmed: boolean,
): AbsenceGateStatus {
  if (!hasCode) return 'none'
  return confirmed ? 'confirmed' : 'pending'
}

export function classifyCabinetDay(input: {
  plan: DayCode
  fact: DayCode
  planWork: boolean
  missed: boolean
  idle: boolean
  extraHours: number
  /** YYYY-MM-DD — день в будущем или сегодня (ещё не «пропуск»). */
  isPast: boolean
}): CabinetDayKind {
  const { plan, fact, planWork, missed, idle, extraHours, isPast } = input

  if (fact === 'Б') return 'sick'
  if (fact === 'ОТ' || fact === 'ОО') return 'vacation'
  if (fact === 'X') return 'absent'
  if (idle || fact === 'ПР') return 'idle'
  if (missed && isPast) return 'missed'
  if (fact === 'Н') return 'night'
  if (fact === '22') return 'double'
  if (isWorkCode(fact) && extraHours > 0) return 'overtime'
  if (isWorkCode(fact)) return 'work'
  if (fact === 'В') return 'off'
  if (planWork && !isPast && fact === '') return 'planned'
  if (plan && fact && plan !== fact) return 'diff'
  if (planWork && !fact) return isPast ? 'missed' : 'planned'
  if (plan === 'В' || (!planWork && !fact)) return plan || fact ? 'off' : 'empty'
  return 'empty'
}

function pickDayCell(
  sheet: MonthSheet,
  rows: TimesheetRow[],
  dateKey: string,
): {
  plan: DayCode
  fact: DayCode
  rowId: string
  brigade: string
  extraHours: number
  workedHours: number
} | null {
  let best: {
    plan: DayCode
    fact: DayCode
    rowId: string
    brigade: string
    extraHours: number
    workedHours: number
    score: number
  } | null = null

  for (const row of rows) {
    if (isTransferredOut(sheet, row.id, dateKey)) continue
    const plan = (sheet.plan[row.id]?.[dateKey] ?? '') as DayCode
    const fact = getFactMark(sheet, row.id, dateKey)
    if (!plan && !fact) continue
    const extraHours = getFactExtraHours(sheet, row.id, dateKey)
    const workedHours = factWorkedHours(sheet, row.id, dateKey, fact)
    let score = 1
    if (isWorkCode(fact) || fact === 'Б' || fact === 'ОТ' || fact === 'ПР' || fact === 'X') score = 3
    else if (fact) score = 2
    else if (isWorkCode(plan)) score = 2
    if (!best || score > best.score) {
      best = { plan, fact, rowId: row.id, brigade: row.brigade, extraHours, workedHours, score }
    }
  }
  if (!best) return null
  return {
    plan: best.plan,
    fact: best.fact,
    rowId: best.rowId,
    brigade: best.brigade,
    extraHours: best.extraHours,
    workedHours: best.workedHours,
  }
}

/** Снимок личного кабинета / HR-календаря за месяц. */
export function buildEmployeeCabinetSnapshot(
  store: AppStore,
  employee: Employee,
  month: string,
): EmployeeCabinetSnapshot {
  const sheet = store.months[month]
  const rows = employeeRows(sheet, employee.id)
  const { year, month: mo } = parseMonthKey(month)
  const daysCount = daysInMonth(year, mo)
  const confirm = absenceConfirmForEmployee(store, employee.id, month)
  const shiftHours = effectiveShiftHours(employee)
  const todayKey = isoDateLocal(new Date())
  const asOfDate = resolveCabinetAsOfDate(month, todayKey)
  const empty: EmployeeCabinetSnapshot = {
    month,
    employee,
    rowId: null,
    rowIds: [],
    brigades: [],
    inMonth: false,
    asOfDate,
    planHours: 0,
    monthPlanHours: 0,
    factHours: 0,
    workFactHours: 0,
    hoursShort: 0,
    monthFactHours: 0,
    planDeltaHours: 0,
    shiftsShort: 0,
    shiftHours,
    estimatedPay: 0,
    sickStatus: 'none',
    vacationStatus: 'none',
    missedPlanDays: 0,
    idleDays: 0,
    overtimeHours: 0,
    workDaysCount: 0,
    brigadierDaysCount: 0,
    brigadierHours: 0,
    days: [],
  }

  if (!sheet || rows.length === 0) return empty

  const accrual = resolvePayrollAccrualRules(store.settings)
  let planHours = 0
  let monthPlanHours = 0
  let factHours = 0
  let monthFactHours = 0
  let workFactHours = 0
  let estimatedPay = 0
  const brigDates = new Set<string>()
  for (const row of rows) {
    const hoursToDate = getRowHoursSnapshot(sheet, row.id, employee, year, mo, confirm, asOfDate)
    const hoursFull = asOfDate
      ? getRowHoursSnapshot(sheet, row.id, employee, year, mo, confirm)
      : hoursToDate
    const pay = calculateRowPay(employee, sheet, row.id, year, mo, {
      sickConfirmed: confirm.sickConfirmed === true,
      vacationConfirmed: confirm.vacationConfirmed === true,
      accrual,
      asOfDate,
    })
    planHours += hoursToDate.planHours
    monthPlanHours += hoursFull.planHours
    factHours += hoursToDate.factHours
    monthFactHours += hoursFull.factHours
    workFactHours += hoursToDate.workFactHours
    estimatedPay += pay.amount
    for (const k of brigadierDateKeys(store, sheet, row.id, employee, year, mo, asOfDate)) {
      brigDates.add(k)
    }
  }

  let hasSick = false
  let hasVacation = false
  let missedPlanDays = 0
  let idleDays = 0
  let overtimeHours = 0
  let workDaysCount = 0
  let brigadierHours = 0
  const days: CabinetDayRow[] = []
  const brigades = [...new Set(rows.map((r) => r.brigade))]

  for (let d = 1; d <= daysCount; d++) {
    const dateKey = dayDateKey(year, mo, d)
    const cell = pickDayCell(sheet, rows, dateKey)
    const plan = cell?.plan ?? ''
    // Будущие дни: не показываем «факт = план» как уже отработанное.
    const isFuture = Boolean(asOfDate && dateKey > asOfDate)
    const fact = isFuture ? '' : (cell?.fact ?? '')
    const planWork = isWorkCode(plan)
    const idle = fact === 'ПР'
    const isPast = dateKey < todayKey
    const missed =
      planWork && (fact === '' || fact === 'В') && !isWorkCode(fact) && isPast
    const extraHours = isFuture ? 0 : (cell?.extraHours ?? 0)
    const workedHours = isFuture ? 0 : (cell?.workedHours ?? 0)
    const dayPlanHours = isWorkCode(plan) ? hoursForCode(plan) : 0
    const isBrigadier = !isFuture && brigDates.has(dateKey)
    const kind = classifyCabinetDay({
      plan,
      fact,
      planWork,
      missed,
      idle,
      extraHours,
      isPast,
    })

    if (!isFuture && fact === 'Б') hasSick = true
    if (!isFuture && fact === 'ОТ') hasVacation = true
    if (missed) missedPlanDays += 1
    if (idle) idleDays += 1
    if (extraHours > 0) overtimeHours += extraHours
    if (isWorkCode(fact)) workDaysCount += 1
    if (isBrigadier && workedHours > 0) brigadierHours += workedHours

    days.push({
      dateKey,
      day: d,
      plan,
      fact,
      planWork,
      missed,
      idle,
      extraHours,
      workedHours,
      planHours: dayPlanHours,
      kind,
      isBrigadier,
      brigade: cell?.brigade,
    })
  }

  // «Осталось» — по полному месяцу: подтверждённые ОТ/Б зачитываются в факт и закрывают норму.
  const hoursShort = Math.max(0, Math.round((monthPlanHours - monthFactHours) * 10) / 10)
  const planDeltaHours = Math.round((factHours - planHours) * 10) / 10
  const shiftsShort =
    hoursShort > 0 && shiftHours > 0 ? Math.ceil(hoursShort / shiftHours) : 0

  return {
    month,
    employee,
    rowId: rows[0]?.id ?? null,
    rowIds: rows.map((r) => r.id),
    brigades,
    inMonth: true,
    asOfDate,
    planHours,
    monthPlanHours,
    factHours,
    workFactHours,
    hoursShort,
    monthFactHours: Math.round(monthFactHours * 10) / 10,
    planDeltaHours,
    shiftsShort,
    shiftHours,
    estimatedPay: Math.round(estimatedPay * 100) / 100,
    sickStatus: absenceGate(hasSick, confirm.sickConfirmed === true),
    vacationStatus: absenceGate(hasVacation, confirm.vacationConfirmed === true),
    missedPlanDays,
    idleDays,
    overtimeHours,
    workDaysCount,
    brigadierDaysCount: brigDates.size,
    brigadierHours: Math.round(brigadierHours * 10) / 10,
    days,
  }
}
