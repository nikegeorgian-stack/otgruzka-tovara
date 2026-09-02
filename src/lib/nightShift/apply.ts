import { addBrigadeRow, normalizeBrigadeSlots } from '@/lib/brigadeRows'
import { setFactWithOverride } from '@/lib/dayTransfer'
import { getFactMark } from '@/lib/stats'
import type { AppStore, DayCode, MonthSheet } from '@/lib/types'
import type { NightShiftAppliedMark, NightShiftDocument } from './types'

function monthKeyFromDate(date: string): string {
  return date.slice(0, 7)
}

/** Строка табеля сотрудника на день (предпочитаем HR-бригаду). */
function resolveRowForEmployee(
  sheet: MonthSheet,
  employeeId: string,
  empBrigade: string,
): { sheet: MonthSheet; rowId: string } {
  const preferred = sheet.rows.find(
    (r) => r.employeeId === employeeId && r.brigade === empBrigade,
  )
  if (preferred) return { sheet, rowId: preferred.id }

  const any = sheet.rows.find((r) => r.employeeId === employeeId)
  if (any) return { sheet, rowId: any.id }

  const brigade = empBrigade && sheet.rows.some((r) => r.brigade === empBrigade)
    ? empBrigade
    : sheet.rows[0]?.brigade
  if (!brigade) return { sheet, rowId: '' }

  let next = sheet
  let emptyId = next.rows.find((r) => r.brigade === brigade && !r.employeeId)?.id
  if (!emptyId) {
    next = addBrigadeRow(next, brigade)
    emptyId = next.rows.find((r) => r.brigade === brigade && !r.employeeId)?.id
  }
  if (!emptyId) return { sheet: next, rowId: '' }
  next = {
    ...next,
    rows: next.rows.map((r) => (r.id === emptyId ? { ...r, employeeId } : r)),
  }
  next = normalizeBrigadeSlots(next, brigade)
  return { sheet: next, rowId: emptyId }
}

/** Провести: поставить Н в факт выбранным. */
export function applyNightShiftToStore(
  store: AppStore,
  doc: NightShiftDocument,
): { store: AppStore; applied: NightShiftAppliedMark[] } | null {
  const month = monthKeyFromDate(doc.date)
  const sheet0 = store.months[month]
  if (!sheet0) return null

  let sheet = sheet0
  const applied: NightShiftAppliedMark[] = []
  const touchedBrigades = new Set<string>()

  for (const employeeId of doc.employeeIds) {
    const emp = store.employees.find((e) => e.id === employeeId)
    if (!emp) continue
    const resolved = resolveRowForEmployee(sheet, employeeId, emp.brigade)
    sheet = resolved.sheet
    if (!resolved.rowId) continue
    const prev = getFactMark(sheet, resolved.rowId, doc.date)
    applied.push({ employeeId, rowId: resolved.rowId, prevFact: prev })
    sheet = setFactWithOverride(sheet, resolved.rowId, doc.date, 'Н')
    const row = sheet.rows.find((r) => r.id === resolved.rowId)
    if (row?.brigade) touchedBrigades.add(row.brigade)
  }

  for (const b of touchedBrigades) {
    sheet = normalizeBrigadeSlots(sheet, b)
  }

  return {
    store: { ...store, months: { ...store.months, [month]: sheet } },
    applied,
  }
}

/** Аннулировать: вернуть предыдущие факты. */
export function revertNightShiftFromStore(
  store: AppStore,
  doc: NightShiftDocument,
): AppStore | null {
  const month = monthKeyFromDate(doc.date)
  const sheet0 = store.months[month]
  if (!sheet0 || !doc.applied?.length) return store

  let sheet = sheet0
  for (const mark of doc.applied) {
    sheet = setFactWithOverride(
      sheet,
      mark.rowId,
      doc.date,
      (mark.prevFact || '') as DayCode,
    )
  }
  return { ...store, months: { ...store.months, [month]: sheet } }
}
