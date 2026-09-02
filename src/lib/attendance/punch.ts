import type { AttendancePunch, AttendancePunchKind, AttendanceStore } from './types'

/** Локальная дата устройства YYYY-MM-DD. */
export function localDateKey(iso = new Date().toISOString()): string {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function punchesForEmployeeDay(
  store: AttendanceStore | undefined,
  employeeId: string,
  dateKey: string,
): AttendancePunch[] {
  const list = store?.punches ?? []
  return list.filter((p) => p.employeeId === employeeId && localDateKey(p.at) === dateKey)
}

/** Следующий тип прохода: первый за день = in, иначе чередование. */
export function nextPunchKind(
  store: AttendanceStore | undefined,
  employeeId: string,
  atIso = new Date().toISOString(),
): AttendancePunchKind {
  const day = localDateKey(atIso)
  const dayPunches = punchesForEmployeeDay(store, employeeId, day)
  if (dayPunches.length === 0) return 'in'
  const last = dayPunches[dayPunches.length - 1]!
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
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  } catch {
    return iso.slice(11, 19)
  }
}
