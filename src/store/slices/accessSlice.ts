import { normalizeAccessStore } from '@/lib/access/init'
import { hashPassword } from '@/lib/access/password'
import type { AccessRoleId, AccessUserGroup, AppUser } from '@/lib/access/types'
import { SYSTEM_ADMIN_USER_ID } from '@/lib/access/types'
import { sanitizeDirectorySections } from '@/lib/directories/access'
import type { DirectorySection } from '@/lib/directories/types'
import {
  isValidCoverageDate,
  nextWorkshopMasterCoverageNumber,
  normalizeWorkshopMasterCoverage,
  resolveAbsentMasterBrigades,
} from '@/lib/access/workshopMasterCoverage'
import { appendAudit } from '@/lib/audit'
import {
  clearMustChangePasswordClaim,
  createFirebaseWebUser,
  updateFirebaseWebUser,
} from '@/lib/cloud/webUserAdmin'
import { beginAuthUserDeletion } from '@/lib/cloud/externalEffects/processor'
import { assertExternalDeletionRuntime } from '@/lib/cloud/externalEffects/runtime'
import { syncWebAccessAllowlistFromStore } from '@/lib/cloud/webAccessConfig'
import { isKnownWebFirebaseEmail } from '@/lib/cloud/fstWebUsers'
import { getFirebaseAuth } from '@/lib/cloud/firebase'
import { updatePassword } from 'firebase/auth'
import type { UserViewDefaults } from '@/lib/viewDefaults/types'
import { mergeUserViewDefaults } from '@/lib/viewDefaults/types'
import type { AppStore, ViewId } from '@/lib/types'
import type { StoreSliceDeps } from '../storeApi'
import { actorFromGetter, recordSliceExplicitDelete } from '@/lib/cloud/explicitDeleteHelper'
import { actorAuditFields } from './actorAuditFields'

export type UpsertAppUserInput = {
  id?: string
  login: string
  displayName: string
  roleId: AccessRoleId
  password?: string
  active: boolean
  employeeId?: string | null
  defaultBrigades?: string[]
  webViews?: ViewId[]
  /** Индивидуальные вкладки справочников; пустой / не передан — наследовать с роли */
  directorySections?: import('@/lib/directories/types').DirectorySection[]
  /** Индивидуальный уровень табеля; null — сбросить (наследовать с роли) */
  timesheetLevel?: 'none' | 'view' | 'edit' | null
  /** Индивидуальный уровень задач; null — наследовать с роли */
  taskAccessLevel?: import('@/lib/tasks/types').TaskAccessLevel | null
  /** null — сбросить персональный список (наследовать) */
  timesheetViewBrigades?: string[] | null
  timesheetEditBrigades?: string[] | null
  /** Учётка уже есть в Firebase — только привязать в store */
  skipFirebaseCreate?: boolean
}

const isWebApp = import.meta.env.VITE_FST_WEB === 'true'

export function createAccessSlice({ setStore, getStore, getActor }: StoreSliceDeps) {
  const who = () => actorAuditFields(getActor)

  async function removeWebUser(input: { id: string; login: string; inStore: boolean }) {
    const login = input.login.trim().toLowerCase()
    if (!login) throw new Error('login_required')

    if (input.inStore && !input.id.startsWith('import-')) {
      // Fail-closed: Phase A only on web (processor lives in FstSqlConnectSync).
      assertExternalDeletionRuntime()
      if (input.id === SYSTEM_ADMIN_USER_ID) throw new Error('cannot_remove_sysadmin')
      const access = normalizeAccessStore(getStore().access)
      const target = access.users.find((u) => u.id === input.id)
      if (!target) throw new Error('user_not_found')
      if (target.pendingDeletion) return
      if (target.roleId === 'sysadmin') {
        const admins = access.users.filter(
          (u) => u.roleId === 'sysadmin' && u.active && u.id !== input.id && !u.pendingDeletion,
        )
        if (admins.length === 0) throw new Error('last_sysadmin')
      }
      const actor = who()
      setStore((s) => {
        const acc = normalizeAccessStore(s.access)
        const t = acc.users.find((u) => u.id === input.id)
        if (!t || t.pendingDeletion) return s
        const begun = beginAuthUserDeletion(s, {
          userId: input.id,
          email: login,
          requestedBy: actor.by,
          requestedByName: actor.byName,
        })
        return appendAudit(begun.store, {
          action: 'user_remove',
          detail: `[pending] ${t.displayName} (${t.login}) · ${t.roleId}`,
          ...actor,
        })
      })
    }
  }

  return {
    async upsertAppUser(input: UpsertAppUserInput): Promise<{ allowlistSyncFailed?: boolean }> {
      const login = input.login.trim().toLowerCase()
      if (!login) throw new Error('login_required')
      const now = new Date().toISOString()
      const s = getStore()
      const access = normalizeAccessStore(s.access)
      const existing = input.id ? access.users.find((u) => u.id === input.id) : undefined
      const dup = access.users.find((u) => u.login === login && u.id !== input.id)
      if (dup) throw new Error('login_taken')

      if (
        existing?.roleId === 'sysadmin' &&
        input.roleId !== 'sysadmin' &&
        existing.active &&
        input.active !== false
      ) {
        const admins = access.users.filter(
          (u) => u.roleId === 'sysadmin' && u.active && u.id !== existing.id,
        )
        if (admins.length === 0) throw new Error('last_sysadmin')
      }

      let passwordHash = existing?.passwordHash ?? ''
      let passwordSalt = existing?.passwordSalt ?? ''
      if (isWebApp) {
        const skipFirebase =
          input.skipFirebaseCreate === true || isKnownWebFirebaseEmail(login)
        if (!existing && !input.password?.trim() && !skipFirebase) {
          throw new Error('password_required')
        }
        passwordHash = ''
        passwordSalt = ''
      } else if (input.password?.trim()) {
        const hashed = await hashPassword(input.password.trim())
        passwordHash = hashed.hash
        passwordSalt = hashed.salt
      } else if (!existing) {
        throw new Error('password_required')
      }

      const employeeId = input.employeeId?.trim() || undefined
      const defaultBrigades =
        input.defaultBrigades?.filter((b) => b.trim()).length
          ? input.defaultBrigades.filter((b) => b.trim())
          : undefined
      const webViews =
        input.roleId === 'employee'
          ? undefined
          : input.webViews && input.webViews.length > 0
            ? [...new Set(input.webViews)]
            : undefined
      const directorySections =
        input.roleId === 'employee'
          ? undefined
          : (() => {
              if (input.directorySections === undefined) return existing?.directorySections
              const sections = sanitizeDirectorySections(input.directorySections)
              return sections && sections.length > 0 ? sections : undefined
            })()
      const password = input.password?.trim()
      if (password && password.length < 8) throw new Error('password_too_short')
      const settingTempPassword = Boolean(password)

      const timesheetLevel =
        input.roleId === 'employee'
          ? undefined
          : input.timesheetLevel === null
            ? undefined
            : input.timesheetLevel === 'none' ||
                input.timesheetLevel === 'view' ||
                input.timesheetLevel === 'edit'
              ? input.timesheetLevel
              : existing?.timesheetLevel
      const timesheetViewBrigades =
        input.roleId === 'employee'
          ? undefined
          : input.timesheetViewBrigades === null
            ? undefined
            : Array.isArray(input.timesheetViewBrigades)
              ? input.timesheetViewBrigades.filter((b) => b.trim())
              : existing?.timesheetViewBrigades
      const timesheetEditBrigades =
        input.roleId === 'employee'
          ? undefined
          : input.timesheetEditBrigades === null
            ? undefined
            : Array.isArray(input.timesheetEditBrigades)
              ? input.timesheetEditBrigades.filter((b) => b.trim())
              : existing?.timesheetEditBrigades

      const taskAccessLevel =
        input.taskAccessLevel === null
          ? undefined
          : input.taskAccessLevel === 'none' ||
              input.taskAccessLevel === 'my' ||
              input.taskAccessLevel === 'board' ||
              input.taskAccessLevel === 'manage'
            ? input.taskAccessLevel
            : existing?.taskAccessLevel

      let resolvedViews = webViews
      if (
        input.roleId !== 'employee' &&
        (timesheetLevel === 'view' || timesheetLevel === 'edit') &&
        resolvedViews &&
        !resolvedViews.includes('month')
      ) {
        resolvedViews = [...resolvedViews, 'month']
      }
      if (
        input.roleId !== 'employee' &&
        directorySections &&
        directorySections.length > 0
      ) {
        if (resolvedViews && !resolvedViews.includes('directories')) {
          resolvedViews = [...resolvedViews, 'directories']
        }
      }
      if (
        taskAccessLevel &&
        taskAccessLevel !== 'none' &&
        resolvedViews &&
        !resolvedViews.includes('tasks')
      ) {
        resolvedViews = [...resolvedViews, 'tasks']
      }

      const user: AppUser = {
        id: existing?.id ?? crypto.randomUUID(),
        login,
        displayName: input.displayName.trim() || login,
        roleId: input.roleId,
        passwordHash,
        passwordSalt,
        active: input.active,
        employeeId,
        defaultBrigades,
        webAccount: isWebApp ? true : existing?.webAccount,
        webViews: resolvedViews,
        directorySections,
        timesheetLevel,
        timesheetViewBrigades,
        timesheetEditBrigades,
        taskAccessLevel,
        mustChangePassword: settingTempPassword
          ? true
          : existing?.mustChangePassword,
        // Галочки «мои бригады» = ACL и дефолт фильтра табеля.
        viewDefaults: mergeUserViewDefaults(existing?.viewDefaults, 'month', {
          defaultBrigades: defaultBrigades ?? [],
        }),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }

      if (isWebApp) {
        const skipFirebaseWithoutPassword =
          !password &&
          (input.skipFirebaseCreate === true || isKnownWebFirebaseEmail(login))

        if (!existing && !password && !skipFirebaseWithoutPassword) {
          throw new Error('password_required')
        }

        if (password) {
          const patch: Parameters<typeof updateFirebaseWebUser>[0] = {
            email: login,
            password,
            mustChangePassword: true,
            displayName: user.displayName,
            roleId: user.roleId,
          }
          if (existing && input.active !== existing.active) {
            patch.disabled = !input.active
          } else if (!existing) {
            patch.disabled = !input.active
          }
          const updated = await updateFirebaseWebUser(patch)
          if (!updated.ok) {
            if (updated.error === 'unauthorized') throw new Error('firebase_unauthorized')
            if (updated.error === 'password_too_short') throw new Error('password_too_short')
            if (updated.error === 'email_exists') {
              const retry = await updateFirebaseWebUser(patch)
              if (!retry.ok) throw new Error('firebase_update_failed')
            } else if (updated.error === 'user_not_found') {
              const created = await createFirebaseWebUser({
                email: login,
                password: password!,
                displayName: user.displayName,
              })
              if (!created.ok) {
                if (created.error === 'email_exists') {
                  const retry = await updateFirebaseWebUser(patch)
                  if (!retry.ok) throw new Error('firebase_update_failed')
                } else if (created.error === 'unauthorized') {
                  throw new Error('firebase_unauthorized')
                } else {
                  throw new Error('firebase_create_failed')
                }
              }
            } else {
              throw new Error('firebase_update_failed')
            }
          }
        } else if (existing) {
          const patch: Parameters<typeof updateFirebaseWebUser>[0] = {
            email: login,
            roleId: user.roleId,
          }
          if (input.active !== existing.active) patch.disabled = !input.active
          if (user.displayName !== existing.displayName) patch.displayName = user.displayName
          if (
            patch.disabled !== undefined ||
            patch.displayName ||
            existing.roleId !== user.roleId
          ) {
            const updated = await updateFirebaseWebUser(patch)
            if (!updated.ok) {
              if (updated.error === 'user_not_found') {
                /* только store — Firebase ещё не создан */
              } else if (updated.error === 'unauthorized') {
                throw new Error('firebase_unauthorized')
              } else {
                throw new Error('firebase_update_failed')
              }
            }
          }
        }
      }

      setStore((prev) => {
        const acc = normalizeAccessStore(prev.access)
        let users = existing
          ? acc.users.map((u) => (u.id === user.id ? user : u))
          : [...acc.users, user]
        if (employeeId) {
          users = users.map((u) =>
            u.id !== user.id && u.employeeId === employeeId
              ? { ...u, employeeId: undefined, updatedAt: now }
              : u,
          )
        }
        let next = { ...prev, access: { ...acc, users } }
        if (existing) {
          const changes: string[] = []
          if (existing.roleId !== user.roleId) {
            changes.push(`роль: ${existing.roleId} → ${user.roleId}`)
          }
          if (existing.active !== user.active) {
            changes.push(user.active ? 'активирован' : 'деактивирован')
          }
          if (existing.displayName !== user.displayName) {
            changes.push(`имя: ${existing.displayName} → ${user.displayName}`)
          }
          next = appendAudit(next, {
            action: 'user_upsert',
            detail: `${user.displayName} (${login}) · ${changes.join(' · ') || 'изменён'}`,
            ...who(),
          })
        } else {
          next = appendAudit(next, {
            action: 'user_upsert',
            detail: `Создан: ${user.displayName} (${login}) · ${user.roleId}`,
            ...who(),
          })
        }
        return next
      })

      let allowlistSyncFailed = false
      if (isWebApp) {
        try {
          await syncWebAccessAllowlistFromStore(getStore().access)
        } catch (err) {
          console.error('FST: sync web access allowlist failed', err)
          allowlistSyncFailed = true
        }
      }
      return { allowlistSyncFailed: allowlistSyncFailed || undefined }
    },

    updateUserViewDefaults<K extends keyof UserViewDefaults>(
      userId: string,
      viewId: K,
      patch: NonNullable<UserViewDefaults[K]>,
    ) {
      const now = new Date().toISOString()
      setStore((s) => {
        const access = normalizeAccessStore(s.access)
        const users = access.users.map((u) => {
          if (u.id !== userId) return u
          const viewDefaults = mergeUserViewDefaults(u.viewDefaults, viewId, patch)
          return {
            ...u,
            viewDefaults,
            updatedAt: now,
          }
        })
        return { ...s, access: { ...access, users } }
      })
    },

    async removeAppUser(id: string) {
      const access = normalizeAccessStore(getStore().access)
      const target = access.users.find((u) => u.id === id)
      if (!target) throw new Error('user_not_found')
      await removeWebUser({ id, login: target.login, inStore: true })
    },

    removeWebUser,

    setRoleViews(roleId: AccessRoleId, views: ViewId[]) {
      if (roleId === 'sysadmin') return
      setStore((s) => {
        const access = normalizeAccessStore(s.access)
        const nextViews = [...new Set(views)]
        let next = {
          ...s,
          access: {
            ...access,
            roleViews: {
              ...access.roleViews,
              [roleId]: nextViews,
            },
          },
        }
        next = appendAudit(next, {
          action: 'role_views',
          detail: `${roleId}: ${nextViews.join(', ') || '—'}`,
          ...who(),
        })
        return next
      })
    },

    setRoleDirectorySections(
      roleId: AccessRoleId,
      sections: DirectorySection[] | null,
    ) {
      if (roleId === 'sysadmin') return
      setStore((s) => {
        const access = normalizeAccessStore(s.access)
        const roleDirectorySections = { ...(access.roleDirectorySections ?? {}) }
        if (sections === null) {
          delete roleDirectorySections[roleId]
        } else {
          roleDirectorySections[roleId] = sanitizeDirectorySections(sections) ?? []
        }
        const cleaned = sections === null ? null : roleDirectorySections[roleId]
        let next: AppStore = {
          ...s,
          access: {
            ...access,
            roleDirectorySections:
              Object.keys(roleDirectorySections).length > 0
                ? roleDirectorySections
                : undefined,
          },
        }
        next = appendAudit(next, {
          action: 'role_views',
          detail:
            cleaned === null
              ? `${roleId} directories: default`
              : `${roleId} directories: ${(cleaned ?? []).join(', ') || '—'}`,
          ...who(),
        })
        return next
      })
    },

    setRoleAllowNegativeStock(roleId: AccessRoleId, allowed: boolean) {
      if (roleId === 'sysadmin') return
      setStore((s) => {
        const access = normalizeAccessStore(s.access)
        const next = { ...(access.roleAllowNegativeStock ?? {}) }
        if (allowed) next[roleId] = true
        else delete next[roleId]
        return {
          ...s,
          access: {
            ...access,
            roleAllowNegativeStock: next,
          },
        }
      })
    },

    setRoleAllowDocumentCancel(roleId: AccessRoleId, allowed: boolean) {
      if (roleId === 'sysadmin') return
      setStore((s) => {
        const access = normalizeAccessStore(s.access)
        const next = { ...(access.roleAllowDocumentCancel ?? {}) }
        if (allowed) next[roleId] = true
        else delete next[roleId]
        return {
          ...s,
          access: {
            ...access,
            roleAllowDocumentCancel: next,
          },
        }
      })
    },

    setRoleAllowRecipeApproval(roleId: AccessRoleId, allowed: boolean) {
      if (roleId === 'sysadmin' || roleId === 'operations_director') return
      setStore((s) => {
        const access = normalizeAccessStore(s.access)
        const next = { ...(access.roleAllowRecipeApproval ?? {}) }
        if (allowed) next[roleId] = true
        else delete next[roleId]
        return {
          ...s,
          access: {
            ...access,
            roleAllowRecipeApproval: next,
          },
        }
      })
    },

    setRoleTimesheetAccess(roleId: AccessRoleId, level: 'none' | 'view' | 'edit') {
      if (roleId === 'sysadmin') return
      setStore((s) => {
        const access = normalizeAccessStore(s.access)
        const next = { ...(access.roleTimesheetAccess ?? {}) }
        next[roleId] = level
        const roleViews = { ...access.roleViews }
        const views = [...(roleViews[roleId] ?? [])]
        if (level === 'none') {
          roleViews[roleId] = views.filter((v) => v !== 'month')
        } else if (!views.includes('month')) {
          roleViews[roleId] = [...views, 'month']
        }
        return appendAudit(
          {
            ...s,
            access: {
              ...access,
              roleTimesheetAccess: next,
              roleViews,
            },
          },
          {
            action: 'role_timesheet',
            detail: `${roleId}: ${level}`,
            ...who(),
          },
        )
      })
    },

    setRoleTaskAccess(
      roleId: AccessRoleId,
      level: import('@/lib/tasks/types').TaskAccessLevel,
    ) {
      if (roleId === 'sysadmin') return
      setStore((s) => {
        const access = normalizeAccessStore(s.access)
        const next = { ...(access.roleTaskAccess ?? {}) }
        next[roleId] = level
        const roleViews = { ...access.roleViews }
        const views = [...(roleViews[roleId] ?? [])]
        if (level === 'none') {
          roleViews[roleId] = views.filter((v) => v !== 'tasks')
        } else if (!views.includes('tasks')) {
          roleViews[roleId] = [...views, 'tasks']
        }
        return appendAudit(
          {
            ...s,
            access: {
              ...access,
              roleTaskAccess: next,
              roleViews,
            },
          },
          {
            action: 'role_tasks',
            detail: `${roleId}: ${level}`,
            ...who(),
          },
        )
      })
    },

    async completeWebPasswordChange(newPassword: string): Promise<void> {
      const trimmed = newPassword.trim()
      if (trimmed.length < 8) throw new Error('password_too_short')
      const auth = getFirebaseAuth()
      const fbUser = auth.currentUser
      if (!fbUser?.email) throw new Error('not_authenticated')

      const login = fbUser.email.trim().toLowerCase()

      try {
        await updatePassword(fbUser, trimmed)
      } catch (err) {
        const code =
          err && typeof err === 'object' && 'code' in err
            ? String((err as { code?: string }).code)
            : ''
        if (code === 'auth/requires-recent-login') {
          throw new Error('requires_recent_login', { cause: err })
        }
        throw err
      }
      await fbUser.getIdToken(true)

      const cleared = await clearMustChangePasswordClaim()
      if (!cleared.ok) {
        console.warn('FST: clear mustChangePassword claim failed', cleared.error)
        throw new Error('clear_must_change_failed')
      }
      await fbUser.getIdToken(true)

      const now = new Date().toISOString()
      setStore((s) => {
        const access = normalizeAccessStore(s.access)
        const users = access.users.map((u) =>
          u.login === login ? { ...u, mustChangePassword: false, updatedAt: now } : u,
        )
        return { ...s, access: { ...access, users } }
      })
    },

    /** Пароль уже сменён, остался только claim — снять блокировку входа. */
    async clearWebMustChangePasswordFlag(): Promise<void> {
      const auth = getFirebaseAuth()
      const fbUser = auth.currentUser
      if (!fbUser?.email) throw new Error('not_authenticated')
      const login = fbUser.email.trim().toLowerCase()
      await fbUser.getIdToken(true)
      const cleared = await clearMustChangePasswordClaim()
      if (!cleared.ok) throw new Error('clear_must_change_failed')
      await fbUser.getIdToken(true)
      const now = new Date().toISOString()
      setStore((s) => {
        const access = normalizeAccessStore(s.access)
        const users = access.users.map((u) =>
          u.login === login ? { ...u, mustChangePassword: false, updatedAt: now } : u,
        )
        return { ...s, access: { ...access, users } }
      })
    },

    async setupInitialAdminPassword(password: string): Promise<void> {
      const trimmed = password.trim()
      if (trimmed.length < 8) throw new Error('password_too_short')
      const hashed = await hashPassword(trimmed)
      const now = new Date().toISOString()
      setStore((s) => {
        const access = normalizeAccessStore(s.access)
        const users = access.users.map((u) =>
          u.id === SYSTEM_ADMIN_USER_ID
            ? {
                ...u,
                passwordHash: hashed.hash,
                passwordSalt: hashed.salt,
                updatedAt: now,
              }
            : u,
        )
        return { ...s, access: { ...access, users } }
      })
    },

    upsertWorkshopMasterCoverage(input: {
      id?: string
      coverUserId: string
      absentUserId: string
      brigades?: string[]
      fromDate: string
      toDate: string
      note?: string
      /** Сохранить и сразу провести */
      post?: boolean
    }): void {
      const coverUserId = input.coverUserId.trim()
      const absentUserId = input.absentUserId.trim()
      const fromDate = input.fromDate.trim()
      const toDate = input.toDate.trim()
      if (!coverUserId || !absentUserId) throw new Error('coverage_users_required')
      if (coverUserId === absentUserId) throw new Error('coverage_same_user')
      if (!isValidCoverageDate(fromDate) || !isValidCoverageDate(toDate)) {
        throw new Error('coverage_dates_invalid')
      }
      if (fromDate > toDate) throw new Error('coverage_dates_order')

      const s0 = getStore()
      const access0 = normalizeAccessStore(s0.access)
      const cover = access0.users.find((u) => u.id === coverUserId)
      const absent = access0.users.find((u) => u.id === absentUserId)
      if (!cover || cover.roleId !== 'workshop_master' || !cover.active) {
        throw new Error('coverage_cover_invalid')
      }
      if (!absent || absent.roleId !== 'workshop_master' || !absent.active) {
        throw new Error('coverage_absent_invalid')
      }
      const brigadesRaw =
        input.brigades?.filter((b) => b.trim()) ??
        resolveAbsentMasterBrigades(s0, absent)
      const brigades = brigadesRaw.filter((b) => s0.brigades.includes(b))
      if (brigades.length === 0) throw new Error('coverage_brigades_empty')

      const af = who()
      const now = new Date().toISOString()
      const existing = input.id
        ? access0.workshopMasterCoverages?.find((c) => c.id === input.id)
        : undefined
      if (existing && existing.status === 'ended') {
        throw new Error('coverage_ended_locked')
      }
      const list0 = access0.workshopMasterCoverages ?? []
      const number =
        existing?.number ?? nextWorkshopMasterCoverageNumber(list0)
      const willPost = Boolean(input.post) || existing?.status === 'posted'
      const status = willPost ? 'posted' : 'draft'
      const isFirstPost =
        willPost && (!existing || existing.status !== 'posted' || !existing.postedAt)
      const normalized = normalizeWorkshopMasterCoverage({
        id: existing?.id ?? crypto.randomUUID(),
        number,
        status,
        coverUserId,
        absentUserId,
        brigades,
        fromDate,
        toDate,
        note: input.note?.trim() || undefined,
        createdBy: existing?.createdBy ?? af.by,
        createdByName: existing?.createdByName ?? af.byName,
        createdAt: existing?.createdAt ?? now,
        postedAt: willPost ? (isFirstPost ? now : existing?.postedAt ?? now) : undefined,
        postedBy: willPost
          ? isFirstPost
            ? af.by
            : existing?.postedBy ?? af.by
          : undefined,
        postedByName: willPost
          ? isFirstPost
            ? af.byName
            : existing?.postedByName ?? af.byName
          : undefined,
        endedAt: undefined,
      })
      if (!normalized) throw new Error('coverage_invalid')

      setStore((s) => {
        const access = normalizeAccessStore(s.access)
        const list = [...(access.workshopMasterCoverages ?? [])]
        const idx = list.findIndex((c) => c.id === normalized.id)
        if (idx >= 0) list[idx] = normalized
        else list.unshift(normalized)

        const verb =
          status === 'posted' && (!existing || existing.status === 'draft')
            ? 'Проведён'
            : status === 'posted'
              ? 'Изменён'
              : 'Черновик'
        return appendAudit(
          {
            ...s,
            access: { ...access, workshopMasterCoverages: list },
          },
          {
            action: 'master_coverage',
            month: fromDate.slice(0, 7),
            detail: `${verb} ${normalized.number}: ${cover.displayName} ← ${absent.displayName} · ${fromDate}…${toDate} · ${brigades.join(', ')}`,
            ...af,
          },
        )
      })
    },

    postWorkshopMasterCoverage(coverageId: string): void {
      const id = coverageId.trim()
      if (!id) throw new Error('coverage_id_required')
      const s0 = getStore()
      const access0 = normalizeAccessStore(s0.access)
      const prev = access0.workshopMasterCoverages?.find((c) => c.id === id)
      if (!prev) throw new Error('coverage_not_found')
      if (prev.status === 'ended') throw new Error('coverage_ended_locked')
      if (prev.status === 'posted') return

      const af = who()
      const now = new Date().toISOString()
      const cover = access0.users.find((u) => u.id === prev.coverUserId)
      const absent = access0.users.find((u) => u.id === prev.absentUserId)
      const normalized = normalizeWorkshopMasterCoverage({
        ...prev,
        status: 'posted',
        postedAt: now,
        postedBy: af.by,
        postedByName: af.byName,
        endedAt: undefined,
      })
      if (!normalized) throw new Error('coverage_invalid')

      setStore((s) => {
        const access = normalizeAccessStore(s.access)
        const list = [...(access.workshopMasterCoverages ?? [])]
        const idx = list.findIndex((c) => c.id === id)
        if (idx < 0) return s
        list[idx] = normalized
        return appendAudit(
          {
            ...s,
            access: { ...access, workshopMasterCoverages: list },
          },
          {
            action: 'master_coverage',
            month: prev.fromDate.slice(0, 7),
            detail: `Проведён ${normalized.number}: ${cover?.displayName ?? prev.coverUserId} ← ${absent?.displayName ?? prev.absentUserId} · ${prev.fromDate}…${prev.toDate}`,
            ...af,
          },
        )
      })
    },

    endWorkshopMasterCoverage(coverageId: string): void {
      const id = coverageId.trim()
      if (!id) throw new Error('coverage_id_required')
      const s0 = getStore()
      const access0 = normalizeAccessStore(s0.access)
      const prev = access0.workshopMasterCoverages?.find((c) => c.id === id)
      if (!prev) throw new Error('coverage_not_found')
      if (prev.status === 'ended' || prev.endedAt) return
      if (prev.status === 'draft') {
        // черновик — удаляем из списка
        const af = who()
        setStore((s) => {
          const access = normalizeAccessStore(s.access)
          const list = (access.workshopMasterCoverages ?? []).filter((c) => c.id !== id)
          return appendAudit(
            {
              ...s,
              access: { ...access, workshopMasterCoverages: list },
            },
            {
              action: 'master_coverage',
              month: prev.fromDate.slice(0, 7),
              detail: `Удалён черновик ${prev.number}`,
              ...af,
            },
          )
        })
        return
      }

      const af = who()
      const now = new Date().toISOString()
      const cover = access0.users.find((u) => u.id === prev.coverUserId)
      const absent = access0.users.find((u) => u.id === prev.absentUserId)

      setStore((s) => {
        const access = normalizeAccessStore(s.access)
        const list = [...(access.workshopMasterCoverages ?? [])]
        const idx = list.findIndex((c) => c.id === id)
        if (idx < 0) return s
        const cur = list[idx]!
        if (cur.status === 'ended' || cur.endedAt) return s
        list[idx] = { ...cur, status: 'ended', endedAt: now }
        return appendAudit(
          {
            ...s,
            access: { ...access, workshopMasterCoverages: list },
          },
          {
            action: 'master_coverage',
            month: prev.fromDate.slice(0, 7),
            detail: `Снят ${prev.number}: ${cover?.displayName ?? prev.coverUserId} ← ${absent?.displayName ?? prev.absentUserId} · ${prev.fromDate}…${prev.toDate}`,
            ...af,
          },
        )
      })
    },

    upsertUserGroup(input: {
      id?: string
      name: string
      note?: string
      userIds?: string[]
    }): void {
      const name = input.name.trim()
      if (!name) throw new Error('group_name_required')
      const now = new Date().toISOString()
      const af = who()
      setStore((s) => {
        const access = normalizeAccessStore(s.access)
        const known = new Set(access.users.map((u) => u.id))
        const userIds = [
          ...new Set((input.userIds ?? []).filter((id) => known.has(id))),
        ]
        const list = [...(access.userGroups ?? [])]
        const existing = input.id ? list.find((g) => g.id === input.id) : undefined
        const group: AccessUserGroup = {
          id: existing?.id ?? crypto.randomUUID(),
          name,
          note: input.note?.trim() || undefined,
          userIds,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        }
        const idx = list.findIndex((g) => g.id === group.id)
        if (idx >= 0) list[idx] = group
        else list.push(group)
        return appendAudit(
          { ...s, access: { ...access, userGroups: list } },
          {
            action: 'access_user_group',
            detail: `${existing ? 'Группа' : 'Новая группа'}: ${name} · ${userIds.length} уч.`,
            ...af,
          },
        )
      })
    },

    removeUserGroup(groupId: string): void {
      const id = groupId.trim()
      if (!id) return
      const access = normalizeAccessStore(getStore().access)
      const prev = access.userGroups?.find((g) => g.id === id)
      if (!prev) return
      recordSliceExplicitDelete('access.userGroups', id, actorFromGetter(getActor))
      const af = who()
      setStore((s) => {
        const access = normalizeAccessStore(s.access)
        const prev = access.userGroups?.find((g) => g.id === id)
        if (!prev) return s
        const list = (access.userGroups ?? []).filter((g) => g.id !== id)
        return appendAudit(
          {
            ...s,
            access: {
              ...access,
              userGroups: list.length > 0 ? list : undefined,
            },
          },
          {
            action: 'access_user_group',
            detail: `Удалена группа: ${prev.name}`,
            ...af,
          },
        )
      })
    },
  }
}
