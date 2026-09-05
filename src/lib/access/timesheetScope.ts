import type { AppStore } from '@/lib/types'
import { resolveWorkshopMasterBrigades } from '@/lib/workshopMasterScope'
import { accessPersona } from './accessPersona'
import {
  activeCoverageBrigades,
  localTodayIsoDate,
  mergeBrigadeLists,
  monthCoverageBrigades,
} from './workshopMasterCoverage'
import type { AccessRoleId, AccessStore, AppUser } from './types'

/** Уровень доступа к разделу «Табель» (month). */
export type TimesheetAccessLevel = 'none' | 'view' | 'edit'

export type TimesheetBrigadeScope = 'all' | string[]

export type TimesheetAccess = {
  level: TimesheetAccessLevel
  /**
   * Бригады для фильтра листа (что видит).
   * Алиас `viewBrigades` — для совместимости со старым кодом.
   */
  brigades: TimesheetBrigadeScope
  viewBrigades: TimesheetBrigadeScope
  /** Бригады, которые можно править (пусто = нельзя; только при level === 'edit'). */
  editBrigades: TimesheetBrigadeScope
  /** Область ограничена — нельзя переключить фильтр на «весь завод». */
  scoped: boolean
}

/** Дефолт до настройки админом (совпадает с прежней жёсткой матрицей). */
export const DEFAULT_ROLE_TIMESHEET_ACCESS: Record<AccessRoleId, TimesheetAccessLevel> = {
  sysadmin: 'edit',
  hr: 'edit',
  finance: 'edit',
  workshop_master: 'edit',
  hr_inspector: 'view',
  operations_director: 'view',
  chief_engineer: 'view',
  warehouse_keeper: 'none',
  procurement_manager: 'none',
  technologist: 'none',
  otc: 'none',
  mixer: 'none',
  employee: 'none',
  timeclock: 'none',
  it_specialist: 'none',
  sales_dispatcher: 'none',
  office_manager: 'none',
  cook: 'none',
  secretary: 'none',
}

/** При «править» без персональных бригад — только бригады учётки (не весь завод). */
export const TIMESHEET_SCOPED_ROLES: AccessRoleId[] = ['workshop_master']

const LEVELS = new Set<TimesheetAccessLevel>(['none', 'view', 'edit'])

export function isTimesheetAccessLevel(v: unknown): v is TimesheetAccessLevel {
  return typeof v === 'string' && LEVELS.has(v as TimesheetAccessLevel)
}

export function defaultTimesheetLevel(roleId: AccessRoleId): TimesheetAccessLevel {
  return DEFAULT_ROLE_TIMESHEET_ACCESS[roleId] ?? 'none'
}

export function resolveRoleTimesheetLevel(
  access: AccessStore | null | undefined,
  roleId: AccessRoleId | undefined | null,
): TimesheetAccessLevel {
  if (!roleId) return 'none'
  if (roleId === 'sysadmin') return 'edit'
  const raw = access?.roleTimesheetAccess?.[roleId]
  if (raw && LEVELS.has(raw)) return raw
  return defaultTimesheetLevel(roleId)
}

/**
 * Уровень табеля: индивидуальный `user.timesheetLevel` важнее роли.
 */
/**
 * Уровень табеля: индивидуальный `user.timesheetLevel` важнее роли.
 * У sysadmin в превью кабинета — уровень выбранной роли.
 */
export function resolveUserTimesheetLevel(
  access: AccessStore | null | undefined,
  user: AppUser | null | undefined,
  cabinet?: import('./adminCabinet').AdminCabinetId,
): TimesheetAccessLevel {
  const u = accessPersona(user, cabinet)
  if (!u?.active) return 'none'
  if (u.roleId === 'sysadmin') return 'edit'
  if (isTimesheetAccessLevel(u.timesheetLevel)) return u.timesheetLevel
  return resolveRoleTimesheetLevel(access, u.roleId)
}

/**
 * Политика табеля по роли (без учётки) — для матрицы «Интерфейсы».
 */
export function timesheetAccessForRole(
  roleId: AccessRoleId | undefined | null,
  access?: AccessStore | null,
): {
  level: TimesheetAccessLevel
  scoped: boolean
} {
  if (!roleId) return { level: 'none', scoped: false }
  const level = resolveRoleTimesheetLevel(access, roleId)
  const scoped = level === 'edit' && TIMESHEET_SCOPED_ROLES.includes(roleId)
  return { level, scoped }
}

function normalizeBrigadeList(raw: string[] | undefined | null): string[] | undefined {
  if (!raw) return undefined
  const list = [...new Set(raw.map((b) => b.trim()).filter(Boolean))]
  return list
}

function coverageBrigadesForUser(
  store: AppStore,
  user: AppUser | null | undefined,
  opts?: { month?: string; dayIso?: string },
): string[] {
  if (user?.roleId !== 'workshop_master') return []
  const dayIso = opts?.dayIso ?? localTodayIsoDate()
  const viaToday = activeCoverageBrigades(
    store.access,
    user.id,
    store.brigades,
    dayIso,
  )
  const viaMonth =
    opts?.month && /^\d{4}-\d{2}$/.test(opts.month)
      ? monthCoverageBrigades(store.access, user.id, store.brigades, opts.month)
      : []
  return mergeBrigadeLists(viaToday, viaMonth)
}

/**
 * ACL-область для scoped-ролей (мастер цеха) и fallback, если админ не задал списки.
 */
export function resolveLegacyScopedBrigades(
  store: AppStore,
  user: AppUser | null | undefined,
  opts?: { month?: string; dayIso?: string },
): string[] {
  const base = resolveWorkshopMasterBrigades(
    store,
    user?.login,
    user?.employeeId,
    user?.defaultBrigades,
    { fallbackToAll: false },
  )
  return mergeBrigadeLists(base, coverageBrigadesForUser(store, user, opts))
}

/** @deprecated use resolveLegacyScopedBrigades / timesheetAccess */
export function resolveTimesheetBrigades(
  store: AppStore,
  user: AppUser | null | undefined,
  opts?: { month?: string; dayIso?: string },
): TimesheetBrigadeScope {
  const level = resolveUserTimesheetLevel(store.access, user)
  if (level === 'none') return []
  const viewOverride = normalizeBrigadeList(user?.timesheetViewBrigades)
  if (viewOverride !== undefined) {
    return mergeBrigadeLists(
      viewOverride,
      coverageBrigadesForUser(store, user, opts),
    )
  }
  const roleScoped =
    level === 'edit' && user?.roleId && TIMESHEET_SCOPED_ROLES.includes(user.roleId)
  if (!roleScoped) return 'all'
  return resolveLegacyScopedBrigades(store, user, opts)
}

export function timesheetAccess(
  store: AppStore,
  user: AppUser | null | undefined,
  opts?: { month?: string; dayIso?: string },
): TimesheetAccess {
  const u = accessPersona(user)
  const level = resolveUserTimesheetLevel(store.access, u)
  if (level === 'none' || !u) {
    return {
      level: 'none',
      brigades: [],
      viewBrigades: [],
      editBrigades: [],
      scoped: false,
    }
  }

  const viewOverride = normalizeBrigadeList(u.timesheetViewBrigades)
  const editOverride = normalizeBrigadeList(u.timesheetEditBrigades)
  const coverageBrigades = coverageBrigadesForUser(store, u, opts)
  const roleScoped =
    !viewOverride &&
    level === 'edit' &&
    TIMESHEET_SCOPED_ROLES.includes(u.roleId)

  let viewBrigades: TimesheetBrigadeScope
  if (viewOverride !== undefined) {
    viewBrigades = mergeBrigadeLists(viewOverride, coverageBrigades)
  } else if (roleScoped) {
    viewBrigades = resolveLegacyScopedBrigades(store, u, opts)
  } else {
    viewBrigades = 'all'
  }

  let editBrigades: TimesheetBrigadeScope
  if (level !== 'edit') {
    editBrigades = []
  } else if (editOverride !== undefined) {
    editBrigades = mergeBrigadeLists(editOverride, coverageBrigades)
  } else if (viewOverride !== undefined) {
    // Видит ограниченный список и может править — по умолчанию те же бригады.
    editBrigades = viewOverride
  } else if (roleScoped) {
    editBrigades = viewBrigades
  } else {
    editBrigades = 'all'
  }

  const scoped = viewBrigades !== 'all'

  return {
    level,
    brigades: viewBrigades,
    viewBrigades,
    editBrigades,
    scoped,
  }
}

export function timesheetCanEdit(access: TimesheetAccess): boolean {
  if (access.level !== 'edit') return false
  if (access.editBrigades === 'all') return true
  return access.editBrigades.length > 0
}

export function timesheetCanView(access: TimesheetAccess): boolean {
  return access.level === 'view' || access.level === 'edit'
}

export function timesheetCanEditBrigade(
  access: TimesheetAccess,
  brigade: string | undefined | null,
): boolean {
  if (!timesheetCanEdit(access)) return false
  return brigadeInTimesheetScope(brigade, access.editBrigades)
}

/** Бригада строки доступна пользователю (видимость). */
export function brigadeInTimesheetScope(
  brigade: string | undefined | null,
  scope: TimesheetBrigadeScope,
): boolean {
  if (scope === 'all') return true
  if (!brigade) return false
  return scope.includes(brigade)
}
