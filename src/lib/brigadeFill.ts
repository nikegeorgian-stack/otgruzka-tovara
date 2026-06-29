import { addBrigadeRow, normalizeBrigadeSlots } from './brigadeRows'
import { syncPlanRow } from './monthSheet'
import type { Employee, MonthSheet } from './types'

/** Активные сотрудники, у которых в карточке указана эта бригада. */
export function employeesInBrigadeFromHr(
  employees: Employee[],
  brigade: string,
): Employee[] {
  return employees
    .filter(
      (e) =>
        e.active &&
        (e.hrStatus ?? 'active') !== 'fired' &&
        e.brigade === brigade,
    )
    .sort(
      (a, b) =>
        a.tabNumber.localeCompare(b.tabNumber, 'ru') ||
        a.fullName.localeCompare(b.fullName, 'ru'),
    )
}

/** Кто уже стоит в строках бригады в табеле месяца. */
export function rosterIdsInMonthSheet(sheet: MonthSheet, brigade: string): string[] {
  return sheet.rows
    .filter((r) => r.brigade === brigade && r.employeeId)
    .map((r) => r.employeeId!)
}

/** Сотрудники, занятые в табеле месяца (любая бригада). */
export function assignedEmployeeIdsInMonth(sheet: MonthSheet): Set<string> {
  const ids = new Set<string>()
  for (const row of sheet.rows) {
    if (row.employeeId) ids.add(row.employeeId)
  }
  return ids
}

function stripRowMarks(sheet: MonthSheet, rowId: string): MonthSheet {
  const { [rowId]: _p, ...plan } = sheet.plan
  const { [rowId]: _f, ...fact } = sheet.fact
  return {
    ...sheet,
    plan,
    fact,
    factOverrides: sheet.factOverrides.filter((k) => !k.startsWith(`${rowId}|`)),
    comments: Object.fromEntries(
      Object.entries(sheet.comments).filter(([k]) => !k.startsWith(`${rowId}|`)),
    ),
    substitutions: Object.fromEntries(
      Object.entries(sheet.substitutions ?? {}).filter(
        ([k]) => !k.startsWith(`${rowId}|`),
      ),
    ),
  }
}

/**
 * Задать состав бригады в табеле месяца: выбранные сотрудники попадают в строки,
 * остальные слоты бригады очищаются. Сотрудник может быть только в одной строке месяца.
 */
export function applyBrigadeRoster(
  sheet: MonthSheet,
  employees: Employee[],
  brigade: string,
  selectedIds: string[],
): MonthSheet {
  const selected = new Set(selectedIds)
  const ordered = selectedIds.filter((id) => employees.some((e) => e.id === id))

  let rows = sheet.rows.map((r) => {
    if (r.employeeId && selected.has(r.employeeId) && r.brigade !== brigade) {
      return { ...r, employeeId: null }
    }
    if (r.brigade === brigade && r.employeeId && !selected.has(r.employeeId)) {
      return { ...r, employeeId: null }
    }
    return r
  })

  let next: MonthSheet = { ...sheet, rows }

  for (const empId of ordered) {
    if (rows.some((r) => r.brigade === brigade && r.employeeId === empId)) continue

    let emptyRow = rows.find((r) => r.brigade === brigade && !r.employeeId)
    if (!emptyRow) {
      next = addBrigadeRow({ ...next, rows }, brigade)
      rows = next.rows
      emptyRow = rows.find((r) => r.brigade === brigade && !r.employeeId)
    }
    if (!emptyRow) continue

    rows = rows.map((r) => (r.id === emptyRow!.id ? { ...r, employeeId: empId } : r))
    next = { ...next, rows }
  }

  for (const row of next.rows.filter((r) => r.brigade === brigade && !r.employeeId)) {
    next = stripRowMarks(next, row.id)
  }

  for (const row of next.rows.filter((r) => r.brigade === brigade && r.employeeId)) {
    const emp = employees.find((e) => e.id === row.employeeId)
    if (emp) next = syncPlanRow(next, row.id, emp)
  }

  return normalizeBrigadeSlots(next, brigade)
}
