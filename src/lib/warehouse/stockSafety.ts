/**
 * PHASE W0 — mandatory stock safety for issue postings.
 * Field validation (`skipValidation`) must never bypass this check.
 */
import { computeItemBalance, toBaseQty } from './stock'
import type { StockMovement, WarehouseDocumentLine, WarehouseStore } from './types'

export type ReservationSourceRef = {
  /** Planner / production order reserves */
  productionOrderIds?: string[]
  /** Mixer task reserves */
  mixTaskId?: string
}

export type StockShortageRow = {
  itemId: string
  name: string
  required: number
  available: number
  ownReserved: number
  shortage: number
  warehouseId: string
}

export type AggregatedIssueLine = {
  itemId: string
  quantity: number
}

export const INSUFFICIENT_STOCK_ERROR = 'warehouse.doc.errInsufficientStock' as const

/** Net reserved qty for a single reservation source on one item (warehouse-scoped). */
export function ownReservedQtyForItem(
  movements: StockMovement[],
  itemId: string,
  warehouseId: string,
  source: ReservationSourceRef | undefined,
): number {
  if (!source) return 0
  const orderIds = new Set((source.productionOrderIds ?? []).filter(Boolean))
  const mixTaskId = source.mixTaskId?.trim() || undefined
  if (orderIds.size === 0 && !mixTaskId) return 0

  let net = 0
  for (const m of movements) {
    if (m.itemId !== itemId) continue
    if (m.warehouseId !== warehouseId) continue
    const matchesOrder = m.productionOrderId != null && orderIds.has(m.productionOrderId)
    const matchesMix = mixTaskId != null && m.mixTaskId === mixTaskId
    if (!matchesOrder && !matchesMix) continue
    if (m.type === 'reserve') net += Math.abs(m.quantity)
    else if (m.type === 'unreserve') net -= Math.abs(m.quantity)
  }
  return Math.max(0, net)
}

export function reservationSourceFromDocument(doc: {
  productionOrderId?: string
  mixTaskId?: string
  reservationSource?: ReservationSourceRef
}): ReservationSourceRef | undefined {
  if (doc.reservationSource) return doc.reservationSource
  const productionOrderIds = doc.productionOrderId ? [doc.productionOrderId] : undefined
  const mixTaskId = doc.mixTaskId
  if (!productionOrderIds?.length && !mixTaskId) return undefined
  return { productionOrderIds, mixTaskId }
}

/** Aggregate issue lines to base units, merging duplicate itemIds. */
export function aggregateIssueLines(
  store: Pick<WarehouseStore, 'items'>,
  lines: Pick<WarehouseDocumentLine, 'itemId' | 'quantity' | 'inputUnit'>[],
): AggregatedIssueLine[] {
  const itemMap = new Map(store.items.map((i) => [i.id, i]))
  const qtyByItem = new Map<string, number>()
  for (const line of lines) {
    if (!line.itemId || line.quantity <= 0) continue
    const item = itemMap.get(line.itemId)
    const qty = item ? toBaseQty(item, line.quantity, line.inputUnit) : line.quantity
    qtyByItem.set(line.itemId, (qtyByItem.get(line.itemId) ?? 0) + qty)
  }
  return [...qtyByItem.entries()].map(([itemId, quantity]) => ({ itemId, quantity }))
}

/**
 * Effective available for an issue against optional own reservation:
 * ordinary available + ownReserved (foreign reserves stay locked).
 */
export function effectiveAvailableForIssue(
  store: Pick<WarehouseStore, 'items' | 'movements'>,
  itemId: string,
  warehouseId: string,
  source: ReservationSourceRef | undefined,
): { available: number; ownReserved: number; effective: number; balance: number } {
  const bal = computeItemBalance(itemId, store.movements, warehouseId)
  const ownReserved = ownReservedQtyForItem(store.movements, itemId, warehouseId, source)
  return {
    available: bal.available,
    ownReserved,
    effective: bal.available + ownReserved,
    balance: bal.balance,
  }
}

export function checkIssueStockSafety(
  store: Pick<WarehouseStore, 'items' | 'movements'>,
  args: {
    warehouseId: string
    lines: Pick<WarehouseDocumentLine, 'itemId' | 'quantity' | 'inputUnit'>[]
    reservationSource?: ReservationSourceRef
  },
):
  | { ok: true; aggregated: AggregatedIssueLine[] }
  | { ok: false; error: typeof INSUFFICIENT_STOCK_ERROR; shortages: StockShortageRow[] } {
  const aggregated = aggregateIssueLines(store, args.lines)
  const shortages: StockShortageRow[] = []
  const itemMap = new Map(store.items.map((i) => [i.id, i]))

  for (const line of aggregated) {
    const { available, ownReserved, effective, balance } = effectiveAvailableForIssue(
      store,
      line.itemId,
      args.warehouseId,
      args.reservationSource,
    )
    // Already-negative ledger: never worsen with a new issue.
    if (balance < -1e-9) {
      shortages.push({
        itemId: line.itemId,
        name: itemMap.get(line.itemId)?.name ?? line.itemId,
        required: line.quantity,
        available,
        ownReserved,
        shortage: line.quantity,
        warehouseId: args.warehouseId,
      })
      continue
    }
    if (line.quantity > effective + 1e-9) {
      shortages.push({
        itemId: line.itemId,
        name: itemMap.get(line.itemId)?.name ?? line.itemId,
        required: line.quantity,
        available,
        ownReserved,
        shortage: Math.max(0, line.quantity - effective),
        warehouseId: args.warehouseId,
      })
    }
  }

  if (shortages.length > 0) {
    return { ok: false, error: INSUFFICIENT_STOCK_ERROR, shortages }
  }
  return { ok: true, aggregated }
}

/** Unreserve own reservation up to issued qty (after a successful issue). */
export function buildOwnUnreserveMovements(
  store: Pick<WarehouseStore, 'items' | 'movements'>,
  args: {
    warehouseId: string
    date: string
    documentId: string
    documentNo: string
    aggregated: AggregatedIssueLine[]
    reservationSource?: ReservationSourceRef
    comment?: string
  },
): StockMovement[] {
  const source = args.reservationSource
  if (!source) return []
  const orderIds = (source.productionOrderIds ?? []).filter(Boolean)
  const mixTaskId = source.mixTaskId?.trim() || undefined
  if (orderIds.length === 0 && !mixTaskId) return []

  const createdAt = new Date().toISOString()
  const out: StockMovement[] = []

  for (const line of args.aggregated) {
    let remaining = line.quantity
    // Prefer releasing order reserves first (deterministic order), then mix task.
    for (const orderId of orderIds) {
      if (remaining <= 1e-9) break
      const owned = ownReservedQtyForItem(store.movements, line.itemId, args.warehouseId, {
        productionOrderIds: [orderId],
      })
      const release = Math.min(remaining, owned)
      if (release <= 1e-9) continue
      out.push({
        id: crypto.randomUUID(),
        itemId: line.itemId,
        warehouseId: args.warehouseId,
        type: 'unreserve',
        quantity: release,
        date: args.date,
        documentId: args.documentId,
        documentNo: args.documentNo,
        productionOrderId: orderId,
        comment: args.comment ?? `Погашение резерва · ${args.documentNo}`,
        createdAt,
      })
      remaining -= release
    }
    if (mixTaskId && remaining > 1e-9) {
      const owned = ownReservedQtyForItem(store.movements, line.itemId, args.warehouseId, {
        mixTaskId,
      })
      const release = Math.min(remaining, owned)
      if (release > 1e-9) {
        out.push({
          id: crypto.randomUUID(),
          itemId: line.itemId,
          warehouseId: args.warehouseId,
          type: 'unreserve',
          quantity: release,
          date: args.date,
          documentId: args.documentId,
          documentNo: args.documentNo,
          mixTaskId,
          comment: args.comment ?? `Погашение резерва · ${args.documentNo}`,
          createdAt,
        })
      }
    }
  }
  return out
}

export function warehouseIdempotencyKey(parts: {
  source: string
  sourceId: string
  role: string
  warehouseId: string
  session?: string
}): string {
  return [parts.source, parts.sourceId, parts.role, parts.warehouseId, parts.session]
    .filter((p) => p != null && String(p).length > 0)
    .join('::')
}

function normalizeLinesForIdempotency(
  lines: WarehouseDocumentLine[],
): Array<{ itemId: string; quantity: number; inputUnit?: string }> {
  return lines
    .map((l) => ({
      itemId: l.itemId,
      quantity: Math.round(l.quantity * 1e6) / 1e6,
      inputUnit: l.inputUnit,
    }))
    .sort((a, b) => a.itemId.localeCompare(b.itemId) || a.quantity - b.quantity)
}

/** Compare payload for idempotent replay vs conflict. */
export function warehouseDocumentsEquivalentForIdempotency(
  a: {
    type: string
    warehouseId: string
    purpose?: string
    docRole?: string
    lines: WarehouseDocumentLine[]
    productionRequestId?: string
    batchRunId?: string
    loadingShipmentId?: string
    transferPairId?: string
    purchaseOrderId?: string
    keeperRequestId?: string
  },
  b: typeof a,
): boolean {
  return (
    a.type === b.type &&
    a.warehouseId === b.warehouseId &&
    (a.purpose ?? '') === (b.purpose ?? '') &&
    (a.docRole ?? '') === (b.docRole ?? '') &&
    (a.productionRequestId ?? '') === (b.productionRequestId ?? '') &&
    (a.batchRunId ?? '') === (b.batchRunId ?? '') &&
    (a.loadingShipmentId ?? '') === (b.loadingShipmentId ?? '') &&
    (a.transferPairId ?? '') === (b.transferPairId ?? '') &&
    (a.purchaseOrderId ?? '') === (b.purchaseOrderId ?? '') &&
    (a.keeperRequestId ?? '') === (b.keeperRequestId ?? '') &&
    JSON.stringify(normalizeLinesForIdempotency(a.lines)) ===
      JSON.stringify(normalizeLinesForIdempotency(b.lines))
  )
}

export const IDEMPOTENCY_CONFLICT_ERROR = 'warehouse.doc.errIdempotencyConflict' as const
