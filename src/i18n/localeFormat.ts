import type { Locale } from '@/i18n/types'

/** BCP 47 tag for Date/Number formatting. */
export function intlLocale(locale: Locale): string {
  if (locale === 'ka') return 'ka-GE'
  if (locale === 'en') return 'en-US'
  return 'ru-RU'
}

/** Collator tag for localeCompare. */
export function collatorLocale(locale: Locale): string {
  if (locale === 'ka') return 'ka'
  if (locale === 'en') return 'en'
  return 'ru'
}

/**
 * Справочники с labelRu/labelKa[/labelEn].
 * EN: labelEn → иначе русский.
 */
export function labelRuKa(
  locale: Locale,
  labelRu: string | undefined,
  labelKa: string | undefined,
  labelEn?: string | undefined,
): string {
  const ru = labelRu?.trim() ?? ''
  const ka = labelKa?.trim() ?? ''
  const en = labelEn?.trim() ?? ''
  if (locale === 'ka') return ka || ru || en
  if (locale === 'en') return en || ru || ka
  return ru || ka || en
}
