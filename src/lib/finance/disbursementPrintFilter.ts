import { employeeStructuralUnitLabel } from '@/lib/hr/orgStructure'
import type { HrStructuralUnit } from '@/lib/hr/types'
import type { Employee } from '@/lib/types'

export type DisbursementPrintRow = {
  lineId: string
  employeeId: string
  emp?: Employee
  employeeName: string
  amount: number
}

export type DisbursementPrintFilterState = {
  /** Пусто = все подразделения */
  unitIds: string[]
  /** Пусто = все бригады */
  brigades: string[]
  /** Выбранные строки для печати; null = все после unit/brigade */
  selectedLineIds: string[] | null
}

export function defaultPrintFilter(): DisbursementPrintFilterState {
  return { unitIds: [], brigades: [], selectedLineIds: null }
}

export function rowUnitId(emp: Employee | undefined): string {
  return emp?.structuralUnitId?.trim() || '__none__'
}

export function rowBrigade(emp: Employee | undefined): string {
  return emp?.brigade?.trim() || '—'
}

export function uniqueUnitsFromRows(
  rows: DisbursementPrintRow[],
  units: HrStructuralUnit[],
): { id: string; label: string }[] {
  const seen = new Map<string, string>()
  for (const r of rows) {
    const id = rowUnitId(r.emp)
    if (seen.has(id)) continue
    const label =
      id === '__none__' || !r.emp
        ? '—'
        : employeeStructuralUnitLabel(r.emp, units) || id
    seen.set(id, label)
  }
  return [...seen.entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ru'))
}

export function uniqueBrigadesFromRows(rows: DisbursementPrintRow[]): string[] {
  return [...new Set(rows.map((r) => rowBrigade(r.emp)))].sort((a, b) =>
    a.localeCompare(b, 'ru'),
  )
}

/** Строки после фильтра подразделения/бригады. */
export function filterRowsByOrg(
  rows: DisbursementPrintRow[],
  filter: DisbursementPrintFilterState,
): DisbursementPrintRow[] {
  return rows.filter((r) => {
    if (filter.unitIds.length > 0 && !filter.unitIds.includes(rowUnitId(r.emp))) {
      return false
    }
    if (filter.brigades.length > 0 && !filter.brigades.includes(rowBrigade(r.emp))) {
      return false
    }
    return true
  })
}

/** Итоговый набор для печати. */
export function resolvePrintRows(
  rows: DisbursementPrintRow[],
  filter: DisbursementPrintFilterState,
): DisbursementPrintRow[] {
  const scoped = filterRowsByOrg(rows, filter)
  if (filter.selectedLineIds == null) return scoped
  const set = new Set(filter.selectedLineIds)
  return scoped.filter((r) => set.has(r.lineId))
}

export function toggleInList(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
}
