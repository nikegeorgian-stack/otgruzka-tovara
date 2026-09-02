import { appendWarehouseAudit } from './audit'
import {
  assertWarehouseAllowsStockIssue,
  isWarehouseAccountingActive,
  setWarehouseAccountingStatus,
  WAREHOUSE_NOT_INITIALIZED,
} from './accountingStatus'
import { isDocumentNumberTaken, nextReversalNumber } from './docNumbering'
import { documentCanBeCancelled, validateWarehouseDocumentInput } from './documentValidation'
import {
  isOpeningInventoryDocument,
  openingInventoryHasDependentMovements,
} from './openingInventory'
import { computeItemBalance, toBaseQty } from './stock'
import {
  buildOwnUnreserveMovements,
  checkIssueStockSafety,
  IDEMPOTENCY_CONFLICT_ERROR,
  reservationSourceFromDocument,
  type ReservationSourceRef,
  type StockShortageRow,
  warehouseDocumentsEquivalentForIdempotency,
  warehouseIdempotencyKey,
} from './stockSafety'
import type { StockMovement, WarehouseDocument, WarehouseStore } from './types'

export function warehouseDocumentKindLabel(type: WarehouseDocument['type']): string {
  if (type === 'receipt') return 'Приход'
  if (type === 'issue') return 'Расход'
  return 'Ревизия'
}

function inventoryLinePreview(
  store: Pick<WarehouseStore, 'items'>,
  doc: Pick<WarehouseDocument, 'type' | 'lines'>,
): string {
  if (doc.type !== 'inventory' || doc.lines.length === 0) return ''
  const itemById = new Map(store.items.map((item) => [item.id, item]))
  const preview = doc.lines.slice(0, 3).map((line) => {
    const item = itemById.get(line.itemId)
    return `${item?.name ?? line.itemId}: ${line.quantity}${item?.unit ? ` ${item.unit}` : ''}`
  })
  const more = doc.lines.length > preview.length ? `; +${doc.lines.length - preview.length}` : ''
  return ` · ${preview.join('; ')}${more}`
}

export type PostDocumentResult =
  | { ok: true; documentId: string; idempotent?: boolean }
  | {
      ok: false
      error: string
      fieldErrors?: Record<string, string>
      shortages?: StockShortageRow[]
    }

export type CancelDocumentResult =
  | { ok: true; reversalIds: string[] }
  | { ok: false; error: string; shortages?: StockShortageRow[] }

export type UnpostDocumentResult = { ok: true } | { ok: false; error: string }

/** Input for a single post step (field skip ≠ stock safety). */
export type PostWarehouseDocumentInput = Omit<WarehouseDocument, 'id' | 'createdAt'> & {
  skipAudit?: boolean
  /** Skip field validation only — stock safety always runs for issues. */
  skipFieldValidation?: boolean
  /** @deprecated Alias of skipFieldValidation; never bypasses stock safety. */
  skipValidation?: boolean
  /** Own reservation sources that may be consumed by this issue. */
  reservationSource?: ReservationSourceRef
}

export type AtomicPostResult =
  | { ok: true; documentIds: string[] }
  | { ok: false; error: string; fieldErrors?: Record<string, string>; shortages?: StockShortageRow[] }

/**
 * Сформировать движения склада по строкам проведённого документа.
 * Движения помечаются `documentId`, что позволяет снимать проведение
 * и перепроводить документ без дублей.
 */
function buildDocumentMovements(
  store: WarehouseStore,
  full: WarehouseDocument,
): StockMovement[] {
  const itemMap = new Map(store.items.map((i) => [i.id, i]))
  const createdAt = new Date().toISOString()

  if (full.type === 'inventory') {
    const movements: StockMovement[] = []
    for (const line of full.lines) {
      const item = itemMap.get(line.itemId)
      if (!item) continue
      const book =
        line.bookQty ??
        computeItemBalance(line.itemId, store.movements, full.warehouseId).balance
      const delta = line.quantity - book
      if (Math.abs(delta) < 1e-9) continue
      movements.push({
        id: crypto.randomUUID(),
        itemId: line.itemId,
        warehouseId: full.warehouseId,
        type: 'inventory',
        quantity: delta,
        date: full.date,
        documentId: full.id,
        documentNo: full.number,
        comment: full.comment,
        createdAt,
      })
    }
    return movements
  }

  const isReceipt = full.type === 'receipt'
  return full.lines.map((line) => {
    const item = itemMap.get(line.itemId)
    const qty = item ? toBaseQty(item, line.quantity, line.inputUnit) : line.quantity
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
      documentId: full.id,
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
}

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

function findIdempotentDocument(
  store: WarehouseStore,
  key: string | undefined,
): WarehouseDocument | undefined {
  if (!key?.trim()) return undefined
  return store.documents.find(
    (d) => d.idempotencyKey === key && d.status !== 'cancelled',
  )
}

/**
 * Internal posting helper — stock safety is mandatory for `issue`.
 * `skipValidation` / `skipFieldValidation` only skip field validation.
 */
function commitPostedDocument(
  store: WarehouseStore,
  full: WarehouseDocument,
  options: {
    skipAudit?: boolean
    reservationSource?: ReservationSourceRef
    /** When re-posting existing draft: drop prior movements for this documentId first */
    replaceExisting?: boolean
  } = {},
): { store: WarehouseStore; result: PostDocumentResult } {
  // Regular inventory corrections require active accounting; opening inventory is the activation path.
  if (
    full.type === 'inventory' &&
    !isOpeningInventoryDocument(full) &&
    !isWarehouseAccountingActive(store, full.warehouseId)
  ) {
    return {
      store,
      result: { ok: false, error: WAREHOUSE_NOT_INITIALIZED },
    }
  }

  if (full.type === 'issue') {
    const gate = assertWarehouseAllowsStockIssue(store, full.warehouseId)
    if (!gate.ok) {
      return { store, result: { ok: false, error: gate.error } }
    }
    const source =
      options.reservationSource ?? reservationSourceFromDocument(full)
    const stock = checkIssueStockSafety(store, {
      warehouseId: full.warehouseId,
      lines: full.lines,
      reservationSource: source,
    })
    if (!stock.ok) {
      return {
        store,
        result: {
          ok: false,
          error: stock.error,
          shortages: stock.shortages,
        },
      }
    }

    const movements = buildDocumentMovements(store, full)
    const unreserves = buildOwnUnreserveMovements(store, {
      warehouseId: full.warehouseId,
      date: full.date,
      documentId: full.id,
      documentNo: full.number,
      aggregated: stock.aggregated,
      reservationSource: source,
    })
    const cleaned = options.replaceExisting
      ? store.movements.filter((m) => m.documentId !== full.id)
      : store.movements
    const documents = options.replaceExisting
      ? store.documents.map((d) => (d.id === full.id ? full : d))
      : [...store.documents, full]

    let next: WarehouseStore = {
      ...store,
      documents,
      movements: [...cleaned, ...movements, ...unreserves],
    }
    if (!options.skipAudit) {
      next = appendWarehouseAudit(next, {
        action: full.reversesDocumentId ? 'document_cancel' : 'document_post',
        detail: full.reversesDocumentId
          ? `Сторно ${full.reversesDocumentId.slice(0, 8)} · ${warehouseDocumentKindLabel(full.type)} №${full.number}`
          : `${warehouseDocumentKindLabel(full.type)} №${full.number} · ${full.lines.length} поз.${inventoryLinePreview(store, full)}`,
        actorId: full.keeperId ?? full.postedBy,
        actorName: full.keeperName ?? full.postedByName,
      })
    }
    return { store: next, result: { ok: true, documentId: full.id } }
  }

  // receipt / inventory — no stock-safety gate (receipt may heal negative balance)
  const movements = buildDocumentMovements(store, full)
  const cleaned = options.replaceExisting
    ? store.movements.filter((m) => m.documentId !== full.id)
    : store.movements
  const documents = options.replaceExisting
    ? store.documents.map((d) => (d.id === full.id ? full : d))
    : [...store.documents, full]

  let next: WarehouseStore = {
    ...store,
    documents,
    movements: [...cleaned, ...movements],
  }
  if (!options.skipAudit) {
    next = appendWarehouseAudit(next, {
      action: full.reversesDocumentId ? 'document_cancel' : 'document_post',
      detail: full.reversesDocumentId
        ? `Сторно ${full.reversesDocumentId.slice(0, 8)} · ${warehouseDocumentKindLabel(full.type)} №${full.number}`
        : `${warehouseDocumentKindLabel(full.type)} №${full.number} · ${full.lines.length} поз.${inventoryLinePreview(store, full)}`,
      actorId: full.keeperId ?? full.postedBy,
      actorName: full.keeperName ?? full.postedByName,
    })
  }
  return { store: next, result: { ok: true, documentId: full.id } }
}

export function postWarehouseDocument(
  store: WarehouseStore,
  doc: PostWarehouseDocumentInput,
): { store: WarehouseStore; result: PostDocumentResult } {
  const {
    skipAudit,
    skipValidation,
    skipFieldValidation,
    reservationSource,
    ...docRest
  } = doc
  const skipFields = skipFieldValidation === true || skipValidation === true

  if (!skipFields) {
    const docForValidation = { ...docRest }
    delete (docForValidation as { status?: unknown }).status
    const validation = validateWarehouseDocumentInput(store, docForValidation)
    if (!validation.ok) {
      const first = Object.values(validation.errors)[0] ?? 'warehouse.doc.errGeneric'
      return { store, result: { ok: false, error: first, fieldErrors: validation.errors } }
    }
  }

  if (doc.type === 'receipt' && isInvoiceAlreadyPosted(store, doc.invoiceKey)) {
    return { store, result: { ok: false, error: 'warehouse.invoice.alreadyPosted' } }
  }

  const existingIdem = findIdempotentDocument(store, docRest.idempotencyKey)
  if (existingIdem) {
    if (
      warehouseDocumentsEquivalentForIdempotency(existingIdem, {
        type: docRest.type,
        warehouseId: docRest.warehouseId,
        purpose: docRest.purpose,
        docRole: docRest.docRole,
        lines: docRest.lines,
        productionRequestId: docRest.productionRequestId,
        batchRunId: docRest.batchRunId,
        loadingShipmentId: docRest.loadingShipmentId,
        transferPairId: docRest.transferPairId,
        purchaseOrderId: docRest.purchaseOrderId,
        keeperRequestId: docRest.keeperRequestId,
      })
    ) {
      return {
        store,
        result: { ok: true, documentId: existingIdem.id, idempotent: true },
      }
    }
    return { store, result: { ok: false, error: IDEMPOTENCY_CONFLICT_ERROR } }
  }

  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  const full: WarehouseDocument = {
    ...docRest,
    status: docRest.status ?? 'posted',
    id,
    createdAt,
  }

  return commitPostedDocument(store, full, { skipAudit, reservationSource })
}

/**
 * Провести существующий документ (черновик или перепровести проведённый):
 * удалить прежние движения этого документа, заново сформировать движения,
 * выставить статус «Проведён». Защита от дублей — по `documentId`.
 * Stock safety always applies for issues.
 */
export function postExistingWarehouseDocument(
  store: WarehouseStore,
  documentId: string,
  actor?: { actorId?: string; actorName?: string },
  options?: { reservationSource?: ReservationSourceRef },
): { store: WarehouseStore; result: PostDocumentResult } {
  const doc = store.documents.find((d) => d.id === documentId)
  if (!doc) return { store, result: { ok: false, error: 'not_found' } }
  if (doc.status === 'cancelled') {
    return { store, result: { ok: false, error: 'warehouse.doc.errAlreadyCancelled' } }
  }

  const docForValidation = { ...doc }
  delete (docForValidation as { status?: unknown }).status
  const validation = validateWarehouseDocumentInput(store, docForValidation, documentId)
  if (!validation.ok) {
    const first = Object.values(validation.errors)[0] ?? 'warehouse.doc.errGeneric'
    return { store, result: { ok: false, error: first, fieldErrors: validation.errors } }
  }

  const storeForCheck: WarehouseStore = {
    ...store,
    movements: store.movements.filter((m) => m.documentId !== documentId),
  }

  const now = new Date().toISOString()
  const full: WarehouseDocument = {
    ...doc,
    status: 'posted',
    postedAt: now,
    postedBy: actor?.actorId,
    postedByName: actor?.actorName,
    lockedBy: undefined,
    lockedByName: undefined,
    lockedAt: undefined,
  }

  const committed = commitPostedDocument(storeForCheck, full, {
    replaceExisting: true,
    reservationSource: options?.reservationSource ?? reservationSourceFromDocument(doc),
  })
  if (!committed.result.ok) {
    return { store, result: committed.result }
  }
  return committed
}

/**
 * Pure in-memory multi-document post: all steps succeed or state is unchanged.
 */
export function postWarehouseDocumentsAtomic(
  store: WarehouseStore,
  docs: PostWarehouseDocumentInput[],
): { store: WarehouseStore; result: AtomicPostResult } {
  let next = store
  const documentIds: string[] = []
  for (const doc of docs) {
    const out = postWarehouseDocument(next, doc)
    if (!out.result.ok) {
      return {
        store,
        result: {
          ok: false,
          error: out.result.error,
          fieldErrors: out.result.fieldErrors,
          shortages: out.result.shortages,
        },
      }
    }
    next = out.store
    documentIds.push(out.result.documentId)
  }
  return { store: next, result: { ok: true, documentIds } }
}

export type SaveDraftInput = Omit<WarehouseDocument, 'id' | 'createdAt' | 'status'> & {
  id?: string
}

/**
 * Сохранить документ как ЧЕРНОВИК — без движений и без изменения остатков.
 * Поддерживает создание нового и обновление существующего черновика.
 * Проведённый документ так редактировать нельзя (сначала снять проведение).
 */
export function saveWarehouseDocumentDraft(
  store: WarehouseStore,
  doc: SaveDraftInput,
  actor?: { actorId?: string; actorName?: string },
): { store: WarehouseStore; result: PostDocumentResult } {
  const existing = doc.id ? store.documents.find((d) => d.id === doc.id) : undefined
  if (existing && existing.status === 'posted') {
    return { store, result: { ok: false, error: 'warehouse.doc.errAlreadyPosted' } }
  }
  if (doc.number?.trim() && isDocumentNumberTaken(store.documents, doc.number, doc.id)) {
    return {
      store,
      result: {
        ok: false,
        error: 'warehouse.doc.errDuplicateNumber',
        fieldErrors: { number: 'warehouse.doc.errDuplicateNumber' },
      },
    }
  }

  const id = doc.id ?? crypto.randomUUID()
  const createdAt = existing?.createdAt ?? new Date().toISOString()
  const rest = { ...doc }
  delete (rest as { id?: string }).id
  const full: WarehouseDocument = {
    ...(existing ?? {}),
    ...rest,
    id,
    createdAt,
    status: 'draft',
  }

  const documents = existing
    ? store.documents.map((d) => (d.id === id ? full : d))
    : [...store.documents, full]

  let next: WarehouseStore = { ...store, documents }
  // Логируем только создание черновика, чтобы не засорять аудит каждой правкой.
  if (!existing) {
    next = appendWarehouseAudit(next, {
      action: 'document_draft',
      detail: `Черновик ${warehouseDocumentKindLabel(full.type).toLowerCase()} №${full.number || '—'} · ${full.lines.length} поз.${inventoryLinePreview(store, full)}`,
      actorId: actor?.actorId,
      actorName: actor?.actorName,
    })
  }
  return { store: next, result: { ok: true, documentId: id } }
}

/**
 * Снять проведение («Отменить проведение»): удалить движения документа и
 * вернуть его в черновик (можно редактировать и провести заново).
 * Сторно-, замес- и парные документы так снимать нельзя — для них отмена.
 *
 * RISK W1: destructive unpost (hard-deletes movements) — not rewritten in W0.
 */
export function unpostWarehouseDocument(
  store: WarehouseStore,
  documentId: string,
  actor?: { actorId?: string; actorName?: string },
): { store: WarehouseStore; result: UnpostDocumentResult } {
  const doc = store.documents.find((d) => d.id === documentId)
  if (!doc) return { store, result: { ok: false, error: 'not_found' } }
  if (doc.status !== 'posted') {
    return { store, result: { ok: false, error: 'warehouse.doc.errNotPosted' } }
  }
  if (!documentCanBeCancelled(doc) || doc.transferPairId) {
    return { store, result: { ok: false, error: 'warehouse.doc.errCannotUnpost' } }
  }

  const documents = store.documents.map((d) =>
    d.id === documentId
      ? { ...d, status: 'draft' as const, postedAt: undefined, postedBy: undefined, postedByName: undefined }
      : d,
  )
  const movements = store.movements.filter((m) => m.documentId !== documentId)

  let next: WarehouseStore = { ...store, documents, movements }
  next = appendWarehouseAudit(next, {
    action: 'document_unpost',
    detail: `Снято проведение ${warehouseDocumentKindLabel(doc.type).toLowerCase()} №${doc.number}`,
    actorId: actor?.actorId,
    actorName: actor?.actorName,
  })
  return { store: next, result: { ok: true } }
}

/** Удалить ЧЕРНОВИК документа (только не проведённый, без движений). */
export function removeWarehouseDraftDocument(
  store: WarehouseStore,
  documentId: string,
  actor?: { actorId?: string; actorName?: string },
): { store: WarehouseStore; result: UnpostDocumentResult } {
  const doc = store.documents.find((d) => d.id === documentId)
  if (!doc) return { store, result: { ok: false, error: 'not_found' } }
  if (doc.status !== 'draft') {
    return { store, result: { ok: false, error: 'warehouse.doc.errNotDraft' } }
  }
  let next: WarehouseStore = {
    ...store,
    documents: store.documents.filter((d) => d.id !== documentId),
  }
  next = appendWarehouseAudit(next, {
    action: 'document_draft',
    detail: `Удалён черновик ${warehouseDocumentKindLabel(doc.type).toLowerCase()} №${doc.number || '—'}`,
    actorId: actor?.actorId,
    actorName: actor?.actorName,
  })
  return { store: next, result: { ok: true } }
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
  if (!isWarehouseAccountingActive(store, args.warehouseId)) {
    return store
  }
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
  if (!isWarehouseAccountingActive(store, warehouseId)) {
    return { store, result: { applied: 0, skipped: lines.length, unchanged: 0 } }
  }
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
  if (!isWarehouseAccountingActive(store, warehouseId)) {
    return { store, result: { applied: 0, skipped: lines.length } }
  }
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

  const atomic = postWarehouseDocumentsAtomic(store, [
    {
      ...args,
      type: 'issue',
      number: issueNo,
      comment: baseComment,
      transferPairId: pairId,
      docRole: 'transfer_issue',
      purpose: args.purpose ?? 'transfer',
      idempotencyKey: warehouseIdempotencyKey({
        source: 'transfer',
        sourceId: pairId,
        role: 'transfer_issue',
        warehouseId: args.warehouseId,
      }),
    },
    {
      ...args,
      type: 'receipt',
      number: receiptNo,
      warehouseId: args.targetWarehouseId,
      comment: baseComment,
      transferPairId: pairId,
      docRole: 'transfer_receipt',
      purpose: args.purpose ?? 'transfer',
      idempotencyKey: warehouseIdempotencyKey({
        source: 'transfer',
        sourceId: pairId,
        role: 'transfer_receipt',
        warehouseId: args.targetWarehouseId,
      }),
    },
  ])
  if (!atomic.result.ok) {
    return {
      store,
      result: {
        ok: false,
        error: atomic.result.error,
        fieldErrors: atomic.result.fieldErrors,
        shortages: atomic.result.shortages,
      },
    }
  }
  return {
    store: atomic.store,
    result: { ok: true, documentId: atomic.result.documentIds[0]! },
  }
}

function cancelInventoryDocument(
  store: WarehouseStore,
  doc: WarehouseDocument,
  args: { cancelledBy?: string; cancelledByName?: string; reason?: string },
): { store: WarehouseStore; result: CancelDocumentResult } {
  let reversalNumber = nextReversalNumber(doc.number)
  let suffix = 1
  while (isDocumentNumberTaken(store.documents, reversalNumber)) {
    suffix += 1
    reversalNumber = `${nextReversalNumber(doc.number)}${suffix > 1 ? suffix : ''}`
  }

  const reversalId = crypto.randomUUID()
  const now = new Date().toISOString()
  const originalMovements = store.movements.filter(
    (m) => m.documentId === doc.id && m.type === 'inventory',
  )
  const reversalMovements: StockMovement[] = originalMovements.map((m) => ({
    ...m,
    id: crypto.randomUUID(),
    quantity: -m.quantity,
    documentId: reversalId,
    documentNo: reversalNumber,
    comment: [`Сторно №${doc.number}`, args.reason].filter(Boolean).join(' · '),
    createdAt: now,
  }))

  const reversalDoc: WarehouseDocument = {
    id: reversalId,
    type: 'inventory',
    number: reversalNumber,
    date: new Date().toISOString().slice(0, 10),
    warehouseId: doc.warehouseId,
    purpose: 'other',
    comment: [`Сторно №${doc.number}`, args.reason].filter(Boolean).join(' · '),
    lines: [],
    keeperId: args.cancelledBy,
    keeperName: args.cancelledByName,
    reversesDocumentId: doc.id,
    docRole: 'reversal',
    status: 'posted',
    postedAt: now,
    postedBy: args.cancelledBy,
    postedByName: args.cancelledByName,
    createdAt: now,
  }

  const nextStore: WarehouseStore = {
    ...store,
    documents: [
      ...store.documents.map((d) =>
        d.id === doc.id
          ? {
              ...d,
              status: 'cancelled' as const,
              cancelledAt: now,
              cancelledBy: args.cancelledBy,
              cancelledByName: args.cancelledByName,
              reversalDocumentId: reversalId,
            }
          : d,
      ),
      reversalDoc,
    ],
    movements: [...store.movements, ...reversalMovements],
  }

  const withAudit = appendWarehouseAudit(nextStore, {
    action: 'document_cancel',
    detail: `Отмена ревизии №${doc.number} · сторно №${reversalNumber}`,
    actorId: args.cancelledBy,
    actorName: args.cancelledByName,
  })

  return { store: withAudit, result: { ok: true, reversalIds: [reversalId] } }
}

function cancelSingleDocument(
  store: WarehouseStore,
  doc: WarehouseDocument,
  args: { cancelledBy?: string; cancelledByName?: string; reason?: string },
): { store: WarehouseStore; result: CancelDocumentResult } {
  if (doc.type === 'inventory') {
    return cancelInventoryDocument(store, doc, args)
  }

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
    skipFieldValidation: true,
    idempotencyKey: warehouseIdempotencyKey({
      source: 'reversal',
      sourceId: doc.id,
      role: 'reversal',
      warehouseId: doc.warehouseId,
    }),
  })
  if (!reversalOut.result.ok) {
    return {
      store,
      result: {
        ok: false,
        error: reversalOut.result.error,
        shortages: reversalOut.result.shortages,
      },
    }
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
    detail: `Отмена ${warehouseDocumentKindLabel(doc.type).toLowerCase()} №${doc.number} · сторно №${reversalNumber}`,
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
  if (isOpeningInventoryDocument(doc) && openingInventoryHasDependentMovements(store, doc)) {
    return {
      store,
      result: { ok: false, error: 'warehouse.accounting.errCancelOpeningDependent' },
    }
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
    if (!out.result.ok) {
      // Atomic: discard any partial cancellations in the pair.
      return { store, result: out.result }
    }
    next = out.store
    reversalIds.push(...out.result.reversalIds)
  }

  // Opening inventory cancel (only when no dependents): leave warehouse unverified — never silently "active".
  if (isOpeningInventoryDocument(doc) && doc.status === 'posted') {
    next = setWarehouseAccountingStatus(next, doc.warehouseId, 'uninitialized', {
      openingInventoryDocumentId: undefined,
      activatedAt: undefined,
      activatedBy: undefined,
      activatedByName: undefined,
      note: 'opening_inventory_cancelled',
    })
  }

  return { store: next, result: { ok: true, reversalIds } }
}
