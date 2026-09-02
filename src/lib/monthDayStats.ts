import { dayDateKey, daysInMonth, isWeekend, parseMonthKey } from './dates'
import { isGeorgiaPublicHoliday } from './georgiaCalendar'
import { getFactMark } from './stats'
import type { AppStore, MonthSheet, TimesheetRow } from './types'

export type DayHeatStatus = 'future' | 'weekend' | 'holiday' | 'empty' | 'partial' | 'ok' | 'warn'

export type DayHeatCell = {
  day: number
  dateKey: string
  status: DayHeatStatus
  filled: number
  total: number
  mismatches: number
}

function rowInScope(row: TimesheetRow, brigades?: Set<string>): boolean {
  if (!row.employeeId) return false
  if (!brigades || brigades.size === 0) return true
  return brigades.has(row.brigade)
}

export function monthDayHeatmap(
  _store: AppStore,
  sheet: MonthSheet,
  mode: 'plan' | 'fact',
  opts?: { brigades?: Set<string>; todayIso?: string },
): DayHeatCell[] {
  const { year, month } = parseMonthKey(sheet.month)
  const days = daysInMonth(year, month)
  const today = opts?.todayIso ?? new Date().toISOString().slice(0, 10)
  const rows = sheet.rows.filter((r) => rowInScope(r, opts?.brigades))
  const out: DayHeatCell[] = []

  for (let d = 1; d <= days; d++) {
    const dateKey = dayDateKey(year, month, d)
    const weekend = isWeekend(year, month, d)
    const holiday = isGeorgiaPublicHoliday(dateKey)
    let filled = 0
    let mismatches = 0
    const total = rows.length

    for (const row of rows) {
      const plan = sheet.plan[row.id]?.[dateKey] ?? ''
      const fact = getFactMark(sheet, row.id, dateKey)
      const code = mode === 'plan' ? plan : fact
      if (code) filled += 1
      if (plan !== fact) mismatches += 1
    }

    let status: DayHeatStatus = 'empty'
    if (dateKey > today) {
      status = 'future'
    } else if (holiday) {
      status = 'holiday'
    } else if (weekend) {
      status = 'weekend'
    } else if (total === 0) {
      status = 'empty'
    } else if (mismatches > 0) {
      status = 'warn'
    } else if (filled >= total) {
      status = 'ok'
    } else if (filled > 0) {
      status = 'partial'
    } else {
      status = 'empty'
    }

    out.push({ day: d, dateKey, status, filled, total, mismatches })
  }

  return out
}

export type DayCodeBucket = 'empty' | 'work' | 'absence' | 'off'

export function bucketForCode(code: string): DayCodeBucket {
  if (!code) return 'empty'
  if (code === 'В') return 'off'
  if (code === 'ОТ' || code === 'ОО' || code === 'Б' || code === 'X' || code === 'ПР') return 'absence'
  return 'work'
}

export function defaultCodeForBucket(
  bucket: DayCodeBucket,
  planCode?: string,
): import('./types').DayCode {
  switch (bucket) {
    case 'work':
      return (planCode && planCode !== 'В' ? planCode : '8') as import('./types').DayCode
    case 'absence':
      return 'Б'
    case 'off':
      return 'В'
    default:
      return ''
  }
}
