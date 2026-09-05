import type { Employee, HrPosition } from '@/lib/types'
import { is52Schedule } from '@/lib/schedules'

/** Индивидуальный оклад/ставка — приоритет над штатным расписанием. */
export function hasIndividualSalary(emp: Employee): boolean {
  return emp.individualSalary === true
}

/** Поля зарплаты из должности; null — не менять (индивидуальный оклад). */
export function salaryFieldsFromPosition(
  emp: Employee,
  position: HrPosition,
): Pick<Employee, 'monthlySalary' | 'hourlyRate' | 'currency'> | null {
  if (hasIndividualSalary(emp)) return null
  const isMonthly = is52Schedule(emp.schedule) || (position.schedule?.includes('5/2') ?? false)
  if (isMonthly) {
    return { monthlySalary: position.salary, currency: position.currency }
  }
  return { hourlyRate: position.salary, currency: position.currency }
}
