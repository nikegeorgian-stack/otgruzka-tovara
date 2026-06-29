export type CounterpartyRole = 'customer' | 'supplier' | 'both'

export type CounterpartyBankAccount = {
  id: string
  bankName: string
  accountNumber: string
  currency: string
  isPrimary: boolean
  note?: string
}

export type CounterpartyContract = {
  id: string
  number: string
  signedAt: string
  subject: string
  validUntil?: string
  amount?: number
  currency?: string
  note?: string
}

export type Counterparty = {
  id: string
  /** Внутренний код КА-000001 */
  code: string
  name: string
  legalName?: string
  role: CounterpartyRole
  taxId?: string
  /** ISO-код страны (AU, GE, RU…) */
  countryCode?: string
  phone?: string
  email?: string
  address?: string
  contactPerson?: string
  bankAccounts: CounterpartyBankAccount[]
  contracts: CounterpartyContract[]
  note?: string
  active: boolean
  createdAt: string
  updatedAt: string
}

export type CounterpartyStore = {
  items: Counterparty[]
  nextCode: number
}
