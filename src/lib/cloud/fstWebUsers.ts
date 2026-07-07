import type { AccessRoleId, AccessStore, AppUser } from '@/lib/access/types'
import { viewsForRole } from '@/lib/access/permissions'
import type { ViewId } from '@/lib/types'
import { isFstAdminEmail, FST_ADMIN_DISPLAY_NAMES } from './fstAdmin'
import { isFstWebAllowedEmail } from './fstWebAllowedEmails'

export type FstWebUserProfile = {
  email: string
  roleId: AccessRoleId
  displayName: string
  uid?: string
}

/** Firebase email → роль и отображаемое имя (legacy, до миграции в store.access). */
export const LEGACY_WEB_USER_DIRECTORY: Record<
  string,
  Pick<FstWebUserProfile, 'roleId' | 'displayName'>
> = {
  'hr-nino@fibercell.net': { roleId: 'hr', displayName: 'Нино' },
  'inspektor-nata@fibercell.net': { roleId: 'hr_inspector', displayName: 'Ната' },
  'finans-lizi@fibercell.net': { roleId: 'finance', displayName: 'Лизи' },
  'sklad-alexandra@fibercell.net': { roleId: 'warehouse_keeper', displayName: 'Александра' },
  'manager-ved-tamara@fibercell.net': { roleId: 'procurement_manager', displayName: 'Тамара' },
  'technolog-lasha@fibercell.net': { roleId: 'technologist', displayName: 'Лаша' },
  'technolog-ekaterina@fibercell.net': { roleId: 'technologist', displayName: 'Екатерина' },
  'technolog-annastasia@fibercell.net': { roleId: 'technologist', displayName: 'Анастасия' },
  'technolog-maria@fibercell.net': { roleId: 'technologist', displayName: 'Мария' },
  'master-karlo@fibercell.net': { roleId: 'workshop_master', displayName: 'Карло' },
  'master-valera@fibercell.net': { roleId: 'workshop_master', displayName: 'Валера' },
}

/** E-mail уже зарегистрирован в Firebase (legacy / админ) — не создавать повторно. */
export function isKnownWebFirebaseEmail(email: string | null | undefined): boolean {
  if (!email?.trim()) return false
  const key = email.trim().toLowerCase()
  if (isFstAdminEmail(key)) return true
  return key in LEGACY_WEB_USER_DIRECTORY
}

/** Разделы в облаке — уже чем на desktop. */
export const FST_WEB_ROLE_VIEWS: Partial<Record<AccessRoleId, ViewId[]>> = {
  hr: ['hr'],
  hr_inspector: ['hr_inspector'],
  finance: ['finance'],
  warehouse_keeper: ['warehouse', 'procurement', 'directories', 'journals'],
  procurement_manager: ['procurement', 'directories'],
  technologist: ['technologist', 'mixer'],
  mixer: ['mixer'],
  workshop_master: ['month', 'production', 'hr'],
  sysadmin: [
    'month',
    'summary',
    'production',
    'planner',
    'warehouse',
    'procurement',
    'hr',
    'finance',
    'directories',
    'technologist',
    'settings',
  ],
}

export function resolveFstWebProfile(
  email: string | null | undefined,
  uid?: string | null,
  access?: AccessStore | null,
): FstWebUserProfile | null {
  if (!email?.trim()) return null
  const key = email.trim().toLowerCase()

  if (isFstAdminEmail(key)) {
    return {
      email: key,
      roleId: 'sysadmin',
      displayName: FST_ADMIN_DISPLAY_NAMES[key] ?? 'Администратор',
      uid: uid ?? undefined,
    }
  }

  const stored = access?.users.find((u) => u.login === key && u.active)
  if (stored) {
    return {
      email: key,
      roleId: stored.roleId,
      displayName: stored.displayName || key,
      uid: uid ?? undefined,
    }
  }

  const row = LEGACY_WEB_USER_DIRECTORY[key]
  if (row && isFstWebAllowedEmail(key)) {
    return { email: key, uid: uid ?? undefined, ...row }
  }

  return null
}

export function buildWebAppUser(profile: FstWebUserProfile): AppUser {
  const now = new Date().toISOString()
  return {
    id: profile.uid ?? `web-${profile.roleId}`,
    login: profile.email,
    displayName: profile.displayName,
    roleId: profile.roleId,
    passwordHash: '',
    passwordSalt: '',
    active: true,
    createdAt: now,
    updatedAt: now,
  }
}

export function webViewsForRole(access: AccessStore, roleId: AccessRoleId): ViewId[] {
  const web = FST_WEB_ROLE_VIEWS[roleId]
  if (web) return [...web]
  return viewsForRole(access, roleId)
}

/** Облако: roleViews из store (настраивает админ), без жёсткого override. */
export function webAccessStore(access: AccessStore, _roleId: AccessRoleId): AccessStore {
  return access
}

export function isWebHrInspectorRole(roleId: AccessRoleId | undefined): boolean {
  return roleId === 'hr_inspector'
}

export function isWebHrRole(roleId: AccessRoleId | undefined): boolean {
  return roleId === 'hr'
}

export function isWebFinanceRole(roleId: AccessRoleId | undefined): boolean {
  return roleId === 'finance'
}

export function isWebWarehouseRole(roleId: AccessRoleId | undefined): boolean {
  return roleId === 'warehouse_keeper'
}

export function isWebTechnologistRole(roleId: AccessRoleId | undefined): boolean {
  return roleId === 'technologist'
}

export function isWebProcurementRole(roleId: AccessRoleId | undefined): boolean {
  return roleId === 'procurement_manager'
}

export function isWebWorkshopMasterRole(roleId: AccessRoleId | undefined): boolean {
  return roleId === 'workshop_master'
}
