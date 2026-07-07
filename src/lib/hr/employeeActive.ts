import { daysInMonth, parseMonthKey } from '@/lib/dates'
import type { Employee } from '@/lib/types'

/** Дата увольнения: явная или «сегодня», если статус уже уволен без даты. */
function impliedTerminationDate(emp: Employee): string | undefined {
  const term = emp.terminationDate?.trim()
  if (term) return term
  if ((emp.hrStatus ?? 'active') === 'fired' || emp.employmentStatus === 'terminated') {
    return new Date().toISOString().slice(0, 10)
  }
  return undefined
}

/** Текущий статус в кадрах (не исторический срез). */
export function employeeActiveNow(emp: Employee): boolean {
  if ((emp.hrStatus ?? 'active') === 'fired') return false
  if (emp.employmentStatus === 'terminated') return false
  return emp.active !== false
}

/**
 * Был ли сотрудник активен на дату YYYY-MM-DD.
 * Увольнение учитывается по terminationDate: в день увольнения и раньше — активен.
 */
export function employeeActiveOnDate(emp: Employee, dateISO: string): boolean {
  const d = dateISO.trim()
  if (!d) return employeeActiveNow(emp)
  const term = impliedTerminationDate(emp)
  if (term) return d <= term
  return emp.active !== false
}

/** Активен ли в календарном месяце табеля (YYYY-MM). */
export function employeeActiveInMonth(emp: Employee, month: string): boolean {
  const term = impliedTerminationDate(emp)
  if (term) {
    const termMonth = term.slice(0, 7)
    if (month > termMonth) return false
    return true
  }
  return emp.active !== false
}

/** Статус «уволен» на дату среза (для отображения, не для фильтра списков). */
export function employeeFiredOnDate(emp: Employee, dateISO: string): boolean {
  const d = dateISO.trim()
  if (!d) return (emp.hrStatus ?? 'active') === 'fired'
  const term = impliedTerminationDate(emp)
  if (!term) return false
  return d > term
}

export function monthEndDate(month: string): string {
  const { year, month: mo } = parseMonthKey(month)
  const last = daysInMonth(year, mo)
  return `${year}-${String(mo).padStart(2, '0')}-${String(last).padStart(2, '0')}`
}

export function filterEmployeesForDate(employees: Employee[], dateISO?: string): Employee[] {
  if (!dateISO) return employees.filter(employeeActiveNow)
  return employees.filter((e) => employeeActiveOnDate(e, dateISO))
}

export function filterEmployeesForMonth(employees: Employee[], month: string): Employee[] {
  return employees.filter((e) => employeeActiveInMonth(e, month))
}
