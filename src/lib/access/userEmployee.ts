import type { AppUser, AccessStore } from './types'
import type { Employee } from '@/lib/types'
import { isFstAdminEmail } from '@/lib/cloud/fstAdmin'
import { isPasswordChangeComplete } from '@/lib/cloud/passwordChangeSession'
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
  const login = webUser.login.trim().toLowerCase()
  const stored = access.users.find((u) => u.login === login && u.active)
  const passwordChangedThisSession = isPasswordChangeComplete(login)

  if (isFstAdminEmail(login)) {
    return {
      ...webUser,
      roleId: 'sysadmin',
      id: stored?.id ?? webUser.id,
      displayName: stored?.displayName || webUser.displayName,
      employeeId: stored?.employeeId,
      defaultBrigades: stored?.defaultBrigades,
      viewDefaults: stored?.viewDefaults,
      webViews: stored?.webViews,
      timesheetLevel: stored?.timesheetLevel,
      timesheetViewBrigades: stored?.timesheetViewBrigades,
      timesheetEditBrigades: stored?.timesheetEditBrigades,
      webAccount: stored?.webAccount ?? true,
      mustChangePassword:
        passwordChangedThisSession ? false : stored?.mustChangePassword === true,
    }
  }

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
    timesheetLevel: stored.timesheetLevel,
    timesheetViewBrigades: stored.timesheetViewBrigades,
    timesheetEditBrigades: stored.timesheetEditBrigades,
    webAccount: stored.webAccount ?? true,
    mustChangePassword:
      passwordChangedThisSession ? false : stored.mustChangePassword === true,
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
