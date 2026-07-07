import { ensureMonth, defaultMonths } from './monthSheet'
import type { AppStore, MonthClosure } from './types'

export function isMonthArchived(store: AppStore, month: string): boolean {
  return store.archivedMonths.includes(month)
}

/** Месяц закрыт (зафиксирован) — план/факт нельзя править */
export function isMonthClosed(store: AppStore, month: string): boolean {
  return (store.closedMonths ?? []).includes(month)
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
