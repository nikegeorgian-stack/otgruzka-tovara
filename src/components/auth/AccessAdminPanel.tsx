import { useEffect, useMemo, useState } from 'react'
import { FormNotice } from '@/components/ui/FormNotice'
import { ModalBackdrop } from '@/components/ui/ModalBackdrop'
import { EmployeePicker } from '@/components/ui/EmployeePicker'
import { useI18n } from '@/context/I18nContext'
import { roleDescription, roleLabel, ACCESS_ROLES } from '@/lib/access/roles'
import { linkedEmployeeLabel } from '@/lib/access/userEmployee'
import { importRowToUpsertInput, buildWebUserListRows, storeUserFromRow, type WebUserListRow } from '@/lib/access/webUserList'
import { viewsForRole, viewsForUser } from '@/lib/access/permissions'
import { listFirebaseWebUsers } from '@/lib/cloud/webUserAdmin'
import type { AccessRoleId, AccessStore, AppUser } from '@/lib/access/types'
import { MANAGED_VIEWS, NEGATIVE_STOCK_ROLES, DOCUMENT_CANCEL_ROLES } from '@/lib/access/types'
import type { Employee, ViewId } from '@/lib/types'
import type { UpsertAppUserInput } from '@/store/slices/accessSlice'

type Props = {
  access: AccessStore
  employees: Employee[]
  brigades: string[]
  currentUser: AppUser
  webMode?: boolean
  onUpsertUser: (input: UpsertAppUserInput) => Promise<{ allowlistSyncFailed?: boolean }>
  onRemoveUser: (id: string) => void
  onSetRoleViews: (roleId: AccessRoleId, views: ViewId[]) => void
  onSetRoleAllowNegativeStock: (roleId: AccessRoleId, allowed: boolean) => void
  onSetRoleAllowDocumentCancel: (roleId: AccessRoleId, allowed: boolean) => void
}

type Tab = 'users' | 'interfaces'

const VIEW_LABEL_KEYS: Record<ViewId, string> = {
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
  mixer: 'nav.mixer',
  director: 'nav.director',
  journals: 'nav.journals',
  it: 'nav.it',
}

export function AccessAdminPanel({
  access,
  employees,
  brigades,
  currentUser,
  webMode = false,
  onUpsertUser,
  onRemoveUser,
  onSetRoleViews,
  onSetRoleAllowNegativeStock,
  onSetRoleAllowDocumentCancel,
}: Props) {
  const { t, tf, locale } = useI18n()
  const [tab, setTab] = useState<Tab>('users')
  const [notice, setNotice] = useState<{ type: 'info' | 'error'; message: string } | null>(null)
  const [editing, setEditing] = useState<UpsertAppUserInput | null>(null)
  const [firebaseUsers, setFirebaseUsers] = useState<
    import('@/lib/cloud/webUserAdmin').FirebaseWebUserRecord[]
  >([])
  const [firebaseLoading, setFirebaseLoading] = useState(false)
  const [firebaseLoadError, setFirebaseLoadError] = useState(false)
  const [userListRefresh, setUserListRefresh] = useState(0)

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
      webViews: u.webViews,
      webAccount: u.webAccount,
      inFirebase: false,
      assumedFirebase: false,
      firebaseDisabled: false,
      needsImport: false,
      inStore: true,
    })) satisfies WebUserListRow[]
  }, [access, firebaseUsers, webMode])

  const editableRoles = ACCESS_ROLES.filter((r) => r.id !== 'sysadmin')

  function openEditRow(row: WebUserListRow) {
    const stored = storeUserFromRow(row)
    if (stored) {
      openEdit(stored)
      return
    }
    setEditing(importRowToUpsertInput(row))
  }

  function openNew() {
    setEditing({
      login: '',
      displayName: '',
      roleId: 'warehouse_keeper',
      password: '',
      active: true,
      employeeId: null,
      defaultBrigades: [],
      webViews: [],
    })
  }

  function openEdit(u: AppUser) {
    setEditing({
      id: u.id,
      login: u.login,
      displayName: u.displayName,
      roleId: u.roleId,
      active: u.active,
      employeeId: u.employeeId ?? null,
      defaultBrigades: u.defaultBrigades ? [...u.defaultBrigades] : [],
      webViews: u.webViews ? [...u.webViews] : [],
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

  function editingEffectiveViews(): ViewId[] {
    if (!editing) return []
    if (editing.webViews?.length) return editing.webViews
    return viewsForRole(access, editing.roleId)
  }

  function toggleUserView(view: ViewId) {
    if (!editing) return
    const current = editingEffectiveViews()
    const next = current.includes(view)
      ? current.filter((v) => v !== view)
      : [...current, view]
    setEditing({ ...editing, webViews: next })
  }

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
              firebase_email_exists: 'access.errFirebaseEmail',
              firebase_create_failed: 'access.errFirebaseCreate',
              firebase_unauthorized: 'access.errFirebaseAuth',
              firebase_update_failed: 'access.errFirebaseUpdate',
              allowlist_sync_failed: 'access.errAllowlistSync',
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

  return (
    <section className="rounded-sm border border-violet-200 bg-violet-50/30 p-5 shadow-sm">
      <h3 className="text-sm font-bold uppercase tracking-wide text-violet-900">
        {t('access.adminTitle')}
      </h3>
      <p className="mt-1 text-sm text-stone-600">
        {webMode ? t('access.adminHintWeb') : t('access.adminHint')}
      </p>

      {notice && (
        <div className="mt-3">
          <FormNotice
            type={notice.type}
            message={notice.message}
            onDismiss={() => setNotice(null)}
          />
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {(
          [
            ['users', 'access.tab.users'],
            ['interfaces', 'access.tab.interfaces'],
          ] as const
        ).map(([id, key]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-sm px-3 py-2 text-xs font-semibold ${
              tab === id ? 'bg-accent text-white' : 'text-stone-600 hover:bg-white'
            }`}
          >
            {t(key)}
          </button>
        ))}
      </div>

      {tab === 'users' && (
        <div className="mt-4 space-y-4">
          {webMode && firebaseLoadError ? (
            <FormNotice type="info" message={t('access.firebaseListOptional')} />
          ) : null}
          {webMode && firebaseLoading ? (
            <p className="text-xs text-stone-500">{t('access.firebaseListLoading')}</p>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {webMode ? (
              <p className="text-xs text-stone-500">
                {tf('access.usersCount', { n: String(userRows.length) })}
              </p>
            ) : (
              <span />
            )}
            <button type="button" className="btn-add" onClick={openNew}>
              {t('access.addUser')}
            </button>
          </div>
          <div className="overflow-x-auto rounded-sm border border-grid bg-white">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-stone-50 text-left text-xs uppercase text-stone-500">
                <tr>
                  <th className="px-4 py-3">{t('access.col.name')}</th>
                  <th className="px-4 py-3">{webMode ? t('access.col.email') : t('access.col.login')}</th>
                  <th className="px-4 py-3">{t('access.col.employee')}</th>
                  <th className="px-4 py-3">{t('access.col.role')}</th>
                  {webMode ? <th className="px-4 py-3">{t('access.col.views')}</th> : null}
                  <th className="px-4 py-3">{t('access.col.status')}</th>
                  {webMode ? <th className="px-4 py-3">{t('access.col.program')}</th> : null}
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {userRows.length === 0 ? (
                  <tr>
                    <td colSpan={webMode ? 8 : 6} className="px-4 py-6 text-center text-stone-400">
                      {t('access.noUsers')}
                    </td>
                  </tr>
                ) : (
                  userRows.map((row) => {
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
                          createdAt: '',
                          updatedAt: '',
                        }).length
                      : viewsForRole(access, row.roleId).length
                    return (
                      <tr
                        key={row.id}
                        className={`border-t border-grid/60 ${row.needsImport ? 'bg-amber-50/60' : ''}`}
                      >
                        <td className="px-4 py-3 font-medium">{row.displayName}</td>
                        <td className="px-4 py-3 font-mono text-xs">{row.login}</td>
                        <td className="px-4 py-3 text-stone-600">
                          {row.employeeId
                            ? linkedEmployeeLabel(
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
                            : (
                              <span className="text-stone-400">—</span>
                            )}
                        </td>
                        <td className="px-4 py-3">{roleLabel(row.roleId, locale)}</td>
                        {webMode ? (
                          <td className="px-4 py-3 text-xs text-stone-600">{viewCount}</td>
                        ) : null}
                        <td className="px-4 py-3">
                          {!row.active || row.firebaseDisabled ? (
                            <span className="text-stone-400">{t('access.inactive')}</span>
                          ) : (
                            <span className="text-emerald-700">{t('access.active')}</span>
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
                          <button
                            type="button"
                            className="text-sm font-medium text-accent hover:underline"
                            onClick={() => openEditRow(row)}
                          >
                            {row.needsImport ? t('access.linkUser') : t('counterparty.open')}
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'interfaces' && (
        <div className="mt-4 overflow-x-auto rounded-sm border border-grid bg-white">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase text-stone-500">
              <tr>
                <th className="px-3 py-3">{t('access.col.role')}</th>
                <th className="px-2 py-3 text-center" title={t('access.negativeStockHint')}>
                  {t('access.col.negativeStock')}
                </th>
                <th className="px-2 py-3 text-center" title={t('access.documentCancelHint')}>
                  {t('access.col.documentCancel')}
                </th>
                {MANAGED_VIEWS.map((view) => (
                  <th key={view} className="px-2 py-3 text-center">
                    {t(VIEW_LABEL_KEYS[view])}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {editableRoles.map((role) => (
                <tr key={role.id} className="border-t border-grid/60">
                  <td className="px-3 py-3">
                    <p className="font-medium">{roleLabel(role.id, locale)}</p>
                    <p className="text-[10px] text-stone-400">
                      {roleDescription(role.id, locale)}
                    </p>
                  </td>
                  <td className="px-2 py-3 text-center">
                    {NEGATIVE_STOCK_ROLES.includes(role.id) ? (
                      <input
                        type="checkbox"
                        checked={access.roleAllowNegativeStock?.[role.id] === true}
                        onChange={(e) =>
                          onSetRoleAllowNegativeStock(role.id, e.target.checked)
                        }
                        aria-label={`${roleLabel(role.id, locale)} · ${t('access.col.negativeStock')}`}
                      />
                    ) : (
                      <span className="text-stone-300">—</span>
                    )}
                  </td>
                  <td className="px-2 py-3 text-center">
                    {DOCUMENT_CANCEL_ROLES.includes(role.id) ? (
                      <input
                        type="checkbox"
                        checked={access.roleAllowDocumentCancel?.[role.id] === true}
                        onChange={(e) =>
                          onSetRoleAllowDocumentCancel(role.id, e.target.checked)
                        }
                        aria-label={`${roleLabel(role.id, locale)} · ${t('access.col.documentCancel')}`}
                      />
                    ) : (
                      <span className="text-stone-300">—</span>
                    )}
                  </td>
                  {MANAGED_VIEWS.map((view) => {
                    const checked = access.roleViews[role.id]?.includes(view) ?? false
                    return (
                      <td key={view} className="px-2 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleRoleView(role.id, view)}
                          aria-label={`${roleLabel(role.id, locale)} · ${t(VIEW_LABEL_KEYS[view])}`}
                        />
                      </td>
                    )
                  })}
                </tr>
              ))}
              <tr className="border-t border-grid/60 bg-stone-50/80">
                <td className="px-3 py-3 font-medium">{roleLabel('sysadmin', locale)}</td>
                <td className="px-2 py-3 text-center text-xs text-stone-500">✓</td>
                <td className="px-2 py-3 text-center text-xs text-stone-500">✓</td>
                <td colSpan={MANAGED_VIEWS.length} className="px-3 py-3 text-xs text-stone-500">
                  {t('access.sysadminAll')}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ModalBackdrop
          open
          onClose={() => setEditing(null)}
          className="fixed inset-0 flex items-center justify-center bg-black/40 p-4"
          panelClassName="w-full max-w-md rounded-sm border border-grid bg-white p-5 shadow-sm"
        >
            <h4 className="text-lg font-bold text-ink">
              {editing.id
                ? t('access.editUser')
                : editing.skipFirebaseCreate
                  ? t('access.setupUser')
                  : t('access.newUser')}
            </h4>
            <div className="mt-4 space-y-3">
              <label className="block text-xs font-medium text-stone-500">
                {t('access.col.name')}
                <input
                  className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                  value={editing.displayName}
                  onChange={(e) => setEditing({ ...editing, displayName: e.target.value })}
                />
              </label>
              <label className="block text-xs font-medium text-stone-500">
                {webMode ? t('access.col.email') : t('access.col.login')}
                <input
                  className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                  value={editing.login}
                  onChange={(e) => setEditing({ ...editing, login: e.target.value })}
                  disabled={!!editing.id || !!editing.skipFirebaseCreate}
                  type={webMode ? 'email' : 'text'}
                  autoComplete="off"
                />
              </label>
              <label className="block text-xs font-medium text-stone-500">
                {t('access.col.employee')}
                <div className="mt-1">
                  <EmployeePicker
                    employees={activeEmployees}
                    value={editing.employeeId ?? null}
                    placeholder={t('access.employeePlaceholder')}
                    onChange={(id) => setEditing({ ...editing, employeeId: id })}
                  />
                </div>
                <p className="mt-1 text-[11px] text-stone-400">{t('access.employeeHint')}</p>
              </label>
              <label className="block text-xs font-medium text-stone-500">
                {t('access.col.role')}
                <select
                  className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                  value={editing.roleId}
                  onChange={(e) =>
                    setEditing({ ...editing, roleId: e.target.value as AccessRoleId })
                  }
                  disabled={editing.id === currentUser.id}
                >
                  {ACCESS_ROLES.map((r) => (
                    <option key={r.id} value={r.id}>
                      {roleLabel(r.id, locale)}
                    </option>
                  ))}
                </select>
              </label>
              {brigades.length > 0 ? (
                <div className="block text-xs font-medium text-stone-500">
                  {t('access.defaultBrigades')}
                  <div className="mt-2 flex flex-wrap gap-2">
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
                  <p className="mt-1 text-[11px] text-stone-400">
                    {t('access.defaultBrigadesHint')}
                  </p>
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
                    {t('access.passwordFirebaseHint')}
                  </span>
                </label>
              )}
              {webMode && editing.roleId !== 'sysadmin' ? (
                <div className="rounded-sm border border-grid/80 bg-stone-50/80 p-3">
                  <p className="text-xs font-medium text-stone-600">{t('access.userViewsTitle')}</p>
                  <p className="mt-0.5 text-[11px] text-stone-400">{t('access.userViewsHint')}</p>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                    {MANAGED_VIEWS.filter((v) => v !== 'settings').map((view) => (
                      <label key={view} className="inline-flex items-center gap-1.5 text-xs">
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
              ) : null}
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
            <div className="mt-5 flex justify-between gap-2 border-t border-grid pt-4">
              {editing.id && editing.id !== currentUser.id ? (
                <button
                  type="button"
                  className="text-sm text-red-600"
                  onClick={() => {
                    try {
                      onRemoveUser(editing.id!)
                      setEditing(null)
                      setNotice({ type: 'info', message: t('access.userRemoved') })
                    } catch {
                      setNotice({ type: 'error', message: t('access.errCannotRemove') })
                    }
                  }}
                >
                  {t('counterparty.delete')}
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-sm border border-grid px-4 py-2 text-sm"
                  onClick={() => setEditing(null)}
                >
                  {t('planner.cancel')}
                </button>
                <button
                  type="button"
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
