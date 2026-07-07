import { createEmptyBrigadeRow } from './brigadeRows'
import { employeeActiveInMonth } from './hr/employeeActive'
import { ensureMonth } from './monthSheet'
import { buildPlanRow } from './schedule'
import type { AppStore, TimesheetRow } from './types'

function insertRowsBeforeEmpty(
  rows: TimesheetRow[],
  brigade: string,
  newRows: TimesheetRow[],
): TimesheetRow[] {
  const emptyIdx = rows.findIndex((r) => r.brigade === brigade && !r.employeeId)
  if (emptyIdx < 0) return [...rows, ...newRows]
  return [...rows.slice(0, emptyIdx), ...newRows, ...rows.slice(emptyIdx)]
}

/**
 * Добавить в месяц сотрудников, которые были активны в этом месяце по кадрам,
 * но ещё не заведены в строках табеля.
 */
export function syncMonthRosterFromHrInStore(store: AppStore, month: string): AppStore {
  const next = ensureMonth(store, month)
  let sheet = next.months[month]
  if (!sheet) return next

  for (const brigade of next.brigades) {
    const existingIds = new Set(
      sheet.rows
        .filter((r) => r.brigade === brigade && r.employeeId)
        .map((r) => r.employeeId!),
    )

    const missing = next.employees
      .filter((e) => employeeActiveInMonth(e, month) && e.brigade === brigade)
      .filter((e) => !existingIds.has(e.id))
      .sort((a, b) => a.tabNumber.localeCompare(b.tabNumber, 'ru', { numeric: true }))

    if (!missing.length) continue

    let order = sheet.rows.reduce((m, r) => Math.max(m, r.sortOrder), -1) + 1
    const newRows: TimesheetRow[] = missing.map((emp) => ({
      id: crypto.randomUUID(),
      brigade,
      employeeId: emp.id,
      sortOrder: order++,
    }))

    const plan = { ...sheet.plan }
    const fact = { ...sheet.fact }
    for (const row of newRows) {
      const emp = next.employees.find((e) => e.id === row.employeeId)
      if (!emp) continue
      plan[row.id] = buildPlanRow(emp, month)
      fact[row.id] = { ...plan[row.id] }
    }

    let rows = insertRowsBeforeEmpty(sheet.rows, brigade, newRows)
    if (!rows.some((r) => r.brigade === brigade && !r.employeeId)) {
      rows = [...rows, createEmptyBrigadeRow(brigade, order)]
    }

    sheet = { ...sheet, rows, plan, fact }
  }

  return { ...next, months: { ...next.months, [month]: sheet } }
}

/** Создать месяц и собрать состав из кадров на дату месяца (архивное внесение). */
export function prepareArchiveMonthInStore(store: AppStore, month: string): AppStore {
  return syncMonthRosterFromHrInStore(ensureMonth(store, month), month)
}
