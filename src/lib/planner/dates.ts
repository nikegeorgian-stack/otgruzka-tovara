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

export function isWeekend(dateIso: string): boolean {
  const d = new Date(dateIso + 'T12:00:00')
  const day = d.getDay()
  return day === 0 || day === 6
}
