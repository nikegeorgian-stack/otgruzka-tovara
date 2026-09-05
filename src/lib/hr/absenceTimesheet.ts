import { dayDateKey, parseMonthKey } from '@/lib/dates'
import { ensureMonth } from '@/lib/monthSheet'
import { isMonthClosed } from '@/lib/monthManage'
import { getFactMark } from '@/lib/stats'
import { auditFactChange } from '@/lib/audit'
import type { AppStore, DayCode, Employee } from '@/lib/types'
import { segmentsForDateRange } from './timesheetRange'
import type { HrAbsence } from './types'
import { absenceCodeForType } from './journal'
import { isScheduledWorkDay } from './sickWorkDays'

/** Проставляет код отсутствия в факте табеля (с factOverrides). */
export function patchStoreEmployeeFactRange(
  store: AppStore,
  month: string,
  employeeId: string,
  fromDay: number,
  toDay: number,
  code: DayCode,
  /** Если true — код только в дни смены по графику. */
  onlyScheduledWorkDays = false,
): AppStore {
  if (isMonthClosed(store, month)) return store
  const base = ensureMonth(store, month)
  const sheet = base.months[month]
  const row = sheet.rows.find((r) => r.employeeId === employeeId)
  if (!row) return store

  const emp = base.employees.find((e) => e.id === employeeId) as Employee | undefined
  const rowId = row.id
  const { year, month: mo } = parseMonthKey(month)
  const rowFact = { ...(sheet.fact[rowId] ?? {}) }
  const overrides = [...sheet.factOverrides]
  const lo = Math.max(1, Math.min(fromDay, toDay))
  const hi = Math.max(fromDay, toDay)
  const touched: string[] = []

  for (let d = lo; d <= hi; d++) {
    const dateKey = dayDateKey(year, mo, d)
    if (onlyScheduledWorkDays && emp && !isScheduledWorkDay(emp, dateKey)) continue
    rowFact[dateKey] = code
    const oKey = `${rowId}|${dateKey}`
    if (!overrides.includes(oKey)) overrides.push(oKey)
    touched.push(dateKey)
  }

  if (touched.length === 0) return store

  let next: AppStore = {
    ...base,
    months: {
      ...base.months,
      [month]: {
        ...sheet,
        fact: { ...sheet.fact, [rowId]: rowFact },
        factOverrides: overrides,
      },
    },
  }

  for (const dateKey of touched) {
    const prev = getFactMark(sheet, rowId, dateKey) ?? ''
    next = auditFactChange(next, month, rowId, dateKey, employeeId, prev, code)
  }
  return next
}

/** Синхронизирует HR-отсутствия сотрудника в факт табеля (план — через buildPlanRow). */
export function syncAbsencesToTimesheetFact(
  store: AppStore,
  employeeId: string,
  absences: HrAbsence[] | undefined,
): AppStore {
  let next = store
  for (const a of absences ?? []) {
    const code = absenceCodeForType(a.type)
    if (!code) continue
    const onlyWork = a.type === 'sick' || a.type === 'vacation'
    for (const seg of segmentsForDateRange(a.startDate, a.endDate)) {
      next = patchStoreEmployeeFactRange(
        next,
        seg.monthKey,
        employeeId,
        seg.fromDay,
        seg.toDay,
        code,
        onlyWork,
      )
    }
  }
  return next
}

export function absencesChanged(
  prev: HrAbsence[] | undefined,
  next: HrAbsence[] | undefined,
): boolean {
  const a = prev ?? []
  const b = next ?? []
  if (a.length !== b.length) return true
  const key = (x: HrAbsence) =>
    `${x.id}|${x.type}|${x.startDate}|${x.endDate}|${x.reason ?? ''}|${x.workDays ?? ''}`
  const setA = new Set(a.map(key))
  return b.some((x) => !setA.has(key(x)))
}
