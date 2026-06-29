import { resolveCountryCode } from './countries'
import { newId } from '@/lib/production/files'
import type {
  Counterparty,
  CounterpartyBankAccount,
  CounterpartyContract,
  CounterpartyStore,
} from './types'

export function formatCounterpartyCode(n: number): string {
  return `КА-${String(n).padStart(6, '0')}`
}

function normalizeAccount(a: CounterpartyBankAccount): CounterpartyBankAccount {
  return {
    id: a.id || newId(),
    bankName: a.bankName?.trim() ?? '',
    accountNumber: a.accountNumber?.trim() ?? '',
    currency: a.currency?.trim() || 'GEL',
    isPrimary: !!a.isPrimary,
    note: a.note?.trim() || undefined,
  }
}

function normalizeContract(c: CounterpartyContract): CounterpartyContract {
  return {
    id: c.id || newId(),
    number: c.number?.trim() ?? '',
    signedAt: c.signedAt ?? '',
    subject: c.subject?.trim() ?? '',
    validUntil: c.validUntil || undefined,
    amount: c.amount,
    currency: c.currency?.trim() || undefined,
    note: c.note?.trim() || undefined,
  }
}

export function normalizeCounterparty(c: Counterparty): Counterparty {
  return {
    ...c,
    code: c.code?.trim() || formatCounterpartyCode(1),
    name: c.name?.trim() ?? '',
    legalName: c.legalName?.trim() || undefined,
    role: c.role === 'supplier' || c.role === 'both' ? c.role : 'customer',
    taxId: c.taxId?.trim() || undefined,
    countryCode:
      c.countryCode?.trim() ||
      resolveCountryCode((c as Counterparty & { country?: string }).country) ||
      undefined,
    phone: c.phone?.trim() || undefined,
    email: c.email?.trim() || undefined,
    address: c.address?.trim() || undefined,
    contactPerson: c.contactPerson?.trim() || undefined,
    bankAccounts: (c.bankAccounts ?? []).map(normalizeAccount),
    contracts: (c.contracts ?? []).map(normalizeContract),
    note: c.note?.trim() || undefined,
    active: c.active !== false,
    createdAt: c.createdAt || new Date().toISOString(),
    updatedAt: c.updatedAt || new Date().toISOString(),
  }
}

export const SEED_A2LINE_COUNTERPARTY_ID = 'seed-counterparty-a2line'

export function findA2LineCounterparty(items: Counterparty[]): Counterparty | undefined {
  return items.find((c) => c.name.trim().toUpperCase().includes('A2LINE'))
}

export function seedA2LineCounterparty(existing: Counterparty[]): Counterparty {
  const found = findA2LineCounterparty(existing)
  if (found) return found

  const now = new Date().toISOString()
  const maxCode = existing.reduce((max, c) => {
    const m = c.code.match(/(\d+)\s*$/)
    return m ? Math.max(max, Number(m[1])) : max
  }, 0)

  return normalizeCounterparty({
    id: existing.some((c) => c.id === SEED_A2LINE_COUNTERPARTY_ID)
      ? newId()
      : SEED_A2LINE_COUNTERPARTY_ID,
    code: formatCounterpartyCode(maxCode + 1),
    name: 'A2LINE',
    role: 'customer',
    countryCode: 'PT',
    contactPerson: 'Денис',
    note: 'Португалия · заказчик готовой продукции',
    bankAccounts: [],
    contracts: [],
    active: true,
    createdAt: now,
    updatedAt: now,
  })
}

export function createDefaultCounterparties(): CounterpartyStore {
  return {
    items: [seedA2LineCounterparty([])],
    nextCode: 2,
  }
}

export function normalizeCounterpartyStore(raw: CounterpartyStore | undefined): CounterpartyStore {
  let items = (raw?.items ?? []).map(normalizeCounterparty)
  if (!findA2LineCounterparty(items)) {
    items = [...items, seedA2LineCounterparty(items)]
  }
  const maxFromCodes = items.reduce((max, i) => {
    const m = i.code.match(/(\d+)\s*$/)
    return m ? Math.max(max, Number(m[1])) : max
  }, 0)
  return {
    items,
    nextCode: Math.max(raw?.nextCode ?? 1, maxFromCodes + 1),
  }
}

export function nextCounterpartyCode(store: CounterpartyStore): string {
  return formatCounterpartyCode(store.nextCode)
}

export function emptyCounterparty(store: CounterpartyStore): Counterparty {
  const now = new Date().toISOString()
  return {
    id: newId(),
    code: nextCounterpartyCode(store),
    name: '',
    role: 'customer',
    bankAccounts: [],
    contracts: [],
    active: true,
    createdAt: now,
    updatedAt: now,
  }
}
