import type { ViewId } from '@/lib/types'
import { accessPersona } from './accessPersona'
import type { AdminCabinetId } from './adminCabinet'
import type { AccessRoleId, AccessStore, AppUser } from './types'
import { MANAGED_VIEWS } from './types'
import { defaultHomeViewForRole } from './homeView'
import { resolveUserTimesheetLevel } from './timesheetScope'
import { canUseTasksSection, resolveTaskAccessLevel } from '@/lib/tasks/access'

/** Реальный sysadmin (не превью кабинета) — переключатель интерфейса, аудит. */
export function isSysAdmin(user: AppUser | null | undefined): boolean {
  return user?.active === true && user.roleId === 'sysadmin'
}

/** Разделы / права как у выбранного кабинета, если админ в превью. */
export function canShowNavItemForAdminPreview(
  access: AccessStore,
  user: AppUser | null | undefined,
  itemId: ViewId,
  adminCabinet: AdminCabinetId,
  _isFstWeb?: boolean,
): boolean {
  return canAccessView(access, user, itemId, adminCabinet)
}

export function viewsForRole(access: AccessStore, roleId: AccessRoleId): ViewId[] {
  if (roleId === 'sysadmin') return [...MANAGED_VIEWS]
  return access.roleViews[roleId] ?? []
}

/**
 * Разделы пользователя.
 * - Роль `employee` — «Моё» и «Обеды» (без табеля/плана).
 * - Если у учётки задан явный список `webViews` — он используется как основа.
 * - Иначе берутся разделы должности (вкладка «Интерфейсы»).
 * - При привязке к сотруднику всегда доступен личный кабинет «Моё».
 * - Если уровень табеля ≠ none — раздел «Табель» всегда в списке.
 */
export function viewsForUser(
  access: AccessStore,
  user: AppUser | null | undefined,
  cabinet?: AdminCabinetId,
): ViewId[] {
  const u = accessPersona(user, cabinet)
  if (!u?.active) return []
  const taskLevel = resolveTaskAccessLevel(u, access)
  const withTasksIfAllowed = (views: ViewId[]): ViewId[] => {
    if (!canUseTasksSection(taskLevel) || views.includes('tasks')) return views
    return ['tasks', ...views]
  }
  // Личный кабинет сотрудника — без ERP-разделов, даже если в store ошибочно шире.
  if (u.roleId === 'employee') return withTasksIfAllowed(['my', 'meals', 'protocols'])
  if (u.roleId === 'cook') return withTasksIfAllowed(['meals', 'my'])
  if (u.roleId === 'secretary') {
    return withTasksIfAllowed(['protocols', 'org_tree', 'my', 'journals', 'directories'])
  }
  if (u.roleId === 'timeclock') return ['timeclock']
  let views: ViewId[]
  if (u.roleId === 'sysadmin' && (!cabinet || cabinet === 'full')) {
    // Старые webViews в облаке могли не содержать новые разделы (tasks и т.д.)
    views = u.webViews?.length
      ? [...new Set<ViewId>([...MANAGED_VIEWS, ...u.webViews])]
      : [...MANAGED_VIEWS]
  } else if (u.webViews?.length) {
    views = [...u.webViews]
  } else if (u.roleId === 'sysadmin') {
    views = [...MANAGED_VIEWS]
  } else {
    views = [...viewsForRole(access, u.roleId)]
  }
  if (u.employeeId && !views.includes('my')) {
    views = ['my', ...views]
  }
  if (resolveUserTimesheetLevel(access, u, cabinet) !== 'none' && !views.includes('month')) {
    views = [...views, 'month']
  }
  if (!views.includes('meals')) {
    views = [...views, 'meals']
  }
  if (u.roleId === 'technologist' && !views.includes('warehouse')) {
    views = [...views, 'warehouse']
  }
  return withTasksIfAllowed(views)
}

export function canAccessView(
  access: AccessStore,
  user: AppUser | null | undefined,
  view: ViewId,
  cabinet?: AdminCabinetId,
): boolean {
  if (!user?.active) return false
  const resolved = resolveView(view)
  return viewsForUser(access, user, cabinet).includes(resolved)
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
  cabinet?: AdminCabinetId,
): ViewId {
  const u = accessPersona(user, cabinet)
  const allowed = viewsForUser(access, user, cabinet)
  if (!u?.active) return 'month'

  const home = defaultHomeViewForRole(u.roleId)
  if (allowed.includes(home)) return home

  const preferred: ViewId[] = [
    'my',
    'meals',
    'hr_inspector',
    'hr',
    'office',
    'finance',
    'warehouse',
    'technologist',
    'otc',
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
  return isSysAdmin(accessPersona(user))
}

/** Выдача / снятие временной подмены мастера цеха. */
export function canManageMasterCoverage(user: AppUser | null | undefined): boolean {
  const u = accessPersona(user)
  if (!u?.active) return false
  return u.roleId === 'sysadmin' || u.roleId === 'hr'
}

/**
 * Полные кадровые данные (паспорт, банк, ЗП, договоры, карточка).
 * Остальные с доступом к разделу «Кадры» видят только ФИО и должность.
 */
export function canViewFullHrPersonnel(user: AppUser | null | undefined): boolean {
  const u = accessPersona(user)
  if (!u?.active) return false
  return u.roleId === 'sysadmin' || u.roleId === 'hr' || u.roleId === 'finance'
}

/** Оклад в карточке сотрудника (не только Финансы → Ставки). */
export function canEditEmployeeSalary(user: AppUser | null | undefined): boolean {
  const u = accessPersona(user)
  if (!u?.active) return false
  return (
    u.roleId === 'sysadmin' ||
    u.roleId === 'hr' ||
    u.roleId === 'hr_inspector' ||
    u.roleId === 'finance'
  )
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

export function canReleaseFinishedGoodsQc(
  user: AppUser | null | undefined,
  access?: AccessStore | null,
): boolean {
  if (!user?.active) return false
  if (user.roleId === 'sysadmin') return true
  if (user.roleId === 'otc') return true
  if (user.roleId === 'operations_director') {
    return access?.roleAllowQcRelease?.operations_director === true
  }
  if (user.roleId === 'technologist') {
    return access?.roleAllowQcRelease?.technologist === true
  }
  return false
}

/** Снять проведение (вернуть в черновик) — только системный администратор. */
export function roleAllowsDocumentUnpost(user: AppUser | null | undefined): boolean {
  return isSysAdmin(accessPersona(user))
}
