import type { AppStore, BrigadeTimesheetSignoff, MonthSheet } from '@/lib/types'

function canonical(value: unknown): string {
  if (value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`
  return JSON.stringify(value)
}

/** Content identity for review freshness, not a security signature. Sort/display are excluded. */
export function brigadeTimesheetFingerprint(
  sheet: MonthSheet,
  brigade: string,
  store?: AppStore,
): string {
  const employeeIds = new Set(
    sheet.rows.filter((r) => r.brigade === brigade).map((r) => r.employeeId),
  )
  // All fragments of these people affect their monthly norm, including other brigades.
  const rows = sheet.rows
    .filter((r) => r.brigade === brigade || (!!r.employeeId && employeeIds.has(r.employeeId)))
    .map(({ id, brigade, employeeId }) => ({ id, brigade, employeeId }))
    .sort((a, b) => a.id.localeCompare(b.id))
  const ids = new Set(rows.map((r) => r.id))
  const cells = (map: object | undefined) =>
    Object.fromEntries(Object.entries(map ?? {}).filter(([k]) => ids.has(k.split('|')[0])))
  const data = canonical({
    month: sheet.month,
    brigade,
    rows,
    plan: cells(sheet.plan),
    fact: cells(sheet.fact),
    overrides: sheet.factOverrides.filter((k) => ids.has(k.split('|')[0])).sort(),
    extra: cells(sheet.factExtraHours),
    exact: cells(sheet.factHoursOverride),
    bounds: cells(sheet.rowBounds),
    brigadierDays: cells(sheet.brigadierDays),
    substitutions: cells(sheet.substitutions),
    transfers: Object.fromEntries(
      Object.entries(sheet.dayTransfers ?? {}).filter(
        ([key, tr]) =>
          employeeIds.has(key.split('|')[0]) || ids.has(tr.fromRowId) || ids.has(tr.toRowId),
      ),
    ),
    employees: store?.employees
      .filter((e) => employeeIds.has(e.id))
      .map((e) => ({
        id: e.id,
        schedule: e.schedule,
        shiftHours: e.shiftHours,
        shiftMode: e.shiftMode,
        group2x2: e.group2x2,
        cycleStart: e.cycleStart,
        hireDate: e.hireDate,
        terminationDate: e.terminationDate,
        monthlySalary: e.monthlySalary,
        hourlyRate: e.hourlyRate,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    brigadier: store?.brigadiers[brigade],
    vacation: store?.finance?.vacationConfirmations
      .filter((c) => c.month === sheet.month && employeeIds.has(c.employeeId))
      .sort((a, b) => a.id.localeCompare(b.id)),
    sick: store?.finance?.sickConfirmations
      .filter((c) => c.month === sheet.month && employeeIds.has(c.employeeId))
      .sort((a, b) => a.id.localeCompare(b.id)),
  })
  let a = 2166136261,
    b = 2246822519
  for (let i = 0; i < data.length; i++) {
    a = Math.imul(a ^ data.charCodeAt(i), 16777619)
    b = Math.imul(b ^ data.charCodeAt(i), 3266489917)
  }
  return `v1:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}:${data.length}`
}

export function getBrigadeSignoff(
  sheet: MonthSheet | undefined,
  brigade: string,
): BrigadeTimesheetSignoff | undefined {
  return sheet?.brigadeSignoffs?.[brigade]
}
export function isBrigadeTimesheetVerified(
  sheet: MonthSheet | undefined,
  brigade: string,
  store?: AppStore,
): boolean {
  const signoff = getBrigadeSignoff(sheet, brigade)
  return (
    !!sheet &&
    signoff?.verified === true &&
    signoff.fingerprint === brigadeTimesheetFingerprint(sheet, brigade, store)
  )
}
export type UnsignedBrigadeItem = { brigade: string; signed: boolean }
export function collectUnsignedBrigades(
  store: AppStore,
  month: string,
  onlyBrigades?: string[],
): string[] {
  const sheet = store.months[month]
  if (!sheet) return []
  return [
    ...new Set(
      sheet.rows
        .filter((r) => r.employeeId && (!onlyBrigades || onlyBrigades.includes(r.brigade)))
        .map((r) => r.brigade),
    ),
  ]
    .filter((b) => !isBrigadeTimesheetVerified(sheet, b, store))
    .sort((a, b) => a.localeCompare(b, 'ru'))
}
