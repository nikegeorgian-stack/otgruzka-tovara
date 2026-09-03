import type { ViewId } from '@/lib/types'
import { DEFAULT_ROLE_VIEWS } from './roles'
import { roleNeedsDirectories, sanitizeDirectorySections } from '@/lib/directories/access'
import { HR_INSPECTOR_LOGIN, HR_INSPECTOR_USER_ID } from '@/lib/hr/inspector'
import type { AccessRoleId, AccessStore, AppUser } from './types'
import { SYSTEM_ADMIN_USER_ID } from './types'
import { normalizeWorkshopMasterCoverages } from './workshopMasterCoverage'
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

const VALID_SHELLS = new Set(['classic', 'workspace'])
const VALID_LAYOUTS = new Set(['dual', 'plan', 'fact'])
const VALID_GROUP_MODES = new Set(['brigade', 'unit'])
const VALID_WAREHOUSE_TABS = new Set([...WAREHOUSE_TABS, ...WAREHOUSE_WEB_TABS])
const VALID_FINANCE_SECTIONS = new Set<FinanceSection>([
  'dashboard',
  'preview',
  'statement',
  'documents',
  'payments',
  'sick',
  'vacation',
  'ledger',
  'rates',
  'employees',
  'org',
])
const VALID_HR_SECTIONS = new Set<HrSection>([
  'employees',
  'candidates',
  'contracts',
  'documents',
  'absences',
  'trainings',
  'pay',
  'fired',
  'trash',
  'reports',
  'settings',
])

const MANAGED_VIEWS = new Set<ViewId>([
  'my',
  'timeclock',
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
  'otc',
  'mixer',
  'director',
  'journals',
  'engineer_log',
  'it',
  'office',
  'meals',
  'protocols',
  'org_tree',
  'settings',
])

function normalizeMonthViewDefaults(
  raw: MonthViewDefaults | undefined,
  legacyBrigades?: string[],
): MonthViewDefaults | undefined {
  if (!raw && !legacyBrigades?.length) return undefined
  const out: MonthViewDefaults = {}
  if (raw?.shell && VALID_SHELLS.has(raw.shell)) out.shell = raw.shell
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
  if (!raw?.section) return undefined
  // Legacy: сводка внутри финансов = отдельный раздел «Сводка» в сайдбаре
  const section =
    (raw.section as string) === 'summary' ? ('dashboard' as FinanceSection) : raw.section
  if (!VALID_FINANCE_SECTIONS.has(section)) return undefined
  return { section }
}

function normalizeHrViewDefaults(raw: HrViewDefaults | undefined): HrViewDefaults | undefined {
  if (!raw?.section) return undefined
  // Legacy: «Карточки» склеены с «Сотрудники»
  const section =
    (raw.section as string) === 'cards' ? ('employees' as HrSection) : raw.section
  if (!VALID_HR_SECTIONS.has(section)) return undefined
  return { section }
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
  'otc',
  'mixer',
  'finance',
  'employee',
  'timeclock',
  'it_specialist',
  'sales_dispatcher',
  'office_manager',
  'cook',
  'secretary',
])

/** Сохранённые в облаке массивы побеждают DEFAULT, кроме киоск-ролей ниже. */
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
    if (roleId === 'employee') {
      out[roleId] = ['my', 'meals', 'tasks']
    }
    if (roleId === 'timeclock') {
      out[roleId] = ['timeclock']
    }
    if (roleId === 'office_manager') {
      out[roleId] = ['office', 'my', 'meals']
    }
    if (roleId === 'cook') {
      out[roleId] = ['meals', 'my', 'tasks']
    }
    if (roleId !== 'timeclock' && !out[roleId].includes('meals')) {
      out[roleId] = [...out[roleId], 'meals']
    }
    if (roleId !== 'timeclock' && !out[roleId].includes('tasks')) {
      out[roleId] = ['tasks', ...out[roleId]]
    }
    if (roleId === 'chief_engineer' && !out[roleId].includes('engineer_log')) {
      out[roleId] = ['engineer_log', ...out[roleId]]
    }
    if (roleId === 'technologist' && !out[roleId].includes('warehouse')) {
      out[roleId] = [...out[roleId], 'warehouse']
    }
    // Директор: технолог + ОТК (очередь рецептов / качество)
    if (roleId === 'operations_director') {
      for (const v of ['technologist', 'otc'] as const) {
        if (!out[roleId].includes(v)) out[roleId] = [...out[roleId], v]
      }
    }
    // Справочники по матрице вкладок роли (директор, продажи, технолог…)
    if (roleNeedsDirectories(roleId) && !out[roleId].includes('directories')) {
      out[roleId] = [...out[roleId], 'directories']
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

function normalizeRoleAllowReservationReallocation(
  raw: Partial<Record<AccessRoleId, boolean>> | undefined,
): Partial<Record<AccessRoleId, boolean>> {
  const out: Partial<Record<AccessRoleId, boolean>> = {}
  if (!raw) return out
  // Explicit capability only — never auto-grant for sysadmin via this map
  for (const roleId of VALID_ROLES) {
    if (roleId === 'sysadmin' || roleId === 'operations_director') continue
    if (raw[roleId] === true) out[roleId] = true
  }
  return out
}

function normalizeRoleTimesheetAccess(
  raw: AccessStore['roleTimesheetAccess'],
): AccessStore['roleTimesheetAccess'] {
  const out: NonNullable<AccessStore['roleTimesheetAccess']> = {}
  if (!raw) return out
  const levels = new Set(['none', 'view', 'edit'])
  for (const roleId of VALID_ROLES) {
    if (roleId === 'sysadmin') continue
    const v = raw[roleId]
    if (v && levels.has(v)) out[roleId] = v
  }
  return out
}

function normalizeRoleTaskAccess(
  raw: AccessStore['roleTaskAccess'],
): AccessStore['roleTaskAccess'] {
  const out: NonNullable<AccessStore['roleTaskAccess']> = {}
  if (!raw) return out
  const levels = new Set(['none', 'my', 'board', 'manage'])
  for (const roleId of VALID_ROLES) {
    if (roleId === 'sysadmin') continue
    const v = raw[roleId]
    if (v && levels.has(v)) out[roleId] = v
  }
  return out
}

function normalizeRoleTaskBoards(
  raw: AccessStore['roleTaskBoards'],
): AccessStore['roleTaskBoards'] {
  if (!raw || typeof raw !== 'object') return undefined
  const out: NonNullable<AccessStore['roleTaskBoards']> = {}
  let any = false
  for (const roleId of VALID_ROLES) {
    if (roleId === 'sysadmin') continue
    if (!Object.prototype.hasOwnProperty.call(raw, roleId)) continue
    const boards = Array.isArray(raw[roleId])
      ? [...new Set(raw[roleId]!.filter((id) => typeof id === 'string' && id.trim()))]
      : []
    out[roleId] = boards
    any = true
  }
  return any ? out : undefined
}

function normalizeUser(u: AppUser): AppUser {
  const roleId = VALID_ROLES.has(u.roleId as AccessRoleId)
    ? (u.roleId as AccessRoleId)
    : 'warehouse_keeper'
  const tsLevel =
    u.timesheetLevel === 'none' || u.timesheetLevel === 'view' || u.timesheetLevel === 'edit'
      ? u.timesheetLevel
      : undefined
  const viewBrigades = Array.isArray(u.timesheetViewBrigades)
    ? u.timesheetViewBrigades.filter((b) => typeof b === 'string' && b.trim())
    : undefined
  const editBrigades = Array.isArray(u.timesheetEditBrigades)
    ? u.timesheetEditBrigades.filter((b) => typeof b === 'string' && b.trim())
    : undefined
  return {
    id: u.id || crypto.randomUUID(),
    login: u.login?.trim().toLowerCase() ?? '',
    displayName: u.displayName?.trim() ?? u.login ?? '',
    roleId,
    passwordHash: u.passwordHash ?? '',
    passwordSalt: u.passwordSalt ?? '',
    employeeId: u.employeeId?.trim() || undefined,
    defaultBrigades: Array.isArray(u.defaultBrigades)
      ? u.defaultBrigades.filter((b) => typeof b === 'string' && b.trim())
      : undefined,
    viewDefaults: normalizeViewDefaults(u.viewDefaults, u.defaultBrigades),
    webAccount: u.webAccount === true,
    // Сотрудник — только «Моё»; старые галочки «Табель» и т.п. сбрасываем.
    webViews:
      roleId === 'employee'
        ? undefined
        : Array.isArray(u.webViews)
          ? [...new Set(u.webViews.filter((v) => MANAGED_VIEWS.has(v as ViewId)))]
          : undefined,
    directorySections:
      roleId === 'employee'
        ? undefined
        : (() => {
            const sections = sanitizeDirectorySections(u.directorySections)
            return sections && sections.length > 0 ? sections : undefined
          })(),
    timesheetLevel: roleId === 'employee' ? undefined : tsLevel,
    timesheetViewBrigades:
      roleId === 'employee' || viewBrigades === undefined ? undefined : viewBrigades,
    timesheetEditBrigades:
      roleId === 'employee' || editBrigades === undefined ? undefined : editBrigades,
    taskAccessLevel:
      u.taskAccessLevel === 'none' ||
      u.taskAccessLevel === 'my' ||
      u.taskAccessLevel === 'board' ||
      u.taskAccessLevel === 'manage'
        ? u.taskAccessLevel
        : undefined,
    taskBoards: Array.isArray(u.taskBoards)
      ? [...new Set(u.taskBoards.filter((id) => typeof id === 'string' && id.trim()))]
      : undefined,
    mustChangePassword: u.mustChangePassword === true,
    pendingDeletion: u.pendingDeletion === true,
    externalEffectOperationId: u.externalEffectOperationId?.trim() || undefined,
    active: u.pendingDeletion === true ? false : u.active !== false,
    createdAt: u.createdAt || new Date().toISOString(),
    updatedAt: u.updatedAt || new Date().toISOString(),
  }
}

/**
 * Только добавляет недостающих builtin-пользователей.
 * Уже заведённые в облаке учётки (роль, ФИО, бригады, разделы, active) не трогаем —
 * иначе после деплоя/normalize local «грязный» updatedAt уезжал в Firestore и затирал настройки.
 */
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
    const exists =
      out.some((u) => u.login === builtin.login) || out.some((u) => u.id === builtin.id)
    if (exists) continue
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
  const workshopMasterCoverages = normalizeWorkshopMasterCoverages(
    raw.workshopMasterCoverages,
  )
  const userGroups = normalizeUserGroups(raw.userGroups, users)
  return {
    users,
    roleViews: normalizeRoleViews(raw.roleViews),
    roleDirectorySections: normalizeRoleDirectorySections(raw.roleDirectorySections),
    roleTimesheetAccess: normalizeRoleTimesheetAccess(raw.roleTimesheetAccess),
    roleTaskAccess: normalizeRoleTaskAccess(raw.roleTaskAccess),
    roleTaskBoards: normalizeRoleTaskBoards(raw.roleTaskBoards),
    roleAllowNegativeStock: normalizeRoleAllowNegativeStock(raw.roleAllowNegativeStock),
    roleAllowDocumentCancel: normalizeRoleAllowDocumentCancel(raw.roleAllowDocumentCancel),
    roleAllowReservationReallocation: normalizeRoleAllowReservationReallocation(
      raw.roleAllowReservationReallocation,
    ),
    ...(workshopMasterCoverages.length > 0 ? { workshopMasterCoverages } : {}),
    ...(userGroups.length > 0 ? { userGroups } : {}),
  }
}

function normalizeRoleDirectorySections(
  raw: AccessStore['roleDirectorySections'],
): AccessStore['roleDirectorySections'] {
  if (!raw || typeof raw !== 'object') return undefined
  const out: NonNullable<AccessStore['roleDirectorySections']> = {}
  let any = false
  for (const roleId of VALID_ROLES) {
    if (roleId === 'sysadmin') continue
    if (!Object.prototype.hasOwnProperty.call(raw, roleId)) continue
    const sections = sanitizeDirectorySections(raw[roleId]) ?? []
    out[roleId] = sections
    any = true
  }
  return any ? out : undefined
}

function normalizeUserGroups(
  raw: AccessStore['userGroups'],
  users: AppUser[],
): NonNullable<AccessStore['userGroups']> {
  if (!Array.isArray(raw) || raw.length === 0) return []
  const known = new Set(users.map((u) => u.id))
  const out: NonNullable<AccessStore['userGroups']> = []
  const seen = new Set<string>()
  for (const g of raw) {
    if (!g || typeof g !== 'object') continue
    const id = typeof g.id === 'string' && g.id.trim() ? g.id.trim() : crypto.randomUUID()
    if (seen.has(id)) continue
    seen.add(id)
    const name = typeof g.name === 'string' ? g.name.trim() : ''
    if (!name) continue
    const userIds = Array.isArray(g.userIds)
      ? [...new Set(g.userIds.filter((uid) => typeof uid === 'string' && known.has(uid)))]
      : []
    const now = new Date().toISOString()
    out.push({
      id,
      name,
      note: typeof g.note === 'string' && g.note.trim() ? g.note.trim() : undefined,
      userIds,
      createdAt: typeof g.createdAt === 'string' ? g.createdAt : now,
      updatedAt: typeof g.updatedAt === 'string' ? g.updatedAt : now,
    })
  }
  return out
}
