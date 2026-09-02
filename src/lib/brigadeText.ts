import type { Locale } from './types'

export function brigadeLabel(
  nameRu: string,
  namesKa: Record<string, string>,
  locale: Locale,
  namesEn?: Record<string, string>,
): string {
  const ka = namesKa[nameRu]?.trim()
  const en = namesEn?.[nameRu]?.trim()
  if (locale === 'ka') return ka || nameRu
  if (locale === 'en') return en || nameRu
  return nameRu
}

export function brigadeLines(
  nameRu: string,
  namesKa: Record<string, string>,
  locale: Locale,
  namesEn?: Record<string, string>,
): { primary: string; secondary?: string } {
  return { primary: brigadeLabel(nameRu, namesKa, locale, namesEn) }
}
