import { formatIban, normalizeIban, detectBankFromIban } from './banks'
import type { Employee, HrBankAccount } from '@/lib/types'
import type { Locale } from '@/i18n/types'

export function primaryBankAccount(emp: Employee): HrBankAccount | undefined {
  const list = emp.bankAccounts ?? []
  const today = new Date().toISOString().slice(0, 10)
  const active = list.filter((a) => a.iban?.trim() && accountActiveOn(a, today))
  const primary = active.find((a) => a.isPrimary)
  if (primary) return primary
  return active.find((a) => a.iban?.trim()) ?? list.find((a) => a.iban?.trim())
}

export function primaryIbanRaw(emp: Employee): string {
  const acc = primaryBankAccount(emp)
  return acc?.iban ? normalizeIban(acc.iban) : ''
}

export function primaryIbanDisplay(emp: Employee): string {
  const raw = primaryIbanRaw(emp)
  return raw ? formatIban(raw) : ''
}

/** Название банка по основному IBAN (или пусто). */
export function primaryBankName(emp: Employee, locale: Locale = 'ru'): string {
  const bank = detectBankFromIban(primaryIbanRaw(emp))
  if (!bank) return ''
  return locale === 'ka' ? bank.nameKa : bank.nameRu
}

export function accountActiveOn(acc: HrBankAccount, date: string): boolean {
  if (acc.validFrom && date < acc.validFrom) return false
  if (acc.validUntil && date > acc.validUntil) return false
  return true
}

/** Счёт, действовавший на дату (основной среди активных, иначе любой активный). */
export function bankAccountAtDate(
  accounts: HrBankAccount[] | undefined,
  date: string,
): HrBankAccount | undefined {
  const list = (accounts ?? []).filter((a) => a.iban?.trim() && accountActiveOn(a, date))
  if (list.length === 0) return undefined
  return list.find((a) => a.isPrimary) ?? list[0]
}

export function formatIbanDisplay(iban: string): string {
  const raw = normalizeIban(iban)
  return raw ? formatIban(raw) : '—'
}

export function formatBankAccountLabel(acc: HrBankAccount | undefined): string {
  if (!acc?.iban?.trim()) return '—'
  const iban = formatIbanDisplay(acc.iban)
  const period =
    acc.validFrom || acc.validUntil
      ? ` (${acc.validFrom || '…'} — ${acc.validUntil || '…'})`
      : ''
  return `${iban}${period}`
}

/** Компактная подпись списка счетов для журнала. */
export function bankAccountsSummary(accounts: HrBankAccount[] | undefined): string {
  const list = (accounts ?? []).filter((a) => a.iban?.trim())
  if (list.length === 0) return '—'
  const primary = list.find((a) => a.isPrimary) ?? list[0]
  const more = list.length > 1 ? ` (+${list.length - 1})` : ''
  return `${formatIban(normalizeIban(primary.iban))}${more}`
}

function accountKey(a: HrBankAccount): string {
  return [
    a.id,
    normalizeIban(a.iban || ''),
    a.isPrimary ? '1' : '0',
    a.validFrom || '',
    a.validUntil || '',
    a.currency || 'GEL',
  ].join('|')
}

export function sameBankAccounts(
  a: HrBankAccount[] | undefined,
  b: HrBankAccount[] | undefined,
): boolean {
  const aa = [...(a ?? [])].map(accountKey).sort()
  const bb = [...(b ?? [])].map(accountKey).sort()
  if (aa.length !== bb.length) return false
  return aa.every((k, i) => k === bb[i])
}

/**
 * При назначении основного счёта с даты: закрывает прежние основные
 * и проставляет validFrom новому (если не задан).
 */
export function promoteBankAccount(
  accounts: HrBankAccount[],
  accountId: string,
  fromDate: string,
): HrBankAccount[] {
  return accounts.map((a) => {
    if (a.id === accountId) {
      return {
        ...a,
        isPrimary: true,
        validFrom: a.validFrom || fromDate,
        validUntil: undefined,
      }
    }
    if (a.isPrimary && !a.validUntil) {
      const until = dayBefore(fromDate)
      return { ...a, isPrimary: false, validUntil: until || a.validUntil }
    }
    return { ...a, isPrimary: false }
  })
}

function dayBefore(iso: string): string | undefined {
  const d = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(d.getTime())) return undefined
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}
