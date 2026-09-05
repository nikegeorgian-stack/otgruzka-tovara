import { isFstAdminEmail } from '@/lib/cloud/fstAdmin'
import type { AccessStore } from '@/lib/access/types'
import type { AppStore } from '@/lib/types'

/**
 * Может ли актор менять access.users / роли в облачном blob.
 * Роль берём из trusted (remote), не из локального стора — иначе escalation через клиент.
 */
export function actorCanManageAccessFromTrusted(
  trusted: AppStore | null | undefined,
  actorEmail: string | null | undefined,
): boolean {
  if (isFstAdminEmail(actorEmail)) return true
  const key = actorEmail?.trim().toLowerCase()
  if (!key || !trusted?.access) return false
  const users = (trusted.access as AccessStore).users ?? []
  const u = users.find((x) => x.login.trim().toLowerCase() === key && x.active)
  return u?.roleId === 'sysadmin'
}

/**
 * Не-sysadmin не может записать изменённый access (роли, users) в облако.
 * closedMonths / прочие поля не трогаем — закрытие месяца доступно и не-sysadmin.
 */
export function clampClientPrivilegeFields(
  outgoing: AppStore,
  trusted: AppStore | null | undefined,
  actorEmail: string | null | undefined,
): AppStore {
  if (!trusted) return outgoing
  if (actorCanManageAccessFromTrusted(trusted, actorEmail)) return outgoing
  return {
    ...outgoing,
    access: trusted.access,
  }
}
