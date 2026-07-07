import type { AccessRoleId, AccessStore, AppUser } from '@/lib/access/types'
import {
  FST_WEB_ROLE_VIEWS,
  isKnownWebFirebaseEmail,
  LEGACY_WEB_USER_DIRECTORY,
} from '@/lib/cloud/fstWebUsers'
import type { FirebaseWebUserRecord } from '@/lib/cloud/webUserAdmin'
import { isFstAdminEmail } from '@/lib/cloud/fstAdmin'
import type { ViewId } from '@/lib/types'
import type { UpsertAppUserInput } from '@/store/slices/accessSlice'

export type WebUserListRow = {
  id: string
  login: string
  displayName: string
  roleId: AccessRoleId
  active: boolean
  employeeId?: string
  webViews?: ViewId[]
  webAccount?: boolean
  /** Подтверждено через Firebase Admin API */
  inFirebase: boolean
  /** Ожидается в Firebase (legacy / админ), даже если список не загрузился */
  assumedFirebase: boolean
  firebaseDisabled?: boolean
  /** Ещё нет в store.access — нужно сохранить сотрудника и права */
  needsImport: boolean
  /** Запись из store.access */
  inStore: boolean
}

function defaultWebViews(roleId: AccessRoleId): ViewId[] {
  return [...(FST_WEB_ROLE_VIEWS[roleId] ?? [])]
}

function resolveFirebaseFlags(email: string, fb: FirebaseWebUserRecord | undefined) {
  return {
    inFirebase: !!fb,
    assumedFirebase: isKnownWebFirebaseEmail(email),
    firebaseDisabled: fb?.disabled,
  }
}

/** Объединить store, Firebase и legacy-справочник для панели админа. */
export function buildWebUserListRows(
  access: AccessStore,
  firebaseUsers: FirebaseWebUserRecord[],
): WebUserListRow[] {
  const firebaseByEmail = new Map(
    firebaseUsers.map((u) => [u.email.trim().toLowerCase(), u]),
  )
  const storeByLogin = new Map(
    access.users.map((u) => [u.login.trim().toLowerCase(), u]),
  )
  const emails = new Set<string>([
    ...storeByLogin.keys(),
    ...firebaseByEmail.keys(),
    ...Object.keys(LEGACY_WEB_USER_DIRECTORY),
  ])

  const rows: WebUserListRow[] = []

  for (const email of emails) {
    const stored = storeByLogin.get(email)
    const fb = firebaseByEmail.get(email)
    const legacy = LEGACY_WEB_USER_DIRECTORY[email]
    const firebase = resolveFirebaseFlags(email, fb)

    if (stored) {
      rows.push({
        id: stored.id,
        login: stored.login,
        displayName: stored.displayName,
        roleId: stored.roleId,
        active: stored.active,
        employeeId: stored.employeeId,
        webViews: stored.webViews,
        webAccount: stored.webAccount,
        ...firebase,
        needsImport: false,
        inStore: true,
      })
      continue
    }

    if (isFstAdminEmail(email)) continue

    const roleId = legacy?.roleId ?? 'warehouse_keeper'
    rows.push({
      id: `import-${email}`,
      login: email,
      displayName: legacy?.displayName ?? fb?.displayName ?? email,
      roleId,
      active: fb ? !fb.disabled : true,
      webViews: defaultWebViews(roleId),
      webAccount: true,
      ...firebase,
      needsImport: true,
      inStore: false,
    })
  }

  return rows.sort((a, b) => a.displayName.localeCompare(b.displayName, 'ru'))
}

export function storeUserFromRow(row: WebUserListRow): AppUser | null {
  if (!row.inStore) return null
  return {
    id: row.id,
    login: row.login,
    displayName: row.displayName,
    roleId: row.roleId,
    passwordHash: '',
    passwordSalt: '',
    active: row.active,
    employeeId: row.employeeId,
    webAccount: row.webAccount,
    webViews: row.webViews,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

export function importRowToUpsertInput(row: WebUserListRow): UpsertAppUserInput {
  return {
    login: row.login,
    displayName: row.displayName,
    roleId: row.roleId,
    active: row.active,
    employeeId: null,
    skipFirebaseCreate: row.inFirebase || row.assumedFirebase,
  }
}
