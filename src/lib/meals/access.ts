import type { AccessRoleId, AppUser } from '@/lib/access/types'
import { accessPersona } from '@/lib/access/accessPersona'
import type { AdminCabinetId } from '@/lib/access/adminCabinet'

export function mealsRoleId(
  user: AppUser | null | undefined,
  cabinet?: AdminCabinetId,
): AccessRoleId | undefined {
  return accessPersona(user, cabinet)?.roleId
}

export function canManageMealSettings(
  user: AppUser | null | undefined,
  cabinet?: AdminCabinetId,
): boolean {
  return mealsRoleId(user, cabinet) === 'sysadmin'
}

export function canCookMeals(
  user: AppUser | null | undefined,
  cabinet?: AdminCabinetId,
): boolean {
  const role = mealsRoleId(user, cabinet)
  return role === 'cook' || role === 'sysadmin'
}

/** Повар видит суммы заказов и аванса, но не получает доступ к разделу финансов/ЗП. */
export function canSeeMealPrices(
  user: AppUser | null | undefined,
  cabinet?: AdminCabinetId,
): boolean {
  return mealsRoleId(user, cabinet) !== 'timeclock'
}

export function canOrderMeals(
  user: AppUser | null | undefined,
  cabinet?: AdminCabinetId,
): boolean {
  const role = mealsRoleId(user, cabinet)
  return !!role && role !== 'timeclock' && role !== 'cook'
}
