import { normalizeCounterparty, nextCounterpartyCode } from '@/lib/counterparties/init'
import type { Counterparty, CounterpartyContract, CounterpartyStore } from '@/lib/counterparties/types'
import { newId } from '@/lib/production/files'
import { warehouseItemFromOrderLine } from './warehouseFromLine'
import type { PurchaseOrder, PurchaseOrderLine } from './types'
import type { WarehouseItem, WarehouseStore } from '@/lib/warehouse/types'

export type PendingSupplier = {
  name: string
  legalName?: string
  countryCode?: string
  taxId?: string
  contactPerson?: string
  email?: string
  phone?: string
}

export type PendingContract = {
  number: string
  subject: string
  signedAt: string
  currency?: string
  amount?: number
  validUntil?: string
}

export type OrderSyncInput = {
  order: PurchaseOrder
  pendingSupplier?: PendingSupplier | null
  pendingContract?: PendingContract | null
  linesToNomenclature: Set<string>
  counterparties: Counterparty[]
  counterpartyStore: CounterpartyStore
  warehouse: WarehouseStore
}

export type OrderSyncCallbacks = {
  upsertCounterparty: (c: Counterparty) => void
  upsertWarehouseItem: (item: WarehouseItem) => void
}

export type OrderSyncResult = {
  order: PurchaseOrder
  createdSupplier?: boolean
  createdContract?: boolean
  createdItems: number
}

export function syncOrderBeforeSave(
  input: OrderSyncInput,
  callbacks: OrderSyncCallbacks,
): OrderSyncResult {
  let counterpartyId = input.order.counterpartyId
  let contractId = input.order.contractId
  let createdSupplier = false
  let createdContract = false
  let createdItems = 0

  if (input.pendingSupplier?.name.trim()) {
    const now = new Date().toISOString()
    const cp = normalizeCounterparty({
      id: newId(),
      code: nextCounterpartyCode(input.counterpartyStore),
      name: input.pendingSupplier.name.trim(),
      legalName: input.pendingSupplier.legalName?.trim(),
      role: 'supplier',
      countryCode: input.pendingSupplier.countryCode || 'CN',
      taxId: input.pendingSupplier.taxId?.trim(),
      contactPerson: input.pendingSupplier.contactPerson?.trim(),
      email: input.pendingSupplier.email?.trim(),
      phone: input.pendingSupplier.phone?.trim(),
      bankAccounts: [],
      contracts: [],
      active: true,
      createdAt: now,
      updatedAt: now,
    })
    callbacks.upsertCounterparty(cp)
    counterpartyId = cp.id
    createdSupplier = true
  }

  if (input.pendingContract?.number.trim() && counterpartyId) {
    const cp = input.counterparties.find((c) => c.id === counterpartyId)
    if (cp) {
      const contract: CounterpartyContract = {
        id: newId(),
        number: input.pendingContract.number.trim(),
        subject: input.pendingContract.subject.trim() || 'Поставка',
        signedAt: input.pendingContract.signedAt || new Date().toISOString().slice(0, 10),
        currency: input.pendingContract.currency,
        amount: input.pendingContract.amount,
        validUntil: input.pendingContract.validUntil,
      }
      callbacks.upsertCounterparty({
        ...cp,
        contracts: [...cp.contracts, contract],
        updatedAt: new Date().toISOString(),
      })
      contractId = contract.id
      createdContract = true
    }
  }

  const lines: PurchaseOrderLine[] = []
  for (const line of input.order.lines) {
    let warehouseItemId = line.warehouseItemId
    const shouldCreate =
      input.linesToNomenclature.has(line.id) &&
      !warehouseItemId &&
      line.name.trim()

    if (shouldCreate) {
      const item = warehouseItemFromOrderLine(
        line,
        input.warehouse,
        input.order.destinationWarehouseId,
      )
      callbacks.upsertWarehouseItem(item)
      warehouseItemId = item.id
      createdItems++
    }

    lines.push({
      ...line,
      warehouseItemId,
      currency: line.currency || input.order.currency,
    })
  }

  return {
    order: {
      ...input.order,
      counterpartyId,
      contractId,
      lines,
    },
    createdSupplier,
    createdContract,
    createdItems,
  }
}
