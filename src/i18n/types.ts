export type Locale = 'ru' | 'ka' | 'en'

export type Dict = Record<string, string>

export const LOCALES: { id: Locale; label: string }[] = [
  { id: 'ru', label: 'Русский' },
  { id: 'ka', label: 'ქართული' },
  { id: 'en', label: 'English' },
]
