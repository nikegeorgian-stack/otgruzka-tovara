/**
 * R3.1C — fail-closed compatibility guards for canonical production lineage.
 *
 * These helpers are pure. They never repair a legacy graph and never mutate
 * either domain. A legacy request.post call is accepted only when its complete
 * deterministic footprint proves that the supplied command is an exact replay.
 */

const EPS = 1e-9

export const LEGACY_REQUEST_POST_NEW_WRITE_FORBIDDEN =
  'legacy_request_post_new_write_forbidden'
export const LEGACY_REQUEST_POST_PARTIAL_FOOTPRINT_FORBIDDEN =
  'legacy_request_post_partial_footprint_forbidden'
export const LEGACY_REQUEST_POST_REPLAY_MISMATCH =
  'legacy_request_post_replay_mismatch'
export const CANONICAL_ORDER_REPLAN_REQUIRED = 'canonical_order_replan_required'
export const CANONICAL_ORDER_LINEAGE_MISMATCH = 'canonical_order_lineage_mismatch'

function ok(data = {}) {
  return { ok: true, ...data }
}

function fail(error, reason, status = 409) {
  return { ok: false, error, status, reason }
}

function text(value) {
  return String(value ?? '').trim()
}

function finitePositive(value) {
  const quantity = Number(value)
  return Number.isFinite(quantity) && quantity > 0 ? quantity : null
}

function finiteNonNegative(value) {
  const quantity = Number(value)
  return Number.isFinite(quantity) && quantity >= 0 ? quantity : null
}

function sameNumber(left, right) {
  return (
    Number.isFinite(Number(left)) &&
    Number.isFinite(Number(right)) &&
    Math.abs(Number(left) - Number(right)) <= EPS
  )
}

function exactOne(rows, missingReason, duplicateReason) {
  if (rows.length === 0) {
    return fail(LEGACY_REQUEST_POST_PARTIAL_FOOTPRINT_FORBIDDEN, missingReason)
  }
  if (rows.length !== 1) {
    return fail(LEGACY_REQUEST_POST_REPLAY_MISMATCH, duplicateReason)
  }
  return ok({ value: rows[0] })
}

function normalizeConsumeLines(lines) {
  if (!Array.isArray(lines)) return ok({ groups: new Map(), byKey: new Map() })
  const groups = new Map()
  const byKey = new Map()
  for (const raw of lines) {
    const warehouseId = text(raw?.warehouseId)
    const itemId = text(raw?.itemId)
    const quantity = finitePositive(raw?.quantity)
    if (!warehouseId || !itemId || quantity == null) {
      return fail(LEGACY_REQUEST_POST_REPLAY_MISMATCH, 'consume_line_invalid')
    }
    const key = `${warehouseId}\u0000${itemId}`
    if (byKey.has(key)) {
      // The legacy writer generated duplicate document-line and movement ids for
      // duplicate item rows, so such a footprint can never be proven unambiguous.
      return fail(LEGACY_REQUEST_POST_REPLAY_MISMATCH, 'consume_line_duplicate')
    }
    const normalized = { warehouseId, itemId, quantity }
    byKey.set(key, normalized)
    const group = groups.get(warehouseId) ?? []
    group.push(normalized)
    groups.set(warehouseId, group)
  }
  return ok({ groups, byKey })
}

function matchesRequest(value, requestId, deterministicId) {
  return text(value?.productionRequestId) === requestId || text(value?.id) === deterministicId
}

function checkCommonDocument(document, expected) {
  return (
    text(document.status) === 'posted' &&
    text(document.productionRequestId) === expected.requestId &&
    text(document.productionOrderId) === expected.orderId &&
    text(document.productionLineId) === expected.lineId &&
    text(document.shiftReportId) === expected.reportId &&
    text(document.date).slice(0, 10) === expected.date
  )
}

function checkCommonMovement(movement, document, expected) {
  return (
    text(movement.documentId) === text(document.id) &&
    text(movement.productionRequestId) === expected.requestId &&
    text(movement.productionOrderId) === expected.orderId &&
    text(movement.shiftReportId) === expected.reportId &&
    text(movement.date).slice(0, 10) === expected.date
  )
}

function uniqueLineBinding(warehouse, lineId) {
  const candidates = (warehouse?.productionLineBindings ?? []).filter((row) => {
    const canonicalLineId = text(row?.lineId)
    return canonicalLineId ? canonicalLineId === lineId : text(row?.id) === lineId
  })
  if (candidates.length !== 1) return null
  const productionWarehouseId = text(
    candidates[0]?.productionWarehouseId || candidates[0]?.sourceWarehouseId,
  )
  const productionLocationId = text(candidates[0]?.productionLocationId)
  if (!productionWarehouseId || !productionLocationId) return null
  return { productionWarehouseId, productionLocationId }
}

/**
 * Validate an exact, already completed historical production.request.post.
 * No configuration, current period, order snapshot, or client fallback is used
 * to fill a missing edge: the persisted deterministic graph is the evidence.
 */
export function resolveCompletedLegacyRequestPostReplay(production, warehouse, command) {
  const requestId = text(command?.requestId)
  const lineId = text(command?.lineId)
  const orderId = text(command?.orderId)
  const date = text(command?.shiftDate).slice(0, 10)
  const shiftSlot = text(command?.shiftSlot || 'day')
  const outputMp = finitePositive(command?.outputMp)
  const outputRolls = finiteNonNegative(command?.outputRolls ?? 0)
  if (!requestId || !lineId || !orderId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return fail(LEGACY_REQUEST_POST_REPLAY_MISMATCH, 'command_identity_invalid')
  }
  if (outputMp == null || outputRolls == null) {
    return fail(LEGACY_REQUEST_POST_REPLAY_MISMATCH, 'command_output_invalid')
  }

  const reportId = `sr-reqpost-${requestId}`
  const wipBatchId = `wip-reqpost-${requestId}`
  const lotId = `lot-reqpost-${requestId}`
  const receiptDocId = `wh-doc-reqpost-${requestId}-wip`
  const fgDocId = `wh-doc-reqpost-${requestId}-fg`
  const issuePrefix = `wh-doc-reqpost-${requestId}-issue-`
  const isPack = lineId === 'pack'

  const documents = Array.isArray(warehouse?.documents) ? warehouse.documents : []
  const movements = Array.isArray(warehouse?.movements) ? warehouse.movements : []
  const reports = Array.isArray(production?.shiftReports) ? production.shiftReports : []
  const batches = Array.isArray(production?.wipBatches) ? production.wipBatches : []
  const lots = Array.isArray(production?.finishedGoodsLots) ? production.finishedGoodsLots : []
  const audits = Array.isArray(production?.auditLog) ? production.auditLog : []

  const requestDocuments = documents.filter(
    (row) =>
      text(row?.productionRequestId) === requestId ||
      text(row?.shiftReportId) === reportId ||
      text(row?.id) === receiptDocId ||
      text(row?.id) === fgDocId ||
      text(row?.id).startsWith(issuePrefix),
  )
  const requestMovements = movements.filter(
    (row) =>
      text(row?.productionRequestId) === requestId ||
      text(row?.shiftReportId) === reportId ||
      text(row?.documentId) === receiptDocId ||
      text(row?.documentId) === fgDocId ||
      text(row?.documentId).startsWith(issuePrefix),
  )
  const requestReports = reports.filter((row) => matchesRequest(row, requestId, reportId))
  const requestBatches = batches.filter(
    (row) =>
      matchesRequest(row, requestId, wipBatchId) || text(row?.shiftReportId) === reportId,
  )
  const requestLots = lots.filter(
    (row) =>
      matchesRequest(row, requestId, lotId) ||
      (Array.isArray(row?.sourceShiftReportIds) &&
        row.sourceShiftReportIds.some((id) => text(id) === reportId)),
  )
  const requestAudits = audits.filter(
    (row) =>
      text(row?.id) === `aud-reqpost-${requestId}` ||
      text(row?.productionRequestId) === requestId,
  )

  if (
    requestDocuments.length === 0 &&
    requestMovements.length === 0 &&
    requestReports.length === 0 &&
    requestBatches.length === 0 &&
    requestLots.length === 0 &&
    requestAudits.length === 0
  ) {
    return fail(LEGACY_REQUEST_POST_NEW_WRITE_FORBIDDEN, 'footprint_absent')
  }

  const normalizedConsume = normalizeConsumeLines(command?.consumeLines)
  if (!normalizedConsume.ok) return normalizedConsume

  const reportResult = exactOne(
    requestReports,
    'shift_report_missing',
    'shift_report_duplicate_or_colliding',
  )
  if (!reportResult.ok) return reportResult
  const batchResult = exactOne(
    requestBatches,
    'wip_batch_missing',
    'wip_batch_duplicate_or_colliding',
  )
  if (!batchResult.ok) return batchResult
  const auditResult = exactOne(
    requestAudits,
    'request_post_audit_missing',
    'request_post_audit_duplicate_or_colliding',
  )
  if (!auditResult.ok) return auditResult
  if (isPack) {
    const lotResult = exactOne(
      requestLots,
      'finished_goods_lot_missing',
      'finished_goods_lot_duplicate_or_colliding',
    )
    if (!lotResult.ok) return lotResult
  } else if (requestLots.length !== 0) {
    return fail(LEGACY_REQUEST_POST_REPLAY_MISMATCH, 'unexpected_finished_goods_lot')
  }

  const expectedDocumentIds = new Set([
    receiptDocId,
    ...[...normalizedConsume.groups.keys()].map(
      (warehouseId) => `${issuePrefix}${warehouseId}`,
    ),
    ...(isPack ? [fgDocId] : []),
  ])
  const audit = auditResult.value
  if (
    text(audit.id) !== `aud-reqpost-${requestId}` ||
    text(audit.action) !== 'production_request_post' ||
    text(audit.detail) !==
      `request ${requestId} docs=${expectedDocumentIds.size} wip=${wipBatchId}`
  ) {
    return fail(LEGACY_REQUEST_POST_REPLAY_MISMATCH, 'request_post_audit_mismatch')
  }
  for (const document of requestDocuments) {
    if (!expectedDocumentIds.has(text(document?.id))) {
      return fail(LEGACY_REQUEST_POST_REPLAY_MISMATCH, 'unexpected_request_document')
    }
  }
  const documentById = new Map()
  for (const documentId of expectedDocumentIds) {
    const found = requestDocuments.filter((row) => text(row?.id) === documentId)
    const exact = exactOne(found, 'required_document_missing', 'required_document_duplicate')
    if (!exact.ok) return exact
    documentById.set(documentId, exact.value)
  }

  const report = reportResult.value
  const wipBatch = batchResult.value
  const orderMatches = (production?.orders ?? []).filter((row) => text(row?.id) === orderId)
  if (orderMatches.length !== 1) {
    return fail(LEGACY_REQUEST_POST_REPLAY_MISMATCH, 'critical_order_not_unique')
  }
  const order = orderMatches[0]
  const semiFinishedItemId = text(
    command?.semiFinishedItemId ?? order?.semiFinishedItemId ?? order?.finishedProductId,
  )
  const warehouseItemId = text(command?.warehouseItemId ?? semiFinishedItemId)
  const finishedProductId = text(command?.finishedProductId ?? order?.finishedProductId)
  const wipItemId = isPack ? semiFinishedItemId || warehouseItemId : warehouseItemId || semiFinishedItemId
  if (!wipItemId || (isPack && (!warehouseItemId || !finishedProductId))) {
    return fail(LEGACY_REQUEST_POST_REPLAY_MISMATCH, 'command_item_identity_invalid')
  }

  if (
    text(report.id) !== reportId ||
    text(report.idempotencyKey) !== `prod-req-post:${requestId}` ||
    text(report.status) !== 'confirmed' ||
    text(report.source) !== 'production.request.post' ||
    text(report.productionRequestId) !== requestId ||
    text(report.orderId) !== orderId ||
    text(report.productionOrderId) !== orderId ||
    text(report.lineId) !== lineId ||
    text(report.shiftDate).slice(0, 10) !== date ||
    text(report.shiftSlot) !== shiftSlot ||
    !sameNumber(report.outputMp, outputMp) ||
    !sameNumber(report.outputRolls ?? 0, outputRolls) ||
    text(report.wipBatchId) !== wipBatchId ||
    text(report.semiFinishedItemId) !== wipItemId
  ) {
    return fail(LEGACY_REQUEST_POST_REPLAY_MISMATCH, 'shift_report_mismatch')
  }

  const frozenPackLocationId = text(report.packLocationId)
  if (!frozenPackLocationId) {
    return fail(LEGACY_REQUEST_POST_REPLAY_MISMATCH, 'wip_location_missing')
  }
  if (
    command?.packLocationId != null &&
    text(command.packLocationId) !== frozenPackLocationId
  ) {
    return fail(LEGACY_REQUEST_POST_REPLAY_MISMATCH, 'pack_location_changed')
  }
  if (
    text(wipBatch.id) !== wipBatchId ||
    text(wipBatch.productionRequestId) !== requestId ||
    text(wipBatch.orderId) !== orderId ||
    text(wipBatch.productionOrderId) !== orderId ||
    text(wipBatch.shiftReportId) !== reportId ||
    text(wipBatch.lineId) !== lineId ||
    text(wipBatch.itemId) !== wipItemId ||
    !sameNumber(wipBatch.quantityMp, outputMp) ||
    !sameNumber(wipBatch.rolls ?? 0, outputRolls) ||
    text(wipBatch.locationId) !== frozenPackLocationId ||
    wipBatch.isFinishedGoods !== false
  ) {
    return fail(LEGACY_REQUEST_POST_REPLAY_MISMATCH, 'wip_batch_mismatch')
  }

  const expected = { requestId, orderId, lineId, reportId, date }
  const wipDocument = documentById.get(receiptDocId)
  const wipLines = Array.isArray(wipDocument?.lines) ? wipDocument.lines : []
  if (
    !checkCommonDocument(wipDocument, expected) ||
    text(wipDocument.type) !== 'receipt' ||
    text(wipDocument.purpose) !== 'production_receipt' ||
    text(wipDocument.docRole) !== 'wip_receipt' ||
    wipDocument.isWip !== true ||
    text(wipDocument.idempotencyKey) !==
      `productionRequest::${requestId}::production_receipt::${text(wipDocument.warehouseId)}` ||
    wipLines.length !== 1 ||
    text(wipLines[0]?.lineId) !== `ln-${receiptDocId}-1` ||
    text(wipLines[0]?.itemId) !== wipItemId ||
    !sameNumber(wipLines[0]?.quantity, outputMp) ||
    text(wipLines[0]?.locationId) !== frozenPackLocationId ||
    text(wipLines[0]?.batchNo) !== wipBatchId
  ) {
    return fail(LEGACY_REQUEST_POST_REPLAY_MISMATCH, 'wip_receipt_mismatch')
  }
  const lineBinding = uniqueLineBinding(warehouse, lineId)
  const packBinding = uniqueLineBinding(warehouse, 'pack')
  if (
    !lineBinding ||
    text(wipDocument.warehouseId) !== lineBinding.productionWarehouseId
  ) {
    return fail(LEGACY_REQUEST_POST_REPLAY_MISMATCH, 'line_binding_unverifiable')
  }
  if (
    !packBinding ||
    packBinding.productionLocationId !== frozenPackLocationId
  ) {
    return fail(LEGACY_REQUEST_POST_REPLAY_MISMATCH, 'pack_binding_unverifiable')
  }
  if (
    command?.productionWarehouseId != null &&
    text(command.productionWarehouseId) !== lineBinding.productionWarehouseId
  ) {
    return fail(LEGACY_REQUEST_POST_REPLAY_MISMATCH, 'production_warehouse_changed')
  }
  if (
    command?.packWarehouseId != null &&
    text(command.packWarehouseId) !== packBinding.productionWarehouseId
  ) {
    return fail(LEGACY_REQUEST_POST_REPLAY_MISMATCH, 'pack_warehouse_changed')
  }
  if (
    command?.productionLocationId != null &&
    text(command.productionLocationId) !== lineBinding.productionLocationId
  ) {
    return fail(LEGACY_REQUEST_POST_REPLAY_MISMATCH, 'production_location_changed')
  }
  const wipMovementResult = exactOne(
    movements.filter((row) => text(row?.id) === `mov-${receiptDocId}-1`),
    'wip_receipt_movement_missing',
    'wip_receipt_movement_duplicate',
  )
  if (!wipMovementResult.ok) return wipMovementResult
  const wipMovement = wipMovementResult.value
  if (
    !checkCommonMovement(wipMovement, wipDocument, expected) ||
    text(wipMovement.id) !== `mov-${receiptDocId}-1` ||
    text(wipMovement.documentLineId) !== text(wipLines[0]?.lineId) ||
    text(wipMovement.type) !== 'receipt' ||
    text(wipMovement.warehouseId) !== text(wipDocument.warehouseId) ||
    text(wipMovement.locationId) !== frozenPackLocationId ||
    text(wipMovement.itemId) !== wipItemId ||
    !sameNumber(wipMovement.quantity, outputMp) ||
    text(wipMovement.batchNo) !== wipBatchId ||
    wipMovement.isWip !== true
  ) {
    return fail(LEGACY_REQUEST_POST_REPLAY_MISMATCH, 'wip_receipt_movement_mismatch')
  }

  const allowedMovementIds = new Set([text(wipMovement.id)])
  for (const [warehouseId, consumeLines] of normalizedConsume.groups) {
    const documentId = `${issuePrefix}${warehouseId}`
    const document = documentById.get(documentId)
    const lines = Array.isArray(document?.lines) ? document.lines : []
    if (
      !checkCommonDocument(document, expected) ||
      text(document.type) !== 'issue' ||
      text(document.purpose) !== 'production_issue' ||
      text(document.docRole) !== 'production_issue' ||
      text(document.warehouseId) !== warehouseId ||
      text(document.idempotencyKey) !==
        `productionRequest::${requestId}::production_issue::${warehouseId}` ||
      lines.length !== consumeLines.length
    ) {
      return fail(LEGACY_REQUEST_POST_REPLAY_MISMATCH, 'consume_document_mismatch')
    }
    const lineByItem = new Map()
    for (const line of lines) {
      const itemId = text(line?.itemId)
      if (!itemId || lineByItem.has(itemId)) {
        return fail(LEGACY_REQUEST_POST_REPLAY_MISMATCH, 'consume_document_line_duplicate')
      }
      lineByItem.set(itemId, line)
    }
    for (const consume of consumeLines) {
      const line = lineByItem.get(consume.itemId)
      if (
        !line ||
        text(line.lineId) !== `ln-${documentId}-${consume.itemId}` ||
        !sameNumber(line.quantity, consume.quantity)
      ) {
        return fail(LEGACY_REQUEST_POST_REPLAY_MISMATCH, 'consume_document_line_mismatch')
      }
      const movementId = `mov-${documentId}-${consume.itemId}`
      const movementResult = exactOne(
        movements.filter((row) => text(row?.id) === movementId),
        'consume_movement_missing',
        'consume_movement_duplicate',
      )
      if (!movementResult.ok) return movementResult
      const movement = movementResult.value
      if (
        !checkCommonMovement(movement, document, expected) ||
        text(movement.documentLineId) !== text(line.lineId) ||
        text(movement.type) !== 'issue' ||
        text(movement.warehouseId) !== warehouseId ||
        text(movement.itemId) !== consume.itemId ||
        !sameNumber(movement.quantity, consume.quantity)
      ) {
        return fail(LEGACY_REQUEST_POST_REPLAY_MISMATCH, 'consume_movement_mismatch')
      }
      allowedMovementIds.add(movementId)
    }
  }

  let finishedGoodsLotId
  const frozenPackWarehouseId = packBinding.productionWarehouseId
  if (isPack) {
    const fgDocument = documentById.get(fgDocId)
    const fgLines = Array.isArray(fgDocument?.lines) ? fgDocument.lines : []
    if (
      !checkCommonDocument(fgDocument, expected) ||
      text(fgDocument.type) !== 'receipt' ||
      text(fgDocument.purpose) !== 'production_receipt' ||
      text(fgDocument.docRole) !== 'fg_receipt' ||
      fgLines.length !== 1 ||
      text(fgLines[0]?.lineId) !== `ln-${fgDocId}-1` ||
      text(fgLines[0]?.itemId) !== warehouseItemId ||
      !sameNumber(fgLines[0]?.quantity, outputMp) ||
      text(fgLines[0]?.batchNo) !== lotId
    ) {
      return fail(LEGACY_REQUEST_POST_REPLAY_MISMATCH, 'finished_goods_receipt_mismatch')
    }
    const fgWarehouseId = text(fgDocument.warehouseId)
    const fgLocationId = text(fgLines[0]?.locationId)
    if (
      !fgWarehouseId ||
      !fgLocationId ||
      (command?.fgWarehouseId != null && text(command.fgWarehouseId) !== fgWarehouseId) ||
      (command?.fgLocationId != null && text(command.fgLocationId) !== fgLocationId) ||
      text(fgDocument.idempotencyKey) !==
        `productionRequest::${requestId}::pack_receipt::${fgWarehouseId}`
    ) {
      return fail(LEGACY_REQUEST_POST_REPLAY_MISMATCH, 'finished_goods_destination_mismatch')
    }
    const fgMovementResult = exactOne(
      movements.filter((row) => text(row?.id) === `mov-${fgDocId}-1`),
      'finished_goods_movement_missing',
      'finished_goods_movement_duplicate',
    )
    if (!fgMovementResult.ok) return fgMovementResult
    const fgMovement = fgMovementResult.value
    if (
      !checkCommonMovement(fgMovement, fgDocument, expected) ||
      text(fgMovement.id) !== `mov-${fgDocId}-1` ||
      text(fgMovement.documentLineId) !== text(fgLines[0]?.lineId) ||
      text(fgMovement.type) !== 'receipt' ||
      text(fgMovement.warehouseId) !== fgWarehouseId ||
      text(fgMovement.locationId) !== fgLocationId ||
      text(fgMovement.itemId) !== warehouseItemId ||
      !sameNumber(fgMovement.quantity, outputMp) ||
      text(fgMovement.batchNo) !== lotId
    ) {
      return fail(LEGACY_REQUEST_POST_REPLAY_MISMATCH, 'finished_goods_movement_mismatch')
    }
    allowedMovementIds.add(text(fgMovement.id))

    const lot = requestLots[0]
    if (
      text(lot.id) !== lotId ||
      text(lot.productionRequestId) !== requestId ||
      text(lot.productionOrderId) !== orderId ||
      text(lot.warehouseItemId) !== warehouseItemId ||
      text(lot.finishedProductId) !== finishedProductId ||
      text(lot.batchNo) !== lotId ||
      text(lot.packagingReportId) !== `pack-reqpost-${requestId}` ||
      !Array.isArray(lot.sourceShiftReportIds) ||
      lot.sourceShiftReportIds.length !== 1 ||
      text(lot.sourceShiftReportIds[0]) !== reportId ||
      !sameNumber(lot.outputM2, outputMp) ||
      !sameNumber(lot.quantityProduced, outputMp) ||
      !sameNumber(lot.rollCount ?? 0, outputRolls) ||
      text(lot.packagingDate).slice(0, 10) !== date ||
      text(lot.productionDate).slice(0, 10) !== date ||
      text(lot.warehouseId) !== fgWarehouseId ||
      text(lot.locationId) !== fgLocationId ||
      text(lot.fgReceiptDocumentId) !== fgDocId ||
      text(lot.transactionGroupId) !== `prod-req-post:${requestId}`
    ) {
      return fail(LEGACY_REQUEST_POST_REPLAY_MISMATCH, 'finished_goods_lot_mismatch')
    }
    finishedGoodsLotId = lotId
  }

  for (const movement of requestMovements) {
    if (!allowedMovementIds.has(text(movement?.id))) {
      return fail(LEGACY_REQUEST_POST_REPLAY_MISMATCH, 'unexpected_request_movement')
    }
  }

  return ok({
    production,
    warehouse,
    result: {
      requestId,
      status: 'posted',
      reportId,
      wipBatchId,
      documentIds: [...expectedDocumentIds],
      finishedGoodsLotId,
      packLocationId: frozenPackLocationId,
      packWarehouseId: frozenPackWarehouseId || undefined,
      g4QcEntry: Boolean(finishedGoodsLotId),
      idempotent: true,
      canonicalReplayVerified: true,
    },
  })
}

/**
 * A tagged WIP-v1 order cannot use the legacy quantity-reservation mutation.
 * Until a versioned replan command exists, only a proven no-op is accepted.
 */
export function guardCanonicalOrderChange(order, warehouse, command) {
  if (!(Number(order?.wipContractVersion) >= 1)) return ok({ canonical: false })

  const orderId = text(order?.id)
  const rawItemId = text(order?.rawMaterialItemId)
  const semiFinishedItemId = text(order?.semiFinishedItemId)
  const frozenRawQty = finitePositive(order?.rawMaterialQty)
  const frozenOrderQty = finitePositive(order?.totalQtyMp)
  if (!orderId || !rawItemId || !semiFinishedItemId || frozenRawQty == null || frozenOrderQty == null) {
    return fail(CANONICAL_ORDER_LINEAGE_MISMATCH, 'canonical_order_snapshot_incomplete')
  }
  if (text(command?.orderId) !== orderId) {
    return fail(CANONICAL_ORDER_LINEAGE_MISMATCH, 'canonical_order_changed')
  }
  if (command?.lineId != null && text(command.lineId) !== text(order?.lineId)) {
    return fail(CANONICAL_ORDER_LINEAGE_MISMATCH, 'canonical_line_changed')
  }

  const reservationDocumentId = text(order?.reservationDocumentId)
  const sourceWarehouseIds = new Set()
  if (reservationDocumentId) {
    const documents = (warehouse?.documents ?? []).filter(
      (row) => text(row?.id) === reservationDocumentId,
    )
    if (documents.length !== 1) {
      return fail(CANONICAL_ORDER_LINEAGE_MISMATCH, 'reservation_document_not_unique')
    }
    const document = documents[0]
    const lines = Array.isArray(document?.lines) ? document.lines : []
    if (
      text(document.status) !== 'posted' ||
      text(document.productionOrderId) !== orderId ||
      !['production_reservation', 'production_reservation_increase'].includes(
        text(document.docRole || document.purpose),
      ) ||
      !lines.length ||
      lines.some((line) => text(line?.itemId) !== rawItemId)
    ) {
      return fail(CANONICAL_ORDER_LINEAGE_MISMATCH, 'reservation_document_mismatch')
    }
    const warehouseId = text(document.warehouseId)
    if (warehouseId) sourceWarehouseIds.add(warehouseId)
    const reserveMovements = (warehouse?.movements ?? []).filter(
      (movement) => text(movement?.documentId) === reservationDocumentId,
    )
    if (reserveMovements.length !== lines.length) {
      return fail(CANONICAL_ORDER_LINEAGE_MISMATCH, 'reservation_movement_count_mismatch')
    }
    for (const line of lines) {
      const matches = reserveMovements.filter(
        (movement) => text(movement?.documentLineId) === text(line?.lineId),
      )
      if (
        matches.length !== 1 ||
        text(matches[0]?.type) !== 'reserve' ||
        text(matches[0]?.productionOrderId) !== orderId ||
        text(matches[0]?.warehouseId) !== warehouseId ||
        text(matches[0]?.itemId) !== rawItemId ||
        !sameNumber(matches[0]?.quantity, line?.quantity)
      ) {
        return fail(CANONICAL_ORDER_LINEAGE_MISMATCH, 'reservation_movement_mismatch')
      }
    }
  }
  for (const shortage of warehouse?.materialShortages ?? []) {
    if (text(shortage?.orderId) === orderId && text(shortage?.itemId) === rawItemId) {
      const warehouseId = text(shortage?.warehouseId)
      if (warehouseId) sourceWarehouseIds.add(warehouseId)
    }
  }
  for (const movement of warehouse?.movements ?? []) {
    if (
      text(movement?.productionOrderId) === orderId &&
      text(movement?.itemId) === rawItemId &&
      (['reserve', 'unreserve'].includes(text(movement?.type)) ||
        (text(movement?.type) === 'issue' && movement?.consumesReserve === true))
    ) {
      const warehouseId = text(movement?.warehouseId)
      if (warehouseId) sourceWarehouseIds.add(warehouseId)
    }
  }
  if (sourceWarehouseIds.size !== 1) {
    return fail(CANONICAL_ORDER_LINEAGE_MISMATCH, 'raw_warehouse_not_unique')
  }
  const rawWarehouseId = [...sourceWarehouseIds][0]
  if (text(command?.rawWarehouseId) !== rawWarehouseId) {
    return fail(CANONICAL_ORDER_LINEAGE_MISMATCH, 'raw_warehouse_changed')
  }
  if (
    (command?.rawMaterialItemId != null && text(command.rawMaterialItemId) !== rawItemId) ||
    (command?.semiFinishedItemId != null &&
      text(command.semiFinishedItemId) !== semiFinishedItemId)
  ) {
    return fail(CANONICAL_ORDER_LINEAGE_MISMATCH, 'canonical_item_changed')
  }
  if (
    command?.rawMaterialQty != null &&
    !sameNumber(command.rawMaterialQty, frozenRawQty)
  ) {
    return fail(CANONICAL_ORDER_REPLAN_REQUIRED, 'raw_material_quantity_changed')
  }
  if (!sameNumber(command?.totalQtyMp, frozenOrderQty)) {
    return fail(CANONICAL_ORDER_REPLAN_REQUIRED, 'production_quantity_changed')
  }

  return ok({
    canonical: true,
    idempotent: true,
    canonicalLineagePreserved: true,
    rawWarehouseId,
  })
}
