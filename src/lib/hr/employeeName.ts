import type { Employee } from '@/lib/types'

export function normalizeEmployeeFullName(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
}

export function findEmployeeFullNameDuplicate(
  employees: readonly Employee[],
  fullName: string,
  excludeEmployeeId?: string,
): Employee | undefined {
  const normalized = normalizeEmployeeFullName(fullName)
  if (!normalized) return undefined

  return employees.find(
    (employee) =>
      employee.id !== excludeEmployeeId &&
      normalizeEmployeeFullName(employee.fullName) === normalized,
  )
}
