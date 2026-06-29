export type EmployeeCitizenship = 'GE' | 'RU' | 'AM' | 'AZ' | 'UA' | 'OTHER'

export const CITIZENSHIP_OPTIONS: { value: EmployeeCitizenship; labelRu: string; labelKa: string }[] =
  [
    { value: 'GE', labelRu: 'Грузия', labelKa: 'საქართველო' },
    { value: 'RU', labelRu: 'Россия', labelKa: 'რუსეთი' },
    { value: 'AM', labelRu: 'Армения', labelKa: 'სომხეთი' },
    { value: 'AZ', labelRu: 'Азербайджан', labelKa: 'აზერბაიჯანი' },
    { value: 'UA', labelRu: 'Украина', labelKa: 'უკრაინა' },
    { value: 'OTHER', labelRu: 'Другое', labelKa: 'სხვა' },
  ]

export function citizenshipLabel(code: EmployeeCitizenship | undefined, locale: 'ru' | 'ka'): string {
  if (!code) return '—'
  const row = CITIZENSHIP_OPTIONS.find((o) => o.value === code)
  if (!row) return code
  return locale === 'ka' ? row.labelKa : row.labelRu
}

export function isGeorgianCitizen(code: EmployeeCitizenship | undefined): boolean {
  return code === 'GE'
}

/** Грузинский личный номер: 11 цифр */
export function looksLikeGeorgianPersonalId(value: string): boolean {
  return /^\d{11}$/.test(value.trim())
}
