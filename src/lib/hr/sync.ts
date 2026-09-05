import type { Employee, EmploymentStatus } from '@/lib/types'
import type { HrStatus } from './types'

export function hrStatusToEmployment(status: HrStatus): EmploymentStatus {
  if (status === 'vacation') return 'vacation'
  if (status === 'sick') return 'sick'
  if (status === 'fired') return 'terminated'
  return 'active'
}

export function applyHrStatus(emp: Employee, hrStatus: HrStatus): Employee {
  return {
    ...emp,
    hrStatus,
    active: hrStatus !== 'fired',
    employmentStatus: hrStatusToEmployment(hrStatus),
  }
}

/** Нормализация: старый sick→maternity становится sick. */
export function normalizeEmploymentStatus(
  emp: Pick<Employee, 'employmentStatus' | 'hrStatus'>,
): EmploymentStatus {
  const st = emp.employmentStatus ?? 'active'
  if (st === 'maternity' && (emp.hrStatus === 'sick' || !emp.hrStatus)) {
    return 'sick'
  }
  return st
}

export function employeeSearchHr(e: Employee): string {
  return [
    e.fullName,
    e.nameKa,
    e.tabNumber,
    e.employeeNumber,
    e.position,
    e.positionKa,
    e.brigade,
    e.department,
    e.line,
    e.phone,
    e.personalId,
    e.surnameKa,
    e.registrationAddress,
    e.actualAddress,
    e.citizenship,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}
