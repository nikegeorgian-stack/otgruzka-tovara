import { employeeSearchHr } from '@/lib/hr/sync'
import { employeeStructuralUnitLabel } from '@/lib/hr/orgStructure'
import type { HrStatus, HrStructuralUnit } from '@/lib/hr/types'
import type { Employee, ScheduleType } from '@/lib/types'

export type OfficeStaffFilter = {
  query: string
  unitIds: string[]
  positions: string[]
  brigades: string[]
  statuses: HrStatus[]
  includeFired: boolean
  schedules: ScheduleType[]
  citizenships: string[]
  genders: string[]
  hireFrom: string
  hireTo: string
}

export const EMPTY_OFFICE_STAFF_FILTER: OfficeStaffFilter = {
  query: '',
  unitIds: [],
  positions: [],
  brigades: [],
  statuses: [],
  includeFired: false,
  schedules: [],
  citizenships: [],
  genders: [],
  hireFrom: '',
  hireTo: '',
}

function statusOf(emp: Employee): HrStatus {
  return emp.hrStatus ?? (emp.active === false ? 'fired' : 'active')
}

export function filterOfficeStaff(
  employees: Employee[],
  units: HrStructuralUnit[],
  filter: OfficeStaffFilter,
): Employee[] {
  const q = filter.query.trim().toLowerCase()
  const unitSet = new Set(filter.unitIds)
  const posSet = new Set(filter.positions.map((p) => p.trim().toLowerCase()).filter(Boolean))
  const brigSet = new Set(filter.brigades)
  const statusSet = new Set(filter.statuses)
  const schedSet = new Set(filter.schedules)
  const citSet = new Set(filter.citizenships)
  const genderSet = new Set(filter.genders)
  const hireFrom = filter.hireFrom.trim()
  const hireTo = filter.hireTo.trim()

  return employees.filter((e) => {
    const status = statusOf(e)
    const allowFired = filter.includeFired || statusSet.has('fired')
    if (status === 'fired' && !allowFired) return false
    if (statusSet.size > 0 && !statusSet.has(status)) return false

    if (unitSet.size > 0) {
      const unitId = e.structuralUnitId ?? ''
      const unitName = employeeStructuralUnitLabel(e, units).toLowerCase()
      const matchId = unitId && unitSet.has(unitId)
      const matchName = [...unitSet].some((id) => {
        const name = units.find((u) => u.id === id)?.name.trim().toLowerCase()
        return Boolean(name && unitName === name)
      })
      if (!matchId && !matchName) return false
    }

    if (posSet.size > 0) {
      const pos = (e.position ?? '').trim().toLowerCase()
      const posKa = (e.positionKa ?? '').trim().toLowerCase()
      if (!posSet.has(pos) && !posSet.has(posKa)) return false
    }

    if (brigSet.size > 0 && !brigSet.has(e.brigade)) return false
    if (schedSet.size > 0 && !schedSet.has(e.schedule)) return false
    if (citSet.size > 0 && !citSet.has((e.citizenship ?? '').trim())) return false
    if (genderSet.size > 0 && !genderSet.has(e.gender ?? 'unknown')) return false

    const hired = (e.hireDate ?? '').trim()
    if (hireFrom && (!hired || hired < hireFrom)) return false
    if (hireTo && (!hired || hired > hireTo)) return false

    if (!q) return true
    const hay = [
      employeeSearchHr(e),
      employeeStructuralUnitLabel(e, units),
      e.email,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return hay.includes(q)
  })
}
