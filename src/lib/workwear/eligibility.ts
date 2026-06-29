import type { Employee } from '@/lib/types'

export type WorkwearBlockReason = 'no_agreement' | 'fixed_term' | 'inactive'

export type WorkwearEligibility =
  | { ok: true }
  | { ok: false; reason: WorkwearBlockReason }

export function isActiveEmployee(emp: Employee): boolean {
  if (!emp.active) return false
  if (emp.hrStatus === 'fired') return false
  if (emp.employmentStatus === 'terminated') return false
  return true
}

/** Выдача спецодежды только по основному (бессрочному) договору */
export function checkWorkwearEligibility(emp: Employee): WorkwearEligibility {
  if (!isActiveEmployee(emp)) {
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
