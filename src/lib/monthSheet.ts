import { DEFAULT_BRIGADES } from './brigades.constants'
import { createEmptyBrigadeRow } from './brigadeRows'
import { monthKey } from './dates'
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
    dayTransfers: {},
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
  const planRow = buildPlanRow(employee, sheet.month)
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

export function defaultMonths(): string[] {
  return [monthKey(2026, 6), monthKey(2026, 7), monthKey(2026, 8)]
}
