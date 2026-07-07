import type { Counterparty } from '@/lib/counterparties/types'
import { isDocumentNumberTaken } from './docNumbering'
import { isWarehousePeriodClosed } from './periodClose'
import type { WarehouseDocument, WarehouseStore } from './types'

export type DocumentFieldErrors = Record<string, string>

export function counterpartyOptionsForPurpose(
  counterparties: Counterparty[],
  purpose: WarehouseDocument['purpose'],
): Counterparty[] {
  const active = counterparties.filter((c) => c.active)
  if (purpose === 'purchase') {
    return active.filter((c) => c.role === 'supplier' || c.role === 'both')
  }
  if (purpose === 'return') {
    return active.filter(
      (c) => c.role === 'customer' || c.role === 'supplier' || c.role === 'both',
    )
  }
  return []
}

/** Заказчики для погрузки готовой продукции */
export function counterpartyOptionsForLoading(counterparties: Counterparty[]): Counterparty[] {
  return counterparties
    .filter((c) => c.active && (c.role === 'customer' || c.role === 'both'))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
}

export function counterpartyRoleLabelKey(
  role: Counterparty['role'],
): 'counterparty.role.customer' | 'counterparty.role.supplier' | 'counterparty.role.both' {
  if (role === 'supplier') return 'counterparty.role.supplier'
  if (role === 'both') return 'counterparty.role.both'
  return 'counterparty.role.customer'
}

export function counterpartyOptionLabel(
  c: Counterparty,
  t: (key: string) => string,
): string {
  return `${c.code} · ${c.name} · ${t(counterpartyRoleLabelKey(c.role))}`
}

export type CounterpartyPickFilter = 'loading' | 'purchase' | 'return'

export function counterpartyOptionsForPickFilter(
  counterparties: Counterparty[],
  filter: CounterpartyPickFilter,
): Counterparty[] {
  if (filter === 'loading') return counterpartyOptionsForLoading(counterparties)
  if (filter === 'purchase') return counterpartyOptionsForPurpose(counterparties, 'purchase')
  return counterpartyOptionsForPurpose(counterparties, 'return')
}

export function enrichDocumentCounterparty<T extends { counterparty?: string; counterpartyId?: string }>(
  doc: T,
  counterparties: Counterparty[],
): T {
  if (doc.counterparty?.trim()) return doc
  if (!doc.counterpartyId) return doc
  const name = counterparties.find((c) => c.id === doc.counterpartyId)?.name
  return name ? { ...doc, counterparty: name } : doc
}

export function resolveCounterpartyDisplayName(
  doc: { counterparty?: string; counterpartyId?: string },
  counterparties: Counterparty[],
  fallback = '—',
): string {
  if (doc.counterparty?.trim()) return doc.counterparty.trim()
  if (doc.counterpartyId) {
    return counterparties.find((c) => c.id === doc.counterpartyId)?.name ?? fallback
  }
  return fallback
}

export function matchCounterpartyId(
  counterparties: Counterparty[],
  name: string,
  taxId?: string,
): string | undefined {
  const active = counterparties.filter((c) => c.active)
  if (taxId?.trim()) {
    const byTin = active.find((c) => c.taxId?.trim() === taxId.trim())
    if (byTin) return byTin.id
  }
  const n = name.trim().toLowerCase()
  if (!n) return undefined
  return active.find(
    (c) =>
      c.name.trim().toLowerCase() === n ||
      c.legalName?.trim().toLowerCase() === n,
  )?.id
}

export function validateWarehouseDocumentInput(
  store: WarehouseStore,
  doc: Omit<WarehouseDocument, 'id' | 'createdAt' | 'status'> & { id?: string },
  excludeId?: string,
): { ok: true } | { ok: false; errors: DocumentFieldErrors } {
  const errors: DocumentFieldErrors = {}
  const skipId = excludeId ?? doc.id

  if (!doc.warehouseId) errors.warehouseId = 'warehouse.doc.errWarehouse'
  if (!doc.number?.trim()) errors.number = 'warehouse.doc.errNumber'
  else if (isDocumentNumberTaken(store.documents, doc.number, skipId)) {
    errors.number = 'warehouse.doc.errDuplicateNumber'
  }
  if (!doc.date) errors.date = 'warehouse.doc.errDate'
  else if (isWarehousePeriodClosed(store.closedMonths, doc.date)) {
    errors.date = 'warehouse.doc.errPeriodClosed'
  }
  if (!doc.lines.length) errors.lines = 'warehouse.doc.errLines'
  if (doc.purpose === 'purchase' && doc.type === 'receipt') {
    if (!doc.counterpartyId && !doc.counterparty?.trim()) {
      errors.counterpartyId = 'warehouse.doc.errCounterparty'
    }
  }

  if (doc.purpose === 'return') {
    if (!doc.counterpartyId && !doc.counterparty?.trim()) {
      errors.counterpartyId = 'warehouse.doc.errReturnCounterparty'
    }
  }

  if (doc.purpose === 'production_issue') {
    if (!doc.brigade?.trim()) errors.brigade = 'warehouse.doc.errBrigade'
  }

  if (doc.purpose === 'writeoff') {
    if (!doc.writeoffReason) errors.writeoffReason = 'warehouse.doc.errWriteoffReason'
    if (doc.writeoffReason === 'other' && !doc.comment?.trim()) {
      errors.comment = 'warehouse.doc.errWriteoffComment'
    }
  }

  if (doc.purpose === 'transfer') {
    if (!doc.targetWarehouseId) errors.targetWarehouseId = 'warehouse.doc.errTargetWarehouse'
    else if (doc.targetWarehouseId === doc.warehouseId) {
      errors.targetWarehouseId = 'warehouse.doc.errSameWarehouse'
    }
  }

  if (doc.type === 'inventory') {
    for (const line of doc.lines) {
      if (!line.itemId || line.quantity < 0 || Number.isNaN(line.quantity)) {
        errors.lines = 'warehouse.doc.errLines'
        break
      }
    }
  } else {
    for (const line of doc.lines) {
      if (!line.itemId || line.quantity <= 0) {
        errors.lines = 'warehouse.doc.errLines'
        break
      }
    }
  }

  return Object.keys(errors).length === 0 ? { ok: true } : { ok: false, errors }
}

export function documentCanBeCancelled(doc: WarehouseDocument): boolean {
  if (doc.status === 'cancelled') return false
  if (doc.reversesDocumentId) return false
  if (doc.batchRunId) return false
  if (doc.docRole === 'batch_issue' || doc.docRole === 'batch_receipt') return false
  return true
}
