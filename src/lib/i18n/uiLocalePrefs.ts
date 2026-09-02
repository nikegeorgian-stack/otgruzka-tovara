import type { Locale } from '@/i18n/types'

const DEVICE_KEY = 'fst.uiLocale:device'

function keyFor(userId: string | null | undefined): string {
  return userId?.trim() ? `fst.uiLocale:${userId.trim()}` : DEVICE_KEY
}

export function isLocale(value: unknown): value is Locale {
  return value === 'ru' || value === 'ka' || value === 'en'
}

export function readUiLocalePref(userId?: string | null): Locale | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const v = localStorage.getItem(keyFor(userId))
    return isLocale(v) ? v : null
  } catch {
    return null
  }
}

export function writeUiLocalePref(userId: string | null | undefined, locale: Locale): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(keyFor(userId), locale)
  } catch {
    /* ignore quota / private mode */
  }
}
