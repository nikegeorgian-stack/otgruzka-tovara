import { daysInMonth, parseMonthKey } from './dates'
import type { AppStore, Locale } from './types'

/** Приказ Минтруда Грузии: სამუშაო დროის აღრიცხვის ფორმა */
export const GE_OFFICIAL_FORM_REF = '01-15/ნ'
export const GE_OFFICIAL_FORM_ANNEX = '2'

/** Условные обозначения по приложению №1 к приказу 01-15/ნ */
export const GE_OFFICIAL_MARKS = [
  { code: 'გ', key: 'print.geMark.absence' },
  { code: 'ს/ფ', key: 'print.geMark.sick' },
  { code: 'შ', key: 'print.geMark.paidLeave' },
  { code: 'უხ/შ', key: 'print.geMark.unpaidLeave' },
  { code: 'X', key: 'print.geMark.weekend' },
] as const

export type PrintEmployerSettings = {
  orgRu?: string
  orgKa?: string
  idCode?: string
  unitRu?: string
  unitKa?: string
}

export type GeorgiaPrintHeaderFields = {
  organization: string
  structuralUnit: string
  preparationDate: string
  periodFrom: string
  periodTo: string
  idCode: string
}

function formatGeDate(year: number, month: number, day: number): string {
  return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`
}

export function monthReportingPeriod(monthKey: string): { from: string; to: string } {
  const { year, month } = parseMonthKey(monthKey)
  const last = daysInMonth(year, month)
  return {
    from: formatGeDate(year, month, 1),
    to: formatGeDate(year, month, last),
  }
}

export function resolveGeorgiaPrintHeaderForMonth(
  store: AppStore,
  monthKey: string,
  locale: Locale,
): GeorgiaPrintHeaderFields {
  const emp = store.settings.employer
  const period = monthReportingPeriod(monthKey)

  const organization =
    locale === 'ka'
      ? emp?.orgKa?.trim() || emp?.orgRu?.trim() || store.settings.site
      : emp?.orgRu?.trim() || emp?.orgKa?.trim() || store.settings.site

  const structuralUnit =
    locale === 'ka'
      ? emp?.unitKa?.trim() || emp?.unitRu?.trim() || store.settings.site
      : emp?.unitRu?.trim() || emp?.unitKa?.trim() || store.settings.site

  return {
    organization,
    structuralUnit,
    preparationDate: '_______________',
    periodFrom: period.from,
    periodTo: period.to,
    idCode: emp?.idCode?.trim() || '_______________',
  }
}

/** Внутренний код FST → официальное обозначение Грузии (для легенды). */
export const FST_TO_GE_OFFICIAL: Partial<Record<string, string>> = {
  Б: 'ს/ფ',
  ОТ: 'შ',
  ОО: 'უხ/შ',
  /** Прогул (FST X) → გ; не путать с ПР (простой). */
  X: 'გ',
  В: 'X',
}
