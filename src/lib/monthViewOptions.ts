import { brigadeLabel } from './brigadeText'
import { collatorLocale } from '@/i18n/localeFormat'
import type { Employee, HrStructuralUnit, Locale } from './types'

export type MonthGroupMode = 'brigade' | 'unit'

/** Пустая строка = все разделы (фильтр списка бригад). */
export const BRIGADE_UNIT_FILTER_ALL = ''

export type MonthTableDisplay = {
  showTab: boolean
  showPosition: boolean
  showUnit: boolean
  showSchedule: boolean
  showTotals: boolean
}

export type MonthViewDisplay = MonthTableDisplay & {
  showPlan: boolean
  showFact: boolean
}

/** Минимальный вид таблицы: №, ФИО, дни. Мета-колонки — только по явному включению. */
export const DEFAULT_MONTH_VIEW_DISPLAY: MonthViewDisplay = {
  showPlan: true,
  showFact: true,
  showTab: false,
  showPosition: false,
  showUnit: false,
  showSchedule: false,
  showTotals: false,
}

/** Собрать вид: сохранённые флаги плана/факта/итогов; мета-колонки всегда выкл. */
export function resolveMonthViewDisplay(
  saved?: Partial<MonthViewDisplay> | null,
  _opts?: { workshopMasterMode?: boolean },
): MonthViewDisplay {
  return {
    ...DEFAULT_MONTH_VIEW_DISPLAY,
    ...saved,
    showTab: false,
    showPosition: false,
    showUnit: false,
    showSchedule: false,
  }
}

/** Сотрудники без structuralUnitId в фильтре табеля. */
export const NO_STRUCTURAL_UNIT_ID = '__none__'

export function employeeStructuralUnitKey(employee: Employee): string {
  return employee.structuralUnitId ?? NO_STRUCTURAL_UNIT_ID
}

export function activeStructuralUnits(units: HrStructuralUnit[]): HrStructuralUnit[] {
  return [...units]
    .filter((u) => !u.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru'))
}

export function structuralUnitFilterKeys(
  units: HrStructuralUnit[],
  employees: Employee[],
): string[] {
  const keys = activeStructuralUnits(units).map((u) => u.id)
  const hasUnassigned = employees.some((e) => e.active && !e.structuralUnitId)
  if (hasUnassigned) keys.push(NO_STRUCTURAL_UNIT_ID)
  return keys
}

export function unitMatchesSearch(name: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return name.toLowerCase().includes(q)
}

export function isEmployeeUnitVisible(
  employee: Employee | null | undefined,
  selectedUnits: Set<string>,
): boolean {
  if (!employee) return true
  return selectedUnits.has(employeeStructuralUnitKey(employee))
}

export function allStructuralUnitsSelected(
  selectedUnits: Set<string>,
  unitKeys: string[],
): boolean {
  return unitKeys.length > 0 && unitKeys.every((id) => selectedUnits.has(id))
}

export function structuralUnitFilterActive(
  selectedUnits: Set<string>,
  unitKeys: string[],
): boolean {
  return selectedUnits.size < unitKeys.length
}

export function brigadeSearchText(
  nameRu: string,
  namesKa: Record<string, string>,
): string {
  const ka = namesKa[nameRu]?.trim() ?? ''
  return `${nameRu} ${ka}`.toLowerCase()
}

export function brigadeMatchesSearch(
  nameRu: string,
  namesKa: Record<string, string>,
  query: string,
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return brigadeSearchText(nameRu, namesKa).includes(q)
}

/** Ключ раздела бригады в фильтре списка (`brigadeUnits` или «без раздела»). */
export function brigadeAssignedUnitKey(
  brigadeUnits: Record<string, string> | undefined,
  brigade: string,
): string {
  const id = brigadeUnits?.[brigade]?.trim()
  return id || NO_STRUCTURAL_UNIT_ID
}

export function brigadeMatchesUnitFilter(
  brigade: string,
  brigadeUnits: Record<string, string> | undefined,
  unitFilter: string,
): boolean {
  if (!unitFilter || unitFilter === BRIGADE_UNIT_FILTER_ALL) return true
  return brigadeAssignedUnitKey(brigadeUnits, brigade) === unitFilter
}

/** Список бригад: фильтр по поиску + разделу, сортировка А→Я по подписи. */
export function filterAndSortBrigadeList(opts: {
  brigades: string[]
  namesKa: Record<string, string>
  locale: Locale
  search?: string
  brigadeUnits?: Record<string, string>
  unitFilter?: string
}): string[] {
  const {
    brigades,
    namesKa,
    locale,
    search = '',
    brigadeUnits,
    unitFilter = BRIGADE_UNIT_FILTER_ALL,
  } = opts
  const filtered = brigades.filter(
    (b) =>
      brigadeMatchesSearch(b, namesKa, search) &&
      brigadeMatchesUnitFilter(b, brigadeUnits, unitFilter),
  )
  return [...filtered].sort((a, b) =>
    brigadeLabel(a, namesKa, locale).localeCompare(
      brigadeLabel(b, namesKa, locale),
      collatorLocale(locale),
      { sensitivity: 'base', numeric: true },
    ),
  )
}

export function isBrigadeVisible(
  brigade: string,
  selectedBrigades: Set<string>,
  brigadeSearch: string,
  namesKa: Record<string, string>,
): boolean {
  if (!selectedBrigades.has(brigade)) return false
  return brigadeMatchesSearch(brigade, namesKa, brigadeSearch)
}

export function allBrigadesSelected(
  selectedBrigades: Set<string>,
  brigades: string[],
): boolean {
  return brigades.length > 0 && brigades.every((b) => selectedBrigades.has(b))
}

export function singleSelectedBrigade(
  selectedBrigades: Set<string>,
): string {
  if (selectedBrigades.size !== 1) return ''
  return [...selectedBrigades][0] ?? ''
}
