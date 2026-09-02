export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

export function parseMonthKey(key: string): { year: number; month: number } {
  const [y, m] = key.split('-').map(Number)
  return { year: y, month: m }
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

export function dayDateKey(year: number, month: number, day: number): string {
  return `${monthKey(year, month)}-${String(day).padStart(2, '0')}`
}

const MONTH_NAMES = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
]

const MONTH_NAMES_KA = [
  'იანვარი',
  'თებერვალი',
  'მარტი',
  'აპრილი',
  'მაისი',
  'ივნისი',
  'ივლისი',
  'აგვისტო',
  'სექტემბერი',
  'ოქტომბერი',
  'ნოემბერი',
  'დეკემბერი',
]

const MONTH_NAMES_EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

function monthNames(locale: 'ru' | 'ka' | 'en') {
  if (locale === 'ka') return MONTH_NAMES_KA
  if (locale === 'en') return MONTH_NAMES_EN
  return MONTH_NAMES
}

export function formatMonthTitle(key: string, locale: 'ru' | 'ka' | 'en' = 'ru'): string {
  const { year, month } = parseMonthKey(key)
  const names = monthNames(locale)
  return `${names[month - 1]} ${year}`
}

/** «Август 2026» — для заголовка «График работ на …». */
export function formatMonthNameCapitalized(key: string, locale: 'ru' | 'ka' | 'en' = 'ru'): string {
  const { year, month } = parseMonthKey(key)
  const names = monthNames(locale)
  const raw = names[month - 1] ?? ''
  if (locale === 'en') return `${raw} ${year}`
  const cap = raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : raw
  return `${cap} ${year}`
}

export function shiftMonth(key: string, delta: number): string {
  const { year, month } = parseMonthKey(key)
  const d = new Date(year, month - 1 + delta, 1)
  return monthKey(d.getFullYear(), d.getMonth() + 1)
}

export function isWeekend(year: number, month: number, day: number): boolean {
  const dow = new Date(year, month - 1, day).getDay()
  return dow === 0 || dow === 6
}

const DOW_SHORT_RU = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
const DOW_SHORT_KA = ['კვ', 'ორშ', 'სამ', 'ოთხ', 'ხუთ', 'პარ', 'შაბ']
const DOW_SHORT_EN = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

export function weekdayShort(
  year: number,
  month: number,
  day: number,
  locale: 'ru' | 'ka' | 'en' = 'ru',
): string {
  const names =
    locale === 'ka' ? DOW_SHORT_KA : locale === 'en' ? DOW_SHORT_EN : DOW_SHORT_RU
  return names[new Date(year, month - 1, day).getDay()]
}

export function isoDateLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Понедельник недели, в которую попадает дата (ISO YYYY-MM-DD). */
export function mondayOfWeekIso(iso?: string): string {
  const base = iso ? new Date(`${iso}T12:00:00`) : new Date()
  const dow = base.getDay()
  const diff = dow === 0 ? -6 : 1 - dow
  const mon = new Date(base)
  mon.setDate(base.getDate() + diff)
  return isoDateLocal(mon)
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + days)
  return isoDateLocal(d)
}

export function parseIsoDate(iso: string): { year: number; month: number; day: number } {
  const [y, m, d] = iso.split('-').map(Number)
  return { year: y, month: m, day: d }
}

export function formatShortDate(iso: string, locale: 'ru' | 'ka' | 'en' = 'ru'): string {
  const { year, month, day } = parseIsoDate(iso)
  const tag = locale === 'ka' ? 'ka-GE' : locale === 'en' ? 'en-US' : 'ru-RU'
  return new Date(year, month - 1, day).toLocaleDateString(tag, {
    day: '2-digit',
    month: '2-digit',
  })
}
