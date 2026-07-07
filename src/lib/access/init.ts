import type { ViewId } from '@/lib/types'
import { DEFAULT_ROLE_VIEWS } from './roles'
import { HR_INSPECTOR_LOGIN, HR_INSPECTOR_USER_ID } from '@/lib/hr/inspector'
import type { AccessRoleId, AccessStore, AppUser } from './types'
import { SYSTEM_ADMIN_USER_ID } from './types'
import type {
  FinanceViewDefaults,
  GlobalViewDefaults,
  HrViewDefaults,
  MonthViewDefaults,
  UserViewDefaults,
  WarehouseViewDefaults,
} from '@/lib/viewDefaults/types'
import { WAREHOUSE_TABS, WAREHOUSE_WEB_TABS } from '@/components/warehouse/warehouseTypes'
import type { FinanceSection } from '@/pages/FinancePage'
import type { HrSection } from '@/lib/types'

const VALID_LAYOUTS = new Set(['dual', 'plan', 'fact'])
const VALID_GROUP_MODES = new Set(['brigade', 'unit'])
const VALID_WAREHOUSE_TABS = new Set([...WAREHOUSE_TABS, ...WAREHOUSE_WEB_TABS])
const VALID_FINANCE_SECTIONS = new Set<FinanceSection>([
  'dashboard',
  'statement',
  'payments',
  'sick',
  'ledger',
  'rates',
  'employees',
  'org',
  'summary',
])
const VALID_HR_SECTIONS = new Set<HrSection>([
  'employees',
  'cards',
  'candidates',
  'documents',
  'absences',
  'trainings',
  'pay',
  'trash',
  'reports',
  'settings',
])

const MANAGED_VIEWS = new Set<ViewId>([
  'month',
  'summary',
  'production',
  'planner',
  'warehouse',
  'procurement',
  'hr',
  'hr_inspector',
  'finance',
  'directories',
  'technologist',
  'mixer',
  'director',
  'journals',
  'it',
  'settings',
])

function normalizeMonthViewDefaults(
  raw: MonthViewDefaults | undefined,
  legacyBrigades?: string[],
): MonthViewDefaults | undefined {
  if (!raw && !legacyBrigades?.length) return undefined
  const out: MonthViewDefaults = {}
  if (raw?.layout && VALID_LAYOUTS.has(raw.layout)) out.layout = raw.layout
  if (raw?.groupMode && VALID_GROUP_MODES.has(raw.groupMode)) out.groupMode = raw.groupMode
  const brigades = raw?.defaultBrigades?.length
    ? raw.defaultBrigades.filter((b) => typeof b === 'string' && b.trim())
    : legacyBrigades?.filter((b) => typeof b === 'string' && b.trim())
  if (brigades?.length) out.defaultBrigades = brigades
  if (raw?.viewDisplay && typeof raw.viewDisplay === 'object') {
    const vd = raw.viewDisplay
    out.viewDisplay = {
      ...(typeof vd.showPlan === 'boolean' ? { showPlan: vd.showPlan } : {}),
      ...(typeof vd.showFact === 'boolean' ? { showFact: vd.showFact } : {}),
      ...(typeof vd.showTab === 'boolean' ? { showTab: vd.showTab } : {}),
      ...(typeof vd.showPosition === 'boolean' ? { showPosition: vd.showPosition } : {}),
      ...(typeof vd.showUnit === 'boolean' ? { showUnit: vd.showUnit } : {}),
      ...(typeof vd.showSchedule === 'boolean' ? { showSchedule: vd.showSchedule } : {}),
      ...(typeof vd.showTotals === 'boolean' ? { showTotals: vd.showTotals } : {}),
    }
    if (Object.keys(out.viewDisplay).length === 0) delete out.viewDisplay
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function normalizeGlobalViewDefaults(raw: GlobalViewDefaults | undefined): GlobalViewDefaults | undefined {
  if (!raw) return undefined
  const out: GlobalViewDefaults = {}
  if (raw.lastView && MANAGED_VIEWS.has(raw.lastView)) out.lastView = raw.lastView
  if (typeof raw.lastMonth === 'string' && /^\d{4}-\d{2}$/.test(raw.lastMonth)) {
    out.lastMonth = raw.lastMonth
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function normalizeWarehouseViewDefaults(
  raw: WarehouseViewDefaults | undefined,
): WarehouseViewDefaults | undefined {
  if (!raw) return undefined
  const out: WarehouseViewDefaults = {}
  if (raw.tab && VALID_WAREHOUSE_TABS.has(raw.tab)) out.tab = raw.tab
  if (typeof raw.warehouseId === 'string' && raw.warehouseId.trim()) {
    out.warehouseId = raw.warehouseId.trim()
  }
  if (raw.deficitOnly === true) out.deficitOnly = true
  if (raw.showArchived === true) out.showArchived = true
  return Object.keys(out).length > 0 ? out : undefined
}

function normalizeFinanceViewDefaults(
  raw: FinanceViewDefaults | undefined,
): FinanceViewDefaults | undefined {
  if (!raw?.section || !VALID_FINANCE_SECTIONS.has(raw.section)) return undefined
  return { section: raw.section }
}

function normalizeHrViewDefaults(raw: HrViewDefaults | undefined): HrViewDefaults | undefined {
  if (!raw?.section || !VALID_HR_SECTIONS.has(raw.section)) return undefined
  return { section: raw.section }
}

function normalizeViewDefaults(
  raw: UserViewDefaults | undefined,
  legacyBrigades?: string[],
): UserViewDefaults | undefined {
  const month = normalizeMonthViewDefaults(raw?.month, legacyBrigades)
  const global = normalizeGlobalViewDefaults(raw?.global)
  const warehouse = normalizeWarehouseViewDefaults(raw?.warehouse)
  const finance = normalizeFinanceViewDefaults(raw?.finance)
  const hr = normalizeHrViewDefaults(raw?.hr)
  const out: UserViewDefaults = {}
  if (global) out.global = global
  if (month) out.month = month
  if (warehouse) out.warehouse = warehouse
  if (finance) out.finance = finance
  if (hr) out.hr = hr
  return Object.keys(out).length > 0 ? out : undefined
}

const VALID_ROLES = new Set<AccessRoleId>([
  'sysadmin',
  'warehouse_keeper',
  'hr',
  'hr_inspector',
  'operations_director',
  'workshop_master',
  'procurement_manager',
  'chief_engineer',
  'technologist',
  'mixer',
  'finance',
])

function normalizeRoleViews(
  raw: Partial<Record<AccessRoleId, ViewId[]>> | undefined,
): Record<AccessRoleId, ViewId[]> {
  const out = { ...DEFAULT_ROLE_VIEWS }
  if (!raw) return out
  for (const roleId of VALID_ROLES) {
    const list = raw[roleId]
    if (!Array.isArray(list)) continue
    out[roleId] = [...new Set(list.filter((v) => MANAGED_VIEWS.has(v)))]
    if (roleId === 'hr_inspector') {
      out[roleId] = out[roleId].filter((v) => v !== 'month')
    }
    if (roleId === 'sysadmin') {
      out[roleId] = [...DEFAULT_ROLE_VIEWS.sysadmin]
    }
  }
  return out
}

function normalizeRoleAllowNegativeStock(
  _raw: Partial<Record<AccessRoleId, boolean>> | undefined,
): Partial<Record<AccessRoleId, boolean>> {
  return {}
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
    defaultBrigades: Array.isArray(u.defaultBrigades)
      ? u.defaultBrigades.filter((b) => typeof b === 'string' && b.trim())
      : undefined,
    viewDefaults: normalizeViewDefaults(u.viewDefaults, u.defaultBrigades),
    webAccount: u.webAccount === true,
    webViews: Array.isArray(u.webViews)
      ? [...new Set(u.webViews.filter((v) => MANAGED_VIEWS.has(v as import('@/lib/types').ViewId)))]
      : undefined,
    createdAt: u.createdAt || new Date().toISOString(),
    updatedAt: u.updatedAt || new Date().toISOString(),
  }
}

function ensureBuiltinWebUsers(users: AppUser[]): AppUser[] {
  const now = new Date().toISOString()
  const builtins: AppUser[] = [
    {
      id: HR_INSPECTOR_USER_ID,
      login: HR_INSPECTOR_LOGIN,
      displayName: 'Ната',
      roleId: 'hr_inspector',
      passwordHash: '',
      passwordSalt: '',
      active: true,
      webAccount: true,
      createdAt: now,
      updatedAt: now,
    },
  ]
  const out = [...users]
  for (const builtin of builtins) {
    const byLogin = out.findIndex((u) => u.login === builtin.login)
    if (byLogin >= 0) {
      out[byLogin] = {
        ...out[byLogin]!,
        id: builtin.id,
        roleId: builtin.roleId,
        displayName: builtin.displayName,
        webAccount: true,
        active: true,
        updatedAt: now,
      }
      continue
    }
    const byId = out.findIndex((u) => u.id === builtin.id)
    if (byId >= 0) {
      out[byId] = { ...out[byId]!, ...builtin, updatedAt: now }
      continue
    }
    out.push(builtin)
  }
  return out
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
    users: ensureBuiltinWebUsers([admin]),
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
  let users = raw.users.map(normalizeUser)
  users = ensureBuiltinWebUsers(users)
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
