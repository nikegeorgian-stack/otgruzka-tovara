import { employeeNameLines } from '@/i18n'
import { collatorLocale } from '@/i18n/localeFormat'
import type { Locale } from '@/i18n/types'
import { primaryIbanDisplay, primaryIbanRaw } from '@/lib/hr/employeeBank'
import type { AppStore, Employee } from '@/lib/types'

export type AccountantHandoffRow = {
  employeeId: string
  name: string
  amount: number
  ibanDisplay: string
  ibanRaw: string
  note?: string
  missingIban: boolean
}

type LineLike = { employeeId: string; amount: number; note?: string }

/** Строки для бухгалтера: ФИО, IBAN, сумма — из строк документа. */
export function buildAccountantHandoffRows(
  store: AppStore,
  lines: LineLike[],
  locale: Locale,
): AccountantHandoffRow[] {
  const byId = new Map(store.employees.map((e) => [e.id, e]))
  const collator = collatorLocale(locale)
  const rows: AccountantHandoffRow[] = []
  for (const line of lines) {
    if (!(line.amount > 0) || !line.employeeId) continue
    const emp = byId.get(line.employeeId)
    if (!emp) continue
    const ibanRaw = primaryIbanRaw(emp)
    rows.push({
      employeeId: emp.id,
      name: employeeNameLines(emp, locale).primary,
      amount: Math.round(line.amount),
      ibanDisplay: primaryIbanDisplay(emp),
      ibanRaw,
      note: line.note,
      missingIban: !ibanRaw,
    })
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, collator))
}

/** TSV для вставки в Excel / банк-клиент: ФИО, IBAN, сумма. */
export function accountantHandoffTsv(rows: AccountantHandoffRow[], locale: Locale): string {
  const header =
    locale === 'ka'
      ? 'თანამშრომელი\tIBAN\tთანხა\tშენიშვნა'
      : 'ФИО\tIBAN\tСумма\tПримечание'
  const body = rows
    .map((r) =>
      [r.name, r.ibanRaw || '', String(r.amount), r.note ?? ''].join('\t'),
    )
    .join('\n')
  return `${header}\n${body}`
}

export async function copyAccountantHandoff(
  rows: AccountantHandoffRow[],
  locale: Locale,
): Promise<boolean> {
  const text = accountantHandoffTsv(rows, locale)
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function employeeById(store: AppStore, id: string): Employee | undefined {
  return store.employees.find((e) => e.id === id)
}
