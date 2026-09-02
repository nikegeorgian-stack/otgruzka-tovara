import { employeeActiveOnDate, employeeActiveNow } from '@/lib/hr/employeeActive'
import type { Employee } from '@/lib/types'

export type WorkwearBlockReason = 'inactive'

export type WorkwearEligibility =
  | { ok: true }
  | { ok: false; reason: WorkwearBlockReason }

export function isActiveEmployee(emp: Employee, dateISO?: string): boolean {
  if (dateISO) return employeeActiveOnDate(emp, dateISO)
  return employeeActiveNow(emp)
}

/** Выдача спецодежды: только активный сотрудник (без привязки к виду договора). */
export function checkWorkwearEligibility(emp: Employee, dateISO?: string): WorkwearEligibility {
  if (!isActiveEmployee(emp, dateISO)) {
    return { ok: false, reason: 'inactive' }
  }
  return { ok: true }
}
