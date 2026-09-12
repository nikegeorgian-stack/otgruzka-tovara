import type { AttendancePunch, AttendancePunchKind, AttendanceStore } from './types'

export const ATTENDANCE_TIME_ZONE = 'Asia/Tbilisi'

/** Дата завода YYYY-MM-DD, независимо от часового пояса устройства. */
export function localDateKey(iso = new Date().toISOString()): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ATTENDANCE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function punchesForEmployeeDay(
  store: AttendanceStore | undefined,
  employeeId: string,
  dateKey: string,
): AttendancePunch[] {
  const list = store?.punches ?? []
  return list.filter((p) => p.employeeId === employeeId && localDateKey(p.at) === dateKey)
}

/** Close the latest open entrance across midnight; old unmatched days remain for review. */
export function nextPunchKind(
  store: AttendanceStore | undefined,
  employeeId: string,
  atIso = new Date().toISOString(),
): AttendancePunchKind {
  const at = new Date(atIso).getTime()
  const last = (store?.punches ?? [])
    .filter(
      (p) =>
        p.employeeId === employeeId && Number.isFinite(Date.parse(p.at)) && Date.parse(p.at) <= at,
    )
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0]
  if (!last || at - Date.parse(last.at) > 24 * 60 * 60 * 1000) return 'in'
  return last.kind === 'in' ? 'out' : 'in'
}

export function punchesForDay(
  store: AttendanceStore | undefined,
  dateKey: string,
): AttendancePunch[] {
  return (store?.punches ?? [])
    .filter((p) => localDateKey(p.at) === dateKey)
    .sort((a, b) => b.at.localeCompare(a.at))
}

export type DayAttendanceSummary = {
  employeeId: string
  firstIn?: string
  lastOut?: string
  punches: AttendancePunch[]
}

export function summarizeDayAttendance(
  store: AttendanceStore | undefined,
  dateKey: string,
): DayAttendanceSummary[] {
  const byEmp = new Map<string, AttendancePunch[]>()
  for (const p of punchesForDay(store, dateKey).slice().reverse()) {
    const list = byEmp.get(p.employeeId) ?? []
    list.push(p)
    byEmp.set(p.employeeId, list)
  }
  const out: DayAttendanceSummary[] = []
  for (const [employeeId, punches] of byEmp) {
    const firstIn = punches.find((p) => p.kind === 'in')?.at
    const outs = punches.filter((p) => p.kind === 'out')
    const lastOut = outs.length ? outs[outs.length - 1]!.at : undefined
    out.push({ employeeId, firstIn, lastOut, punches })
  }
  out.sort((a, b) => (b.firstIn ?? '').localeCompare(a.firstIn ?? ''))
  return out
}

export function formatPunchTime(iso: string, locale = 'ru-GE'): string {
  try {
    return new Date(iso).toLocaleTimeString(locale, {
      timeZone: ATTENDANCE_TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  } catch {
    return iso.slice(11, 19)
  }
}
