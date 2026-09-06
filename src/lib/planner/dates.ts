/** Даты от start до end включительно (YYYY-MM-DD) */
export function dateRangeInclusive(start: string, end: string): string[] {
  const out: string[] = []
  const cur = new Date(start + 'T12:00:00')
  const last = new Date(end + 'T12:00:00')
  if (Number.isNaN(cur.getTime()) || Number.isNaN(last.getTime()) || cur > last) {
    return out
  }
  while (cur <= last) {
    out.push(cur.toISOString().slice(0, 10))
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Last calendar day of YYYY-MM as YYYY-MM-DD. */
export function monthLastDayIso(yearMonth: string): string {
  const [ys, ms] = yearMonth.split('-')
  const y = Number(ys)
  const m = Number(ms)
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    return `${yearMonth}-28`
  }
  const last = new Date(y, m, 0).getDate()
  return `${yearMonth}-${String(last).padStart(2, '0')}`
}

export function addDaysIso(dateIso: string, days: number): string {
  const d = new Date(dateIso + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export function isWeekend(dateIso: string): boolean {
  const d = new Date(dateIso + 'T12:00:00')
  const day = d.getDay()
  return day === 0 || day === 6
}
