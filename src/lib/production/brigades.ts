import type { Employee, MonthSheet } from '@/lib/types'
import type { ProductionLineId, ProductionRosterEntry } from './types'

const FOREMAN_RE = /бригадир|ბრიგადირი/i

function isForemanEmployee(emp: Employee): boolean {
  return FOREMAN_RE.test(emp.fullName) || FOREMAN_RE.test(emp.position ?? '')
}

/** Сотрудники бригады: карточка + строки плана табеля за месяц. */
export function employeesInBrigade(
  brigade: string,
  employees: Employee[],
  sheet?: MonthSheet | null,
): Employee[] {
  if (!brigade) return []
  const byId = new Map<string, Employee>()
  for (const e of employees) {
    if (!e.active || (e.hrStatus ?? 'active') === 'fired') continue
    if (e.brigade === brigade) byId.set(e.id, e)
  }
  if (sheet) {
    const rows = sheet.rows
      .filter((r) => r.brigade === brigade && r.employeeId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
    for (const row of rows) {
      const emp = employees.find((e) => e.id === row.employeeId)
      if (emp?.active) byId.set(emp.id, emp)
    }
  }
  return [...byId.values()].sort((a, b) =>
    a.fullName.localeCompare(b.fullName, 'ru'),
  )
}

/** Список для выбора бригадира: сначала с пометкой «бригадир», затем остальные из бригады. */
export function foremanSelectOptions(
  brigade: string,
  employees: Employee[],
  sheet?: MonthSheet | null,
): Employee[] {
  const pool = employeesInBrigade(brigade, employees, sheet)
  if (!pool.length) return []
  const marked = pool.filter(isForemanEmployee)
  const rest = pool.filter((e) => !marked.some((m) => m.id === e.id))
  return [...marked, ...rest]
}

function defaultForemanFromPool(pool: Employee[], sheet: MonthSheet | null | undefined, brigade: string): Employee | undefined {
  const marked = pool.filter(isForemanEmployee)
  if (marked.length) return marked[0]
  if (sheet) {
    const firstRow = sheet.rows
      .filter((r) => r.brigade === brigade && r.employeeId)
      .sort((a, b) => a.sortOrder - b.sortOrder)[0]
    if (firstRow?.employeeId) {
      return pool.find((e) => e.id === firstRow.employeeId)
    }
  }
  return pool[0]
}

export function defaultForemanId(
  brigade: string,
  employees: Employee[],
  sheet?: MonthSheet | null,
): string | undefined {
  const pool = employeesInBrigade(brigade, employees, sheet)
  return defaultForemanFromPool(pool, sheet, brigade)?.id
}

/** Бригады пропитки, обычно привязанные к линии (можно менять вручную). */
export function brigadesForLine(
  lineId: ProductionLineId,
  allBrigades: string[],
): string[] {
  if (lineId === 'pack') {
    const packBrigades = allBrigades.filter((b) => /упаков|შეფუთ/i.test(b))
    return packBrigades.length ? packBrigades : allBrigades
  }
  const propitka = allBrigades.filter((b) => /пропитк/i.test(b))
  const pool = propitka.length ? propitka : allBrigades
  if (lineId === '1') {
    const preferred = pool.filter((b) => /№1\.[12]|№1\s/i.test(b) || /1\.1|1\.2/.test(b))
    return preferred.length ? preferred : pool
  }
  const preferred = pool.filter((b) => /№2\.[12]|№2\s/i.test(b) || /2\.1|2\.2/.test(b))
  return preferred.length ? preferred : pool
}

export function defaultBrigadeForLine(
  lineId: ProductionLineId,
  allBrigades: string[],
): string {
  const list = brigadesForLine(lineId, allBrigades)
  return list[0] ?? ''
}

/** Список явки: состав бригады + вручную добавленные на смену. */
export function buildBrigadeRoster(
  brigade: string,
  employees: Employee[],
  sheet?: MonthSheet | null,
  prev?: ProductionRosterEntry[],
): ProductionRosterEntry[] {
  const members = employeesInBrigade(brigade, employees, sheet)
  const memberIds = new Set(members.map((m) => m.id))
  const prevMap = new Map((prev ?? []).map((e) => [e.employeeId, e]))
  const core = members.map((emp) => {
    const prevEntry = prevMap.get(emp.id)
    return {
      employeeId: emp.id,
      present: prevMap.has(emp.id) ? prevEntry!.present : true,
      extra: prevEntry?.extra,
    }
  })
  const extras = (prev ?? []).filter(
    (e) => e.extra && !memberIds.has(e.employeeId) && employees.some((x) => x.id === e.employeeId),
  )
  return [...core, ...extras]
}

export function addExtraRosterMember(
  roster: ProductionRosterEntry[],
  employeeId: string,
): ProductionRosterEntry[] {
  if (roster.some((r) => r.employeeId === employeeId)) return roster
  return [...roster, { employeeId, present: true, extra: true }]
}

export function removeRosterMember(
  roster: ProductionRosterEntry[],
  employeeId: string,
): ProductionRosterEntry[] {
  return roster.filter((r) => r.employeeId !== employeeId)
}

export function requestShiftKey(
  date: string,
  lineId: ProductionLineId,
  shift: 'day' | 'night',
): string {
  return `${date}|${lineId}|${shift}`
}
