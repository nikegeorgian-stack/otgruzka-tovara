import type { ViewId } from '@/lib/types'
import type { AccessRoleId, AccessStore, AppUser } from './types'
import { MANAGED_VIEWS } from './types'
import { defaultHomeViewForRole } from './homeView'

export function isSysAdmin(user: AppUser | null | undefined): boolean {
  return user?.active === true && user.roleId === 'sysadmin'
}

export function viewsForRole(access: AccessStore, roleId: AccessRoleId): ViewId[] {
  if (roleId === 'sysadmin') return [...MANAGED_VIEWS]
  return access.roleViews[roleId] ?? []
}

/**
 * Разделы пользователя.
 * - Если у учётки задан явный список `webViews` — он используется как есть
 *   (полный контроль: можно и добавить, и убрать раздел относительно роли).
 * - Иначе берутся разделы должности (вкладка «Интерфейсы»).
 */
export function viewsForUser(access: AccessStore, user: AppUser | null | undefined): ViewId[] {
  if (!user?.active) return []
  if (user.roleId === 'sysadmin') return viewsForRole(access, 'sysadmin')
  if (user.webViews?.length) return [...user.webViews]
  return viewsForRole(access, user.roleId)
}

export function canAccessView(
  access: AccessStore,
  user: AppUser | null | undefined,
  view: ViewId,
): boolean {
  if (!user?.active) return false
  const resolved = resolveView(view)
  return viewsForUser(access, user).includes(resolved)
}

/** Устаревшие view → актуальный раздел */
export function resolveView(view: ViewId): ViewId {
  if (view === 'pay') return 'finance'
  if (view === 'employees' || view === 'codes') return 'directories'
  return view
}

export function firstAllowedView(
  access: AccessStore,
  user: AppUser | null | undefined,
): ViewId {
  const allowed = viewsForUser(access, user)
  if (!user?.active) return 'month'

  const home = defaultHomeViewForRole(user.roleId)
  if (allowed.includes(home)) return home

  const preferred: ViewId[] = [
    'hr_inspector',
    'hr',
    'finance',
    'warehouse',
    'technologist',
    'mixer',
    'procurement',
    'director',
    'production',
    'planner',
    'summary',
    'month',
  ]
  for (const view of preferred) {
    if (allowed.includes(view)) return view
  }
  return allowed[0] ?? 'month'
}

export function canManageAccess(user: AppUser | null | undefined): boolean {
  return isSysAdmin(user)
}

export function roleAllowsNegativeStock(
  access: AccessStore,
  roleId: AccessRoleId,
): boolean {
  if (roleId === 'sysadmin') return true
  return access.roleAllowNegativeStock?.[roleId] === true
}

export function roleAllowsDocumentCancel(
  access: AccessStore,
  roleId: AccessRoleId,
): boolean {
  if (roleId === 'sysadmin') return true
  return access.roleAllowDocumentCancel?.[roleId] === true
}

/** Снять проведение (вернуть в черновик) — только системный администратор. */
export function roleAllowsDocumentUnpost(user: AppUser | null | undefined): boolean {
  return isSysAdmin(user)
}
