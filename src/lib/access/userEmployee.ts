import type { AppUser, AccessStore } from './types'
import type { Employee } from '@/lib/types'

/** Сотрудник, привязанный к учётной записи (если есть и активен). */
export function linkedEmployee(
  user: AppUser | null | undefined,
  employees: Employee[],
): Employee | undefined {
  if (!user?.employeeId) return undefined
  return employees.find((e) => e.id === user.employeeId && e.active)
}

/** Имя привязанного сотрудника для таблицы учёток. */
export function linkedEmployeeLabel(
  user: AppUser,
  employees: Employee[],
): string | null {
  const emp = linkedEmployee(user, employees)
  return emp?.fullName?.trim() || null
}

/** Объединить облачную сессию с записью из store (employeeId, id). */
export function mergeWebAppUser(
  webUser: AppUser,
  access: AccessStore,
): AppUser {
  const stored = access.users.find(
    (u) => u.login === webUser.login && u.active,
  )
  if (!stored) return webUser
  return {
    ...webUser,
    id: stored.id,
    employeeId: stored.employeeId,
    displayName: stored.displayName || webUser.displayName,
  }
}
