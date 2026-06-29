import { HR_ORG_STRUCTURE_SEED } from '@/data/hr-org-structure.seed'
import type { HrPosition, HrStructuralUnit } from './types'
import type { Employee } from '@/lib/types'

export function slugUnitId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-zа-яё0-9-]/gi, '')
}

export function positionSeedId(unitName: string, title: string): string {
  return `${slugUnitId(unitName)}--${title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-zа-яё0-9-]/gi, '')}`
}

export function buildOrgStructureFromSeed(): {
  units: HrStructuralUnit[]
  positions: HrPosition[]
} {
  const unitOrder = new Map<string, number>()
  const units: HrStructuralUnit[] = []
  const positions: HrPosition[] = []

  for (const row of HR_ORG_STRUCTURE_SEED) {
    if (!unitOrder.has(row.unit)) {
      const sortOrder = unitOrder.size
      unitOrder.set(row.unit, sortOrder)
      units.push({
        id: slugUnitId(row.unit),
        name: row.unit,
        sortOrder,
      })
    }
    positions.push({
      id: positionSeedId(row.unit, row.title),
      title: row.title,
      structuralUnitId: slugUnitId(row.unit),
      department: row.unit,
      salary: 0,
      currency: 'GEL',
      contractType: 'full_time',
    })
  }

  return { units, positions }
}

export function normalizeHrStructuralUnits(
  units: HrStructuralUnit[] | undefined,
): HrStructuralUnit[] {
  return (units ?? [])
    .map((u, i) => ({
      ...u,
      name: u.name?.trim() ?? '',
      sortOrder: Number.isFinite(u.sortOrder) ? u.sortOrder : i,
    }))
    .filter((u) => u.name)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru'))
}

export function normalizeHrPositionsWithUnits(
  positions: HrPosition[] | undefined,
  units: HrStructuralUnit[],
): HrPosition[] {
  const unitById = new Map(units.map((u) => [u.id, u]))
  const unitByName = new Map(units.map((u) => [u.name.toLowerCase(), u]))

  return (positions ?? []).map((p) => {
    let structuralUnitId = p.structuralUnitId
    if (!structuralUnitId && p.department) {
      structuralUnitId = unitByName.get(p.department.trim().toLowerCase())?.id
    }
    const unit = structuralUnitId ? unitById.get(structuralUnitId) : undefined
    return {
      ...p,
      structuralUnitId,
      department: unit?.name ?? p.department?.trim() ?? '',
      salary: Number(p.salary) || 0,
      currency: p.currency ?? 'GEL',
      contractType: p.contractType ?? 'full_time',
      rank: p.rank?.trim() || p.grade?.trim() || undefined,
      qualificationClass: p.qualificationClass?.trim() || undefined,
    }
  })
}

/** Подставляет штатное расписание, если справочники пустые. */
export function ensureOrgStructureSeed(
  units: HrStructuralUnit[] | undefined,
  positions: HrPosition[] | undefined,
): { units: HrStructuralUnit[]; positions: HrPosition[] } {
  let normalizedUnits = normalizeHrStructuralUnits(units)
  let normalizedPositions = normalizeHrPositionsWithUnits(positions, normalizedUnits)

  if (normalizedUnits.length === 0 && normalizedPositions.length > 0) {
    const names = [
      ...new Set(normalizedPositions.map((p) => p.department.trim()).filter(Boolean)),
    ]
    normalizedUnits = names.map((name, i) => ({
      id: slugUnitId(name),
      name,
      sortOrder: i,
    }))
    normalizedPositions = normalizeHrPositionsWithUnits(normalizedPositions, normalizedUnits)
    return { units: normalizedUnits, positions: normalizedPositions }
  }

  if (normalizedUnits.length > 0 || normalizedPositions.length > 0) {
    return { units: normalizedUnits, positions: normalizedPositions }
  }
  return buildOrgStructureFromSeed()
}

export function applyPositionToEmployeeFields(
  position: HrPosition,
  unit?: HrStructuralUnit,
): {
  positionId: string
  structuralUnitId?: string
  position: string
  department: string
  grade?: string
} {
  const dept = unit?.name ?? position.department
  return {
    positionId: position.id,
    structuralUnitId: position.structuralUnitId ?? unit?.id,
    position: position.title,
    department: dept,
    grade: position.rank ?? position.grade,
  }
}

export function structuralUnitName(
  units: HrStructuralUnit[],
  unitId: string | undefined,
): string {
  if (!unitId) return ''
  return units.find((u) => u.id === unitId)?.name ?? ''
}

export function employeeStructuralUnitLabel(
  employee: Employee,
  units: HrStructuralUnit[],
): string {
  if (employee.structuralUnitId) {
    const name = structuralUnitName(units, employee.structuralUnitId)
    if (name) return name
  }
  return employee.department?.trim() ?? ''
}

export function isEmployeeOnPosition(employee: Employee, position: HrPosition): boolean {
  if (employee.positionId === position.id) return true
  if (employee.positionId) return false
  return (
    employee.position.trim().toLowerCase() === position.title.trim().toLowerCase() &&
    (!(employee.department ?? '').trim() ||
      (employee.department ?? '').trim().toLowerCase() ===
        position.department.trim().toLowerCase())
  )
}

export function employeesOnPosition(
  employees: Employee[],
  position: HrPosition,
): Employee[] {
  return employees.filter((e) => isEmployeeOnPosition(e, position))
}

export function applyPositionToEmployee(
  employee: Employee,
  position: HrPosition,
  units: HrStructuralUnit[],
): Employee {
  const unit = units.find((u) => u.id === position.structuralUnitId)
  return {
    ...employee,
    ...applyPositionToEmployeeFields(position, unit),
    monthlySalary: position.salary,
    currency: position.currency,
    contractType: position.contractType,
    probationMonths: position.probationMonths,
  }
}
