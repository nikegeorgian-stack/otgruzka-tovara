import { addBrigadeRow, normalizeBrigadeSlots } from './brigadeRows'
import { shiftMonth } from './dates'
import { moveRowMarks, syncPlanRow } from './monthSheet'
import { employeeActiveInMonth } from '@/lib/hr/employeeActive'
import type { Employee, MonthSheet } from './types'

/** Активные сотрудники, у которых в карточке указана эта бригада. */
export function employeesInBrigadeFromHr(
  employees: Employee[],
  brigade: string,
  month?: string,
): Employee[] {
  return employees
    .filter(
      (e) =>
        (month ? employeeActiveInMonth(e, month) : e.active && (e.hrStatus ?? 'active') !== 'fired') &&
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

/**
 * Состав этой же бригады в предыдущем месяце (порядок строк сохраняется).
 * Неактивных в целевом месяце отбрасываем.
 */
export function rosterIdsFromPreviousMonth(
  months: Record<string, MonthSheet>,
  month: string,
  brigade: string,
  employees: Employee[],
): { prevMonth: string; ids: string[] } {
  const prevMonth = shiftMonth(month, -1)
  const prev = months[prevMonth]
  if (!prev) return { prevMonth, ids: [] }
  const raw = rosterIdsInMonthSheet(prev, brigade)
  const active = new Set(
    employees.filter((e) => employeeActiveInMonth(e, month)).map((e) => e.id),
  )
  const seen = new Set<string>()
  const ids: string[] = []
  for (const id of raw) {
    if (!active.has(id) || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return { prevMonth, ids }
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

function isTransferSplitRow(sheet: MonthSheet, rowId: string): boolean {
  const b = sheet.rowBounds?.[rowId]
  return Boolean(b?.inactiveFrom?.trim() || b?.inactiveUntil?.trim())
}

/**
 * Задать состав бригады в табеле месяца: выбранные сотрудники попадают в строки,
 * остальные слоты бригады очищаются.
 * Строки с периодом перевода (inactiveFrom/Until) не трогаем — иначе пропадает история месяца.
 */
export function applyBrigadeRoster(
  sheet: MonthSheet,
  employees: Employee[],
  brigade: string,
  selectedIds: string[],
): MonthSheet {
  const selected = new Set(selectedIds)
  const ordered = selectedIds.filter((id) => employees.some((e) => e.id === id))
  const prevRowByEmp = new Map(
    sheet.rows
      .filter((r) => r.employeeId)
      .map((r) => [r.employeeId!, r.id] as const),
  )

  let rows = sheet.rows.map((r) => {
    if (isTransferSplitRow(sheet, r.id)) return r
    if (r.employeeId && selected.has(r.employeeId) && r.brigade !== brigade) {
      return { ...r, employeeId: null }
    }
    if (r.brigade === brigade && r.employeeId && !selected.has(r.employeeId)) {
      return { ...r, employeeId: null }
    }
    return r
  })

  let next: MonthSheet = { ...sheet, rows }
  const migratedTo = new Set<string>()

  for (const empId of ordered) {
    if (rows.some((r) => r.brigade === brigade && r.employeeId === empId)) continue

    let emptyRow = rows.find((r) => r.brigade === brigade && !r.employeeId)
    if (!emptyRow) {
      next = addBrigadeRow({ ...next, rows }, brigade)
      rows = next.rows
      emptyRow = rows.find((r) => r.brigade === brigade && !r.employeeId)
    }
    if (!emptyRow) continue

    const fromId = prevRowByEmp.get(empId)
    rows = rows.map((r) => (r.id === emptyRow!.id ? { ...r, employeeId: empId } : r))
    next = { ...next, rows }
    if (fromId && fromId !== emptyRow.id) {
      next = moveRowMarks(next, fromId, emptyRow.id)
      migratedTo.add(emptyRow.id)
    }
  }

  // Пустые слоты без перенесённых данных — можно очистить.
  for (const row of next.rows.filter((r) => r.brigade === brigade && !r.employeeId)) {
    if (migratedTo.has(row.id)) continue
    next = stripRowMarks(next, row.id)
  }

  for (const row of next.rows.filter((r) => r.brigade === brigade && r.employeeId)) {
    if (migratedTo.has(row.id)) continue
    const emp = employees.find((e) => e.id === row.employeeId)
    // Новый слот без переноса — график с нуля (не оставляем чужие orphan-метки).
    if (emp) next = syncPlanRow(next, row.id, emp)
  }

  return normalizeBrigadeSlots(next, brigade)
}
