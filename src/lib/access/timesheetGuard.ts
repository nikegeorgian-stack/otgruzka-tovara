import { timesheetAccess, brigadeInTimesheetScope } from './timesheetScope'
import type { AppUser } from './types'
import type { AppStore } from '@/lib/types'

/** Кто выполняет действие (учётка). */
export type TimesheetActor = { id?: string; name?: string }

export function resolveTimesheetActorUser(
  store: AppStore,
  actor: TimesheetActor | null | undefined,
): AppUser | null {
  if (!actor?.id) return null
  return store.access?.users?.find((u) => u.id === actor.id) ?? null
}

/**
 * Можно ли менять табель (план/факт/состав) для цели.
 * Без актёра — запрет (нужна учётка).
 */
export function canMutateTimesheet(
  store: AppStore,
  actor: TimesheetActor | null | undefined,
  target: { month: string; rowId?: string; brigade?: string | null },
): boolean {
  const user = resolveTimesheetActorUser(store, actor)
  const access = timesheetAccess(store, user, { month: target.month })
  if (access.level !== 'edit') return false
  if (access.editBrigades === 'all') return true

  // Операция без цели (весь завод) — только для edit-all.
  if (!target.brigade && !target.rowId) return false

  let brigade = target.brigade ?? null
  if (!brigade && target.rowId) {
    brigade =
      store.months[target.month]?.rows.find((r) => r.id === target.rowId)?.brigade ?? null
  }
  return brigadeInTimesheetScope(brigade, access.editBrigades)
}
