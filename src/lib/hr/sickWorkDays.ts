import { isWorkCode } from '@/lib/factExtra'
import { effectiveShiftHours } from '@/lib/schedules'
import { parseMonthKey } from '@/lib/dates'
import {
  autoCodeForDay,
  resolveCycleStart,
} from '@/lib/schedule'
import type { Employee } from '@/lib/types'
import type { HrAbsence } from './types'

/** Максимум подряд оплачиваемых рабочих дней больничного. */
export const MAX_CONSECUTIVE_SICK_WORK_DAYS = 40

/** День, в который сотрудник должен выйти по графику (смена, не выходной/праздник). */
export function isScheduledWorkDay(emp: Employee, dateKey: string): boolean {
  const { year, month } = parseMonthKey(dateKey.slice(0, 7))
  const day = Number(dateKey.slice(8, 10))
  if (!Number.isFinite(day) || day < 1) return false
  const cycleStart = resolveCycleStart(emp, year, month)
  const code = autoCodeForDay(
    emp.schedule,
    cycleStart,
    year,
    month,
    day,
    emp.shiftMode ?? 'day',
    effectiveShiftHours(emp),
  )
  return isWorkCode(code)
}

/** Список рабочих дней графика в интервале [start, end] включительно. */
export function scheduledWorkDaysInRange(
  emp: Employee,
  startISO: string,
  endISO: string,
): string[] {
  const start = new Date(`${startISO}T12:00:00`)
  const end = new Date(`${endISO}T12:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return []
  }
  const out: string[] = []
  const cur = new Date(start)
  while (cur <= end) {
    const y = cur.getFullYear()
    const m = String(cur.getMonth() + 1).padStart(2, '0')
    const d = String(cur.getDate()).padStart(2, '0')
    const key = `${y}-${m}-${d}`
    if (isScheduledWorkDay(emp, key)) out.push(key)
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

export function countSickWorkDays(
  emp: Employee,
  startISO: string,
  endISO: string,
): number {
  return scheduledWorkDaysInRange(emp, startISO, endISO).length
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + n)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Склеивает пересекающиеся / смежные больничные в цепочки
 * и считает рабочие дни по графику в каждой. Возвращает
 * цепочку, покрывающую period (или последнюю, если period не задан).
 */
export function consecutiveSickWorkDays(
  emp: Employee,
  period?: { startDate: string; endDate: string },
): { workDays: number; chainStart: string; chainEnd: string } {
  type Span = { startDate: string; endDate: string }
  const spans: Span[] = (emp.hrAbsences ?? [])
    .filter((a) => a.type === 'sick')
    .map((a) => ({ startDate: a.startDate, endDate: a.endDate }))
  if (period) spans.push(period)
  spans.sort((a, b) => a.startDate.localeCompare(b.startDate))
  if (spans.length === 0) {
    return { workDays: 0, chainStart: '', chainEnd: '' }
  }

  const merged: Span[] = []
  for (const s of spans) {
    const last = merged[merged.length - 1]
    if (!last) {
      merged.push({ ...s })
      continue
    }
    const gapOk = s.startDate <= addDays(last.endDate, 1)
    if (gapOk) {
      if (s.endDate > last.endDate) last.endDate = s.endDate
      if (s.startDate < last.startDate) last.startDate = s.startDate
    } else {
      merged.push({ ...s })
    }
  }

  const anchor = period ?? merged[merged.length - 1]
  const chain =
    merged.find((m) => m.startDate <= anchor.endDate && anchor.startDate <= m.endDate) ??
    merged[merged.length - 1]

  return {
    workDays: countSickWorkDays(emp, chain.startDate, chain.endDate),
    chainStart: chain.startDate,
    chainEnd: chain.endDate,
  }
}

export function sickLimitInfo(
  emp: Employee,
  startDate: string,
  endDate: string,
): {
  periodWorkDays: number
  chainWorkDays: number
  overLimit: boolean
  remaining: number
} | null {
  if (!startDate || !endDate || startDate > endDate) return null
  const periodWorkDays = countSickWorkDays(emp, startDate, endDate)
  const { workDays: chainWorkDays } = consecutiveSickWorkDays(emp, { startDate, endDate })
  return {
    periodWorkDays,
    chainWorkDays,
    overLimit: chainWorkDays > MAX_CONSECUTIVE_SICK_WORK_DAYS,
    remaining: Math.max(0, MAX_CONSECUTIVE_SICK_WORK_DAYS - chainWorkDays),
  }
}

/** Заполнить workDays у больничной / отпускной записи (только дни смены по графику). */
export function withScheduledWorkDays(emp: Employee, absence: HrAbsence): HrAbsence {
  if (absence.type !== 'sick' && absence.type !== 'vacation') return absence
  return {
    ...absence,
    workDays: countSickWorkDays(emp, absence.startDate, absence.endDate),
  }
}

/** @deprecated use withScheduledWorkDays */
export function withSickWorkDays(emp: Employee, absence: HrAbsence): HrAbsence {
  return withScheduledWorkDays(emp, absence)
}
