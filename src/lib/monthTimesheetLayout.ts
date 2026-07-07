import {
  activeStructuralUnits,
  employeeStructuralUnitKey,
  NO_STRUCTURAL_UNIT_ID,
  type MonthGroupMode,
} from './monthViewOptions'
import { sortTimesheetRows, type MonthRowSort } from './monthRowSort'
import { structuralUnitName } from './hr/orgStructure'
import type { AppStore, Employee, HrStructuralUnit, MonthSheet, TimesheetRow } from './types'

export type TimesheetLayoutBlock = {
  kind: 'brigade' | 'unit' | 'unit-brigade'
  brigade: string
  unitId?: string
  unitLabel?: string
  rows: TimesheetRow[]
  brigadeRowCount: number
  emptyRowCount: number
}

type BuildArgs = {
  store: AppStore
  sheet: MonthSheet
  brigades: string[]
  groupMode: MonthGroupMode
  brigadeShown: (brigade: string) => boolean
  rowVisible: (rowId: string, brigade: string, employeeId: string | null) => boolean
  searchActive: boolean
  rowSort?: MonthRowSort
  employeesById?: Map<string, Employee>
  locale?: import('@/i18n/types').Locale
}

function prepareVisibleRows(
  rows: TimesheetRow[],
  rowVisible: BuildArgs['rowVisible'],
  searchActive: boolean,
  rowSort?: MonthRowSort,
  employeesById?: Map<string, Employee>,
  locale?: import('@/i18n/types').Locale,
): TimesheetRow[] {
  let visibleRows = rows.filter((r) => rowVisible(r.id, r.brigade, r.employeeId))
  if (!visibleRows.length) {
    const emptySlots = rows.filter((r) => !r.employeeId)
    if (emptySlots.length > 0 && !searchActive) visibleRows = emptySlots
  }
  if (rowSort && employeesById && locale) {
    visibleRows = sortTimesheetRows(visibleRows, employeesById, rowSort, locale)
  }
  return visibleRows
}

function unitLabelFor(
  unitId: string,
  units: HrStructuralUnit[],
  t: (key: string) => string,
): string {
  if (unitId === NO_STRUCTURAL_UNIT_ID) return t('month.unitUnassigned')
  return structuralUnitName(units, unitId) || unitId
}

export function buildTimesheetLayout(
  args: BuildArgs,
  t: (key: string) => string,
): TimesheetLayoutBlock[] {
  const { store, sheet, brigades, groupMode, brigadeShown, rowVisible, searchActive, rowSort, employeesById, locale } =
    args
  const units = activeStructuralUnits(store.hrStructuralUnits)

  if (groupMode === 'brigade') {
    const blocks: TimesheetLayoutBlock[] = []
    for (const brigade of brigades) {
      if (!brigadeShown(brigade)) continue
      const rows = sheet.rows.filter((r) => r.brigade === brigade)
      const visibleRows = prepareVisibleRows(rows, rowVisible, searchActive, rowSort, employeesById, locale)
      if (!visibleRows.length) continue
      blocks.push({
        kind: 'brigade',
        brigade,
        rows: visibleRows,
        brigadeRowCount: rows.length,
        emptyRowCount: rows.filter((r) => !r.employeeId).length,
      })
    }
    return blocks
  }

  const byUnit = new Map<string, Map<string, TimesheetRow[]>>()

  for (const brigade of brigades) {
    if (!brigadeShown(brigade)) continue
    const brigadeUnitId = store.brigadeUnits?.[brigade] || undefined
    const rows = sheet.rows.filter((r) => r.brigade === brigade)
    const visibleRows = prepareVisibleRows(rows, rowVisible, searchActive, rowSort, employeesById, locale)
    for (const row of visibleRows) {
      const emp = row.employeeId
        ? store.employees.find((e) => e.id === row.employeeId)
        : null
      const unitId =
        brigadeUnitId ?? (emp ? employeeStructuralUnitKey(emp) : NO_STRUCTURAL_UNIT_ID)
      if (!byUnit.has(unitId)) byUnit.set(unitId, new Map())
      const brigadeMap = byUnit.get(unitId)!
      if (!brigadeMap.has(brigade)) brigadeMap.set(brigade, [])
      brigadeMap.get(brigade)!.push(row)
    }
  }

  const unitOrder = [
    ...units.map((u) => u.id),
    ...(byUnit.has(NO_STRUCTURAL_UNIT_ID) ? [NO_STRUCTURAL_UNIT_ID] : []),
  ]

  const blocks: TimesheetLayoutBlock[] = []
  for (const unitId of unitOrder) {
    const brigadeMap = byUnit.get(unitId)
    if (!brigadeMap?.size) continue

    blocks.push({
      kind: 'unit',
      brigade: '',
      unitId,
      unitLabel: unitLabelFor(unitId, units, t),
      rows: [],
      brigadeRowCount: 0,
      emptyRowCount: 0,
    })

    for (const brigade of brigades) {
      const rows = brigadeMap.get(brigade)
      if (!rows?.length) continue
      const allRows = sheet.rows.filter((r) => r.brigade === brigade)
      blocks.push({
        kind: 'unit-brigade',
        brigade,
        unitId,
        unitLabel: unitLabelFor(unitId, units, t),
        rows,
        brigadeRowCount: allRows.length,
        emptyRowCount: allRows.filter((r) => !r.employeeId).length,
      })
    }
  }

  return blocks
}

export function layoutNavRowIds(blocks: TimesheetLayoutBlock[]): string[] {
  const ids: string[] = []
  for (const block of blocks) {
    if (block.kind === 'unit') continue
    for (const row of block.rows) {
      if (row.employeeId) ids.push(row.id)
    }
  }
  return ids
}

export type TimesheetVirtualItem =
  | { kind: 'unit'; key: string; block: TimesheetLayoutBlock }
  | { kind: 'brigade-header'; key: string; block: TimesheetLayoutBlock }
  | {
      kind: 'data'
      key: string
      block: TimesheetLayoutBlock
      row: TimesheetRow
      rowIndex: number
    }

/** Плоский список строк таблицы (заголовки + данные) для виртуализации */
export function flattenTimesheetLayout(
  blocks: TimesheetLayoutBlock[],
): TimesheetVirtualItem[] {
  const out: TimesheetVirtualItem[] = []
  for (const block of blocks) {
    if (block.kind === 'unit') {
      out.push({ kind: 'unit', key: `unit-${block.unitId}`, block })
      continue
    }
    const headerKey = `${block.kind}-${block.unitId ?? 'x'}-${block.brigade}`
    out.push({ kind: 'brigade-header', key: headerKey, block })
    block.rows.forEach((row, rowIndex) => {
      out.push({ kind: 'data', key: row.id, block, row, rowIndex })
    })
  }
  return out
}
