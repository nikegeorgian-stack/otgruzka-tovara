import { ensureMonth, defaultMonths } from './monthSheet'
import { createEmptyBrigadeRow } from './brigadeRows'
import type { AppStore, MonthClosure, MonthSheet } from './types'
import type { AppUser } from '@/lib/access/types'

export function isMonthArchived(store: AppStore, month: string): boolean {
  return store.archivedMonths.includes(month)
}

/** Месяц закрыт (зафиксирован) — план/факт нельзя править */
export function isMonthClosed(store: AppStore, month: string): boolean {
  return (store.closedMonths ?? []).includes(month)
}

/**
 * Sysadmin и директор операций могут править закрытый/архивный месяц
 * без переоткрытия (аудит / исправления).
 */
export function canBypassMonthClose(user: AppUser | null | undefined): boolean {
  if (!user?.active) return false
  return user.roleId === 'sysadmin' || user.roleId === 'operations_director'
}

/** Закрыт и актёр не может обойти блокировку. */
export function isMonthWriteLocked(
  store: AppStore,
  month: string,
  user: AppUser | null | undefined,
): boolean {
  return isMonthClosed(store, month) && !canBypassMonthClose(user)
}

export function monthClosureInfo(store: AppStore, month: string): MonthClosure | undefined {
  return store.monthClosures?.[month]
}

/**
 * Закрыть/открыть месяц. При закрытии фиксируем кто/когда; при открытии —
 * чистим метаданные. Бросает, если месяца нет.
 */
export function setMonthClosed(
  store: AppStore,
  month: string,
  closed: boolean,
  actor?: { id?: string; name?: string },
): AppStore {
  if (!store.months[month]) throw new Error('missing')
  const list = store.closedMonths ?? []
  const has = list.includes(month)
  const closures = { ...(store.monthClosures ?? {}) }
  if (closed && !has) {
    closures[month] = {
      at: new Date().toISOString(),
      by: actor?.id,
      byName: actor?.name,
    }
    return { ...store, closedMonths: [...list, month].sort(), monthClosures: closures }
  }
  if (!closed && has) {
    delete closures[month]
    return {
      ...store,
      closedMonths: list.filter((m) => m !== month),
      monthClosures: closures,
    }
  }
  return store
}

export function listMonthKeys(store: AppStore): string[] {
  return Object.keys(store.months).sort()
}

export function addMonthToStore(store: AppStore, month: string): AppStore {
  if (store.months[month]) throw new Error('exists')
  return ensureMonth(store, month)
}

export function removeMonthFromStore(store: AppStore, month: string): AppStore {
  if (isMonthArchived(store, month) || isMonthClosed(store, month)) throw new Error('archived')
  if (!store.months[month]) throw new Error('missing')
  const { [month]: _, ...months } = store.months
  return { ...store, months }
}

/**
 * Пустой лист: по одной пустой строке на бригаду, без сотрудников и без отметок.
 */
export function createClearedMonthSheet(
  month: string,
  brigades: string[],
): MonthSheet {
  const rows = brigades.map((brigade, i) => createEmptyBrigadeRow(brigade, i))
  return {
    month,
    rows,
    plan: {},
    fact: {},
    factOverrides: [],
    comments: {},
    substitutions: {},
    factExtraHours: {},
    brigadierDays: {},
    factHoursOverride: {},
    brigadeSignoffs: {},
    dayTransfers: {},
    rowBounds: {},
    resetAt: new Date().toISOString(),
  }
}

/**
 * Технический сброс табеля за месяц: бригады пустые, ячейки пустые.
 * Закрытие месяца снимается. Финансы / ЗП не трогает.
 */
export function clearMonthTimesheetInStore(store: AppStore, month: string): AppStore {
  if (!store.months[month]) throw new Error('missing')
  const cleared = createClearedMonthSheet(month, store.brigades)
  let next: AppStore = {
    ...store,
    months: { ...store.months, [month]: cleared },
  }
  if (isMonthClosed(next, month)) {
    next = setMonthClosed(next, month, false)
  }
  return next
}

/**
 * Очистить все месяцы строго раньше `beforeMonth` (YYYY-MM).
 * Пример: beforeMonth=2026-04 → март 2026 и всё раньше.
 */
export function clearMonthsBeforeInStore(
  store: AppStore,
  beforeMonth: string,
): { store: AppStore; cleared: string[] } {
  if (!/^\d{4}-\d{2}$/.test(beforeMonth)) {
    throw new Error(`bad_before_month:${beforeMonth}`)
  }
  const cleared = Object.keys(store.months)
    .filter((m) => m < beforeMonth)
    .sort()
  if (!cleared.length) return { store, cleared }
  let next = store
  for (const month of cleared) {
    next = clearMonthTimesheetInStore(next, month)
  }
  return { store: next, cleared }
}

export function setMonthArchived(
  store: AppStore,
  month: string,
  archived: boolean,
): AppStore {
  if (!store.months[month]) throw new Error('missing')
  const has = store.archivedMonths.includes(month)
  if (archived && !has) {
    return { ...store, archivedMonths: [...store.archivedMonths, month].sort() }
  }
  if (!archived && has) {
    return {
      ...store,
      archivedMonths: store.archivedMonths.filter((m) => m !== month),
    }
  }
  return store
}

export function defaultArchivedMonths(): string[] {
  return defaultMonths()
}
