import type { Employee } from '@/lib/types'
import type { Locale } from './types'

/** Один язык по локали интерфейса; при отсутствии перевода — fallback. */
function localeText(
  ru: string | undefined,
  ka: string | undefined,
  locale: Locale,
  en?: string | undefined,
): string {
  const r = ru?.trim() ?? ''
  const k = ka?.trim() ?? ''
  const e = en?.trim() ?? ''
  if (locale === 'ka') return k || r || e || '—'
  if (locale === 'en') return e || r || k || '—'
  return r || k || e || '—'
}

export type BilingualLines = { primary: string; secondary?: string }

export function employeeNameLines(emp: Employee, locale: Locale): BilingualLines {
  return { primary: localeText(emp.fullName, emp.nameKa, locale, emp.nameEn) }
}

export function employeePositionLines(emp: Employee, locale: Locale): BilingualLines {
  return { primary: localeText(emp.position, emp.positionKa, locale) }
}

export function employeeName(emp: Employee, locale: Locale): string {
  return localeText(emp.fullName, emp.nameKa, locale, emp.nameEn)
}

/** «Иванов Иван Петрович» → «Иванов И.П.» */
export function surnameWithInitials(fullName: string | undefined | null): string {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]!
  const surname = parts[0]!
  const initials = parts
    .slice(1)
    .map((p) => `${p.charAt(0).toUpperCase()}.`)
    .join('')
  return `${surname} ${initials}`
}

export function employeePosition(emp: Employee, locale: Locale): string {
  return localeText(emp.position, emp.positionKa, locale)
}

export function employeeSearchText(emp: Employee): string {
  return [emp.fullName, emp.nameKa, emp.nameEn, emp.position, emp.positionKa, emp.tabNumber, emp.employeeNumber]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}
