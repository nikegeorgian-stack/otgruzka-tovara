import {
  employeeName,
  employeeNameLines,
  employeePosition,
  employeePositionLines,
  employeeSearchText,
  surnameWithInitials,
} from './employeeText'
import { ka } from './ka'
import { en } from './en'
import { ru } from './ru'
import type { Dict, Locale } from './types'

const DICTS: Record<Locale, Dict> = { ru, ka, en }

export function t(locale: Locale, key: string): string {
  return DICTS[locale][key] ?? DICTS.ru[key] ?? key
}

export {
  employeeName,
  employeeNameLines,
  employeePosition,
  employeePositionLines,
  employeeSearchText,
  surnameWithInitials,
}

export function tf(locale: Locale, key: string, vars: Record<string, string | number>): string {
  let s = t(locale, key)
  for (const [k, v] of Object.entries(vars)) {
    s = s.replaceAll(`{${k}}`, String(v))
  }
  return s
}

export { LOCALES, type Locale } from './types'
