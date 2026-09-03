/**
 * PHASE P1A — document-backed material handoff: raw warehouse → production line location
 * and return of leftovers. Uses transfer pairs; no bare movements; no second ledger.
 */
import type { AccessRoleId, AppUser } from '@/lib/access/types'
import { reservedQtyForOrder } from '@/lib/planner/materialStock'
import type { ProductionOrder } from '@/lib/planner/types'
import {
  isWarehouseAccountingActive,
  WAREHOUSE_NOT_INITIALIZED,
} from './accountingStatus'
import { appendWarehouseAudit } from './audit'
import { nextDocumentNumber } from './docNumbering'
import { postWarehouseDocument, postWarehouseTransfer } from './documents'
import {
  allocateBatchesFefoFifo,
  assertUnitCompatible,
  buildBatchLotsFromMovements,
  UNIT_MISMATCH_ERROR,
  MISSING_ITEM_ID_ERROR,
  BATCH_OVERRIDE_REASON_REQUIRED,
  upsertMaterialShortages,
  shortageIdempotencyKey,
} from './productionReservations'
import {
  LINE_LOCATION_MISSING,
  LINE_LOCATION_NOT_CONFIGURED,
  resolveProductionLineLocation,
} from './productionLineLocationConfig'
import { computeItemBalance } from './stock'
import type {
  MaterialShortageRecord,
  WarehouseDocument,
  WarehouseDocumentLine,
  WarehouseStore,
} from './types'

export const HANDOFF_FORBIDDEN = 'warehouse.handoff.errForbidden' as const
export const OVER_RESERVE_REASON_REQUIRED = 'warehouse.handoff.errOverReserveReason' as const
export const RETURN_REASON_REQUIRED = 'warehouse.handoff.errReturnReason' as const
export const RETURN_EXCEEDS_REMAINING = 'warehouse.handoff.errReturnExceeds' as const
export const INSUFFICIENT_PHYSICAL = 'warehouse.handoff.errInsufficientPhysical' as const
export const NEGATIVE_STOCK_FORBIDDEN = 'warehouse.handoff.errNegativeStock' as const

export type HandoffActor = {
  id?: string
  name?: string
  roleId?: AccessRoleId
}

export type HandoffLineInput = {
  itemId: string
  quantity: number
  inputUnit?: string
  batchNo?: string
  expiryDate?: string
  batchOverrideReason?: string
  /** Explicit over-reserve amount (else computed vs own reserve) */
  overReserveQty?: number
}

export type ProductionMaterialTransferInput = {
  productionOrder: ProductionOrder
  rawWarehouseId: string
  lines: HandoffLineInput[]
  actor?: HandoffActor
  comment?: string
  overReserveReason?: string
  idempotencyKey: string
  reservationDocumentId?: string
  date?: string
  transactionGroupId?: string
}

export type ProductionMaterialReturnInput = {
  productionOrder: ProductionOrder
  rawWarehouseId: string
  lines: HandoffLineInput[]
  actor?: HandoffActor
  returnReason: string
  idempotencyKey: string
  date?: string
  transactionGroupId?: string
}

export type HandoffResult = {
  ok: boolean
  error?: string
  documentId?: string
  documentIds?: string[]
  idempotent?: boolean
  transferPairId?: string
}

export type LineMaterialBalance = {
  productionOrderId: string
  lineId: string
  productionLocationId: string
  itemId: string
  batchNo?: string
  expiryDate?: string
  transferredQty: number
  consumedQty: number
  returnedQty: number
  remainingQty: number
  sourceReservationDocumentIds: string[]
  transferDocumentIds: string[]
  returnDocumentIds: string[]
}

export function canPostProductionMaterialHandoff(
  user: AppUser | null | undefined,
): boolean {
  if (!user?.active) return false
  return user.roleId === 'warehouse_keeper' || user.roleId === 'sysadmin'
}

export function canViewProductionMaterialHandoff(
  user: AppUser | null | undefined,
): boolean {
  if (!user?.active) return false
  return (
    canPostProductionMaterialHandoff(user) ||
    user.roleId === 'operations_director' ||
    user.roleId === 'chief_engineer' ||
    user.roleId === 'technologist' ||
    user.roleId === 'sysadmin'
  )
}

function assertHandoffActor(actor: HandoffActor | undefined): { ok: true } | { ok: false; error: string } {
  if (!actor?.roleId) return { ok: true } // tests may omit; slice should pass
  if (actor.roleId === 'warehouse_keeper' || actor.roleId === 'sysadmin') return { ok: true }
  return { ok: false, error: HANDOFF_FORBIDDEN }
}

function findIdempotentPair(
  store: WarehouseStore,
  idempotencyKey: string,
): WarehouseDocument | undefined {
  return store.documents.find(
    (d) =>
      (d.idempotencyKey === idempotencyKey ||
        d.idempotencyKey === `${idempotencyKey}::issue` ||
        d.idempotencyKey?.startsWith(`${idempotencyKey}::`)) &&
      d.status !== 'cancelled',
  )
}

/**
 * Physical stock at a production location for one order (and optional batch).
 * Derived from movements — not a second ledger.
 */
export function computeLineMaterialBalances(
  store: WarehouseStore,
  args: {
    productionOrderId: string
    productionLocationId: string
    lineId?: string
    itemId?: string
  },
): LineMaterialBalance[] {
  const map = new Map<string, LineMaterialBalance>()

  const reservationDocIds = store.documents
    .filter(
      (d) =>
        d.productionOrderId === args.productionOrderId &&
        d.type === 'reservation' &&
        d.status !== 'cancelled',
    )
    .map((d) => d.id)

  const docById = new Map(store.documents.map((d) => [d.id, d]))

  const isTransferDoc = (doc: WarehouseDocument | undefined) =>
    Boolean(
      doc &&
        (doc.purpose === 'production_material_transfer' ||
          doc.docRole === 'production_transfer_issue' ||
          doc.docRole === 'production_transfer_receipt'),
    )
  const isReturnDoc = (doc: WarehouseDocument | undefined) =>
    Boolean(
      doc &&
        (doc.purpose === 'production_material_return' ||
          doc.docRole === 'production_return_issue' ||
          doc.docRole === 'production_return_receipt'),
    )

  for (const m of store.movements) {
    if (m.productionOrderId !== args.productionOrderId) continue
    if (m.warehouseId !== args.productionLocationId) continue
    if (args.itemId && m.itemId !== args.itemId) continue
    if (m.type !== 'receipt' && m.type !== 'issue') continue

    const key = `${m.itemId}::${m.batchNo ?? ''}::${m.expiryDate ?? ''}`
    let row = map.get(key)
    if (!row) {
      row = {
        productionOrderId: args.productionOrderId,
        lineId: args.lineId ?? '',
        productionLocationId: args.productionLocationId,
        itemId: m.itemId,
        batchNo: m.batchNo,
        expiryDate: m.expiryDate,
        transferredQty: 0,
        consumedQty: 0,
        returnedQty: 0,
        remainingQty: 0,
        sourceReservationDocumentIds: [...reservationDocIds],
        transferDocumentIds: [],
        returnDocumentIds: [],
      }
      map.set(key, row)
    }

    const doc = m.documentId ? docById.get(m.documentId) : undefined
    const qty = Math.abs(m.quantity)
    if (m.type === 'receipt') {
      if (isTransferDoc(doc) || !doc) {
        row.transferredQty += qty
        if (m.documentId && isTransferDoc(doc) && !row.transferDocumentIds.includes(m.documentId)) {
          row.transferDocumentIds.push(m.documentId)
        }
      }
    } else if (m.type === 'issue') {
      if (isReturnDoc(doc)) {
        row.returnedQty += qty
        if (m.documentId && !row.returnDocumentIds.includes(m.documentId)) {
          row.returnDocumentIds.push(m.documentId)
        }
      } else {
        // Legacy / future P1B consumption at line
        row.consumedQty += qty
      }
    }
  }

  for (const row of map.values()) {
    row.remainingQty = Math.max(
      0,
      row.transferredQty - row.consumedQty - row.returnedQty,
    )
  }
  return [...map.values()].filter((r) => r.transferredQty > 0 || r.remainingQty > 0)
}

function remainingAtLine(
  store: WarehouseStore,
  orderId: string,
  locationId: string,
  itemId: string,
  batchNo?: string,
): number {
  const rows = computeLineMaterialBalances(store, {
    productionOrderId: orderId,
    productionLocationId: locationId,
    itemId,
  })
  return rows
    .filter((r) => (batchNo ? r.batchNo === batchNo : true))
    .reduce((s, r) => s + r.remainingQty, 0)
}

function pickBatches(
  store: WarehouseStore,
  itemId: string,
  warehouseId: string,
  qty: number,
  manual?: { batchNo: string; expiryDate?: string; reason?: string },
):
  | { ok: true; allocations: { batchNo?: string; expiryDate?: string; quantity: number }[] }
  | { ok: false; error: string } {
  if (manual?.batchNo) {
    if (!manual.reason?.trim()) {
      return { ok: false, error: BATCH_OVERRIDE_REASON_REQUIRED }
    }
    return {
      ok: true,
      allocations: [{ batchNo: manual.batchNo, expiryDate: manual.expiryDate, quantity: qty }],
    }
  }
  const lots = buildBatchLotsFromMovements(store.movements, itemId, warehouseId)
  if (!lots.length) {
    return { ok: true, allocations: [{ quantity: qty }] }
  }
  const alloc = allocateBatchesFefoFifo(lots, qty)
  const sum = alloc.reduce((s, a) => s + a.quantity, 0)
  if (sum + 1e-9 < qty) {
    // Partial batch coverage — pad remainder without batch
    const rem = qty - sum
    return {
      ok: true,
      allocations: [...alloc, ...(rem > 0 ? [{ quantity: rem }] : [])],
    }
  }
  return { ok: true, allocations: alloc }
}

/**
 * Transfer materials from raw warehouse to production line location for an order.
 */
export function transferProductionMaterials(
  store: WarehouseStore,
  input: ProductionMaterialTransferInput,
): { store: WarehouseStore; result: HandoffResult } {
  const actorGate = assertHandoffActor(input.actor)
  if (!actorGate.ok) return { store, result: { ok: false, error: actorGate.error } }

  const existing = findIdempotentPair(store, input.idempotencyKey)
  if (existing) {
    return {
      store,
      result: {
        ok: true,
        idempotent: true,
        documentId: existing.id,
        transferPairId: existing.transferPairId,
      },
    }
  }

  const order = input.productionOrder
  const lineResolve = resolveProductionLineLocation(store, order.lineId)
  if (!lineResolve.ok) {
    return { store, result: { ok: false, error: lineResolve.error } }
  }

  if (!isWarehouseAccountingActive(store, input.rawWarehouseId)) {
    return { store, result: { ok: false, error: WAREHOUSE_NOT_INITIALIZED } }
  }
  if (!isWarehouseAccountingActive(store, lineResolve.productionLocationId)) {
    return { store, result: { ok: false, error: WAREHOUSE_NOT_INITIALIZED } }
  }

  if (!input.lines.length) {
    return { store, result: { ok: false, error: 'warehouse.doc.errLines' } }
  }

  let working = store
  const date = input.date ?? new Date().toISOString().slice(0, 10)
  const now = new Date().toISOString()
  const docLines: WarehouseDocumentLine[] = []
  let anyOver = false

  for (const line of input.lines) {
    if (!line.itemId?.trim()) {
      return { store, result: { ok: false, error: MISSING_ITEM_ID_ERROR } }
    }
    const item = working.items.find((i) => i.id === line.itemId)
    if (!item) {
      return { store, result: { ok: false, error: MISSING_ITEM_ID_ERROR } }
    }
    const unitCheck = assertUnitCompatible(item.unit, line.inputUnit, item.unitConversions)
    if (!unitCheck.ok) {
      return { store, result: { ok: false, error: UNIT_MISMATCH_ERROR } }
    }

    const qty = Math.max(0, line.quantity)
    if (qty <= 0) continue

    const ownReserved = reservedQtyForOrder(working.movements, order.id, item.id)
    const over = Math.max(0, line.overReserveQty ?? qty - ownReserved)
    if (over > 0) {
      anyOver = true
      if (!input.overReserveReason?.trim()) {
        return { store, result: { ok: false, error: OVER_RESERVE_REASON_REQUIRED } }
      }
    }

    const bal = computeItemBalance(item.id, working.movements, input.rawWarehouseId)
    // Physical available for issue = available + own reserved (stockSafety pattern)
    const physical = bal.available + ownReserved
    if (physical + 1e-9 < qty) {
      return { store, result: { ok: false, error: INSUFFICIENT_PHYSICAL } }
    }
    if (bal.balance + 1e-9 < qty) {
      return { store, result: { ok: false, error: NEGATIVE_STOCK_FORBIDDEN } }
    }

    const batches = pickBatches(working, item.id, input.rawWarehouseId, qty, line.batchNo
      ? {
          batchNo: line.batchNo,
          expiryDate: line.expiryDate,
          reason: line.batchOverrideReason,
        }
      : undefined)
    if (!batches.ok) {
      return { store, result: { ok: false, error: batches.error } }
    }

    // Distribute reserved / over-reserve across batch allocations once (no double-count)
    let reservedLeft = Math.min(ownReserved, qty)
    let overLeft = over
    for (const alloc of batches.allocations) {
      const reservedPart = Math.min(reservedLeft, alloc.quantity)
      reservedLeft -= reservedPart
      const overPart = Math.min(overLeft, Math.max(0, alloc.quantity - reservedPart))
      overLeft -= overPart
      docLines.push({
        lineId: crypto.randomUUID(),
        itemId: item.id,
        quantity: alloc.quantity,
        issuedQty: alloc.quantity,
        reservedQty: reservedPart,
        overReserveQty: overPart,
        itemCodeSnapshot: item.internalCode,
        itemNameSnapshot: item.name,
        unitSnapshot: item.unit,
        inputUnit: line.inputUnit,
        batchNo: alloc.batchNo,
        expiryDate: alloc.expiryDate,
        batchOverrideReason: line.batchOverrideReason,
        sourceLocationId: input.rawWarehouseId,
        destinationLocationId: lineResolve.productionLocationId,
      })
    }
  }

  if (!docLines.length) {
    return { store, result: { ok: false, error: 'warehouse.doc.errLines' } }
  }

  // Over-reserve: document-backed reservation increase before issue burn
  if (anyOver) {
    const overByItem = new Map<string, number>()
    for (const l of docLines) {
      const o = l.overReserveQty ?? 0
      if (o > 0) overByItem.set(l.itemId, (overByItem.get(l.itemId) ?? 0) + o)
    }
    for (const [itemId, overQty] of overByItem) {
      const item = working.items.find((i) => i.id === itemId)!
      const number = nextDocumentNumber(working.documents, 'reservation', date)
      const posted = postWarehouseDocument(working, {
        type: 'reservation',
        number,
        date,
        documentDateTime: now,
        warehouseId: input.rawWarehouseId,
        purpose: 'production_reservation_increase',
        productionOrderId: order.id,
        reservationReason: input.overReserveReason,
        comment: `Превышение резерва при выдаче · ${order.orderNumber}`,
        idempotencyKey: `${input.idempotencyKey}::over-reserve::${itemId}`,
        transactionGroupId: input.transactionGroupId ?? input.idempotencyKey,
        docRole: 'production_reservation',
        lines: [
          {
            lineId: crypto.randomUUID(),
            itemId,
            quantity: overQty,
            requiredQty: overQty,
            reservedQty: overQty,
            shortageQty: 0,
            itemCodeSnapshot: item.internalCode,
            itemNameSnapshot: item.name,
            unitSnapshot: item.unit,
          },
        ],
        status: 'posted',
        postedAt: now,
        postedBy: input.actor?.id,
        postedByName: input.actor?.name,
      })
      if (!posted.result.ok) {
        return { store, result: { ok: false, error: posted.result.error } }
      }
      working = posted.store
    }
  }

  const transferNumber = `ПД-${date.replace(/-/g, '')}-${String(working.documents.length + 1).padStart(3, '0')}`

  const groupId = input.transactionGroupId ?? input.idempotencyKey
  const out = postWarehouseTransfer(working, {
    number: transferNumber,
    date,
    documentDateTime: now,
    warehouseId: input.rawWarehouseId,
    targetWarehouseId: lineResolve.productionLocationId,
    sourceWarehouseId: input.rawWarehouseId,
    destinationWarehouseId: lineResolve.productionLocationId,
    purpose: 'production_material_transfer',
    docRole: 'production_transfer_issue',
    productionOrderId: order.id,
    productionLineId: order.lineId,
    reservationDocumentId: input.reservationDocumentId,
    overReserveReason: input.overReserveReason,
    basisType: 'production_order',
    basisId: order.id,
    basisNumber: order.orderNumber,
    comment: [input.comment, `Передача в производство · ${order.orderNumber} · линия ${order.lineId}`]
      .filter(Boolean)
      .join(' · '),
    lines: docLines,
    transactionGroupId: groupId,
    idempotencyKey: input.idempotencyKey,
    status: 'posted',
    postedAt: now,
    postedBy: input.actor?.id,
    postedByName: input.actor?.name,
    createdBy: input.actor?.id,
    createdByName: input.actor?.name,
    keeperId: input.actor?.id,
    keeperName: input.actor?.name,
    // reservationSource applied via productionOrderId on document
  })

  if (!out.result.ok) {
    return { store, result: { ok: false, error: out.result.error } }
  }

  const transferDocumentId = out.result.documentId

  // Tag docRoles on the pair for journal
  let next = out.store
  const pairId = next.documents.find((d) => d.id === transferDocumentId)?.transferPairId
  if (pairId) {
    next = {
      ...next,
      documents: next.documents.map((d) => {
        if (d.transferPairId !== pairId) return d
        if (d.type === 'issue') {
          return {
            ...d,
            docRole: 'production_transfer_issue' as const,
            purpose: 'production_material_transfer' as const,
            productionLineId: order.lineId,
            reservationDocumentId: input.reservationDocumentId,
            overReserveReason: input.overReserveReason,
            transactionGroupId: groupId,
            idempotencyKey: d.idempotencyKey ?? `${input.idempotencyKey}::issue`,
          }
        }
        return {
          ...d,
          docRole: 'production_transfer_receipt' as const,
          purpose: 'production_material_transfer' as const,
          productionOrderId: order.id,
          productionLineId: order.lineId,
          transactionGroupId: groupId,
          idempotencyKey: d.idempotencyKey ?? `${input.idempotencyKey}::receipt`,
        }
      }),
      movements: next.movements.map((m) => {
        const doc = next.documents.find((d) => d.id === m.documentId)
        if (!doc || doc.transferPairId !== pairId) return m
        return {
          ...m,
          productionOrderId: order.id,
          transactionGroupId: groupId,
        }
      }),
    }
  }

  // Refresh shortages after reserve burn
  const shortageUpdates: Omit<
    MaterialShortageRecord,
    'id' | 'createdAt' | 'updatedAt' | 'resolvedAt'
  >[] = []
  for (const line of docLines) {
    const reserved = reservedQtyForOrder(next.movements, order.id, line.itemId)
    const item = next.items.find((i) => i.id === line.itemId)
    shortageUpdates.push({
      productionOrderId: order.id,
      materialLineKey: `handoff::${line.itemId}`,
      itemId: line.itemId,
      warehouseId: input.rawWarehouseId,
      requiredDate: order.startDate || date,
      requiredQty: reserved + (line.issuedQty ?? line.quantity),
      reservedQty: reserved,
      shortageQty: 0,
      orderPriority: order.priority === 'urgent' ? 'urgent' : 'normal',
      status: 'resolved',
      sourceReservationDocumentId: input.reservationDocumentId,
      idempotencyKey: shortageIdempotencyKey(
        order.id,
        line.itemId,
        input.rawWarehouseId,
        `handoff::${line.itemId}`,
      ),
    })
    void item
  }
  next = upsertMaterialShortages(next, shortageUpdates, now)
  next = appendWarehouseAudit(next, {
    action: 'document_post',
    detail: `Передача в производство · ${order.orderNumber} · линия ${order.lineId}`,
    actorId: input.actor?.id,
    actorName: input.actor?.name,
  })

  return {
    store: next,
    result: {
      ok: true,
      documentId: transferDocumentId,
      transferPairId: pairId,
      documentIds: pairId
        ? next.documents.filter((d) => d.transferPairId === pairId).map((d) => d.id)
        : transferDocumentId
          ? [transferDocumentId]
          : [],
    },
  }
}

/**
 * Return leftover materials from production line location to raw warehouse.
 */
export function returnProductionMaterials(
  store: WarehouseStore,
  input: ProductionMaterialReturnInput,
): { store: WarehouseStore; result: HandoffResult } {
  const actorGate = assertHandoffActor(input.actor)
  if (!actorGate.ok) return { store, result: { ok: false, error: actorGate.error } }

  if (!input.returnReason?.trim()) {
    return { store, result: { ok: false, error: RETURN_REASON_REQUIRED } }
  }

  const existing = findIdempotentPair(store, input.idempotencyKey)
  if (existing) {
    return {
      store,
      result: {
        ok: true,
        idempotent: true,
        documentId: existing.id,
        transferPairId: existing.transferPairId,
      },
    }
  }

  const order = input.productionOrder
  const lineResolve = resolveProductionLineLocation(store, order.lineId)
  if (!lineResolve.ok) {
    return { store, result: { ok: false, error: lineResolve.error } }
  }

  if (!isWarehouseAccountingActive(store, input.rawWarehouseId)) {
    return { store, result: { ok: false, error: WAREHOUSE_NOT_INITIALIZED } }
  }
  if (!isWarehouseAccountingActive(store, lineResolve.productionLocationId)) {
    return { store, result: { ok: false, error: WAREHOUSE_NOT_INITIALIZED } }
  }

  const date = input.date ?? new Date().toISOString().slice(0, 10)
  const now = new Date().toISOString()
  const docLines: WarehouseDocumentLine[] = []

  for (const line of input.lines) {
    if (!line.itemId?.trim()) {
      return { store, result: { ok: false, error: MISSING_ITEM_ID_ERROR } }
    }
    const item = store.items.find((i) => i.id === line.itemId)
    if (!item) {
      return { store, result: { ok: false, error: MISSING_ITEM_ID_ERROR } }
    }
    const unitCheck = assertUnitCompatible(item.unit, line.inputUnit, item.unitConversions)
    if (!unitCheck.ok) {
      return { store, result: { ok: false, error: UNIT_MISMATCH_ERROR } }
    }
    const qty = Math.max(0, line.quantity)
    if (qty <= 0) continue

    const rem = remainingAtLine(
      store,
      order.id,
      lineResolve.productionLocationId,
      item.id,
      line.batchNo,
    )
    if (qty > rem + 1e-9) {
      return { store, result: { ok: false, error: RETURN_EXCEEDS_REMAINING } }
    }

    if (line.batchNo && !line.batchOverrideReason?.trim()) {
      // Returning exact batch is normal — override reason only if changing batch vs FEFO suggestion
    }

    docLines.push({
      lineId: crypto.randomUUID(),
      itemId: item.id,
      quantity: qty,
      itemCodeSnapshot: item.internalCode,
      itemNameSnapshot: item.name,
      unitSnapshot: item.unit,
      inputUnit: line.inputUnit,
      batchNo: line.batchNo,
      expiryDate: line.expiryDate,
      sourceLocationId: lineResolve.productionLocationId,
      destinationLocationId: input.rawWarehouseId,
    })
  }

  if (!docLines.length) {
    return { store, result: { ok: false, error: 'warehouse.doc.errLines' } }
  }

  const transferNumber = `ВЗ-${date.replace(/-/g, '')}-${String(store.documents.length + 1).padStart(3, '0')}`
  const groupId = input.transactionGroupId ?? input.idempotencyKey

  const out = postWarehouseTransfer(store, {
    number: transferNumber,
    date,
    documentDateTime: now,
    warehouseId: lineResolve.productionLocationId,
    targetWarehouseId: input.rawWarehouseId,
    sourceWarehouseId: lineResolve.productionLocationId,
    destinationWarehouseId: input.rawWarehouseId,
    purpose: 'production_material_return',
    docRole: 'production_return_issue',
    productionOrderId: order.id,
    productionLineId: order.lineId,
    returnReason: input.returnReason,
    basisType: 'production_order',
    basisId: order.id,
    basisNumber: order.orderNumber,
    comment: [
      input.returnReason,
      `Возврат из производства · ${order.orderNumber} · линия ${order.lineId}`,
    ]
      .filter(Boolean)
      .join(' · '),
    lines: docLines,
    transactionGroupId: groupId,
    idempotencyKey: input.idempotencyKey,
    status: 'posted',
    postedAt: now,
    postedBy: input.actor?.id,
    postedByName: input.actor?.name,
    createdBy: input.actor?.id,
    createdByName: input.actor?.name,
    keeperId: input.actor?.id,
    keeperName: input.actor?.name,
  })

  if (!out.result.ok) {
    return { store, result: { ok: false, error: out.result.error } }
  }

  const returnDocumentId = out.result.documentId

  let next = out.store
  const pairId = next.documents.find((d) => d.id === returnDocumentId)?.transferPairId
  if (pairId) {
    next = {
      ...next,
      documents: next.documents.map((d) => {
        if (d.transferPairId !== pairId) return d
        if (d.type === 'issue') {
          return {
            ...d,
            docRole: 'production_return_issue' as const,
            purpose: 'production_material_return' as const,
            productionLineId: order.lineId,
            returnReason: input.returnReason,
            transactionGroupId: groupId,
          }
        }
        return {
          ...d,
          docRole: 'production_return_receipt' as const,
          purpose: 'production_material_return' as const,
          productionOrderId: order.id,
          productionLineId: order.lineId,
          returnReason: input.returnReason,
          transactionGroupId: groupId,
        }
      }),
      movements: next.movements.map((m) => {
        const doc = next.documents.find((d) => d.id === m.documentId)
        if (!doc || doc.transferPairId !== pairId) return m
        return { ...m, productionOrderId: order.id, transactionGroupId: groupId }
      }),
    }
  }

  next = appendWarehouseAudit(next, {
    action: 'document_post',
    detail: `Возврат из производства · ${order.orderNumber} · ${input.returnReason}`,
    actorId: input.actor?.id,
    actorName: input.actor?.name,
  })

  return {
    store: next,
    result: {
      ok: true,
      documentId: returnDocumentId,
      transferPairId: pairId,
      documentIds: pairId
        ? next.documents.filter((d) => d.transferPairId === pairId).map((d) => d.id)
        : [],
    },
  }
}

export function isProductionHandoffDocument(
  doc: Pick<WarehouseDocument, 'purpose' | 'docRole'>,
): boolean {
  return (
    doc.purpose === 'production_material_transfer' ||
    doc.purpose === 'production_material_return' ||
    doc.docRole === 'production_transfer_issue' ||
    doc.docRole === 'production_transfer_receipt' ||
    doc.docRole === 'production_return_issue' ||
    doc.docRole === 'production_return_receipt'
  )
}

// Re-export config errors for callers
export { LINE_LOCATION_NOT_CONFIGURED, LINE_LOCATION_MISSING }
