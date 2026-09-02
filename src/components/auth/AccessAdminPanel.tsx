import { useCallback, useEffect, useMemo, useState } from 'react'
import { FormNotice } from '@/components/ui/FormNotice'
import { ModalBackdrop } from '@/components/ui/ModalBackdrop'
import { EmployeePicker } from '@/components/ui/EmployeePicker'
import { useConfirm } from '@/context/ConfirmContext'
import { useI18n } from '@/context/I18nContext'
import { roleDescription, roleLabel, ACCESS_ROLES } from '@/lib/access/roles'
import { linkedEmployeeLabel } from '@/lib/access/userEmployee'
import { importRowToUpsertInput, buildWebUserListRows, storeUserFromRow, type WebUserListRow } from '@/lib/access/webUserList'
import { viewsForRole, viewsForUser } from '@/lib/access/permissions'
import {
  directorySectionsForRole,
} from '@/lib/directories/access'
import { DIRECTORY_SECTIONS, type DirectorySection } from '@/lib/directories/types'
import { listFirebaseWebUsers } from '@/lib/cloud/webUserAdmin'
import { generateOneTimePassword } from '@/lib/access/tempPassword'
import { suggestLoginFromDisplayName } from '@/lib/access/suggestLogin'
import { AccessUserGroupsPanel } from '@/components/auth/AccessUserGroupsPanel'
import type { AccessRoleId, AccessStore, AppUser } from '@/lib/access/types'
import { NEGATIVE_STOCK_ROLES, DOCUMENT_CANCEL_ROLES } from '@/lib/access/types'
import {
  defaultTimesheetLevel,
  resolveRoleTimesheetLevel,
  TIMESHEET_SCOPED_ROLES,
  type TimesheetAccessLevel,
} from '@/lib/access/timesheetScope'
import { resolveRoleTaskAccessLevel } from '@/lib/tasks/access'
import type { TaskAccessLevel } from '@/lib/tasks/types'
import type { Employee, ViewId } from '@/lib/types'
import type { UpsertAppUserInput } from '@/store/slices/accessSlice'

type Props = {
  access: AccessStore
  employees: Employee[]
  brigades: string[]
  currentUser: AppUser
  webMode?: boolean
  onUpsertUser: (input: UpsertAppUserInput) => Promise<{ allowlistSyncFailed?: boolean }>
  onRemoveUser: (target: { id: string; login: string; inStore: boolean }) => Promise<void>
  onSetRoleViews: (roleId: AccessRoleId, views: ViewId[]) => void
  onSetRoleDirectorySections: (
    roleId: AccessRoleId,
    sections: import('@/lib/directories/types').DirectorySection[] | null,
  ) => void
  onSetRoleAllowNegativeStock: (roleId: AccessRoleId, allowed: boolean) => void
  onSetRoleAllowDocumentCancel: (roleId: AccessRoleId, allowed: boolean) => void
  onSetRoleTimesheetAccess: (roleId: AccessRoleId, level: TimesheetAccessLevel) => void
  onSetRoleTaskAccess: (roleId: AccessRoleId, level: TaskAccessLevel) => void
  onUpsertUserGroup: (input: {
    id?: string
    name: string
    note?: string
    userIds?: string[]
  }) => void
  onRemoveUserGroup: (groupId: string) => void
}

type Tab = 'users' | 'groups' | 'interfaces'
type GroupBy = 'none' | 'role' | 'group'

const VIEW_LABEL_KEYS: Record<ViewId, string> = {
  my: 'nav.my',
  timeclock: 'nav.timeclock',
  month: 'nav.month',
  summary: 'nav.summary',
  production: 'nav.production',
  planner: 'nav.planner',
  warehouse: 'nav.warehouse',
  procurement: 'nav.procurement',
  hr: 'nav.hr',
  hr_inspector: 'nav.hrInspector',
  finance: 'nav.finance',
  directories: 'nav.directories',
  settings: 'nav.settings',
  employees: 'nav.directories',
  codes: 'nav.directories',
  pay: 'nav.finance',
  technologist: 'nav.technologist',
  otc: 'nav.otc',
  mixer: 'nav.mixer',
  director: 'nav.director',
  journals: 'nav.journals',
  engineer_log: 'nav.engineerLog',
  tasks: 'nav.tasks',
  it: 'nav.it',
  office: 'nav.office',
  meals: 'nav.meals',
  protocols: 'nav.protocols',
  org_tree: 'nav.orgTree',
}

/** Группы разделов — чтобы матрица не растягивалась в одну строку. */
const VIEW_GROUPS: { id: string; labelKey: string; views: ViewId[] }[] = [
  {
    id: 'people',
    labelKey: 'access.viewGroup.people',
    views: ['my', 'meals', 'tasks', 'protocols', 'timeclock', 'month', 'summary', 'hr', 'hr_inspector', 'org_tree', 'office', 'finance'],
  },
  {
    id: 'ops',
    labelKey: 'access.viewGroup.ops',
    views: ['director', 'production', 'planner', 'technologist', 'otc', 'mixer', 'engineer_log'],
  },
  {
    id: 'stock',
    labelKey: 'access.viewGroup.stock',
    views: ['warehouse', 'procurement', 'directories'],
  },
  {
    id: 'system',
    labelKey: 'access.viewGroup.system',
    views: ['journals', 'it', 'settings'],
  },
]

export function AccessAdminPanel({
  access,
  employees,
  brigades,
  currentUser,
  webMode = false,
  onUpsertUser,
  onRemoveUser,
  onSetRoleViews,
  onSetRoleDirectorySections,
  onSetRoleAllowNegativeStock,
  onSetRoleAllowDocumentCancel,
  onSetRoleTimesheetAccess,
  onSetRoleTaskAccess,
  onUpsertUserGroup,
  onRemoveUserGroup,
}: Props) {
  const { t, tf, locale } = useI18n()
  const { confirm } = useConfirm()
  const [tab, setTab] = useState<Tab>('users')
  const [userQuery, setUserQuery] = useState('')
  const [groupBy, setGroupBy] = useState<GroupBy>('role')
  const [roleFilter, setRoleFilter] = useState<AccessRoleId | 'all'>('all')
  const [notice, setNotice] = useState<{ type: 'info' | 'error'; message: string } | null>(null)
  const [editing, setEditing] = useState<UpsertAppUserInput | null>(null)
  /** Пока true — логин подставляется из имени (новый пользователь). */
  const [loginAutoFill, setLoginAutoFill] = useState(true)
  const [firebaseUsers, setFirebaseUsers] = useState<
    import('@/lib/cloud/webUserAdmin').FirebaseWebUserRecord[]
  >([])
  const [firebaseLoading, setFirebaseLoading] = useState(false)
  const [firebaseLoadError, setFirebaseLoadError] = useState(false)
  const [userListRefresh, setUserListRefresh] = useState(0)

  const closeEditModal = useCallback(() => {
    setEditing(null)
    setLoginAutoFill(true)
  }, [])

  useEffect(() => {
    if (!webMode) return
    let cancelled = false
    setFirebaseLoading(true)
    setFirebaseLoadError(false)
    void listFirebaseWebUsers()
      .then((res) => {
        if (cancelled) return
        if (res.ok) setFirebaseUsers(res.users)
        else setFirebaseLoadError(true)
      })
      .finally(() => {
        if (!cancelled) setFirebaseLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [webMode, userListRefresh])

  const activeEmployees = useMemo(
    () => employees.filter((e) => e.active && (e.hrStatus ?? 'active') !== 'fired'),
    [employees],
  )

  const userRows = useMemo(() => {
    if (webMode) return buildWebUserListRows(access, firebaseUsers)
    return access.users.map((u) => ({
      id: u.id,
      login: u.login,
      displayName: u.displayName,
      roleId: u.roleId,
      active: u.active,
      employeeId: u.employeeId,
      defaultBrigades: u.defaultBrigades,
      webViews: u.webViews,
      directorySections: u.directorySections,
      webAccount: u.webAccount,
      inFirebase: false,
      assumedFirebase: false,
      firebaseDisabled: false,
      needsImport: false,
      inStore: true,
    })) satisfies WebUserListRow[]
  }, [access, firebaseUsers, webMode])

  const takenLogins = useMemo(
    () => userRows.map((r) => r.login).filter(Boolean),
    [userRows],
  )

  function suggestLoginForName(displayName: string): string {
    return suggestLoginFromDisplayName(displayName, {
      asEmail: webMode,
      taken: takenLogins,
    })
  }

  function patchEditingName(displayName: string) {
    setEditing((prev) => {
      if (!prev) return prev
      if (prev.id || prev.skipFirebaseCreate || !loginAutoFill) {
        return { ...prev, displayName }
      }
      return { ...prev, displayName, login: suggestLoginForName(displayName) }
    })
  }

  function patchEditingEmployee(employeeId: string | null) {
    setEditing((prev) => {
      if (!prev) return prev
      const emp = employeeId ? employees.find((e) => e.id === employeeId) : null
      const displayName = emp?.fullName?.trim() || prev.displayName
      if (prev.id || prev.skipFirebaseCreate || !loginAutoFill) {
        return {
          ...prev,
          employeeId,
          displayName: emp?.fullName?.trim() ? displayName : prev.displayName,
        }
      }
      return {
        ...prev,
        employeeId,
        displayName,
        login: suggestLoginForName(displayName),
      }
    })
  }

  const filteredUserRows = useMemo(() => {
    const q = userQuery.trim().toLowerCase()
    return userRows.filter((row) => {
      if (roleFilter !== 'all' && row.roleId !== roleFilter) return false
      if (!q) return true
      const hay = `${row.displayName} ${row.login} ${row.employeeId ?? ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [userRows, userQuery, roleFilter])

  const userSections = useMemo(() => {
    if (groupBy === 'none') {
      return [{ key: 'all', title: t('access.groupBy.all'), rows: filteredUserRows }]
    }
    if (groupBy === 'role') {
      const order = ACCESS_ROLES.map((r) => r.id)
      const map = new Map<string, WebUserListRow[]>()
      for (const row of filteredUserRows) {
        const list = map.get(row.roleId) ?? []
        list.push(row)
        map.set(row.roleId, list)
      }
      return order
        .filter((id) => map.has(id))
        .map((id) => ({
          key: id,
          title: roleLabel(id, locale),
          rows: map.get(id)!,
        }))
    }
    // custom groups
    const groups = access.userGroups ?? []
    const assigned = new Set<string>()
    const sections: { key: string; title: string; rows: WebUserListRow[] }[] = []
    for (const g of groups) {
      const rows = filteredUserRows.filter((r) => g.userIds.includes(r.id))
      for (const r of rows) assigned.add(r.id)
      if (rows.length > 0) {
        sections.push({ key: g.id, title: g.name, rows })
      }
    }
    const ungrouped = filteredUserRows.filter((r) => !assigned.has(r.id))
    if (ungrouped.length > 0) {
      sections.push({
        key: 'ungrouped',
        title: t('access.groups.ungrouped'),
        rows: ungrouped,
      })
    }
    if (sections.length === 0) {
      return [{ key: 'empty', title: t('access.noUsers'), rows: [] }]
    }
    return sections
  }, [groupBy, filteredUserRows, access.userGroups, locale, t])

  const userStats = useMemo(() => {
    const active = userRows.filter((r) => r.active && !r.firebaseDisabled).length
    const needs = userRows.filter((r) => r.needsImport).length
    return {
      total: userRows.length,
      active,
      groups: access.userGroups?.length ?? 0,
      needs,
    }
  }, [userRows, access.userGroups])

  const editableRoles = ACCESS_ROLES.filter((r) => r.id !== 'sysadmin')

  function openEditRow(row: WebUserListRow) {
    // Полная запись из store — иначе потеряются defaultBrigades и др. поля,
    // которых нет в урезанном WebUserListRow / storeUserFromRow.
    if (row.inStore) {
      const fromStore = access.users.find((u) => u.id === row.id)
      if (fromStore) {
        openEdit(fromStore)
        return
      }
    }
    const stored = storeUserFromRow(row)
    if (stored) {
      openEdit(stored)
      return
    }
    setLoginAutoFill(false)
    setEditing(importRowToUpsertInput(row))
  }

  function openNew() {
    setLoginAutoFill(true)
    setEditing({
      login: '',
      displayName: '',
      roleId: 'warehouse_keeper',
      password: '',
      active: true,
      employeeId: null,
      defaultBrigades: [],
      webViews: [],
      directorySections: [],
      timesheetLevel: null,
      timesheetViewBrigades: null,
      timesheetEditBrigades: null,
      taskAccessLevel: null,
    })
  }

  function openEdit(u: AppUser) {
    setLoginAutoFill(false)
    setEditing({
      id: u.id,
      login: u.login,
      displayName: u.displayName,
      roleId: u.roleId,
      active: u.active,
      employeeId: u.employeeId ?? null,
      defaultBrigades: u.defaultBrigades ? [...u.defaultBrigades] : [],
      webViews: u.roleId === 'employee' ? [] : u.webViews ? [...u.webViews] : [],
      directorySections:
        u.roleId === 'employee' ? [] : u.directorySections ? [...u.directorySections] : [],
      timesheetLevel: u.timesheetLevel ?? null,
      timesheetViewBrigades: u.timesheetViewBrigades
        ? [...u.timesheetViewBrigades]
        : null,
      timesheetEditBrigades: u.timesheetEditBrigades
        ? [...u.timesheetEditBrigades]
        : null,
      taskAccessLevel: u.taskAccessLevel ?? null,
    })
  }

  function toggleDefaultBrigade(brigade: string) {
    if (!editing) return
    const current = editing.defaultBrigades ?? []
    const next = current.includes(brigade)
      ? current.filter((b) => b !== brigade)
      : [...current, brigade]
    setEditing({ ...editing, defaultBrigades: next })
  }

  function toggleTimesheetBrigade(
    field: 'timesheetViewBrigades' | 'timesheetEditBrigades',
    brigade: string,
  ) {
    if (!editing) return
    const current = editing[field] ?? []
    const list = Array.isArray(current) ? current : []
    const next = list.includes(brigade)
      ? list.filter((b) => b !== brigade)
      : [...list, brigade]
    setEditing({ ...editing, [field]: next })
  }

  function setTimesheetBrigadeMode(
    field: 'timesheetViewBrigades' | 'timesheetEditBrigades',
    mode: 'all' | 'list',
  ) {
    if (!editing) return
    if (mode === 'all') {
      setEditing({ ...editing, [field]: null })
      return
    }
    const current = editing[field]
    setEditing({
      ...editing,
      [field]: Array.isArray(current) ? current : [],
    })
  }

  function editingEffectiveViews(): ViewId[] {
    if (!editing) return []
    if (editing.roleId === 'employee') return ['my', 'meals']
    if (editing.roleId === 'cook') return ['meals', 'my']
    if (editing.webViews?.length) return editing.webViews
    return viewsForRole(access, editing.roleId)
  }

  function toggleUserView(view: ViewId) {
    if (!editing || editing.roleId === 'employee' || editing.roleId === 'cook') return
    const current = editingEffectiveViews()
    const next = current.includes(view)
      ? current.filter((v) => v !== view)
      : [...current, view]
    setEditing({ ...editing, webViews: next })
  }

  function editingEffectiveDirectorySections(): DirectorySection[] {
    if (!editing || editing.roleId === 'employee') return []
    if (editing.directorySections?.length) return editing.directorySections
    return directorySectionsForRole(editing.roleId, access)
  }

  function toggleUserDirectorySection(section: DirectorySection) {
    if (!editing || editing.roleId === 'employee' || editing.roleId === 'cook') return
    const current = editingEffectiveDirectorySections()
    const next = current.includes(section)
      ? current.filter((s) => s !== section)
      : [...current, section]
    const views = editingEffectiveViews()
    setEditing({
      ...editing,
      directorySections: next,
      webViews:
        next.length > 0 && !views.includes('directories')
          ? [...views, 'directories']
          : editing.webViews?.length
            ? views
            : editing.webViews,
    })
  }

  function roleEffectiveDirectorySections(roleId: AccessRoleId): DirectorySection[] {
    return directorySectionsForRole(roleId, access)
  }

  function toggleRoleDirectorySection(roleId: AccessRoleId, section: DirectorySection) {
    const current = roleEffectiveDirectorySections(roleId)
    const next = current.includes(section)
      ? current.filter((s) => s !== section)
      : [...current, section]
    onSetRoleDirectorySections(roleId, next)
    const views = access.roleViews[roleId] ?? []
    if (next.length > 0 && !views.includes('directories')) {
      onSetRoleViews(roleId, [...views, 'directories'])
    }
  }

  const editingTsLevel =
    editing?.timesheetLevel === null || editing?.timesheetLevel === undefined
      ? 'inherit'
      : editing.timesheetLevel
  const roleTsLevel = editing
    ? resolveRoleTimesheetLevel(access, editing.roleId)
    : 'none'
  const effectiveTsLevel =
    editingTsLevel === 'inherit' ? roleTsLevel : editingTsLevel
  const showTimesheetBrigades =
    !!editing &&
    editing.roleId !== 'employee' &&
    (effectiveTsLevel === 'view' || effectiveTsLevel === 'edit')

  const editingTaskLevel =
    editing?.taskAccessLevel === null || editing?.taskAccessLevel === undefined
      ? 'inherit'
      : editing.taskAccessLevel
  const roleTaskLevel = editing
    ? resolveRoleTaskAccessLevel(access, editing.roleId)
    : 'none'
  const effectiveTaskLevel =
    editingTaskLevel === 'inherit' ? roleTaskLevel : editingTaskLevel

  async function saveUser() {
    if (!editing) return
    try {
      const result = await onUpsertUser(editing)
      setEditing(null)
      setUserListRefresh((n) => n + 1)
      setNotice({
        type: 'info',
        message: result.allowlistSyncFailed
          ? t('access.userSavedAllowlistWarn')
          : t('access.userSaved'),
      })
    } catch (err) {
      const key =
        err instanceof Error
          ? ({
              login_required: 'access.errLogin',
              login_taken: 'access.errLoginTaken',
              password_required: 'access.errPassword',
              password_too_short: 'access.errPasswordShort',
              firebase_email_exists: 'access.errFirebaseEmail',
              firebase_create_failed: 'access.errFirebaseCreate',
              firebase_unauthorized: 'access.errFirebaseAuth',
              firebase_update_failed: 'access.errFirebaseUpdate',
              allowlist_sync_failed: 'access.errAllowlistSync',
              last_sysadmin: 'access.errLastSysadmin',
            }[err.message] ?? 'access.errGeneric')
          : 'access.errGeneric'
      setNotice({ type: 'error', message: t(key) })
    }
  }

  function toggleRoleView(roleId: AccessRoleId, view: ViewId) {
    const current = access.roleViews[roleId] ?? []
    const next = current.includes(view)
      ? current.filter((v) => v !== view)
      : [...current, view]
    onSetRoleViews(roleId, next)
  }

  function canDeleteLogin(login: string): boolean {
    return login.trim().toLowerCase() !== currentUser.login.trim().toLowerCase()
  }

  function canDeleteRow(row: WebUserListRow): boolean {
    // Auth hard-delete only on web (SQL outbox processor).
    if (!webMode) return false
    return canDeleteLogin(row.login)
  }

  async function removeUserRow(row: WebUserListRow) {
    const ok = await confirm({
      title: t('access.deleteUserTitle'),
      message: tf('access.deleteUserConfirm', { name: row.displayName, email: row.login }),
      confirmLabel: t('counterparty.delete'),
      danger: true,
    })
    if (!ok) return
    try {
      await onRemoveUser({ id: row.id, login: row.login, inStore: row.inStore })
      setEditing(null)
      setUserListRefresh((n) => n + 1)
      setNotice({ type: 'info', message: t('access.userRemovePending') })
    } catch (err) {
      const key =
        err instanceof Error
          ? ({
              cannot_delete_self: 'access.errCannotRemoveSelf',
              last_sysadmin: 'access.errLastSysadmin',
              cannot_remove_sysadmin: 'access.errCannotRemove',
              firebase_delete_failed: 'access.errFirebaseDelete',
              external_deletion_web_only: 'access.externalDeleteWebOnly',
            }[err.message] ?? 'access.errCannotRemove')
          : 'access.errCannotRemove'
      setNotice({ type: 'error', message: t(key) })
    }
  }

  return (
    <section className="rounded-sm border border-grid bg-white p-5 shadow-sm">
      <h3 className="text-sm font-bold uppercase tracking-wide text-ink">
        {t('access.adminTitle')}
      </h3>
      <p className="mt-1 max-w-2xl text-sm text-stone-600">
        {webMode ? t('access.adminHintWeb') : t('access.adminHint')}
      </p>
      {!webMode ? (
        <p className="mt-2 max-w-2xl text-sm text-amber-800">
          {t('access.externalDeleteWebOnly')}
        </p>
      ) : null}

      {notice && (
        <div className="mt-3">
          <FormNotice
            type={notice.type}
            message={notice.message}
            onDismiss={() => setNotice(null)}
          />
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        {(
          [
            ['access.stats.total', userStats.total],
            ['access.stats.active', userStats.active],
            ['access.stats.groups', userStats.groups],
            ['access.stats.needsSetup', userStats.needs],
          ] as const
        ).map(([key, value]) => (
          <div key={key} className="rounded-sm border border-grid bg-stone-50/80 px-3 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">
              {t(key)}
            </p>
            <p className="mt-1 text-2xl font-semibold text-ink">{value}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2 border-b border-grid pb-3">
        {(
          [
            ['users', 'access.tab.users'],
            ['groups', 'access.tab.groups'],
            ['interfaces', 'access.tab.interfaces'],
          ] as const
        ).map(([id, key]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-sm px-3 py-2 text-xs font-semibold ${
              tab === id ? 'bg-accent text-white' : 'text-stone-600 hover:bg-stone-50'
            }`}
          >
            {t(key)}
          </button>
        ))}
      </div>

      {tab === 'groups' ? (
        <AccessUserGroupsPanel
          access={access}
          onUpsertGroup={onUpsertUserGroup}
          onRemoveGroup={onRemoveUserGroup}
        />
      ) : null}

      {tab === 'users' && (
        <div className="mt-4 space-y-4">
          {webMode && firebaseLoadError ? (
            <FormNotice type="error" message={t('access.firebaseListFailed')} />
          ) : null}
          {webMode && firebaseLoading ? (
            <p className="text-xs text-stone-500">{t('access.firebaseListLoading')}</p>
          ) : null}
          <div className="flex flex-wrap items-end gap-2 rounded-sm border border-grid bg-stone-50/60 p-3">
            <label className="min-w-[12rem] flex-1 text-xs font-medium text-stone-500">
              {t('access.search')}
              <input
                className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
                placeholder={t('access.searchPlaceholder')}
              />
            </label>
            <label className="text-xs font-medium text-stone-500">
              {t('access.filterRole')}
              <select
                className="mt-1 block rounded-sm border border-grid bg-white px-3 py-2 text-sm"
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value as AccessRoleId | 'all')}
              >
                <option value="all">{t('access.filterRoleAll')}</option>
                {ACCESS_ROLES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {roleLabel(r.id, locale)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-stone-500">
              {t('access.groupBy.label')}
              <select
                className="mt-1 block rounded-sm border border-grid bg-white px-3 py-2 text-sm"
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as GroupBy)}
              >
                <option value="none">{t('access.groupBy.none')}</option>
                <option value="role">{t('access.groupBy.role')}</option>
                <option value="group">{t('access.groupBy.group')}</option>
              </select>
            </label>
            <button type="button" className="btn-add ml-auto" onClick={openNew}>
              {t('access.addUser')}
            </button>
          </div>
          <p className="text-xs text-stone-500">
            {tf('access.usersCount', { n: String(filteredUserRows.length) })}
            {filteredUserRows.length !== userRows.length ? ` / ${userRows.length}` : ''}
          </p>
          {userSections.map((section) => (
            <div key={section.key} className="space-y-2">
              {groupBy !== 'none' ? (
                <h4 className="text-xs font-bold uppercase tracking-wide text-stone-500">
                  {section.title}{' '}
                  <span className="font-normal text-stone-400">({section.rows.length})</span>
                </h4>
              ) : null}
              <div className="overflow-x-auto rounded-sm border border-grid bg-white">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-stone-50 text-left text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                    <tr>
                      <th className="px-4 py-3">{t('access.col.name')}</th>
                      <th className="px-4 py-3">
                        {webMode ? t('access.col.email') : t('access.col.login')}
                      </th>
                      <th className="px-4 py-3">{t('access.col.employee')}</th>
                      <th className="px-4 py-3">{t('access.col.role')}</th>
                      {webMode ? <th className="px-4 py-3">{t('access.col.views')}</th> : null}
                      <th className="px-4 py-3">{t('access.col.status')}</th>
                      {webMode ? <th className="px-4 py-3">{t('access.col.program')}</th> : null}
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {section.rows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={webMode ? 8 : 6}
                          className="px-4 py-6 text-center text-stone-400"
                        >
                          {t('access.noUsers')}
                        </td>
                      </tr>
                    ) : (
                      section.rows.map((row) => {
                        const viewCount = row.inStore
                          ? viewsForUser(access, {
                              id: row.id,
                              login: row.login,
                              displayName: row.displayName,
                              roleId: row.roleId,
                              passwordHash: '',
                              passwordSalt: '',
                              active: row.active,
                              employeeId: row.employeeId,
                              webViews: row.webViews,
                              timesheetLevel: access.users.find((u) => u.id === row.id)
                                ?.timesheetLevel,
                              createdAt: '',
                              updatedAt: '',
                            }).length
                          : viewsForRole(access, row.roleId).length
                        return (
                          <tr
                            key={row.id}
                            className={`border-t border-grid/60 hover:bg-stone-50/80 ${
                              row.needsImport ? 'bg-amber-50/60' : ''
                            }`}
                          >
                            <td className="px-4 py-3 font-medium">{row.displayName}</td>
                            <td className="px-4 py-3 font-mono text-xs">{row.login}</td>
                            <td className="px-4 py-3 text-stone-600">
                              {row.employeeId ? (
                                linkedEmployeeLabel(
                                  {
                                    id: row.id,
                                    login: row.login,
                                    displayName: row.displayName,
                                    roleId: row.roleId,
                                    passwordHash: '',
                                    passwordSalt: '',
                                    active: row.active,
                                    employeeId: row.employeeId,
                                    createdAt: '',
                                    updatedAt: '',
                                  },
                                  employees,
                                )
                              ) : (
                                <span className="text-stone-400">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3">{roleLabel(row.roleId, locale)}</td>
                            {webMode ? (
                              <td className="px-4 py-3 text-xs text-stone-600">{viewCount}</td>
                            ) : null}
                            <td className="px-4 py-3">
                              {!row.active || row.firebaseDisabled ? (
                                <span className="rounded-sm bg-stone-100 px-1.5 py-0.5 text-[11px] font-medium text-stone-500">
                                  {t('access.inactive')}
                                </span>
                              ) : (
                                <span className="rounded-sm bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
                                  {t('access.active')}
                                </span>
                              )}
                            </td>
                            {webMode ? (
                              <td className="px-4 py-3 text-xs">
                                {row.inStore ? (
                                  <span className="text-emerald-700">{t('access.inProgram')}</span>
                                ) : (
                                  <span className="text-amber-700">{t('access.needsImport')}</span>
                                )}
                              </td>
                            ) : null}
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-3">
                                <button
                                  type="button"
                                  className="text-sm font-medium text-accent hover:underline"
                                  onClick={() => openEditRow(row)}
                                >
                                  {row.needsImport ? t('access.linkUser') : t('counterparty.open')}
                                </button>
                                {canDeleteRow(row) ? (
                                  <button
                                    type="button"
                                    className="text-sm text-red-600 hover:underline"
                                    onClick={() => void removeUserRow(row)}
                                  >
                                    {t('counterparty.delete')}
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'interfaces' && (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-stone-500">{t('access.interfacesHint')}</p>
          <div className="grid gap-3 lg:grid-cols-2">
            {editableRoles.map((role) => {
              const tsLevel = resolveRoleTimesheetLevel(access, role.id)
              const taskLevel = resolveRoleTaskAccessLevel(access, role.id)
              const scopedEdit = TIMESHEET_SCOPED_ROLES.includes(role.id)
              return (
                <section
                  key={role.id}
                  className="rounded-sm border border-grid bg-white p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-grid/60 pb-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink">{roleLabel(role.id, locale)}</p>
                      <p className="mt-0.5 text-[11px] text-stone-400">
                        {roleDescription(role.id, locale)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-start gap-3">
                    <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-stone-500">
                      {t('access.col.timesheet')}
                      <select
                        className="min-w-[9.5rem] rounded-sm border border-grid bg-white px-2 py-1.5 text-xs font-medium normal-case text-ink"
                        value={tsLevel}
                        onChange={(e) =>
                          onSetRoleTimesheetAccess(
                            role.id,
                            e.target.value as TimesheetAccessLevel,
                          )
                        }
                        aria-label={`${roleLabel(role.id, locale)} · ${t('access.col.timesheet')}`}
                      >
                        <option value="none">{t('access.timesheet.none')}</option>
                        <option value="view">{t('access.timesheet.view')}</option>
                        <option value="edit">
                          {scopedEdit
                            ? t('access.timesheet.editScoped')
                            : t('access.timesheet.edit')}
                        </option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-stone-500">
                      {t('access.col.tasks')}
                      <select
                        className="min-w-[9.5rem] rounded-sm border border-grid bg-white px-2 py-1.5 text-xs font-medium normal-case text-ink"
                        value={taskLevel}
                        onChange={(e) =>
                          onSetRoleTaskAccess(role.id, e.target.value as TaskAccessLevel)
                        }
                        aria-label={`${roleLabel(role.id, locale)} · ${t('access.col.tasks')}`}
                      >
                        <option value="none">{t('access.tasks.none')}</option>
                        <option value="my">{t('access.tasks.my')}</option>
                        <option value="board">{t('access.tasks.assign')}</option>
                        <option value="manage">{t('access.tasks.manage')}</option>
                      </select>
                    </label>
                    </div>
                  </div>

                  <div className="mt-3 space-y-3">
                    {VIEW_GROUPS.map((group) => (
                      <div key={group.id}>
                        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-stone-400">
                          {t(group.labelKey)}
                        </p>
                        <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                          {group.views.map((view) => {
                            const checked = access.roleViews[role.id]?.includes(view) ?? false
                            return (
                              <label
                                key={view}
                                className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm border border-transparent px-1.5 py-0.5 text-xs text-ink hover:border-grid hover:bg-stone-50"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleRoleView(role.id, view)}
                                  aria-label={`${roleLabel(role.id, locale)} · ${t(VIEW_LABEL_KEYS[view])}`}
                                />
                                {t(VIEW_LABEL_KEYS[view])}
                              </label>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                    <div className="rounded-sm border border-dashed border-teal-200/80 bg-teal-50/30 p-2.5">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-teal-900">
                        {t('access.roleDirectoriesTitle')}
                      </p>
                      <p className="mt-0.5 text-[10px] text-stone-500">
                        {t('access.roleDirectoriesHint')}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5">
                        {DIRECTORY_SECTIONS.map((tab) => {
                          const checked = roleEffectiveDirectorySections(role.id).includes(
                            tab.id,
                          )
                          return (
                            <label
                              key={tab.id}
                              className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm border border-transparent px-1.5 py-0.5 text-xs text-ink hover:border-grid hover:bg-white"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleRoleDirectorySection(role.id, tab.id)}
                                aria-label={`${roleLabel(role.id, locale)} · ${t(tab.labelKey)}`}
                              />
                              {t(tab.labelKey)}
                            </label>
                          )
                        })}
                      </div>
                      {access.roleDirectorySections?.[role.id] !== undefined ? (
                        <button
                          type="button"
                          className="mt-2 text-[11px] font-medium text-teal-800 hover:underline"
                          onClick={() => onSetRoleDirectorySections(role.id, null)}
                        >
                          {t('access.directoriesResetDefault')}
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {(NEGATIVE_STOCK_ROLES.includes(role.id) ||
                    DOCUMENT_CANCEL_ROLES.includes(role.id)) && (
                    <div className="mt-3 flex flex-wrap gap-4 border-t border-grid/60 pt-3 text-xs">
                      {NEGATIVE_STOCK_ROLES.includes(role.id) && (
                        <label className="inline-flex items-center gap-1.5" title={t('access.negativeStockHint')}>
                          <input
                            type="checkbox"
                            checked={access.roleAllowNegativeStock?.[role.id] === true}
                            onChange={(e) =>
                              onSetRoleAllowNegativeStock(role.id, e.target.checked)
                            }
                          />
                          {t('access.col.negativeStock')}
                        </label>
                      )}
                      {DOCUMENT_CANCEL_ROLES.includes(role.id) && (
                        <label className="inline-flex items-center gap-1.5" title={t('access.documentCancelHint')}>
                          <input
                            type="checkbox"
                            checked={access.roleAllowDocumentCancel?.[role.id] === true}
                            onChange={(e) =>
                              onSetRoleAllowDocumentCancel(role.id, e.target.checked)
                            }
                          />
                          {t('access.col.documentCancel')}
                        </label>
                      )}
                    </div>
                  )}
                </section>
              )
            })}

            <section className="rounded-sm border border-dashed border-grid bg-stone-50/80 p-4 lg:col-span-2">
              <p className="font-semibold text-ink">{roleLabel('sysadmin', locale)}</p>
              <p className="mt-1 text-xs text-stone-500">{t('access.sysadminAll')}</p>
              <p className="mt-1 text-xs text-stone-400">
                {t('access.col.timesheet')}: {t('access.timesheet.edit')} ({defaultTimesheetLevel('sysadmin')})
              </p>
            </section>
          </div>
        </div>
      )}

      {editing && (
        <ModalBackdrop
          open
          onClose={closeEditModal}
          panelClassName="app-dialog-panel flex w-full max-w-3xl flex-col overflow-hidden rounded-t-sm border border-grid bg-white shadow-sm sm:rounded-sm"
        >
            <h4 className="shrink-0 border-b border-grid bg-stone-50 px-5 py-4 text-lg font-bold text-ink">
              {editing.id
                ? t('access.editUser')
                : editing.skipFirebaseCreate
                  ? t('access.setupUser')
                  : t('access.newUser')}
            </h4>
            <div className="app-dialog-body space-y-4 px-5 py-4">
              <p className="rounded-sm border border-amber-200/80 bg-amber-50/60 px-3 py-2 text-[11px] leading-relaxed text-stone-600">
                {t('access.userOverridesPriority')}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-stone-500">
                {t('access.col.name')}
                <input
                  className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                  value={editing.displayName}
                  onChange={(e) => patchEditingName(e.target.value)}
                />
              </label>
              <label className="block text-xs font-medium text-stone-500">
                {webMode ? t('access.col.email') : t('access.col.login')}
                <input
                  className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                  value={editing.login}
                  onChange={(e) => {
                    setLoginAutoFill(false)
                    setEditing({ ...editing, login: e.target.value })
                  }}
                  disabled={!!editing.id || !!editing.skipFirebaseCreate}
                  type={webMode ? 'email' : 'text'}
                  autoComplete="off"
                />
                {!editing.id && !editing.skipFirebaseCreate ? (
                  <p className="mt-1 text-[11px] text-stone-400">{t('access.loginFromNameHint')}</p>
                ) : null}
              </label>
              </div>
              <label className="block text-xs font-medium text-stone-500">
                {t('access.col.employee')}
                <div className="mt-1">
                  <EmployeePicker
                    employees={activeEmployees}
                    value={editing.employeeId ?? null}
                    placeholder={t('access.employeePlaceholder')}
                    onChange={(id) => patchEditingEmployee(id)}
                  />
                </div>
                <p className="mt-1 text-[11px] text-stone-400">{t('access.employeeHint')}</p>
              </label>
              <label className="block text-xs font-medium text-stone-500">
                {t('access.col.role')}
                <select
                  className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                  value={editing.roleId}
                  onChange={(e) => {
                    const roleId = e.target.value as AccessRoleId
                    setEditing({
                      ...editing,
                      roleId,
                      webViews: roleId === 'employee' ? [] : editing.webViews,
                      directorySections:
                        roleId === 'employee' ? [] : editing.directorySections,
                      timesheetLevel: roleId === 'employee' ? null : editing.timesheetLevel,
                      timesheetViewBrigades:
                        roleId === 'employee' ? null : editing.timesheetViewBrigades,
                      timesheetEditBrigades:
                        roleId === 'employee' ? null : editing.timesheetEditBrigades,
                    })
                  }}
                  disabled={editing.id === currentUser.id}
                >
                  {ACCESS_ROLES.map((r) => (
                    <option key={r.id} value={r.id}>
                      {roleLabel(r.id, locale)}
                    </option>
                  ))}
                </select>
              </label>

              {editing.roleId !== 'employee' ? (
                <div className="rounded-sm border border-sky-200/80 bg-sky-50/40 p-3 space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-stone-700">
                      {t('access.userTimesheetTitle')}
                    </p>
                    <p className="mt-0.5 text-[11px] text-stone-500">
                      {t('access.userTimesheetHint')}
                    </p>
                  </div>
                  <label className="block text-xs font-medium text-stone-500">
                    {t('access.col.timesheet')}
                    <select
                      className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
                      value={editingTsLevel}
                      onChange={(e) => {
                        const v = e.target.value
                        setEditing({
                          ...editing,
                          timesheetLevel:
                            v === 'inherit'
                              ? null
                              : (v as TimesheetAccessLevel),
                        })
                      }}
                    >
                      <option value="inherit">
                        {tf('access.timesheet.inheritRole', {
                          level: t(`access.timesheet.${roleTsLevel}`),
                        })}
                      </option>
                      <option value="none">{t('access.timesheet.none')}</option>
                      <option value="view">{t('access.timesheet.view')}</option>
                      <option value="edit">{t('access.timesheet.edit')}</option>
                    </select>
                  </label>

                  {showTimesheetBrigades && brigades.length > 0 ? (
                    <>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-medium text-stone-600">
                            {t('access.timesheetViewBrigades')}
                          </span>
                          <button
                            type="button"
                            className={`rounded-sm border px-2 py-0.5 text-[11px] ${
                              editing.timesheetViewBrigades === null
                                ? 'border-accent bg-accent/10 font-semibold text-accent'
                                : 'border-grid bg-white text-stone-600'
                            }`}
                            onClick={() => setTimesheetBrigadeMode('timesheetViewBrigades', 'all')}
                          >
                            {t('access.timesheetBrigadesAll')}
                          </button>
                          <button
                            type="button"
                            className={`rounded-sm border px-2 py-0.5 text-[11px] ${
                              Array.isArray(editing.timesheetViewBrigades)
                                ? 'border-accent bg-accent/10 font-semibold text-accent'
                                : 'border-grid bg-white text-stone-600'
                            }`}
                            onClick={() => setTimesheetBrigadeMode('timesheetViewBrigades', 'list')}
                          >
                            {t('access.timesheetBrigadesList')}
                          </button>
                        </div>
                        <p className="mt-1 text-[11px] text-stone-400">
                          {t('access.timesheetViewBrigadesHint')}
                        </p>
                        {Array.isArray(editing.timesheetViewBrigades) ? (
                          <div className="mt-2 flex max-h-36 flex-wrap gap-2 overflow-y-auto">
                            {brigades.map((b) => (
                              <label
                                key={`view-${b}`}
                                className="flex cursor-pointer items-center gap-1.5 rounded-sm border border-grid bg-white px-2 py-1 text-xs text-stone-700"
                              >
                                <input
                                  type="checkbox"
                                  checked={editing.timesheetViewBrigades!.includes(b)}
                                  onChange={() =>
                                    toggleTimesheetBrigade('timesheetViewBrigades', b)
                                  }
                                />
                                {b}
                              </label>
                            ))}
                          </div>
                        ) : null}
                      </div>

                      {effectiveTsLevel === 'edit' ? (
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-medium text-stone-600">
                              {t('access.timesheetEditBrigades')}
                            </span>
                            <button
                              type="button"
                              className={`rounded-sm border px-2 py-0.5 text-[11px] ${
                                editing.timesheetEditBrigades === null
                                  ? 'border-accent bg-accent/10 font-semibold text-accent'
                                  : 'border-grid bg-white text-stone-600'
                              }`}
                              onClick={() =>
                                setTimesheetBrigadeMode('timesheetEditBrigades', 'all')
                              }
                            >
                              {t('access.timesheetBrigadesAll')}
                            </button>
                            <button
                              type="button"
                              className={`rounded-sm border px-2 py-0.5 text-[11px] ${
                                Array.isArray(editing.timesheetEditBrigades)
                                  ? 'border-accent bg-accent/10 font-semibold text-accent'
                                  : 'border-grid bg-white text-stone-600'
                              }`}
                              onClick={() =>
                                setTimesheetBrigadeMode('timesheetEditBrigades', 'list')
                              }
                            >
                              {t('access.timesheetBrigadesList')}
                            </button>
                          </div>
                          <p className="mt-1 text-[11px] text-stone-400">
                            {t('access.timesheetEditBrigadesHint')}
                          </p>
                          {Array.isArray(editing.timesheetEditBrigades) ? (
                            <div className="mt-2 flex max-h-36 flex-wrap gap-2 overflow-y-auto">
                              {brigades.map((b) => (
                                <label
                                  key={`edit-${b}`}
                                  className="flex cursor-pointer items-center gap-1.5 rounded-sm border border-grid bg-white px-2 py-1 text-xs text-stone-700"
                                >
                                  <input
                                    type="checkbox"
                                    checked={editing.timesheetEditBrigades!.includes(b)}
                                    onChange={() =>
                                      toggleTimesheetBrigade('timesheetEditBrigades', b)
                                    }
                                  />
                                  {b}
                                </label>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : null}

              {editing.roleId !== 'timeclock' ? (
                <div className="rounded-sm border border-violet-200/80 bg-violet-50/40 p-3 space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-stone-700">
                      {t('access.userTasksTitle')}
                    </p>
                    <p className="mt-0.5 text-[11px] text-stone-500">
                      {t('access.userTasksHint')}
                    </p>
                  </div>
                  <label className="block text-xs font-medium text-stone-500">
                    {t('access.col.tasks')}
                    <select
                      className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
                      value={editingTaskLevel}
                      onChange={(e) => {
                        const v = e.target.value
                        setEditing({
                          ...editing,
                          taskAccessLevel:
                            v === 'inherit' ? null : (v as TaskAccessLevel),
                        })
                      }}
                    >
                      <option value="inherit">
                        {tf('access.tasks.inheritRole', {
                          level: t(`access.tasks.${roleTaskLevel === 'board' ? 'assign' : roleTaskLevel}`),
                        })}
                      </option>
                      <option value="none">{t('access.tasks.none')}</option>
                      <option value="my">{t('access.tasks.my')}</option>
                      <option value="board">{t('access.tasks.assign')}</option>
                      <option value="manage">{t('access.tasks.manage')}</option>
                    </select>
                  </label>
                  {effectiveTaskLevel === 'board' || effectiveTaskLevel === 'manage' ? (
                    <p className="text-[11px] text-stone-500">{t('access.tasks.assignHint')}</p>
                  ) : null}
                </div>
              ) : null}

              {brigades.length > 0 && editing.roleId !== 'employee' ? (
                <div className="block text-xs font-medium text-stone-500">
                  <span className="text-stone-700">{t('access.defaultBrigades')}</span>
                  <p className="mt-0.5 text-[11px] font-normal text-stone-400">
                    {t('access.defaultBrigadesHint')}
                  </p>
                  <div className="mt-2 flex max-h-28 flex-wrap gap-2 overflow-y-auto">
                    {brigades.map((b) => (
                      <label
                        key={b}
                        className="flex cursor-pointer items-center gap-1.5 rounded-sm border border-grid px-2 py-1 text-xs text-stone-700"
                      >
                        <input
                          type="checkbox"
                          checked={(editing.defaultBrigades ?? []).includes(b)}
                          onChange={() => toggleDefaultBrigade(b)}
                        />
                        {b}
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
              {!webMode ? (
                <label className="block text-xs font-medium text-stone-500">
                  {editing.id ? t('access.passwordOptional') : t('access.password')}
                  <input
                    type="password"
                    className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                    value={editing.password ?? ''}
                    onChange={(e) => setEditing({ ...editing, password: e.target.value })}
                    autoComplete="new-password"
                  />
                </label>
              ) : editing.id ? null : editing.skipFirebaseCreate ? (
                <p className="rounded-sm border border-grid/80 bg-stone-50/80 px-3 py-2 text-[11px] text-stone-500">
                  {t('access.linkExistingHint')}
                </p>
              ) : (
                <label className="block text-xs font-medium text-stone-500">
                  {t('access.passwordFirebase')}
                  <input
                    type="password"
                    className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                    value={editing.password ?? ''}
                    onChange={(e) => setEditing({ ...editing, password: e.target.value })}
                    autoComplete="new-password"
                  />
                  <span className="mt-1 block text-[11px] text-stone-400">
                    {t('access.passwordFirebaseOneTimeHint')}
                  </span>
                </label>
              )}
              {webMode && editing.id ? (
                <div className="rounded-sm border border-amber-200/80 bg-amber-50/50 p-3">
                  <p className="text-xs font-medium text-stone-700">{t('access.passwordResetOneTime')}</p>
                  <p className="mt-0.5 text-[11px] text-stone-500">{t('access.passwordResetOneTimeHint')}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <input
                      type="text"
                      className="min-w-0 flex-1 rounded-sm border border-grid px-3 py-2 font-mono text-sm"
                      value={editing.password ?? ''}
                      onChange={(e) => setEditing({ ...editing, password: e.target.value })}
                      autoComplete="off"
                      placeholder={t('access.passwordReset')}
                    />
                    <button
                      type="button"
                      className="rounded-sm border border-grid bg-white px-3 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-50"
                      onClick={() =>
                        setEditing({ ...editing, password: generateOneTimePassword() })
                      }
                    >
                      {t('access.generatePassword')}
                    </button>
                  </div>
                </div>
              ) : null}
              {editing.roleId !== 'employee' ? (
                <div className="rounded-sm border border-grid/80 bg-stone-50/80 p-3">
                  <p className="text-xs font-medium text-stone-600">{t('access.userViewsTitle')}</p>
                  <p className="mt-0.5 text-[11px] text-stone-400">{t('access.userViewsHint')}</p>
                  <div className="mt-3 space-y-3">
                    {VIEW_GROUPS.map((group) => (
                      <div key={group.id}>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                          {t(group.labelKey)}
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                          {group.views.map((view) => (
                            <label
                              key={view}
                              className="inline-flex items-center gap-1.5 text-xs"
                            >
                              <input
                                type="checkbox"
                                checked={editingEffectiveViews().includes(view)}
                                onChange={() => toggleUserView(view)}
                              />
                              {t(VIEW_LABEL_KEYS[view])}
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 rounded-sm border border-dashed border-teal-200/80 bg-teal-50/40 p-2.5">
                    <p className="text-xs font-medium text-teal-900">
                      {t('access.userDirectoriesTitle')}
                    </p>
                    <p className="mt-0.5 text-[11px] text-stone-500">
                      {t('access.userDirectoriesHint')}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                      {DIRECTORY_SECTIONS.map((tab) => (
                        <label
                          key={tab.id}
                          className="inline-flex items-center gap-1.5 text-xs"
                        >
                          <input
                            type="checkbox"
                            checked={editingEffectiveDirectorySections().includes(tab.id)}
                            onChange={() => toggleUserDirectorySection(tab.id)}
                          />
                          {t(tab.labelKey)}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="rounded-sm border border-grid/80 bg-stone-50/80 px-3 py-2 text-[11px] text-stone-500">
                  {t('access.userViewsEmployeeOnly')}
                </p>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editing.active}
                  onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
                  disabled={editing.id === currentUser.id}
                />
                {t('access.active')}
              </label>
            </div>
            <div className="app-dialog-footer flex shrink-0 items-center justify-between gap-2 border-t border-grid bg-stone-50 px-5 pt-3">
              {editing.id && canDeleteLogin(editing.login) ? (
                <button
                  type="button"
                  className="text-sm text-red-600"
                  onClick={() =>
                    void removeUserRow({
                      id: editing.id!,
                      login: editing.login,
                      inStore: !editing.id!.startsWith('import-'),
                      displayName: editing.displayName,
                      roleId: editing.roleId,
                      active: editing.active,
                      inFirebase: false,
                      assumedFirebase: false,
                      needsImport: editing.id!.startsWith('import-'),
                    })
                  }
                >
                  {t('counterparty.delete')}
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-sm border border-grid bg-white px-4 py-2 text-sm"
                  onClick={() => setEditing(null)}
                >
                  {t('planner.cancel')}
                </button>
                <button
                  type="button"
                  data-modal-primary
                  className="rounded-sm bg-accent px-4 py-2 text-sm font-semibold text-white"
                  onClick={() => void saveUser()}
                >
                  {t('planner.save')}
                </button>
              </div>
            </div>
        </ModalBackdrop>
      )}
    </section>
  )
}
