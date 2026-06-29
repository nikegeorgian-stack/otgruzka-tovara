import type { ViewId } from '@/lib/types'
import { DEFAULT_ROLE_VIEWS } from './roles'
import type { AccessRoleId, AccessStore, AppUser } from './types'
import { SYSTEM_ADMIN_USER_ID } from './types'

const VALID_ROLES = new Set<AccessRoleId>([
  'sysadmin',
  'warehouse_keeper',
  'hr',
  'operations_director',
  'workshop_master',
  'procurement_manager',
  'chief_engineer',
  'technologist',
  'mixer',
  'finance',
])

const MANAGED = new Set<ViewId>([
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
  'mixer',
  'director',
  'journals',
  'it',
  'settings',
])

function normalizeRoleViews(
  raw: Partial<Record<AccessRoleId, ViewId[]>> | undefined,
): Record<AccessRoleId, ViewId[]> {
  const out = { ...DEFAULT_ROLE_VIEWS }
  if (!raw) return out
  for (const roleId of VALID_ROLES) {
    const list = raw[roleId]
    if (!Array.isArray(list)) continue
    out[roleId] = [...new Set(list.filter((v) => MANAGED.has(v)))]
    if (roleId === 'sysadmin') {
      out[roleId] = [...DEFAULT_ROLE_VIEWS.sysadmin]
    }
  }
  return out
}

function normalizeRoleAllowNegativeStock(
  raw: Partial<Record<AccessRoleId, boolean>> | undefined,
): Partial<Record<AccessRoleId, boolean>> {
  const out: Partial<Record<AccessRoleId, boolean>> = {}
  if (!raw) return out
  for (const roleId of VALID_ROLES) {
    if (roleId === 'sysadmin') continue
    if (raw[roleId] === true) out[roleId] = true
  }
  return out
}

function normalizeRoleAllowDocumentCancel(
  raw: Partial<Record<AccessRoleId, boolean>> | undefined,
): Partial<Record<AccessRoleId, boolean>> {
  const out: Partial<Record<AccessRoleId, boolean>> = {}
  if (!raw) return out
  for (const roleId of VALID_ROLES) {
    if (roleId === 'sysadmin') continue
    if (raw[roleId] === true) out[roleId] = true
  }
  return out
}

function normalizeUser(u: AppUser): AppUser {
  const roleId = VALID_ROLES.has(u.roleId as AccessRoleId)
    ? (u.roleId as AccessRoleId)
    : 'warehouse_keeper'
  return {
    id: u.id || crypto.randomUUID(),
    login: u.login?.trim().toLowerCase() ?? '',
    displayName: u.displayName?.trim() ?? u.login ?? '',
    roleId,
    passwordHash: u.passwordHash ?? '',
    passwordSalt: u.passwordSalt ?? '',
    active: u.active !== false,
    employeeId: u.employeeId?.trim() || undefined,
    createdAt: u.createdAt || new Date().toISOString(),
    updatedAt: u.updatedAt || new Date().toISOString(),
  }
}

export function createDefaultAccessStore(): AccessStore {
  const now = new Date().toISOString()
  const admin: AppUser = {
    id: SYSTEM_ADMIN_USER_ID,
    login: 'admin',
    displayName: 'Системный администратор',
    roleId: 'sysadmin',
    passwordHash: '',
    passwordSalt: '',
    active: true,
    createdAt: now,
    updatedAt: now,
  }
  return {
    users: [admin],
    roleViews: { ...DEFAULT_ROLE_VIEWS },
  }
}

/** Первый запуск: у sysadmin ещё не задан пароль. */
export function needsAdminSetup(access: AccessStore | undefined): boolean {
  if (!access?.users?.length) return true
  const admin =
    access.users.find((u) => u.id === SYSTEM_ADMIN_USER_ID) ??
    access.users.find((u) => u.roleId === 'sysadmin' && u.active)
  if (!admin) return true
  return !admin.passwordHash?.trim() || !admin.passwordSalt?.trim()
}

export function normalizeAccessStore(raw: AccessStore | undefined): AccessStore {
  if (!raw?.users?.length) return createDefaultAccessStore()
  const users = raw.users.map(normalizeUser)
  const hasAdmin = users.some((u) => u.roleId === 'sysadmin' && u.active)
  if (!hasAdmin) {
    users.unshift(createDefaultAccessStore().users[0]!)
  }
  return {
    users,
    roleViews: normalizeRoleViews(raw.roleViews),
    roleAllowNegativeStock: normalizeRoleAllowNegativeStock(raw.roleAllowNegativeStock),
    roleAllowDocumentCancel: normalizeRoleAllowDocumentCancel(raw.roleAllowDocumentCancel),
  }
}
