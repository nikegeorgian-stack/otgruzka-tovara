import { normalizeAccessStore } from '@/lib/access/init'
import { hashPassword } from '@/lib/access/password'
import type { AccessRoleId, AppUser } from '@/lib/access/types'
import { SYSTEM_ADMIN_USER_ID } from '@/lib/access/types'
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
}

export function createAccessSlice({ setStore, getStore }: { setStore: SetStore; getStore: GetStore }) {
  return {
    async upsertAppUser(input: UpsertAppUserInput): Promise<void> {
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
      if (input.password?.trim()) {
        const hashed = await hashPassword(input.password.trim())
        passwordHash = hashed.hash
        passwordSalt = hashed.salt
      } else if (!existing) {
        throw new Error('password_required')
      }

      const employeeId = input.employeeId?.trim() || undefined

      const user: AppUser = {
        id: existing?.id ?? crypto.randomUUID(),
        login,
        displayName: input.displayName.trim() || login,
        roleId: input.roleId,
        passwordHash,
        passwordSalt,
        active: input.active,
        employeeId,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
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
        return { ...prev, access: { ...acc, users } }
      })
    },

    removeAppUser(id: string) {
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
        return {
          ...s,
          access: {
            ...access,
            users: access.users.filter((u) => u.id !== id),
          },
        }
      })
    },

    setRoleViews(roleId: AccessRoleId, views: ViewId[]) {
      if (roleId === 'sysadmin') return
      setStore((s) => {
        const access = normalizeAccessStore(s.access)
        return {
          ...s,
          access: {
            ...access,
            roleViews: {
              ...access.roleViews,
              [roleId]: [...new Set(views)],
            },
          },
        }
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
