/** Срез «на дату и время» — общий паттерн FST для остатков, выработки, журналов, KPI. */

/** Собрать ISO-момент из даты и времени (локальная зона браузера). */
export function buildAsOfIso(date: string, time?: string): string {
  const t = (time?.trim() || '23:59:59').slice(0, 8)
  const normalized = t.length === 5 ? `${t}:00` : t
  return new Date(`${date}T${normalized}`).toISOString()
}

/** Записи с полем createdAt ≤ asOf. */
export function recordsBeforeAsOf<T extends { createdAt: string }>(
  rows: T[],
  asOfIso: string,
): T[] {
  return rows.filter((r) => r.createdAt <= asOfIso)
}

/** Записи с полем at ≤ asOf (аудит, журналы). */
export function eventsBeforeAsOf<T extends { at: string }>(rows: T[], asOfIso: string): T[] {
  return rows.filter((r) => r.at <= asOfIso)
}

/** @deprecated use recordsBeforeAsOf */
export const movementsBeforeAsOf = recordsBeforeAsOf

/** Склад с движениями, обрезанными по моменту среза. */
export function warehouseStoreAsOf<W extends { movements: { createdAt: string }[] }>(
  warehouse: W,
  asOfIso: string,
): W {
  return { ...warehouse, movements: recordsBeforeAsOf(warehouse.movements, asOfIso) }
}
