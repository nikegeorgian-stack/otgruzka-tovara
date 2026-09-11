import {
  canonicalG5ShipmentCancel,
  canonicalG5ShipmentPost,
  stableG5ShipmentJson,
  type G5ShipmentSemanticInput,
} from './g5ShipmentIntegrityCore.mjs'

type Row = Record<string, unknown>

export type G5ShipmentAck = Row & {
  criticalRevision?: number
  idempotent?: boolean
  commandFingerprint?: string
  warehouse?: Row
  production?: Row
  sales?: Row
}

export type G5ShipmentPostExpected = G5ShipmentSemanticInput & {
  shipmentId: string
  salesOrderId: string
  salesLineId: string
  finishedProductId: string
  finishedGoodsLotId: string
  quantity: number
  warehouseId: string
  date: string
  minimumCriticalRevision: number
}

export type G5ShipmentCancelExpected = G5ShipmentSemanticInput & {
  shipmentId: string
  reason: string
  date: string
  minimumCriticalRevision: number
}

type ShipmentAckResult =
  | {
      ok: true
      criticalRevision: number
      commandFingerprint: string
      number: string
      reversalDocumentIds: string[]
    }
  | { ok: false; error: 'sales_shipment_ack_mismatch' }

const ERROR = { ok: false, error: 'sales_shipment_ack_mismatch' } as const
const EPS = 1e-9

export function requireSingleG5ShipmentUsage<T>(usages: readonly T[]):
  | { ok: true; usage: T }
  | { ok: false; error: 'warehouse.loading.errEmpty' | 'sales_shipment_single_lot_required' } {
  if (usages.length === 0) return { ok: false, error: 'warehouse.loading.errEmpty' }
  if (usages.length !== 1) {
    return { ok: false, error: 'sales_shipment_single_lot_required' }
  }
  return { ok: true, usage: usages[0]! }
}

function text(value: unknown): string {
  return String(value ?? '').trim()
}

function number(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim()) return Number(value)
  return Number.NaN
}

function quantity(value: unknown): number {
  const parsed = number(value)
  return Number.isFinite(parsed) ? Math.round(parsed * 1e6) / 1e6 : Number.NaN
}

function qtyEqual(left: unknown, right: unknown): boolean {
  const a = quantity(left)
  const b = quantity(right)
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= EPS
}

function finiteNonNegative(value: unknown): boolean {
  const parsed = number(value)
  return Number.isFinite(parsed) && parsed >= 0
}

function finitePositive(value: unknown): boolean {
  const parsed = number(value)
  return Number.isFinite(parsed) && parsed > EPS
}

function hasUniqueNonEmptyIds(rowsToCheck: Row[], idOf: (entry: Row) => unknown): boolean {
  const ids = rowsToCheck.map((entry) => text(idOf(entry)))
  return ids.every(Boolean) && new Set(ids).size === ids.length
}

function row(value: unknown): Row | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : null
}

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((entry): entry is Row => row(entry) !== null) : []
}

async function sha256(value: unknown): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(stableG5ShipmentJson(value)),
  )
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function validateRevision(ack: G5ShipmentAck, minimum: number): number | null {
  if (!Number.isInteger(minimum) || minimum < 0) return null
  const revision = number(ack.criticalRevision)
  if (!Number.isInteger(revision) || revision <= 0 || revision < minimum) return null
  if (ack.idempotent !== true && revision <= minimum) return null
  return revision
}

function expectedSalesStatus(lines: Row[]): string | null {
  if (
    lines.length === 0 ||
    lines.some(
      (line) =>
        !finiteNonNegative(line.quantity) ||
        !finiteNonNegative(line.shippedQty) ||
        !finiteNonNegative(line.remainingQty) ||
        number(line.shippedQty) > number(line.quantity) + EPS ||
        !qtyEqual(
          line.remainingQty,
          Math.max(0, number(line.quantity) - number(line.shippedQty)),
        ),
    )
  ) {
    return null
  }
  if (
    lines.every((line) => number(line.shippedQty) + EPS >= number(line.quantity))
  ) {
    return 'fulfilled'
  }
  return lines.some((line) => number(line.shippedQty) > EPS)
    ? 'partially_shipped'
    : 'confirmed'
}

function validateConservation(
  ack: G5ShipmentAck,
  shipment: Row,
  lot: Row,
  order: Row,
  line: Row,
): boolean {
  const shipments = rows(ack.warehouse?.loadingShipments)
  const postedLotShipments = shipments.filter(
      (entry) =>
        entry.status === 'posted' &&
        text(entry.finishedGoodsLotId) === text(shipment.finishedGoodsLotId),
    )
  const postedLineShipments = shipments.filter(
      (entry) =>
        entry.status === 'posted' &&
        text(entry.salesOrderId) === text(shipment.salesOrderId) &&
        text(entry.salesLineId) === text(shipment.salesLineId),
  )
  if (
    !hasUniqueNonEmptyIds(postedLotShipments, (entry) => entry.id) ||
    !hasUniqueNonEmptyIds(postedLineShipments, (entry) => entry.id) ||
    postedLotShipments.some((entry) => !finitePositive(entry.quantity)) ||
    postedLineShipments.some((entry) => !finitePositive(entry.quantity)) ||
    !finiteNonNegative(lot.quantityQcReleased) ||
    !finiteNonNegative(lot.quantityShipped) ||
    !finiteNonNegative(lot.quantityRemaining) ||
    !finiteNonNegative(line.quantity) ||
    !finiteNonNegative(line.shippedQty) ||
    !finiteNonNegative(line.remainingQty)
  ) {
    return false
  }
  const postedLot = postedLotShipments
    .reduce((sum, entry) => sum + (number(entry.quantity) || 0), 0)
  const postedLine = postedLineShipments
    .reduce((sum, entry) => sum + (number(entry.quantity) || 0), 0)
  const released = quantity(lot.quantityQcReleased)
  const shipped = quantity(lot.quantityShipped)
  const remaining = quantity(lot.quantityRemaining)
  const lineQuantity = quantity(line.quantity)
  const lineShipped = quantity(line.shippedQty)
  const lineRemaining = quantity(line.remainingQty)
  return (
    qtyEqual(postedLot, shipped) &&
    qtyEqual(remaining, released - shipped) &&
    qtyEqual(postedLine, lineShipped) &&
    qtyEqual(lineRemaining, Math.max(0, lineQuantity - lineShipped)) &&
    expectedSalesStatus(rows(order.lines)) !== null &&
    text(order.status) === expectedSalesStatus(rows(order.lines))
  )
}

export async function validateG5ShipmentPostAck(
  ack: G5ShipmentAck,
  expected: G5ShipmentPostExpected,
): Promise<ShipmentAckResult> {
  const canonical = canonicalG5ShipmentPost(expected)
  const fingerprint = await sha256(canonical)
  const revision = validateRevision(ack, expected.minimumCriticalRevision)
  if (
    revision == null ||
    ack.touchesWarehouse !== true ||
    text(ack.commandFingerprint) !== fingerprint ||
    text(ack.shipmentId) !== canonical.shipmentId ||
    ack.status !== 'posted' ||
    text(ack.salesOrderId) !== canonical.salesOrderId ||
    text(ack.salesLineId) !== canonical.salesLineId ||
    text(ack.finishedProductId) !== canonical.finishedProductId ||
    text(ack.finishedGoodsLotId) !== canonical.finishedGoodsLotId ||
    text(ack.warehouseId) !== canonical.warehouseId ||
    text(ack.date).slice(0, 10) !== canonical.date ||
    text(ack.counterpartyId) !== canonical.counterpartyId ||
    !qtyEqual(ack.quantity, canonical.quantity)
  ) {
    return ERROR
  }

  const shipments = rows(ack.warehouse?.loadingShipments).filter(
    (entry) => text(entry.id) === canonical.shipmentId,
  )
  if (shipments.length !== 1) return ERROR
  const shipment = shipments[0]
  if (
    shipment.status !== 'posted' ||
    text(shipment.postCommandFingerprint ?? shipment.commandFingerprint) !== fingerprint ||
    text(shipment.salesOrderId) !== canonical.salesOrderId ||
    text(shipment.salesLineId) !== canonical.salesLineId ||
    text(shipment.finishedProductId) !== canonical.finishedProductId ||
    text(shipment.finishedGoodsLotId) !== canonical.finishedGoodsLotId ||
    text(shipment.warehouseId) !== canonical.warehouseId ||
    text(shipment.date).slice(0, 10) !== canonical.date ||
    text(shipment.counterpartyId) !== canonical.counterpartyId ||
    !text(shipment.warehouseItemId) ||
    !text(shipment.unitSnapshot) ||
    !text(shipment.lotNumber) ||
    text(ack.warehouseItemId) !== text(shipment.warehouseItemId) ||
    text(ack.unitSnapshot) !== text(shipment.unitSnapshot) ||
    text(ack.lotNumber) !== text(shipment.lotNumber) ||
    text(ack.locationId) !== text(shipment.locationId) ||
    !qtyEqual(shipment.quantity, canonical.quantity)
  ) {
    return ERROR
  }

  const documentIds = Array.isArray(shipment.documentIds)
    ? shipment.documentIds.map(text).filter(Boolean)
    : []
  if (
    documentIds.length !== 1 ||
    text(ack.documentId) !== documentIds[0] ||
    new Set(documentIds).size !== 1
  ) {
    return ERROR
  }
  const documents = rows(ack.warehouse?.documents).filter(
    (entry) => text(entry.id) === documentIds[0],
  )
  const shipmentDocuments = rows(ack.warehouse?.documents).filter(
    (entry) => text(entry.shipmentId) === canonical.shipmentId,
  )
  if (
    documents.length !== 1 ||
    shipmentDocuments.length !== 1 ||
    text(shipmentDocuments[0].id) !== documentIds[0]
  ) {
    return ERROR
  }
  const document = documents[0]
  const documentLines = rows(document.lines)
  if (
    document.status !== 'posted' ||
    document.type !== 'issue' ||
    document.docRole !== 'finished_goods_shipment' ||
    text(document.commandFingerprint) !== fingerprint ||
    text(document.shipmentId) !== canonical.shipmentId ||
    text(document.salesOrderId) !== canonical.salesOrderId ||
    text(document.salesLineId) !== canonical.salesLineId ||
    text(document.finishedGoodsLotId) !== canonical.finishedGoodsLotId ||
    text(document.warehouseId) !== canonical.warehouseId ||
    text(document.date).slice(0, 10) !== canonical.date ||
    text(document.counterpartyId) !== canonical.counterpartyId ||
    documentLines.length !== 1 ||
    !text(documentLines[0].lineId) ||
    text(documentLines[0].itemId) !== text(shipment.warehouseItemId) ||
    text(documentLines[0].locationId) !== text(shipment.locationId) ||
    text(documentLines[0].batchNo) !== text(shipment.lotNumber) ||
    text(documentLines[0].unitSnapshot) !== text(shipment.unitSnapshot) ||
    !qtyEqual(documentLines[0].quantity, canonical.quantity)
  ) {
    return ERROR
  }

  const movementIds = Array.isArray(ack.movementIds)
    ? ack.movementIds.map(text).filter(Boolean)
    : []
  const movements = rows(ack.warehouse?.movements).filter(
    (entry) => text(entry.documentId) === documentIds[0],
  )
  const shipmentMovements = rows(ack.warehouse?.movements).filter(
    (entry) => text(entry.shipmentId) === canonical.shipmentId,
  )
  const movementIdentityMatches = rows(ack.warehouse?.movements).filter(
    (entry) => text(entry.id) === movementIds[0],
  )
  if (
    movements.length !== 1 ||
    shipmentMovements.length !== 1 ||
    text(shipmentMovements[0].id) !== text(movements[0].id) ||
    movements[0].cancelled === true ||
    movementIds.length !== 1 ||
    movementIdentityMatches.length !== 1 ||
    !text(movements[0].id) ||
    text(movements[0].id) !== movementIds[0] ||
    movements[0].type !== 'issue' ||
    text(movements[0].documentLineId) !== text(documentLines[0].lineId) ||
    text(movements[0].shipmentId) !== canonical.shipmentId ||
    text(movements[0].salesOrderId) !== canonical.salesOrderId ||
    text(movements[0].salesLineId) !== canonical.salesLineId ||
    text(movements[0].finishedGoodsLotId) !== canonical.finishedGoodsLotId ||
    text(movements[0].warehouseId) !== canonical.warehouseId ||
    text(movements[0].locationId) !== text(shipment.locationId) ||
    text(movements[0].itemId) !== text(shipment.warehouseItemId) ||
    text(movements[0].batchNo) !== text(shipment.lotNumber) ||
    text(movements[0].unitSnapshot) !== text(shipment.unitSnapshot) ||
    text(movements[0].date).slice(0, 10) !== canonical.date ||
    text(movements[0].commandFingerprint) !== fingerprint ||
    !qtyEqual(movements[0].quantity, canonical.quantity) ||
    !qtyEqual(documentLines[0].quantity, canonical.quantity)
  ) {
    return ERROR
  }

  const lots = rows(ack.production?.finishedGoodsLots ?? ack.production?.lots).filter(
    (entry) => text(entry.id) === canonical.finishedGoodsLotId,
  )
  const orders = rows(ack.sales?.orders).filter(
    (entry) => text(entry.id) === canonical.salesOrderId,
  )
  if (lots.length !== 1 || orders.length !== 1) return ERROR
  const lot = lots[0]
  const order = orders[0]
  const lines = rows(order.lines).filter(
    (entry) => text(entry.lineId ?? entry.id) === canonical.salesLineId,
  )
  if (
    lines.length !== 1 ||
    !hasUniqueNonEmptyIds(rows(order.lines), (entry) => entry.lineId ?? entry.id) ||
    lot.qcStatus !== 'released' ||
    text(lot.finishedProductId) !== canonical.finishedProductId ||
    text(lot.warehouseId) !== canonical.warehouseId ||
    text(lot.currentDecisionId) !== text(ack.qcDecisionId) ||
    !Number.isInteger(number(lot.lotRevision)) ||
    number(lot.lotRevision) <= 0 ||
    !Number.isInteger(number(ack.lotRevisionAtPost)) ||
    number(ack.lotRevisionAtPost) <= 0 ||
    number(lot.lotRevision) !== number(ack.lotRevisionAtPost) ||
    text(lines[0].finishedProductId) !== canonical.finishedProductId ||
    !qtyEqual(ack.quantityQcReleased, lot.quantityQcReleased) ||
    !qtyEqual(ack.quantityShipped, lot.quantityShipped) ||
    !qtyEqual(ack.quantityRemaining, lot.quantityRemaining) ||
    !qtyEqual(ack.salesLineQuantity, lines[0].quantity) ||
    !qtyEqual(ack.salesLineQuantityShipped, lines[0].shippedQty) ||
    !qtyEqual(ack.salesLineQuantityRemaining, lines[0].remainingQty) ||
    text(ack.salesStatus) !== text(order.status) ||
    !validateConservation(ack, shipment, lot, order, lines[0])
  ) {
    return ERROR
  }

  const decisions = rows(ack.production?.qcDecisions).filter(
    (entry) => text(entry.id) === text(ack.qcDecisionId),
  )
  if (
    decisions.length !== 1 ||
    decisions[0].status !== 'released' ||
    text(decisions[0].lotId) !== canonical.finishedGoodsLotId ||
    number(decisions[0].lotRevision) !== number(ack.lotRevisionAtPost) ||
    text(shipment.qcDecisionId) !== text(ack.qcDecisionId) ||
    number(shipment.lotRevisionAtPost) !== number(ack.lotRevisionAtPost)
  ) {
    return ERROR
  }

  return {
    ok: true,
    criticalRevision: revision,
    commandFingerprint: fingerprint,
    number: text(shipment.number) || text(document.number) || canonical.shipmentId,
    reversalDocumentIds: [],
  }
}

export async function validateG5ShipmentCancelAck(
  ack: G5ShipmentAck,
  expected: G5ShipmentCancelExpected,
): Promise<ShipmentAckResult> {
  const canonical = canonicalG5ShipmentCancel(expected)
  const fingerprint = await sha256(canonical)
  const revision = validateRevision(ack, expected.minimumCriticalRevision)
  if (
    revision == null ||
    ack.touchesWarehouse !== true ||
    text(ack.commandFingerprint) !== fingerprint ||
    text(ack.shipmentId) !== canonical.shipmentId ||
    ack.status !== 'cancelled' ||
    text(ack.reason) !== canonical.reason ||
    text(ack.date).slice(0, 10) !== canonical.date
  ) {
    return ERROR
  }

  const shipments = rows(ack.warehouse?.loadingShipments).filter(
    (entry) => text(entry.id) === canonical.shipmentId,
  )
  if (shipments.length !== 1) return ERROR
  const shipment = shipments[0]
  if (
    shipment.status !== 'cancelled' ||
    text(shipment.cancelCommandFingerprint) !== fingerprint ||
    text(shipment.cancellationReason) !== canonical.reason ||
    text(shipment.cancellationDate).slice(0, 10) !== canonical.date ||
    !text(shipment.salesOrderId) ||
    !text(shipment.salesLineId) ||
    !text(shipment.finishedProductId) ||
    !text(shipment.finishedGoodsLotId) ||
    !text(shipment.warehouseId) ||
    !text(shipment.warehouseItemId) ||
    !text(shipment.unitSnapshot) ||
    !text(shipment.lotNumber) ||
    !finitePositive(shipment.quantity) ||
    text(ack.salesOrderId) !== text(shipment.salesOrderId) ||
    text(ack.salesLineId) !== text(shipment.salesLineId) ||
    text(ack.finishedProductId) !== text(shipment.finishedProductId) ||
    text(ack.finishedGoodsLotId) !== text(shipment.finishedGoodsLotId) ||
    text(ack.warehouseId) !== text(shipment.warehouseId) ||
    text(ack.warehouseItemId) !== text(shipment.warehouseItemId) ||
    text(ack.unitSnapshot) !== text(shipment.unitSnapshot) ||
    text(ack.lotNumber) !== text(shipment.lotNumber) ||
    text(ack.locationId) !== text(shipment.locationId) ||
    text(ack.counterpartyId) !== text(shipment.counterpartyId) ||
    !qtyEqual(ack.quantity, shipment.quantity)
  ) {
    return ERROR
  }

  const postFingerprint = text(shipment.postCommandFingerprint ?? shipment.commandFingerprint)
  const sourceIds = Array.isArray(shipment.documentIds)
    ? shipment.documentIds.map(text).filter(Boolean)
    : []
  const reversalIds = Array.isArray(shipment.reversalDocumentIds)
    ? shipment.reversalDocumentIds.map(text).filter(Boolean)
    : []
  if (
    !/^[a-f0-9]{64}$/.test(postFingerprint) ||
    sourceIds.length !== 1 ||
    reversalIds.length !== 1 ||
    text(ack.documentId) !== sourceIds[0] ||
    new Set(sourceIds).size !== 1 ||
    new Set(reversalIds).size !== 1 ||
    !Array.isArray(ack.reversalDocumentIds) ||
    ack.reversalDocumentIds.map(text).filter(Boolean).length !== 1 ||
    text(ack.reversalDocumentIds[0]) !== reversalIds[0]
  ) {
    return ERROR
  }

  const documents = rows(ack.warehouse?.documents)
  const sources = documents.filter((entry) => text(entry.id) === sourceIds[0])
  const reversals = documents.filter((entry) => text(entry.id) === reversalIds[0])
  const shipmentDocuments = documents.filter(
    (entry) => text(entry.shipmentId) === canonical.shipmentId,
  )
  if (
    sources.length !== 1 ||
    reversals.length !== 1 ||
    shipmentDocuments.length !== 2 ||
    !shipmentDocuments.every(
      (entry) => text(entry.id) === sourceIds[0] || text(entry.id) === reversalIds[0],
    )
  ) {
    return ERROR
  }
  const source = sources[0]
  const reversal = reversals[0]
  const sourceLines = rows(source.lines)
  const reversalLines = rows(reversal.lines)
  if (
    source.status !== 'posted' ||
    source.type !== 'issue' ||
    source.docRole !== 'finished_goods_shipment' ||
    text(source.shipmentId) !== canonical.shipmentId ||
    text(source.salesOrderId) !== text(shipment.salesOrderId) ||
    text(source.salesLineId) !== text(shipment.salesLineId) ||
    text(source.finishedGoodsLotId) !== text(shipment.finishedGoodsLotId) ||
    text(source.warehouseId) !== text(shipment.warehouseId) ||
    text(source.date).slice(0, 10) !== text(shipment.date).slice(0, 10) ||
    text(source.counterpartyId) !== text(shipment.counterpartyId) ||
    text(source.commandFingerprint) !== postFingerprint ||
    reversal.status !== 'posted' ||
    reversal.type !== 'receipt' ||
    reversal.docRole !== 'finished_goods_shipment_cancel' ||
    text(reversal.reversesDocumentId) !== sourceIds[0] ||
    text(reversal.shipmentId) !== canonical.shipmentId ||
    text(reversal.salesOrderId) !== text(shipment.salesOrderId) ||
    text(reversal.salesLineId) !== text(shipment.salesLineId) ||
    text(reversal.finishedGoodsLotId) !== text(shipment.finishedGoodsLotId) ||
    text(reversal.warehouseId) !== text(shipment.warehouseId) ||
    text(reversal.cancellationReason) !== canonical.reason ||
    text(reversal.date).slice(0, 10) !== canonical.date ||
    text(reversal.commandFingerprint) !== fingerprint ||
    sourceLines.length !== 1 ||
    reversalLines.length !== 1 ||
    !text(sourceLines[0].lineId) ||
    !text(reversalLines[0].lineId) ||
    text(reversalLines[0].lineId) === text(sourceLines[0].lineId) ||
    text(sourceLines[0].itemId) !== text(shipment.warehouseItemId) ||
    text(sourceLines[0].locationId) !== text(shipment.locationId) ||
    text(sourceLines[0].batchNo) !== text(shipment.lotNumber) ||
    text(sourceLines[0].unitSnapshot) !== text(shipment.unitSnapshot) ||
    text(reversalLines[0].itemId) !== text(sourceLines[0].itemId) ||
    text(reversalLines[0].locationId) !== text(sourceLines[0].locationId) ||
    text(reversalLines[0].batchNo) !== text(sourceLines[0].batchNo) ||
    text(reversalLines[0].unitSnapshot) !== text(sourceLines[0].unitSnapshot) ||
    !qtyEqual(sourceLines[0].quantity, shipment.quantity) ||
    !qtyEqual(reversalLines[0].quantity, shipment.quantity)
  ) {
    return ERROR
  }

  const movements = rows(ack.warehouse?.movements)
  const sourceMovements = movements.filter(
    (entry) => text(entry.documentId) === sourceIds[0],
  )
  const reversalMovements = movements.filter(
    (entry) => text(entry.documentId) === reversalIds[0],
  )
  const shipmentMovements = movements.filter(
    (entry) => text(entry.shipmentId) === canonical.shipmentId,
  )
  const reversalMovementIds = Array.isArray(ack.reversalMovementIds)
    ? ack.reversalMovementIds.map(text).filter(Boolean)
    : []
  const sourceMovementIdentityMatches = movements.filter(
    (entry) => text(entry.id) === text(sourceMovements[0]?.id),
  )
  const reversalMovementIdentityMatches = movements.filter(
    (entry) => text(entry.id) === text(reversalMovements[0]?.id),
  )
  if (
    sourceMovements.length !== 1 ||
    reversalMovements.length !== 1 ||
    shipmentMovements.length !== 2 ||
    !shipmentMovements.every(
      (entry) =>
        text(entry.id) === text(sourceMovements[0].id) ||
        text(entry.id) === text(reversalMovements[0].id),
    ) ||
    sourceMovements[0].cancelled === true ||
    reversalMovements[0].cancelled === true ||
    !text(sourceMovements[0].id) ||
    !text(reversalMovements[0].id) ||
    text(reversalMovements[0].id) === text(sourceMovements[0].id) ||
    sourceMovementIdentityMatches.length !== 1 ||
    reversalMovementIdentityMatches.length !== 1 ||
    reversalMovementIds.length !== 1 ||
    text(reversalMovements[0].id) !== reversalMovementIds[0] ||
    sourceMovements[0].type !== 'issue' ||
    text(sourceMovements[0].documentLineId) !== text(sourceLines[0].lineId) ||
    text(sourceMovements[0].shipmentId) !== canonical.shipmentId ||
    text(sourceMovements[0].salesOrderId) !== text(shipment.salesOrderId) ||
    text(sourceMovements[0].salesLineId) !== text(shipment.salesLineId) ||
    text(sourceMovements[0].finishedGoodsLotId) !== text(shipment.finishedGoodsLotId) ||
    text(sourceMovements[0].warehouseId) !== text(shipment.warehouseId) ||
    text(sourceMovements[0].locationId) !== text(shipment.locationId) ||
    text(sourceMovements[0].itemId) !== text(shipment.warehouseItemId) ||
    text(sourceMovements[0].batchNo) !== text(shipment.lotNumber) ||
    text(sourceMovements[0].unitSnapshot) !== text(shipment.unitSnapshot) ||
    text(sourceMovements[0].date).slice(0, 10) !== text(shipment.date).slice(0, 10) ||
    !qtyEqual(sourceMovements[0].quantity, shipment.quantity) ||
    text(sourceMovements[0].commandFingerprint) !== postFingerprint ||
    reversalMovements[0].type !== 'receipt' ||
    text(reversalMovements[0].documentLineId) !== text(reversalLines[0].lineId) ||
    text(reversalMovements[0].reversesMovementId) !== text(sourceMovements[0].id) ||
    text(reversalMovements[0].shipmentId) !== canonical.shipmentId ||
    text(reversalMovements[0].finishedGoodsLotId) !== text(shipment.finishedGoodsLotId) ||
    text(reversalMovements[0].salesOrderId) !== text(shipment.salesOrderId) ||
    text(reversalMovements[0].salesLineId) !== text(shipment.salesLineId) ||
    text(reversalMovements[0].warehouseId) !== text(shipment.warehouseId) ||
    text(reversalMovements[0].locationId) !== text(shipment.locationId) ||
    text(reversalMovements[0].itemId) !== text(shipment.warehouseItemId) ||
    text(reversalMovements[0].batchNo) !== text(shipment.lotNumber) ||
    text(reversalMovements[0].unitSnapshot) !== text(shipment.unitSnapshot) ||
    text(reversalMovements[0].date).slice(0, 10) !== canonical.date ||
    text(reversalMovements[0].commandFingerprint) !== fingerprint ||
    !qtyEqual(reversalMovements[0].quantity, shipment.quantity)
  ) {
    return ERROR
  }

  const lots = rows(ack.production?.finishedGoodsLots ?? ack.production?.lots).filter(
    (entry) => text(entry.id) === text(shipment.finishedGoodsLotId),
  )
  const orders = rows(ack.sales?.orders).filter(
    (entry) => text(entry.id) === text(shipment.salesOrderId),
  )
  if (lots.length !== 1 || orders.length !== 1) return ERROR
  const lot = lots[0]
  const order = orders[0]
  const lines = rows(order.lines).filter(
    (entry) => text(entry.lineId ?? entry.id) === text(shipment.salesLineId),
  )
  if (
    lines.length !== 1 ||
    !hasUniqueNonEmptyIds(rows(order.lines), (entry) => entry.lineId ?? entry.id) ||
    lot.qcStatus !== 'released' ||
    text(lot.finishedProductId) !== text(shipment.finishedProductId) ||
    text(lot.warehouseId) !== text(shipment.warehouseId) ||
    text(lot.warehouseItemId ?? lot.itemId ?? shipment.finishedProductId) !==
      text(shipment.warehouseItemId) ||
    text(lot.locationId) !== text(shipment.locationId) ||
    text(lot.lotNumber) !== text(shipment.lotNumber) ||
    text(lines[0].finishedProductId) !== text(shipment.finishedProductId) ||
    !qtyEqual(ack.quantity, shipment.quantity) ||
    !qtyEqual(ack.quantityQcReleased, lot.quantityQcReleased) ||
    !qtyEqual(ack.quantityShipped, lot.quantityShipped) ||
    !qtyEqual(ack.quantityRemaining, lot.quantityRemaining) ||
    !qtyEqual(ack.salesLineQuantity, lines[0].quantity) ||
    !qtyEqual(ack.salesLineQuantityShipped, lines[0].shippedQty) ||
    !qtyEqual(ack.salesLineQuantityRemaining, lines[0].remainingQty) ||
    text(ack.salesStatus) !== text(order.status) ||
    !validateConservation(ack, shipment, lot, order, lines[0])
  ) {
    return ERROR
  }

  return {
    ok: true,
    criticalRevision: revision,
    commandFingerprint: fingerprint,
    number: text(shipment.number) || canonical.shipmentId,
    reversalDocumentIds: reversalIds,
  }
}

export async function acceptG5ShipmentPostAck(
  ack: G5ShipmentAck,
  expected: G5ShipmentPostExpected,
  onAccepted: (validated: Extract<ShipmentAckResult, { ok: true }>) => void,
): Promise<ShipmentAckResult> {
  const validated = await validateG5ShipmentPostAck(ack, expected)
  if (validated.ok) onAccepted(validated)
  return validated
}

export async function acceptG5ShipmentCancelAck(
  ack: G5ShipmentAck,
  expected: G5ShipmentCancelExpected,
  onAccepted: (validated: Extract<ShipmentAckResult, { ok: true }>) => void,
): Promise<ShipmentAckResult> {
  const validated = await validateG5ShipmentCancelAck(ack, expected)
  if (validated.ok) onAccepted(validated)
  return validated
}
