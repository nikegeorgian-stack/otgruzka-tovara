import type { AppStore, MonthSheet } from '@/lib/types'

/**
 * Может ли в бригаде быть бригадир (доплата + назначение в UI).
 * Ключ отсутствует → да (как раньше). Явный `false` — нет (мастер/аппарат и т.п.).
 */
export function brigadeAllowsBrigadier(
  store: Pick<AppStore, 'brigadeHasBrigadier'>,
  brigade: string,
): boolean {
  if (!brigade) return true
  return store.brigadeHasBrigadier?.[brigade] !== false
}

export function normalizeBrigadeHasBrigadier(
  raw: unknown,
): Record<string, boolean> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, boolean> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k === 'string' && k && typeof v === 'boolean') out[k] = v
  }
  return out
}

/** Удаляет старые дневные отметки всех строк указанной бригады во всех месяцах. */
export function clearBrigadierMarksForBrigade(
  months: Record<string, MonthSheet>,
  brigade: string,
): Record<string, MonthSheet> {
  let changed = false
  const nextMonths: Record<string, MonthSheet> = { ...months }

  for (const [month, sheet] of Object.entries(months)) {
    const rowIds = new Set(sheet.rows.filter((row) => row.brigade === brigade).map((row) => row.id))
    if (rowIds.size === 0 || !sheet.brigadierDays) continue

    const brigadierDays: Record<string, true> = {}
    let sheetChanged = false
    for (const [key, value] of Object.entries(sheet.brigadierDays)) {
      const rowId = key.slice(0, key.indexOf('|'))
      if (rowIds.has(rowId)) {
        sheetChanged = true
      } else if (value) {
        brigadierDays[key] = true
      }
    }
    if (!sheetChanged) continue

    changed = true
    nextMonths[month] = { ...sheet, brigadierDays }
  }

  return changed ? nextMonths : months
}
