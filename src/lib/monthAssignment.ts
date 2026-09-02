import type { MonthSheet } from '@/lib/types'

export type MonthAssignment = {
  rowId: string
  brigade: string
}

/** Где сотрудник уже стоит в табеле месяца (одна строка). */
export function findMonthAssignment(
  sheet: MonthSheet,
  employeeId: string,
  excludeRowId?: string,
): MonthAssignment | undefined {
  for (const row of sheet.rows) {
    if (row.employeeId !== employeeId) continue
    if (excludeRowId && row.id === excludeRowId) continue
    return { rowId: row.id, brigade: row.brigade }
  }
  return undefined
}

/** employeeId → назначение в месяце. */
export function monthAssignmentsByEmployee(
  sheet: MonthSheet,
): Map<string, MonthAssignment> {
  const map = new Map<string, MonthAssignment>()
  for (const row of sheet.rows) {
    if (!row.employeeId) continue
    map.set(row.employeeId, { rowId: row.id, brigade: row.brigade })
  }
  return map
}
