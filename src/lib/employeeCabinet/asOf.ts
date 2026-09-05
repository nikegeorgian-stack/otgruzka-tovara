import { daysInMonth, isoDateLocal, parseMonthKey } from '@/lib/dates'

/**
 * Дата среза для «Моё»:
 * - текущий месяц → сегодня (факт на сегодня, не весь месяц вперёд);
 * - прошлый месяц → полный месяц (undefined);
 * - будущий месяц → пустой срез (дата до начала месяца).
 */
export function resolveCabinetAsOfDate(
  month: string,
  today: string = isoDateLocal(new Date()),
): string | undefined {
  const { year, month: mo } = parseMonthKey(month)
  const last = daysInMonth(year, mo)
  const monthStart = `${month}-01`
  const monthEnd = `${month}-${String(last).padStart(2, '0')}`
  if (today < monthStart) return '0000-01-01'
  if (today > monthEnd) return undefined
  return today
}

export function isDateOnOrBefore(dateKey: string, asOfDate: string | undefined): boolean {
  if (!asOfDate) return true
  return dateKey <= asOfDate
}
