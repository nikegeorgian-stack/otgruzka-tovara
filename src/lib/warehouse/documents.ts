import { appendWarehouseAudit } from './audit'
import { isDocumentNumberTaken, nextReversalNumber } from './docNumbering'
import { documentCanBeCancelled, validateWarehouseDocumentInput } from './documentValidation'
import { toBaseQty } from './stock'
import type { StockMovement, WarehouseDocument, WarehouseStore } from './types'

export type PostDocumentResult =
  | { ok: true; documentId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

export type CancelDocumentResult =
  | { ok: true; reversalIds: string[] }
  | { ok: false; error: string }

export function isInvoiceAlreadyPosted(
  store: WarehouseStore,
  invoiceKey: string | undefined,
): boolean {
  if (!invoiceKey?.trim()) return false
  return store.documents.some(
    (d) =>
      d.type === 'receipt' &&
      d.invoiceKey === invoiceKey &&
      d.status !== 'cancelled',
  )
}

export function postWarehouseDocument(
  store: WarehouseStore,
  doc: Omit<WarehouseDocument, 'id' | 'createdAt'> & { skipAudit?: boolean; skipValidation?: boolean },
): { store: WarehouseStore; result: PostDocumentResult } {
  const { skipAudit, skipValidation, ...docRest } = doc

  if (!skipValidation) {
    const { status: _status, ...docForValidation } = docRest
    const validation = validateWarehouseDocumentInput(store, docForValidation)
    if (!validation.ok) {
      const first = Object.values(validation.errors)[0] ?? 'warehouse.doc.errGeneric'
      return { store, result: { ok: false, error: first, fieldErrors: validation.errors } }
    }
  }

  if (doc.type === 'receipt' && isInvoiceAlreadyPosted(store, doc.invoiceKey)) {
    return { store, result: { ok: false, error: 'warehouse.invoice.alreadyPosted' } }
  }

  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  const full: WarehouseDocument = {
    ...docRest,
    status: docRest.status ?? 'posted',
    id,
    createdAt,
  }

  const itemMap = new Map(store.items.map((i) => [i.id, i]))
  const isReceipt = full.type === 'receipt'
  const movements: StockMovement[] = full.lines.map((line) => {
    const item = itemMap.get(line.itemId)
    const qty = item
      ? toBaseQty(item, line.quantity, line.inputUnit)
      : line.quantity
    // Цена указывается за единицу ввода — приводим к базовой единице.
    const unitCost =
      isReceipt && line.unitPrice != null && qty > 0
        ? (line.unitPrice * line.quantity) / qty
        : undefined
    return {
      id: crypto.randomUUID(),
      itemId: line.itemId,
      warehouseId: full.warehouseId,
      type: full.type,
      quantity: qty,
      date: full.date,
      documentId: id,
      documentNo: full.number,
      brigade: full.brigade,
      comment: full.comment,
      inputUnit: line.inputUnit,
      unitCost,
      batchNo: isReceipt ? line.batchNo : undefined,
      expiryDate: isReceipt ? line.expiryDate : undefined,
      createdAt,
    }
  })

  let next: WarehouseStore = {
    ...store,
    documents: [...store.documents, full],
    movements: [...store.movements, ...movements],
  }
  if (!skipAudit) {
    next = appendWarehouseAudit(next, {
      action: full.reversesDocumentId ? 'document_cancel' : 'document_post',
      detail: full.reversesDocumentId
        ? `Сторно ${full.reversesDocumentId.slice(0, 8)} · ${full.type === 'receipt' ? 'Приход' : 'Расход'} №${full.number}`
        : `${full.type === 'receipt' ? 'Приход' : 'Расход'} №${full.number} · ${full.lines.length} поз.`,
      actorId: full.keeperId,
      actorName: full.keeperName,
    })
  }
  return { store: next, result: { ok: true, documentId: id } }
}

export function runInventoryCount(
  store: WarehouseStore,
  args: {
    itemId: string
    warehouseId: string
    counted: number
    date: string
    comment?: string
  },
): WarehouseStore {
  const { itemId, warehouseId, counted, date, comment } = args
  const item = store.items.find((i) => i.id === itemId)
  if (!item) return store

  let receipt = 0
  let issue = 0
  let adjustment = 0
  for (const m of store.movements) {
    if (m.itemId !== itemId || m.warehouseId !== warehouseId) continue
    if (m.type === 'receipt') receipt += Math.abs(m.quantity)
    else if (m.type === 'issue') issue += Math.abs(m.quantity)
    else if (m.type === 'adjustment' || m.type === 'inventory') adjustment += m.quantity
  }
  const current = receipt - issue + adjustment
  const delta = counted - current
  if (Math.abs(delta) < 1e-9) return store

  const movement: StockMovement = {
    id: crypto.randomUUID(),
    itemId,
    warehouseId,
    type: 'inventory',
    quantity: delta,
    date,
    comment: comment ?? `Инвентаризация: было ${current}, стало ${counted}`,
    createdAt: new Date().toISOString(),
  }

  let next: WarehouseStore = {
    ...store,
    movements: [...store.movements, movement],
  }
  next = appendWarehouseAudit(next, {
    action: 'inventory',
    detail: `${item.name}: ${current} → ${counted}`,
    itemId,
  })
  return next
}

export type InventoryRevisionLine = {
  itemId: string
  counted: number
}

export type InventoryRevisionResult = {
  applied: number
  skipped: number
  unchanged: number
}

/** Массовая ревизия: корректировка фактических остатков по списку позиций */
export function postInventoryRevision(
  store: WarehouseStore,
  args: {
    warehouseId: string
    date: string
    comment?: string
    lines: InventoryRevisionLine[]
  },
): { store: WarehouseStore; result: InventoryRevisionResult } {
  const { warehouseId, date, comment, lines } = args
  const itemMap = new Map(store.items.map((i) => [i.id, i]))
  const batchComment =
    comment?.trim() || `Ревизия от ${date.split('-').reverse().join('.')}`

  let next = store
  let applied = 0
  let skipped = 0
  let unchanged = 0

  for (const line of lines) {
    const item = itemMap.get(line.itemId)
    if (!item || !item.active) {
      skipped++
      continue
    }
    if (line.counted < 0 || Number.isNaN(line.counted)) {
      skipped++
      continue
    }

    let receipt = 0
    let issue = 0
    let adjustment = 0
    for (const m of next.movements) {
      if (m.itemId !== line.itemId || m.warehouseId !== warehouseId) continue
      if (m.type === 'receipt') receipt += Math.abs(m.quantity)
      else if (m.type === 'issue') issue += Math.abs(m.quantity)
      else if (m.type === 'adjustment' || m.type === 'inventory') adjustment += m.quantity
    }
    const current = receipt - issue + adjustment
    const delta = line.counted - current
    if (Math.abs(delta) < 1e-9) {
      unchanged++
      continue
    }

    const movement: StockMovement = {
      id: crypto.randomUUID(),
      itemId: line.itemId,
      warehouseId,
      type: 'inventory',
      quantity: delta,
      date,
      comment: `${batchComment}: было ${current}, стало ${line.counted}`,
      createdAt: new Date().toISOString(),
    }
    next = { ...next, movements: [...next.movements, movement] }
    applied++
  }

  if (applied > 0) {
    next = appendWarehouseAudit(next, {
      action: 'inventory',
      detail: `${batchComment} · скорректировано ${applied} поз.`,
    })
  }

  return { store: next, result: { applied, skipped, unchanged } }
}

export type OpeningBalanceLine = {
  itemId: string
  quantity: number
}

export type OpeningBalanceResult = {
  applied: number
  skipped: number
}

/** Начальные остатки: установка остатка для позиций с нулевым учётом */
export function postOpeningBalances(
  store: WarehouseStore,
  args: {
    warehouseId: string
    date: string
    comment?: string
    lines: OpeningBalanceLine[]
  },
): { store: WarehouseStore; result: OpeningBalanceResult } {
  const { warehouseId, date, comment, lines } = args
  const itemMap = new Map(store.items.map((i) => [i.id, i]))
  const batchComment =
    comment?.trim() || `Начальный остаток на ${date.split('-').reverse().join('.')}`

  let next = store
  let applied = 0
  let skipped = 0

  for (const line of lines) {
    const item = itemMap.get(line.itemId)
    if (!item || !item.active) {
      skipped++
      continue
    }
    if (line.quantity <= 0 || Number.isNaN(line.quantity)) {
      skipped++
      continue
    }

    let receipt = 0
    let issue = 0
    let adjustment = 0
    for (const m of next.movements) {
      if (m.itemId !== line.itemId || m.warehouseId !== warehouseId) continue
      if (m.type === 'receipt') receipt += Math.abs(m.quantity)
      else if (m.type === 'issue') issue += Math.abs(m.quantity)
      else if (m.type === 'adjustment' || m.type === 'inventory') adjustment += m.quantity
    }
    const current = receipt - issue + adjustment
    if (Math.abs(current) > 1e-9) {
      skipped++
      continue
    }

    const movement: StockMovement = {
      id: crypto.randomUUID(),
      itemId: line.itemId,
      warehouseId,
      type: 'adjustment',
      quantity: line.quantity,
      date,
      comment: batchComment,
      createdAt: new Date().toISOString(),
    }
    next = { ...next, movements: [...next.movements, movement] }
    applied++
  }

  if (applied > 0) {
    next = appendWarehouseAudit(next, {
      action: 'inventory',
      detail: `${batchComment} · установлено ${applied} поз.`,
    })
  }

  return { store: next, result: { applied, skipped } }
}

export function postWarehouseTransfer(
  store: WarehouseStore,
  args: Omit<WarehouseDocument, 'id' | 'createdAt' | 'type' | 'docRole' | 'transferPairId'> & {
    targetWarehouseId: string
  },
): { store: WarehouseStore; result: PostDocumentResult } {
  const pairId = crypto.randomUUID()
  const issueNo = `${args.number.trim()}-И`
  const receiptNo = `${args.number.trim()}-П`
  const baseComment = [args.comment, 'Перемещение между складами'].filter(Boolean).join(' · ')

  const issueOut = postWarehouseDocument(store, {
    ...args,
    type: 'issue',
    number: issueNo,
    comment: baseComment,
    transferPairId: pairId,
    docRole: 'transfer_issue',
  })
  if (!issueOut.result.ok) return issueOut

  return postWarehouseDocument(issueOut.store, {
    ...args,
    type: 'receipt',
    number: receiptNo,
    warehouseId: args.targetWarehouseId,
    comment: baseComment,
    transferPairId: pairId,
    docRole: 'transfer_receipt',
  })
}

function cancelSingleDocument(
  store: WarehouseStore,
  doc: WarehouseDocument,
  args: { cancelledBy?: string; cancelledByName?: string; reason?: string },
): { store: WarehouseStore; result: CancelDocumentResult } {
  const reversalType = doc.type === 'receipt' ? 'issue' : 'receipt'
  let reversalNumber = nextReversalNumber(doc.number)
  let suffix = 1
  while (isDocumentNumberTaken(store.documents, reversalNumber)) {
    suffix += 1
    reversalNumber = `${nextReversalNumber(doc.number)}${suffix > 1 ? suffix : ''}`
  }

  const reversalOut = postWarehouseDocument(store, {
    type: reversalType,
    number: reversalNumber,
    date: new Date().toISOString().slice(0, 10),
    warehouseId: doc.warehouseId,
    purpose: 'other',
    comment: [`Сторно №${doc.number}`, args.reason].filter(Boolean).join(' · '),
    lines: doc.lines,
    keeperId: args.cancelledBy,
    keeperName: args.cancelledByName,
    reversesDocumentId: doc.id,
    docRole: 'reversal',
    skipValidation: true,
  })
  if (!reversalOut.result.ok) {
    return { store, result: { ok: false, error: reversalOut.result.error } }
  }

  const reversalId = reversalOut.result.documentId
  const now = new Date().toISOString()
  const nextStore: WarehouseStore = {
    ...reversalOut.store,
    documents: reversalOut.store.documents.map((d) =>
      d.id === doc.id
        ? {
            ...d,
            status: 'cancelled',
            cancelledAt: now,
            cancelledBy: args.cancelledBy,
            cancelledByName: args.cancelledByName,
            reversalDocumentId: reversalId,
          }
        : d,
    ),
  }

  const withAudit = appendWarehouseAudit(nextStore, {
    action: 'document_cancel',
    detail: `Отмена ${doc.type === 'receipt' ? 'прихода' : 'расхода'} №${doc.number} · сторно №${reversalNumber}`,
    actorId: args.cancelledBy,
    actorName: args.cancelledByName,
  })

  return { store: withAudit, result: { ok: true, reversalIds: [reversalId] } }
}

export function cancelWarehouseDocument(
  store: WarehouseStore,
  documentId: string,
  args: { cancelledBy?: string; cancelledByName?: string; reason?: string },
): { store: WarehouseStore; result: CancelDocumentResult } {
  const doc = store.documents.find((d) => d.id === documentId)
  if (!doc) return { store, result: { ok: false, error: 'not_found' } }
  if (!documentCanBeCancelled(doc)) {
    return { store, result: { ok: false, error: 'warehouse.doc.errCannotCancel' } }
  }

  const targets = doc.transferPairId
    ? store.documents.filter(
        (d) => d.transferPairId === doc.transferPairId && d.status !== 'cancelled',
      )
    : [doc]

  let next = store
  const reversalIds: string[] = []
  for (const target of targets) {
    const out = cancelSingleDocument(next, target, args)
    if (!out.result.ok) return out
    next = out.store
    reversalIds.push(...out.result.reversalIds)
  }

  return { store: next, result: { ok: true, reversalIds } }
}
