import { ruNameToKa } from '@/lib/i18n/ruToKaName'
import { ruNameToEn } from '@/lib/i18n/ruToEnName'
import { translateProductName } from '@/lib/i18n/productNameTranslate'

/** person — ФИО (транслит); product — ГП / номенклатура (смысловой словарь) */
export type LocalizedNameDomain = 'person' | 'product'

/** Draft KA + EN labels from a Russian name. */
export function suggestLocalizedNames(
  nameRu: string,
  domain: LocalizedNameDomain = 'person',
): { ka: string; en: string } {
  const ru = nameRu.trim()
  if (!ru) return { ka: '', en: '' }
  if (domain === 'product') {
    return translateProductName(ru)
  }
  return {
    ka: ruNameToKa(ru),
    en: ruNameToEn(ru),
  }
}

/** Fill missing translations without overwriting manual values. */
export function withSuggestedLocalizedNames<
  T extends { name?: string; nameKa?: string; nameEn?: string },
>(row: T, nameRu?: string, domain: LocalizedNameDomain = 'person'): T {
  const ru = (nameRu ?? row.name ?? '').trim()
  if (!ru) return row
  const { ka, en } = suggestLocalizedNames(ru, domain)
  return {
    ...row,
    nameKa: row.nameKa?.trim() ? row.nameKa : ka || row.nameKa,
    nameEn: row.nameEn?.trim() ? row.nameEn : en || row.nameEn,
  }
}
