/** R3.1C — fail-closed ACK validation for irreversible G4 QC/shipment commands. */
import {
  g4CriticalMutationCommandFingerprint,
  type G4CriticalMutationCommandType,
} from './g4CriticalMutationIntegrityCore.mjs'

export const G4_CRITICAL_ACK_INVALID = 'g4_critical_ack_invalid' as const

type Row = Record<string, unknown>

export type G4CriticalMutationAck = Row & {
  criticalRevision?: number
  productionActive?: boolean
  packagingQcActive?: boolean
  idempotent?: boolean
  commandFingerprint?: string
  production?: Row
  warehouse?: Row
}

export type G4CriticalMutationAckResult =
  | {
      ok: true
      criticalRevision: number
      commandFingerprint: string
      lot: Row
      decision?: Row
      childLot?: Row
      shipment?: Row
      documentIds: string[]
      movementIds: string[]
    }
  | { ok: false; error: typeof G4_CRITICAL_ACK_INVALID; reason: string }

const EPS = 1e-9

function text(value: unknown): string {
  return String(value ?? '').trim()
}

function number(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function sameQuantity(left: unknown, right: unknown): boolean {
  const a = number(left)
  const b = number(right)
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= EPS
}

function row(value: unknown): Row | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  try {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null ? (value as Row) : null
  } catch {
    return null
  }
}

function strictRows(value: unknown): Row[] | null {
  if (!Array.isArray(value)) return null
  const result: Row[] = []
  for (const entry of value) {
    const parsed = row(entry)
    if (!parsed) return null
    result.push(parsed)
  }
  return result
}

function rows(value: unknown): Row[] {
  return strictRows(value) ?? []
}

function uniqueNonEmptyIds(value: unknown): boolean {
  const parsed = strictRows(value)
  if (!parsed) return false
  const ids = parsed.map((entry) => text(entry.id))
  return ids.every(Boolean) && new Set(ids).size === ids.length
}

function hasCriticalAckShape(ack: Row): ack is G4CriticalMutationAck {
  const production = row(ack.production)
  const warehouse = row(ack.warehouse)
  if (!production || !warehouse) return false
  if (
    !uniqueNonEmptyIds(production.orders) ||
    !uniqueNonEmptyIds(production.packagingReports) ||
    !uniqueNonEmptyIds(production.finishedGoodsLots) ||
    !uniqueNonEmptyIds(production.qcDecisions) ||
    !uniqueNonEmptyIds(warehouse.documents) ||
    !uniqueNonEmptyIds(warehouse.movements) ||
    !uniqueNonEmptyIds(warehouse.loadingShipments)
  ) {
    return false
  }
  const reports = strictRows(production.packagingReports)!
  if (
    reports.some(
      (report) =>
        !uniqueNonEmptyLineIds(report.wipLines, true) ||
        !uniqueNonEmptyLineIds(report.materialLines, true),
    )
  ) {
    return false
  }
  const documents = strictRows(warehouse.documents)!
  if (documents.some((document) => !uniqueNonEmptyLineIds(document.lines))) return false
  const shipments = strictRows(warehouse.loadingShipments)!
  return shipments.every(
    (shipment) =>
      shipment.lines === undefined || uniqueNonEmptyLineIds(shipment.lines, true, true),
  )
}

function uniqueNonEmptyLineIds(
  value: unknown,
  allowIdAlias = false,
  useIdFirst = false,
): boolean {
  const parsed = strictRows(value)
  if (!parsed) return false
  const ids = parsed.map((entry) =>
    text(
      useIdFirst
        ? entry.id ?? entry.lineId
        : entry.lineId ?? (allowIdAlias ? entry.id : undefined),
    ),
  )
  return ids.every(Boolean) && new Set(ids).size === ids.length
}

function exactOne(value: unknown, id: unknown): Row | null {
  const normalized = text(id)
  if (!normalized) return null
  const matches = rows(value).filter((entry) => text(entry.id) === normalized)
  return matches.length === 1 ? matches[0]! : null
}

function stringIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const ids = value.map(text)
  return ids.every(Boolean) && new Set(ids).size === ids.length ? ids : []
}

function exactIds(left: unknown, right: unknown): boolean {
  const a = stringIds(left)
  const b = stringIds(right)
  return (
    a.length === b.length &&
    a.length > 0 &&
    a.every((id, index) => id === b[index])
  )
}

function postedShipmentQuantityForLot(ack: G4CriticalMutationAck, lotId: string): number {
  const shipments = rows(ack.warehouse?.loadingShipments).filter(
    (entry) => entry.status === 'posted' && text(entry.finishedGoodsLotId) === lotId,
  )
  const ids = shipments.map((entry) => text(entry.id))
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) return Number.NaN
  let total = 0
  for (const shipment of shipments) {
    const quantity = number(shipment.quantity)
    if (!Number.isFinite(quantity) || quantity <= EPS) return Number.NaN
    total += quantity
  }
  return total
}

function fail(reason: string): G4CriticalMutationAckResult {
  return { ok: false, error: G4_CRITICAL_ACK_INVALID, reason }
}

function lotIdFromCommand(command: Row): string {
  return text(command.finishedGoodsLotId ?? command.lotId)
}

function validateRevision(ack: G4CriticalMutationAck, previous: number): number | null {
  if (!Number.isInteger(previous) || previous < 0) return null
  const revision = number(ack.criticalRevision)
  if (!Number.isInteger(revision) || revision <= 0 || revision < previous) return null
  if (ack.idempotent !== true && revision <= previous) return null
  return revision
}

function validateDecision(
  ack: G4CriticalMutationAck,
  lot: Row,
  expectedStatus: string,
  fingerprint: string,
): Row | null {
  const decisionId = text(ack.decisionId)
  const decision = exactOne(ack.production?.qcDecisions, decisionId)
  if (
    !decision ||
    text(lot.currentDecisionId) !== decisionId ||
    text(decision.lotId ?? decision.finishedGoodsLotId) !== text(lot.id) ||
    text(decision.status) !== expectedStatus ||
    text(decision.commandFingerprint) !== fingerprint ||
    text(ack.finishedGoodsLotId) !== text(lot.id)
  ) {
    return null
  }
  const lotRevision = number(lot.lotRevision)
  const decisionRevision = number(decision.lotRevision)
  if (
    !Number.isInteger(lotRevision) ||
    lotRevision <= 0 ||
    !Number.isInteger(decisionRevision) ||
    decisionRevision !== lotRevision
  ) {
    return null
  }
  return decision
}

type DocumentSpec = {
  id: string
  role: string
  type: 'issue' | 'receipt'
  lotId: string
  itemId: string
  warehouseId: string
  locationId: string
  batchNo: string
  quantity: number
  shipmentId?: string
  reversesDocumentId?: string
}

function validateDocumentGraph(
  ack: G4CriticalMutationAck,
  fingerprint: string,
  specs: DocumentSpec[],
  claimedMovementIds: string[],
): boolean {
  const documents = rows(ack.warehouse?.documents)
  const movements = rows(ack.warehouse?.movements)
  if (
    specs.length === 0 ||
    claimedMovementIds.length !== specs.length ||
    documents.filter((doc) => text(doc.commandFingerprint) === fingerprint).length !== specs.length ||
    movements.filter((movement) => text(movement.commandFingerprint) === fingerprint).length !==
      specs.length
  ) {
    return false
  }
  const claimedMovementSet = new Set(claimedMovementIds)
  for (const spec of specs) {
    const doc = exactOne(documents, spec.id)
    if (!doc) return false
    const lines = strictRows(doc.lines)
    if (
      !lines ||
      doc.status !== 'posted' ||
      text(doc.type) !== spec.type ||
      text(doc.docRole) !== spec.role ||
      text(doc.commandFingerprint) !== fingerprint ||
      text(doc.finishedGoodsLotId) !== spec.lotId ||
      text(doc.warehouseId) !== spec.warehouseId ||
      (spec.shipmentId != null && text(doc.shipmentId) !== spec.shipmentId) ||
      (spec.reversesDocumentId != null &&
        text(doc.reversesDocumentId) !== spec.reversesDocumentId) ||
      lines.length !== 1
    ) {
      return false
    }
    const line = lines[0]!
    if (
      !text(line.lineId) ||
      text(line.itemId) !== spec.itemId ||
      text(line.locationId) !== spec.locationId ||
      text(line.batchNo) !== spec.batchNo ||
      !sameQuantity(line.quantity, spec.quantity)
    ) {
      return false
    }
    const docMovements = movements.filter((movement) => text(movement.documentId) === spec.id)
    if (docMovements.length !== 1) return false
    const movement = docMovements[0]!
    if (
      !claimedMovementSet.has(text(movement.id)) ||
      movement.cancelled === true ||
      text(movement.type) !== spec.type ||
      text(movement.documentLineId) !== text(line.lineId) ||
      text(movement.commandFingerprint) !== fingerprint ||
      text(movement.finishedGoodsLotId) !== spec.lotId ||
      text(movement.warehouseId) !== spec.warehouseId ||
      text(movement.locationId) !== spec.locationId ||
      text(movement.itemId) !== spec.itemId ||
      text(movement.batchNo) !== spec.batchNo ||
      (spec.shipmentId != null && text(movement.shipmentId) !== spec.shipmentId) ||
      !sameQuantity(movement.quantity, spec.quantity)
    ) {
      return false
    }
  }
  return true
}

function expectDocumentIds(ack: G4CriticalMutationAck, count: number): string[] | null {
  const ids = stringIds(
    count === 1 && !Array.isArray(ack.documentIds) ? [ack.documentId] : ack.documentIds,
  )
  return ids.length === count ? ids : null
}

function expectMovementIds(ack: G4CriticalMutationAck, count: number): string[] | null {
  const ids = stringIds(
    count === 1 && !Array.isArray(ack.movementIds) ? [ack.movementId] : ack.movementIds,
  )
  return ids.length === count ? ids : null
}

export function validateG4CriticalMutationAck(input: {
  ack: G4CriticalMutationAck
  commandType: G4CriticalMutationCommandType
  command: Row
  previousCriticalRevision: number
}): G4CriticalMutationAckResult {
  const ackRow = row(input?.ack)
  const command = row(input?.command)
  const commandType = input?.commandType
  if (!ackRow || !command || !hasCriticalAckShape(ackRow)) {
    return fail('authoritative_shape_invalid')
  }
  const ack = ackRow as G4CriticalMutationAck
  const revision = validateRevision(ack, input.previousCriticalRevision)
  if (revision == null) return fail('revision_invalid')
  if (ack.productionActive !== true || ack.packagingQcActive !== true) {
    return fail('domain_activation_missing')
  }

  let fingerprint: string
  try {
    fingerprint = g4CriticalMutationCommandFingerprint(commandType, command)
  } catch {
    return fail('fingerprint_unavailable')
  }
  if (
    !/^g4-critical:v1:sha256:[a-f0-9]{64}$/.test(text(ack.commandFingerprint)) ||
    text(ack.commandFingerprint) !== fingerprint
  ) {
    return fail('fingerprint_mismatch')
  }

  let lotId = lotIdFromCommand(command)
  if (commandType === 'shipment.cancel') {
    const cancelShipment = exactOne(ack.warehouse?.loadingShipments, command.shipmentId)
    lotId = text(cancelShipment?.finishedGoodsLotId)
  }
  const lot = exactOne(ack.production?.finishedGoodsLots, lotId)
  if (!lot || text(ack.finishedGoodsLotId) !== lotId) return fail('lot_not_unique')

  let decision: Row | undefined
  let childLot: Row | undefined
  let shipment: Row | undefined
  let documentIds: string[] = []
  let movementIds: string[] = []

  if (commandType === 'qc.review.start') {
    if (
      ack.touchesWarehouse !== false ||
      text(ack.qcStatus) !== 'in_review' ||
      text(lot.qcStatus) !== 'in_review' ||
      text(lot.reviewCommandFingerprint) !== fingerprint
    ) {
      return fail('review_state_mismatch')
    }
    decision = validateDecision(ack, lot, 'in_review', fingerprint) ?? undefined
    if (!decision) return fail('review_decision_mismatch')
  } else if (commandType === 'qc.release') {
    if (
      ack.touchesWarehouse !== false ||
      text(ack.qcStatus) !== 'released' ||
      text(lot.qcStatus) !== 'released' ||
      text(lot.releaseCommandFingerprint) !== fingerprint ||
      !sameQuantity(lot.quantityQcReleased, lot.quantityProduced) ||
      !sameQuantity(
        lot.quantityRemaining,
        Math.max(0, number(lot.quantityQcReleased) - number(lot.quantityShipped)),
      )
    ) {
      return fail('release_state_mismatch')
    }
    decision = validateDecision(ack, lot, 'released', fingerprint) ?? undefined
    if (
      !decision ||
      !text(ack.passportAttachmentId) ||
      !text(ack.protocolAttachmentId) ||
      text(decision.passportAttachmentId) !== text(ack.passportAttachmentId) ||
      text(decision.protocolAttachmentId) !== text(ack.protocolAttachmentId)
    ) {
      return fail('release_decision_mismatch')
    }
  } else if (commandType === 'qc.regrade') {
    const childId = text(ack.newFinishedGoodsLotId)
    childLot = exactOne(ack.production?.finishedGoodsLots, childId) ?? undefined
    const quantity = number(ack.quantity)
    if (
      ack.touchesWarehouse !== true ||
      text(ack.qcStatus) !== 'regrade_pending' ||
      text(lot.qcStatus) !== 'regrade_pending' ||
      text(lot.regradeCommandFingerprint) !== fingerprint ||
      text(lot.regradedToLotId) !== childId ||
      !childLot ||
      text(childLot.parentLotId) !== lotId ||
      text(childLot.qcStatus) !== 'pending' ||
      text(childLot.finishedProductId) !== text(command.targetFinishedProductId) ||
      text(childLot.warehouseItemId) !==
        text(command.targetWarehouseItemId ?? command.targetFinishedProductId) ||
      !Number.isFinite(quantity) ||
      quantity <= EPS ||
      !sameQuantity(childLot.quantityProduced, quantity) ||
      (command.quantity != null && !sameQuantity(command.quantity, quantity))
    ) {
      return fail('regrade_state_mismatch')
    }
    decision = validateDecision(ack, lot, 'regrade_pending', fingerprint) ?? undefined
    if (!decision) return fail('regrade_decision_mismatch')
    documentIds = expectDocumentIds(ack, 2) ?? []
    movementIds = expectMovementIds(ack, 2) ?? []
    if (documentIds.length !== 2 || movementIds.length !== 2) {
      return fail('regrade_ledger_ids_missing')
    }
    if (
      !exactIds(lot.regradeDocumentIds, documentIds) ||
      !exactIds(lot.regradeMovementIds, movementIds)
    ) {
      return fail('regrade_ledger_pointer_mismatch')
    }
    const sourceSpec: DocumentSpec = {
      id: documentIds[0]!,
      role: 'qc_regrade_issue',
      type: 'issue',
      lotId,
      itemId: text(lot.warehouseItemId),
      warehouseId: text(lot.warehouseId),
      locationId: text(lot.locationId),
      batchNo: text(lot.lotNumber ?? lot.batchNo),
      quantity,
    }
    const childSpec: DocumentSpec = {
      id: documentIds[1]!,
      role: 'qc_regrade_receipt',
      type: 'receipt',
      lotId: childId,
      itemId: text(childLot.warehouseItemId),
      warehouseId: text(childLot.warehouseId),
      locationId: text(childLot.locationId),
      batchNo: text(childLot.lotNumber ?? childLot.batchNo),
      quantity,
    }
    if (!validateDocumentGraph(ack, fingerprint, [sourceSpec, childSpec], movementIds)) {
      return fail('regrade_ledger_mismatch')
    }
  } else if (commandType === 'qc.reject') {
    const quantity = number(ack.quantity)
    const scrapLocationId = text(ack.scrapLocationId)
    if (
      ack.touchesWarehouse !== true ||
      text(ack.qcStatus) !== 'scrap_pending' ||
      text(lot.qcStatus) !== 'scrap_pending' ||
      text(lot.rejectCommandFingerprint) !== fingerprint ||
      text(lot.scrapLocationId) !== scrapLocationId ||
      text(lot.locationId) !== scrapLocationId ||
      !Number.isFinite(quantity) ||
      quantity <= EPS ||
      !sameQuantity(lot.scrapQuantity, quantity)
    ) {
      return fail('reject_state_mismatch')
    }
    decision = validateDecision(ack, lot, 'rejected', fingerprint) ?? undefined
    if (!decision) return fail('reject_decision_mismatch')
    documentIds = expectDocumentIds(ack, 2) ?? []
    movementIds = expectMovementIds(ack, 2) ?? []
    if (documentIds.length !== 2 || movementIds.length !== 2) {
      return fail('reject_ledger_ids_missing')
    }
    if (
      !exactIds(lot.rejectDocumentIds, documentIds) ||
      !exactIds(lot.rejectMovementIds, movementIds)
    ) {
      return fail('reject_ledger_pointer_mismatch')
    }
    const issue = exactOne(ack.warehouse?.documents, documentIds[0])
    const issueLines = strictRows(issue?.lines)
    const issueLine = issueLines?.[0]
    if (!issue || !issueLines || !issueLine) return fail('authoritative_shape_invalid')
    const specs: DocumentSpec[] = [
      {
        id: documentIds[0]!,
        role: 'qc_reject_issue',
        type: 'issue',
        lotId,
        itemId: text(lot.warehouseItemId),
        warehouseId: text(lot.warehouseId),
        locationId: text(issueLine.locationId),
        batchNo: text(lot.lotNumber ?? lot.batchNo),
        quantity,
      },
      {
        id: documentIds[1]!,
        role: 'qc_reject_scrap_receipt',
        type: 'receipt',
        lotId,
        itemId: text(lot.warehouseItemId),
        warehouseId: text(lot.warehouseId),
        locationId: scrapLocationId,
        batchNo: text(lot.lotNumber ?? lot.batchNo),
        quantity,
      },
    ]
    if (!validateDocumentGraph(ack, fingerprint, specs, movementIds)) {
      return fail('reject_ledger_mismatch')
    }
  } else if (commandType === 'qc.scrap.writeoff') {
    const quantity = number(ack.quantity)
    if (
      ack.touchesWarehouse !== true ||
      text(ack.qcStatus) !== 'written_off' ||
      text(lot.qcStatus) !== 'written_off' ||
      text(lot.writeoffCommandFingerprint) !== fingerprint ||
      !Number.isFinite(quantity) ||
      quantity <= EPS ||
      !sameQuantity(lot.quantityWrittenOff, quantity)
    ) {
      return fail('writeoff_state_mismatch')
    }
    decision = validateDecision(ack, lot, 'written_off', fingerprint) ?? undefined
    if (!decision) return fail('writeoff_decision_mismatch')
    documentIds = expectDocumentIds(ack, 1) ?? []
    movementIds = expectMovementIds(ack, 1) ?? []
    const spec: DocumentSpec = {
      id: documentIds[0] ?? '',
      role: 'qc_scrap_writeoff',
      type: 'issue',
      lotId,
      itemId: text(lot.warehouseItemId),
      warehouseId: text(lot.warehouseId),
      locationId: text(lot.scrapLocationId ?? lot.locationId),
      batchNo: text(lot.lotNumber ?? lot.batchNo),
      quantity,
    }
    if (
      documentIds.length !== 1 ||
      movementIds.length !== 1 ||
      text(lot.writeoffDocumentId) !== documentIds[0] ||
      text(lot.writeoffMovementId) !== movementIds[0] ||
      !validateDocumentGraph(ack, fingerprint, [spec], movementIds)
    ) {
      return fail('writeoff_ledger_mismatch')
    }
  } else if (commandType === 'shipment.post') {
    const shipmentId = text(command.shipmentId)
    shipment = exactOne(ack.warehouse?.loadingShipments, shipmentId) ?? undefined
    const quantity = number(command.quantity)
    if (
      ack.touchesWarehouse !== true ||
      text(ack.shipmentId) !== shipmentId ||
      text(ack.status) !== 'posted' ||
      !shipment ||
      text(shipment.status) !== 'posted' ||
      text(shipment.postCommandFingerprint ?? shipment.commandFingerprint) !== fingerprint ||
      text(shipment.finishedGoodsLotId) !== lotId ||
      text(shipment.finishedProductId) !== text(command.finishedProductId) ||
      text(shipment.warehouseId) !== text(command.warehouseId ?? lot.warehouseId) ||
      text(shipment.date).slice(0, 10) !== text(command.date).slice(0, 10) ||
      !sameQuantity(shipment.quantity, quantity) ||
      text(lot.qcStatus) !== 'released' ||
      text(lot.warehouseItemId) !== text(shipment.warehouseItemId) ||
      text(lot.warehouseId) !== text(shipment.warehouseId) ||
      text(lot.locationId) !== text(shipment.locationId) ||
      !sameQuantity(postedShipmentQuantityForLot(ack, lotId), lot.quantityShipped) ||
      !sameQuantity(
        lot.quantityRemaining,
        number(lot.quantityQcReleased) - number(lot.quantityShipped),
      )
    ) {
      return fail('shipment_post_state_mismatch')
    }
    documentIds = expectDocumentIds(ack, 1) ?? []
    movementIds = expectMovementIds(ack, 1) ?? []
    const spec: DocumentSpec = {
      id: documentIds[0] ?? '',
      role: 'finished_goods_shipment',
      type: 'issue',
      lotId,
      itemId: text(shipment.warehouseItemId),
      warehouseId: text(shipment.warehouseId),
      locationId: text(shipment.locationId),
      batchNo: text(shipment.lotNumber),
      quantity,
      shipmentId,
    }
    if (
      documentIds.length !== 1 ||
      movementIds.length !== 1 ||
      !exactIds(shipment.documentIds, documentIds) ||
      !exactIds(shipment.movementIds, movementIds) ||
      !validateDocumentGraph(ack, fingerprint, [spec], movementIds)
    ) {
      return fail('shipment_post_ledger_mismatch')
    }
  } else {
    const shipmentId = text(command.shipmentId)
    shipment = exactOne(ack.warehouse?.loadingShipments, shipmentId) ?? undefined
    if (
      ack.touchesWarehouse !== true ||
      text(ack.shipmentId) !== shipmentId ||
      text(ack.status) !== 'cancelled' ||
      !shipment ||
      text(shipment.status) !== 'cancelled' ||
      text(shipment.cancelCommandFingerprint) !== fingerprint ||
      text(shipment.cancellationReason) !== text(command.reason ?? command.cancellationReason) ||
      text(shipment.cancellationDate).slice(0, 10) !== text(command.date).slice(0, 10) ||
      text(ack.finishedGoodsLotId) !== text(shipment.finishedGoodsLotId)
    ) {
      return fail('shipment_cancel_state_mismatch')
    }
    const sourceIds = stringIds(shipment.documentIds)
    documentIds = stringIds(ack.reversalDocumentIds)
    movementIds = stringIds(ack.reversalMovementIds)
    if (sourceIds.length !== 1 || documentIds.length !== 1 || movementIds.length !== 1) {
      return fail('shipment_cancel_ledger_ids_missing')
    }
    if (
      !exactIds(shipment.reversalDocumentIds, documentIds) ||
      !exactIds(shipment.reversalMovementIds, movementIds) ||
      !sameQuantity(postedShipmentQuantityForLot(ack, lotId), lot.quantityShipped) ||
      !sameQuantity(
        lot.quantityRemaining,
        number(lot.quantityQcReleased) - number(lot.quantityShipped),
      )
    ) {
      return fail('shipment_cancel_conservation_mismatch')
    }
    const spec: DocumentSpec = {
      id: documentIds[0]!,
      role: 'finished_goods_shipment_cancel',
      type: 'receipt',
      lotId: text(shipment.finishedGoodsLotId),
      itemId: text(shipment.warehouseItemId),
      warehouseId: text(shipment.warehouseId),
      locationId: text(shipment.locationId),
      batchNo: text(shipment.lotNumber),
      quantity: number(shipment.quantity),
      shipmentId,
      reversesDocumentId: sourceIds[0],
    }
    if (!validateDocumentGraph(ack, fingerprint, [spec], movementIds)) {
      return fail('shipment_cancel_ledger_mismatch')
    }
  }

  return {
    ok: true,
    criticalRevision: revision,
    commandFingerprint: fingerprint,
    lot,
    decision,
    childLot,
    shipment,
    documentIds,
    movementIds,
  }
}
