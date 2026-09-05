/**
 * PHASE W0.5 — opening inventory to activate warehouse accounting.
 * Posts a full inventory WarehouseDocument; never deletes prior history.
 */
import {
  getWarehouseAccountingState,
  isWarehouseAccountingActive,
  setWarehouseAccountingStatus,
  WAREHOUSE_NOT_INITIALIZED,
} from './accountingStatus'
import { appendWarehouseAudit } from './audit'
import {
  postExistingWarehouseDocument,
  postWarehouseDocument,
  saveWarehouseDocumentDraft,
  type PostDocumentResult,
  type SaveDraftInput,
} from './documents'
import { computeItemBalance } from './stock'
import { warehouseIdempotencyKey } from './stockSafety'
import type {
  WarehouseDocument,
  WarehouseDocumentLine,
  WarehouseStore,
} from './types'

export type OpeningInventoryLineInput = {
  itemId: string
  /** Factually counted quantity (base unit) */
  countedQty: number
  comment?: string
  batchNo?: string
  expiryDate?: string
  inputUnit?: string
}

export type OpeningInventoryDraftInput = {
  id?: string
  number: string
  date: string
  warehouseId: string
  comment?: string
  lines: OpeningInventoryLineInput[]
  keeperId?: string
  keeperName?: string
}

function openingIdempotencyKey(warehouseId: string): string {
  return warehouseIdempotencyKey({
    source: 'openingInventory',
    sourceId: warehouseId,
    role: 'opening_inventory',
    warehouseId,
  })
}

/** Exported for PHASE W0.6 transaction group ids. */
export function openingInventorySourceKey(warehouseId: string): string {
  return openingIdempotencyKey(warehouseId)
}

function buildOpeningLines(
  store: WarehouseStore,
  warehouseId: string,
  lines: OpeningInventoryLineInput[],
): WarehouseDocumentLine[] {
  return lines.map((line) => {
    const book = computeItemBalance(line.itemId, store.movements, warehouseId).balance
    return {
      itemId: line.itemId,
      quantity: line.countedQty,
      bookQty: book,
      batchNo: line.batchNo,
      expiryDate: line.expiryDate,
      inputUnit: line.inputUnit,
      comment: line.comment,
    }
  })
}

export function saveOpeningInventoryDraft(
  store: WarehouseStore,
  input: OpeningInventoryDraftInput,
  actor?: { actorId?: string; actorName?: string },
): { store: WarehouseStore; result: PostDocumentResult } {
  if (isWarehouseAccountingActive(store, input.warehouseId)) {
    return {
      store,
      result: { ok: false, error: 'warehouse.accounting.alreadyActive' },
    }
  }

  const lines = buildOpeningLines(store, input.warehouseId, input.lines)
  if (!lines.length) {
    return { store, result: { ok: false, error: 'warehouse.doc.errLines' } }
  }

  const draft: SaveDraftInput = {
    id: input.id,
    type: 'inventory',
    number: input.number,
    date: input.date,
    warehouseId: input.warehouseId,
    purpose: 'opening_inventory',
    isOpeningInventory: true,
    comment: input.comment,
    lines,
    keeperId: input.keeperId ?? actor?.actorId,
    keeperName: input.keeperName ?? actor?.actorName,
    idempotencyKey: openingIdempotencyKey(input.warehouseId),
  }

  const saved = saveWarehouseDocumentDraft(store, draft, actor)
  if (!saved.result.ok) return saved

  const next = setWarehouseAccountingStatus(saved.store, input.warehouseId, 'reconciling', {
    note: 'opening_inventory_draft',
  })
  return { store: next, result: saved.result }
}

/**
 * Post opening inventory (new or existing draft) and activate only this warehouse.
 * Atomic: on any failure returns original store (no movements, no activation).
 */
export function postOpeningInventory(
  store: WarehouseStore,
  input: OpeningInventoryDraftInput & { documentId?: string },
  actor?: { actorId?: string; actorName?: string },
): { store: WarehouseStore; result: PostDocumentResult } {
  if (isWarehouseAccountingActive(store, input.warehouseId)) {
    // Idempotent: already active with matching opening doc key
    const key = openingIdempotencyKey(input.warehouseId)
    const existing = store.documents.find(
      (d) =>
        d.idempotencyKey === key &&
        d.status === 'posted' &&
        (d.isOpeningInventory || d.purpose === 'opening_inventory'),
    )
    if (existing) {
      return { store, result: { ok: true, documentId: existing.id, idempotent: true } }
    }
    return { store, result: { ok: false, error: 'warehouse.accounting.alreadyActive' } }
  }

  const lines = buildOpeningLines(store, input.warehouseId, input.lines)
  if (!lines.length) {
    return { store, result: { ok: false, error: 'warehouse.doc.errLines' } }
  }

  const original = store
  let working = store
  let documentId = input.documentId

  if (documentId) {
    const existing = working.documents.find((d) => d.id === documentId)
    if (!existing || existing.status === 'cancelled') {
      return { store: original, result: { ok: false, error: 'not_found' } }
    }
    // Refresh draft lines/bookQty before post
    const refreshed = saveWarehouseDocumentDraft(
      working,
      {
        id: documentId,
        type: 'inventory',
        number: input.number || existing.number,
        date: input.date || existing.date,
        warehouseId: input.warehouseId,
        purpose: 'opening_inventory',
        isOpeningInventory: true,
        comment: input.comment ?? existing.comment,
        lines,
        keeperId: input.keeperId ?? existing.keeperId ?? actor?.actorId,
        keeperName: input.keeperName ?? existing.keeperName ?? actor?.actorName,
        idempotencyKey: openingIdempotencyKey(input.warehouseId),
      },
      actor,
    )
    if (!refreshed.result.ok) {
      return { store: original, result: refreshed.result }
    }
    working = refreshed.store
    const posted = postExistingWarehouseDocument(working, documentId, actor)
    if (!posted.result.ok) {
      return { store: original, result: posted.result }
    }
    working = posted.store
    documentId = posted.result.documentId
  } else {
    const posted = postWarehouseDocument(working, {
      type: 'inventory',
      number: input.number,
      date: input.date,
      warehouseId: input.warehouseId,
      purpose: 'opening_inventory',
      isOpeningInventory: true,
      comment: input.comment,
      lines,
      keeperId: input.keeperId ?? actor?.actorId,
      keeperName: input.keeperName ?? actor?.actorName,
      status: 'posted',
      postedAt: new Date().toISOString(),
      postedBy: actor?.actorId,
      postedByName: actor?.actorName,
      idempotencyKey: openingIdempotencyKey(input.warehouseId),
      skipFieldValidation: false,
    })
    if (!posted.result.ok) {
      return { store: original, result: posted.result }
    }
    working = posted.store
    documentId = posted.result.documentId
  }

  const prev = getWarehouseAccountingState(working, input.warehouseId)
  let activated = setWarehouseAccountingStatus(working, input.warehouseId, 'active', {
    openingInventoryDocumentId: documentId,
    activatedAt: new Date().toISOString(),
    activatedBy: actor?.actorId,
    activatedByName: actor?.actorName,
    note: input.comment,
    revision: (prev.revision ?? 0) + 1,
  })

  activated = appendWarehouseAudit(activated, {
    action: 'inventory',
    detail: `Начальная инвентаризация · склад активирован · док. ${input.number}`,
    actorId: actor?.actorId,
    actorName: actor?.actorName,
  })

  return { store: activated, result: { ok: true, documentId: documentId! } }
}

/** Block cancelling opening inventory after subsequent warehouse movements exist. */
export function openingInventoryHasDependentMovements(
  store: WarehouseStore,
  doc: WarehouseDocument,
): boolean {
  if (!(doc.isOpeningInventory || doc.purpose === 'opening_inventory')) return false
  if (doc.status !== 'posted') return false
  const postedAt = doc.postedAt ?? doc.createdAt
  return store.movements.some(
    (m) =>
      m.warehouseId === doc.warehouseId &&
      m.documentId !== doc.id &&
      m.createdAt > postedAt,
  )
}

export function isOpeningInventoryDocument(doc: Pick<WarehouseDocument, 'purpose' | 'isOpeningInventory'>): boolean {
  return doc.isOpeningInventory === true || doc.purpose === 'opening_inventory'
}

export { WAREHOUSE_NOT_INITIALIZED }
