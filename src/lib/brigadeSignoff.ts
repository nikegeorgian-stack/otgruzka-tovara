import type { AppStore, BrigadeTimesheetSignoff, MonthSheet } from '@/lib/types'

export function getBrigadeSignoff(
  sheet: MonthSheet | undefined,
  brigade: string,
): BrigadeTimesheetSignoff | undefined {
  return sheet?.brigadeSignoffs?.[brigade]
}

export function isBrigadeTimesheetVerified(
  sheet: MonthSheet | undefined,
  brigade: string,
): boolean {
  return getBrigadeSignoff(sheet, brigade)?.verified === true
}

export type UnsignedBrigadeItem = {
  brigade: string
  signed: boolean
}

/** Бригады месяца без сверки (есть хотя бы одна строка с сотрудником). */
export function collectUnsignedBrigades(
  store: AppStore,
  month: string,
  onlyBrigades?: string[],
): string[] {
  const sheet = store.months[month]
  if (!sheet) return []
  const filter = onlyBrigades ? new Set(onlyBrigades) : null
  const withPeople = new Set<string>()
  for (const r of sheet.rows) {
    if (!r.employeeId) continue
    if (filter && !filter.has(r.brigade)) continue
    withPeople.add(r.brigade)
  }
  return [...withPeople]
    .filter((b) => !isBrigadeTimesheetVerified(sheet, b))
    .sort((a, b) => a.localeCompare(b, 'ru'))
}
