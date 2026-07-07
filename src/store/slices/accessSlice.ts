import { normalizeAccessStore } from '@/lib/access/init'
import { hashPassword } from '@/lib/access/password'
import type { AccessRoleId, AppUser } from '@/lib/access/types'
import { SYSTEM_ADMIN_USER_ID } from '@/lib/access/types'
import { appendAudit } from '@/lib/audit'
import {
  createFirebaseWebUser,
  updateFirebaseWebUser,
} from '@/lib/cloud/webUserAdmin'
import { syncWebAccessAllowlistFromStore } from '@/lib/cloud/webAccessConfig'
import { isKnownWebFirebaseEmail } from '@/lib/cloud/fstWebUsers'
import type { UserViewDefaults } from '@/lib/viewDefaults/types'
import { mergeUserViewDefaults } from '@/lib/viewDefaults/types'
import type { ViewId } from '@/lib/types'
import type { GetStore, SetStore } from '../storeApi'

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
  /** Учётка уже есть в Firebase — только привязать в store */
  skipFirebaseCreate?: boolean
}

const isWebApp = import.meta.env.VITE_FST_WEB === 'true'

export function createAccessSlice({ setStore, getStore }: { setStore: SetStore; getStore: GetStore }) {
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
        input.webViews && input.webViews.length > 0 ? [...new Set(input.webViews)] : undefined

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
        webViews,
        viewDefaults: existing?.viewDefaults,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }

      if (isWebApp) {
        const skipFirebase =
          input.skipFirebaseCreate === true || isKnownWebFirebaseEmail(login)
        const password = input.password?.trim()
        if (!existing && password && !skipFirebase) {
          const created = await createFirebaseWebUser({
            email: login,
            password,
            displayName: user.displayName,
          })
          if (!created.ok && created.error !== 'email_exists') {
            if (created.error === 'unauthorized') throw new Error('firebase_unauthorized')
            throw new Error('firebase_create_failed')
          }
        } else if (existing) {
          const patch: Parameters<typeof updateFirebaseWebUser>[0] = { email: login }
          if (password) patch.password = password
          if (input.active !== existing.active) patch.disabled = !input.active
          if (user.displayName !== existing.displayName) patch.displayName = user.displayName
          if (patch.password || patch.disabled !== undefined || patch.displayName) {
            const updated = await updateFirebaseWebUser(patch)
            if (!updated.ok) {
              if (updated.error === 'user_not_found' && !password) {
                /* только store — Firebase ещё не создан */
              } else if (updated.error === 'unauthorized') {
                throw new Error('firebase_unauthorized')
              } else if (updated.error !== 'user_not_found') {
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
          })
        } else {
          next = appendAudit(next, {
            action: 'user_upsert',
            detail: `Создан: ${user.displayName} (${login}) · ${user.roleId}`,
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
          const defaultBrigades = viewDefaults.month?.defaultBrigades?.filter((b) => b.trim()).length
            ? viewDefaults.month.defaultBrigades.filter((b) => b.trim())
            : u.defaultBrigades
          return {
            ...u,
            defaultBrigades,
            viewDefaults,
            updatedAt: now,
          }
        })
        return { ...s, access: { ...access, users } }
      })
    },

    async removeAppUser(id: string) {
      if (id === SYSTEM_ADMIN_USER_ID) throw new Error('cannot_remove_sysadmin')
      setStore((s) => {
        const access = normalizeAccessStore(s.access)
        const target = access.users.find((u) => u.id === id)
        if (!target) return s
        if (target.roleId === 'sysadmin') {
          const admins = access.users.filter(
            (u) => u.roleId === 'sysadmin' && u.active && u.id !== id,
          )
          if (admins.length === 0) throw new Error('last_sysadmin')
        }
        return appendAudit(
          {
            ...s,
            access: {
              ...access,
              users: access.users.filter((u) => u.id !== id),
            },
          },
          {
            action: 'user_remove',
            detail: `${target.displayName} (${target.login}) · ${target.roleId}`,
          },
        )
      })
      if (isWebApp) {
        await syncWebAccessAllowlistFromStore(getStore().access).catch((err) => {
          console.error('FST: sync web access allowlist failed', err)
        })
      }
    },

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
  }
}
