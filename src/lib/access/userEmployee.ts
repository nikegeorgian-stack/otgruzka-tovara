import type { AppUser, AccessStore } from './types'
import type { Employee } from '@/lib/types'
import { resolveFstWebProfile, type FstWebUserProfile } from '@/lib/cloud/fstWebUsers'

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

/** Объединить облачную сессию с записью из store (роль, сотрудник, интерфейсы). */
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
    roleId: stored.roleId,
    displayName: stored.displayName || webUser.displayName,
    employeeId: stored.employeeId,
    defaultBrigades: stored.defaultBrigades,
    viewDefaults: stored.viewDefaults,
    webViews: stored.webViews,
    webAccount: stored.webAccount ?? true,
  }
}

/** Профиль из store для текущего e-mail (после загрузки облака). */
export function webProfileFromAccess(
  email: string | null | undefined,
  uid: string | null | undefined,
  access: AccessStore,
): FstWebUserProfile | null {
  return resolveFstWebProfile(email, uid, access)
}
