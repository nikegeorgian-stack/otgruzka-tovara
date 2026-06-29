import { daysInMonth, monthKey, parseMonthKey } from '@/lib/dates'

export type MonthRangeSegment = {
  monthKey: string
  fromDay: number
  toDay: number
}

/**
 * Разбивает интервал дат [startISO, endISO] на сегменты по месяцам
 * с номерами дней (для простановки факта в табеле).
 */
export function segmentsForDateRange(startISO: string, endISO: string): MonthRangeSegment[] {
  const start = new Date(`${startISO}T00:00:00`)
  const end = new Date(`${endISO}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return []
  }
  const segments: MonthRangeSegment[] = []
  let year = start.getFullYear()
  let month = start.getMonth() + 1
  const endYear = end.getFullYear()
  const endMonth = end.getMonth() + 1

  while (year < endYear || (year === endYear && month <= endMonth)) {
    const isFirst = year === start.getFullYear() && month === start.getMonth() + 1
    const isLast = year === endYear && month === endMonth
    const fromDay = isFirst ? start.getDate() : 1
    const toDay = isLast ? end.getDate() : daysInMonth(year, month)
    segments.push({ monthKey: monthKey(year, month), fromDay, toDay })
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return segments
}

/**
 * Сегменты «от даты увольнения до конца» — только для уже существующих месяцев
 * (не создаём новые будущие месяцы). Очищает факт с даты увольнения и далее.
 */
export function terminationSegments(
  existingMonthKeys: string[],
  terminationISO: string,
): MonthRangeSegment[] {
  const date = new Date(`${terminationISO}T00:00:00`)
  if (Number.isNaN(date.getTime())) return []
  const startMonthKey = monthKey(date.getFullYear(), date.getMonth() + 1)
  const segments: MonthRangeSegment[] = []
  for (const key of existingMonthKeys) {
    if (key < startMonthKey) continue
    const { year, month } = parseMonthKey(key)
    const fromDay = key === startMonthKey ? date.getDate() : 1
    segments.push({ monthKey: key, fromDay, toDay: daysInMonth(year, month) })
  }
  return segments
}
