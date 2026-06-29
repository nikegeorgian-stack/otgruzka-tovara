import type { MonthSheet, TimesheetRow } from './types'

function newRowId(): string {
  return crypto.randomUUID()
}

function stripRowData(sheet: MonthSheet, rowIds: string[]): MonthSheet {
  if (!rowIds.length) return sheet
  const drop = new Set(rowIds)
  const plan = { ...sheet.plan }
  const fact = { ...sheet.fact }
  const comments = { ...sheet.comments }
  const substitutions = { ...(sheet.substitutions ?? {}) }
  for (const id of rowIds) {
    delete plan[id]
    delete fact[id]
  }
  return {
    ...sheet,
    plan,
    fact,
    comments: Object.fromEntries(
      Object.entries(comments).filter(([k]) => !drop.has(k.split('|')[0] ?? '')),
    ),
    substitutions: Object.fromEntries(
      Object.entries(substitutions).filter(([k]) => !drop.has(k.split('|')[0] ?? '')),
    ),
    factOverrides: sheet.factOverrides.filter((k) => !drop.has(k.split('|')[0] ?? '')),
  }
}

export function createEmptyBrigadeRow(
  brigade: string,
  sortOrder: number,
): TimesheetRow {
  return {
    id: newRowId(),
    brigade,
    employeeId: null,
    sortOrder,
  }
}

/** Добавить пустую строку в конец бригады. */
export function addBrigadeRow(sheet: MonthSheet, brigade: string): MonthSheet {
  const inBrigade = sheet.rows.filter((r) => r.brigade === brigade)
  const nextOrder =
    inBrigade.length > 0
      ? Math.max(...inBrigade.map((r) => r.sortOrder)) + 1
      : sheet.rows.reduce((m, r) => Math.max(m, r.sortOrder), -1) + 1
  const newRow = createEmptyBrigadeRow(brigade, nextOrder)
  return {
    ...sheet,
    rows: [...sheet.rows, newRow].sort((a, b) => a.sortOrder - b.sortOrder),
  }
}

/** Убрать одну пустую строку в бригаде (если есть и строк больше одной). */
export function removeEmptyBrigadeRow(sheet: MonthSheet, brigade: string): MonthSheet {
  const inBrigade = sheet.rows
    .filter((r) => r.brigade === brigade)
    .sort((a, b) => a.sortOrder - b.sortOrder)
  if (inBrigade.length <= 1) return sheet
  const emptyRows = inBrigade.filter((r) => !r.employeeId)
  if (!emptyRows.length) return sheet
  return removeBrigadeRow(sheet, emptyRows[emptyRows.length - 1]!.id)
}

/** Убрать строку (минимум одна строка на бригаду). */
export function removeBrigadeRow(sheet: MonthSheet, rowId: string): MonthSheet {
  const row = sheet.rows.find((r) => r.id === rowId)
  if (!row) return sheet
  const count = sheet.rows.filter((r) => r.brigade === row.brigade).length
  if (count <= 1) return sheet
  const next = {
    ...sheet,
    rows: sheet.rows.filter((r) => r.id !== rowId),
  }
  return stripRowData(next, [rowId])
}

function countEmptyInBrigade(sheet: MonthSheet, brigade: string): number {
  return sheet.rows.filter((r) => r.brigade === brigade && !r.employeeId).length
}

/**
 * План бригады: одно пустое место в конце, когда все заняты — добавить ещё;
 * лишние пустые (после снятия сотрудника) — убрать.
 */
export function normalizeBrigadeSlots(
  sheet: MonthSheet,
  brigade: string,
  options?: { addIfAllFilled?: boolean },
): MonthSheet {
  const addIfAllFilled = options?.addIfAllFilled !== false
  let next = sheet

  for (let guard = 0; guard < 32; guard++) {
    const empty = countEmptyInBrigade(next, brigade)
    if (empty <= 1) break
    const trimmed = removeEmptyBrigadeRow(next, brigade)
    if (trimmed === next) break
    next = trimmed
  }

  if (addIfAllFilled) {
    const inBrigade = next.rows.filter((r) => r.brigade === brigade)
    if (inBrigade.length > 0 && countEmptyInBrigade(next, brigade) === 0) {
      next = addBrigadeRow(next, brigade)
    }
  }

  return next
}
