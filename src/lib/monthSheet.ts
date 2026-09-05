import { DEFAULT_BRIGADES } from './brigades.constants'
import { createEmptyBrigadeRow } from './brigadeRows'
import { isWorkDayCode } from './codes'
import { monthKey, shiftMonth } from './dates'
import { employeeActiveInMonth } from './hr/employeeActive'
import { buildPlanRow } from './schedule'
import type { AppStore, DayCode, Employee, MonthSheet, TimesheetRow } from './types'

function newRowId(): string {
  return crypto.randomUUID()
}

export function createMonthSheet(
  month: string,
  employees: Employee[],
  brigades: string[] = [...DEFAULT_BRIGADES],
): MonthSheet {
  const rows: TimesheetRow[] = []
  let order = 0

  for (const brigade of brigades) {
    const inBrigade = employees
      .filter((e) => employeeActiveInMonth(e, month) && e.brigade === brigade)
      .sort((a, b) => a.tabNumber.localeCompare(b.tabNumber, 'ru', { numeric: true }))

    for (const emp of inBrigade) {
      rows.push({
        id: newRowId(),
        brigade,
        employeeId: emp.id,
        sortOrder: order++,
      })
    }
    rows.push(createEmptyBrigadeRow(brigade, order++))
  }

  const plan: MonthSheet['plan'] = {}
  const fact: MonthSheet['fact'] = {}

  for (const row of rows) {
    if (!row.employeeId) continue
    const emp = employees.find((e) => e.id === row.employeeId)
    if (!emp) continue
    plan[row.id] = buildPlanRow(emp, month)
    fact[row.id] = { ...plan[row.id] }
  }

  return {
    month,
    rows,
    plan,
    fact,
    factOverrides: [],
    comments: {},
    substitutions: {},
    factExtraHours: {},
    brigadierDays: {},
    factHoursOverride: {},
    brigadeSignoffs: {},
    dayTransfers: {},
    rowBounds: {},
  }
}

export function ensureMonth(store: AppStore, month: string): AppStore {
  if (store.months[month]) return store
  return {
    ...store,
    months: {
      ...store.months,
      [month]: createMonthSheet(month, store.employees, store.brigades),
    },
  }
}

export function syncPlanRow(
  sheet: MonthSheet,
  rowId: string,
  employee: Employee,
): MonthSheet {
  const planRow = buildPlanRow(employee, sheet.month, sheet.rowBounds?.[rowId])
  const nextPlan = { ...sheet.plan, [rowId]: planRow }
  const nextFact = { ...sheet.fact }
  const kept: Record<string, DayCode> = {}

  for (const [dateKey, code] of Object.entries(planRow)) {
    const oKey = `${rowId}|${dateKey}`
    if (sheet.factOverrides.includes(oKey)) {
      kept[dateKey] = nextFact[rowId]?.[dateKey] ?? code
    } else {
      kept[dateKey] = code
    }
  }
  nextFact[rowId] = kept

  return { ...sheet, plan: nextPlan, fact: nextFact }
}

/**
 * Ручная правка плана по дню.
 * Если факт этой ячейки не трогали руками — подтягиваем факт к плану
 * (и чистим +N / точные часы, если код нерабочий). Иначе факт не меняем.
 */
export function applyPlanDayMark(
  sheet: MonthSheet,
  rowId: string,
  dateKey: string,
  code: DayCode,
): MonthSheet {
  const oKey = `${rowId}|${dateKey}`
  const next: MonthSheet = {
    ...sheet,
    plan: {
      ...sheet.plan,
      [rowId]: { ...(sheet.plan[rowId] ?? {}), [dateKey]: code },
    },
  }
  if (sheet.factOverrides.includes(oKey)) return next

  const cellKey = `${rowId}|${dateKey}`
  const factExtraHours = { ...(sheet.factExtraHours ?? {}) }
  const factHoursOverride = { ...(sheet.factHoursOverride ?? {}) }
  if (!isWorkDayCode(code)) {
    delete factExtraHours[cellKey]
    delete factHoursOverride[cellKey]
  }

  return {
    ...next,
    fact: {
      ...sheet.fact,
      [rowId]: { ...(sheet.fact[rowId] ?? {}), [dateKey]: code },
    },
    factExtraHours,
    factHoursOverride,
  }
}

/**
 * Перенос план/факт/override с одной строки на другую (смена слота в составе).
 * Не затирает уже заполненные ячейки на целевой строке.
 */
export function moveRowMarks(
  sheet: MonthSheet,
  fromRowId: string,
  toRowId: string,
): MonthSheet {
  if (!fromRowId || !toRowId || fromRowId === toRowId) return sheet

  const fromPlan = sheet.plan[fromRowId]
  const fromFact = sheet.fact[fromRowId]
  const plan = { ...sheet.plan }
  const fact = { ...sheet.fact }

  if (fromPlan) {
    plan[toRowId] = { ...fromPlan, ...(plan[toRowId] ?? {}) }
    delete plan[fromRowId]
  }
  if (fromFact) {
    fact[toRowId] = { ...fromFact, ...(fact[toRowId] ?? {}) }
    delete fact[fromRowId]
  }

  const prefixFrom = `${fromRowId}|`
  const factOverrides = sheet.factOverrides.map((k) =>
    k.startsWith(prefixFrom) ? `${toRowId}|${k.slice(prefixFrom.length)}` : k,
  )
  const remapKeyed = <T,>(rec: Record<string, T> | undefined): Record<string, T> => {
    if (!rec) return {}
    const out: Record<string, T> = {}
    for (const [k, v] of Object.entries(rec)) {
      if (k.startsWith(prefixFrom)) out[`${toRowId}|${k.slice(prefixFrom.length)}`] = v
      else out[k] = v
    }
    return out
  }

  return {
    ...sheet,
    plan,
    fact,
    factOverrides: [...new Set(factOverrides)],
    comments: remapKeyed(sheet.comments),
    substitutions: remapKeyed(sheet.substitutions),
    factExtraHours: remapKeyed(sheet.factExtraHours),
    factHoursOverride: remapKeyed(sheet.factHoursOverride),
  }
}

/** Текущий и следующий календарный месяц — без ручного добавления. */
export function defaultMonths(now = new Date()): string[] {
  const cur = monthKey(now.getFullYear(), now.getMonth() + 1)
  return [cur, shiftMonth(cur, 1)]
}
