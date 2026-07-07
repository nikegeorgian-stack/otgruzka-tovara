import { employeeActiveOnDate, employeeActiveNow } from '@/lib/hr/employeeActive'
import type { Employee } from '@/lib/types'

export type WorkwearBlockReason = 'no_agreement' | 'fixed_term' | 'inactive'

export type WorkwearEligibility =
  | { ok: true }
  | { ok: false; reason: WorkwearBlockReason }

export function isActiveEmployee(emp: Employee, dateISO?: string): boolean {
  if (dateISO) return employeeActiveOnDate(emp, dateISO)
  return employeeActiveNow(emp)
}

/** Выдача спецодежды только по основному (бессрочному) договору */
export function checkWorkwearEligibility(emp: Employee, dateISO?: string): WorkwearEligibility {
  if (!isActiveEmployee(emp, dateISO)) {
    return { ok: false, reason: 'inactive' }
  }
  if (!emp.employmentAgreementKind) {
    return { ok: false, reason: 'no_agreement' }
  }
  if (emp.employmentAgreementKind === 'fixed_term') {
    return { ok: false, reason: 'fixed_term' }
  }
  return { ok: true }
}
