import { readAdminCabinet, type AdminCabinetId } from './adminCabinet'
import type { AppUser } from './types'

/**
 * Эффективная учётка для ACL/UI при превью кабинета sysadmin.
 * Реальная роль остаётся sysadmin (логин, аудит, переключатель «Интерфейс»).
 * В превью — roleId выбранного кабинета без персональных оверрайдов табеля/webViews,
 * чтобы действовали матрица «Интерфейсы» и дефолты роли.
 */
export function accessPersona(
  user: AppUser | null | undefined,
  cabinet?: AdminCabinetId,
): AppUser | null | undefined {
  if (!user?.active) return user
  if (user.roleId !== 'sysadmin') return user
  const c = cabinet ?? readAdminCabinet()
  if (c === 'full') return user
  return {
    ...user,
    roleId: c,
    timesheetLevel: undefined,
    timesheetViewBrigades: undefined,
    timesheetEditBrigades: undefined,
    webViews: undefined,
    directorySections: undefined,
  }
}

/** Кабинет генерального директора: свой логин или превью сисадмина. */
export function isDirectorHqPersona(
  user: AppUser | null | undefined,
  cabinet?: AdminCabinetId,
): boolean {
  return accessPersona(user, cabinet)?.roleId === 'operations_director'
}
