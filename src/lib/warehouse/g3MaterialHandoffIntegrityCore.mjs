/**
 * Pure, browser-safe integrity helpers for authoritative G3 material handoffs.
 * SHA-256 is supplied by the caller so the same canonical payload is used by
 * the Node server and by the browser acknowledgement validator.
 */

export const G3_MATERIAL_HANDOFF_ACK_MISMATCH =
  'production_material_handoff_ack_mismatch'
export const G3_MATERIAL_HANDOFF_FINGERPRINT_PREFIX =
  'g3-material-handoff:v1:'

function text(value) {
  return String(value ?? '').trim()
}

function date(value) {
  return text(value).slice(0, 10)
}

function finite(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function record(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : null
}

function recordArray(value) {
  if (!Array.isArray(value)) return null
  const rows = value.map(record)
  return rows.some((row) => row == null) ? null : rows
}

export function materialHandoffKind(commandType) {
  return commandType === 'production.material.issueToLine'
    ? 'issue'
    : commandType === 'production.material.returnFromLine'
      ? 'return'
      : ''
}

export function canonicalG3MaterialHandoffLines(lines) {
  if (!Array.isArray(lines)) return []
  return lines
    .map((line) => ({
      itemId: text(line?.itemId),
      quantity: finite(line?.quantity),
      batchNo: text(line?.batchNo),
      expiryDate: date(line?.expiryDate),
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
}

export function canonicalG3MaterialHandoffCommand(commandType, command) {
  const kind = materialHandoffKind(commandType)
  return {
    version: 1,
    commandType: text(commandType),
    orderId: text(command?.orderId),
    lineId: text(command?.lineId),
    rawWarehouseId: text(command?.rawWarehouseId),
    reservationDocumentId:
      kind === 'issue' ? text(command?.reservationDocumentId) : '',
    reason:
      kind === 'issue'
        ? text(command?.overReserveReason ?? command?.reason)
        : text(command?.reason),
    lines: canonicalG3MaterialHandoffLines(command?.lines),
  }
}

export function canonicalG3MaterialHandoffPayload(commandType, command) {
  return JSON.stringify(canonicalG3MaterialHandoffCommand(commandType, command))
}

export function formatG3MaterialHandoffFingerprint(hexDigest) {
  const digest = text(hexDigest).toLowerCase()
  return /^[a-f0-9]{64}$/.test(digest)
    ? `${G3_MATERIAL_HANDOFF_FINGERPRINT_PREFIX}${digest}`
    : ''
}

function exactOptional(left, right) {
  return text(left) === text(right)
}

function sameNumber(left, right) {
  const a = finite(left)
  const b = finite(right)
  return a != null && b != null && Math.abs(a - b) <= 1e-9
}

function exactStringArray(value, { requireNonEmpty = false } = {}) {
  if (!Array.isArray(value)) return null
  const rows = value.map(text)
  if (
    rows.some((row) => !row) ||
    new Set(rows).size !== rows.length ||
    (requireNonEmpty && rows.length === 0)
  ) {
    return null
  }
  return rows
}

function lineSignature(row) {
  return JSON.stringify([
    text(row?.itemId),
    text(row?.batchNo),
    date(row?.expiryDate),
    finite(row?.quantity),
  ])
}

function stockTupleSignature(row) {
  return JSON.stringify([
    text(row?.itemId),
    text(row?.batchNo),
    date(row?.expiryDate),
  ])
}

function sameLineMultiset(left, right) {
  if (left.length !== right.length) return false
  return (
    JSON.stringify(left.map(lineSignature).sort()) ===
    JSON.stringify(right.map(lineSignature).sort())
  )
}

function quantityMap(rows, keyOf) {
  const map = new Map()
  for (const row of rows) {
    const quantity = finite(row?.quantity)
    if (!text(row?.itemId) || quantity == null || quantity <= 0) return null
    const key = keyOf(row)
    map.set(key, (map.get(key) ?? 0) + quantity)
  }
  return map
}

function sameQuantityMap(left, right) {
  if (!left || !right || left.size !== right.size) return false
  for (const [key, quantity] of left) {
    if (!sameNumber(quantity, right.get(key))) return false
  }
  return true
}

function effectsMatchSubmission(kind, effectLines, submittedLines) {
  const submitted = canonicalG3MaterialHandoffLines(submittedLines)
  if (
    submitted.length === 0 ||
    submitted.some(
      (row) => !row.itemId || row.quantity == null || row.quantity <= 0,
    )
  ) {
    return false
  }

  if (kind === 'return') {
    return sameQuantityMap(
      quantityMap(effectLines, stockTupleSignature),
      quantityMap(submitted, stockTupleSignature),
    )
  }

  // An issue may let the server allocate an unspecified requested lot by FEFO.
  // Totals are nevertheless exact, and every explicitly submitted lot remains
  // a hard lower-bound constraint on that exact batch/expiry tuple.
  const itemKey = (row) => text(row?.itemId)
  if (
    !sameQuantityMap(
      quantityMap(effectLines, itemKey),
      quantityMap(submitted, itemKey),
    )
  ) {
    return false
  }
  const effectsByTuple = quantityMap(effectLines, stockTupleSignature)
  const explicitByTuple = quantityMap(
    submitted.filter((row) => row.batchNo || row.expiryDate),
    stockTupleSignature,
  )
  if (!effectsByTuple || !explicitByTuple) return false
  for (const [key, quantity] of explicitByTuple) {
    const actual = effectsByTuple.get(key)
    if (actual == null || actual + 1e-9 < quantity) return false
  }
  return true
}

function matchingLineBindings(warehouse, lineId) {
  const bindings = Array.isArray(warehouse?.productionLineBindings)
    ? warehouse.productionLineBindings
    : []
  return bindings.filter((binding) => {
    const exactLineId = text(binding?.lineId)
    return exactLineId ? exactLineId === lineId : text(binding?.id) === lineId
  })
}

function validateDocumentLines(document, expected) {
  const lines = recordArray(document?.lines)
  if (!lines || lines.length === 0) return null
  const ids = lines.map((line) => text(line?.lineId))
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) return null
  if (
    lines.some((line) => {
      const quantity = finite(line?.quantity)
      return (
        !text(line?.itemId) ||
        quantity == null ||
        quantity <= 0 ||
        text(line?.productionOrderId) !== expected.orderId ||
        text(line?.productionLineId) !== expected.lineId ||
        (expected.requireLocation
          ? text(line?.locationId) !== expected.locationId
          : expected.forbidLocation && Boolean(text(line?.locationId)))
      )
    })
  ) {
    return null
  }
  return lines
}

function validateDocumentMovements(document, lines, allMovements, expected) {
  const relevant = allMovements.filter(
    (movement) =>
      text(movement?.documentId) === text(document?.id) ||
      text(movement?.transferPairId) === expected.transferPairId,
  )
  const documentMovements = relevant.filter(
    (movement) => text(movement?.documentId) === text(document?.id),
  )
  if (documentMovements.length !== lines.length) return false
  const movementIds = documentMovements.map((movement) => text(movement?.id))
  if (
    movementIds.some((id) => !id) ||
    new Set(movementIds).size !== movementIds.length
  ) {
    return false
  }
  for (const line of lines) {
    const matches = documentMovements.filter(
      (movement) => text(movement?.documentLineId) === text(line?.lineId),
    )
    if (matches.length !== 1) return false
    const movement = matches[0]
    if (
      movement?.cancelled === true ||
      text(movement?.type) !== expected.movementType ||
      text(movement?.warehouseId) !== expected.warehouseId ||
      text(movement?.locationId) !== text(line?.locationId) ||
      text(movement?.productionOrderId) !== expected.orderId ||
      text(movement?.productionLineId) !== expected.lineId ||
      text(movement?.transferPairId) !== expected.transferPairId ||
      text(movement?.reservationDocumentId) !== expected.reservationDocumentId ||
      text(movement?.commandFingerprint) !== expected.commandFingerprint ||
      text(movement?.itemId) !== text(line?.itemId) ||
      text(movement?.batchNo) !== text(line?.batchNo) ||
      date(movement?.expiryDate) !== date(line?.expiryDate) ||
      !sameNumber(movement?.quantity, line?.quantity) ||
      (expected.consumesReserve && movement?.consumesReserve !== true)
    ) {
      return false
    }
  }
  return true
}

/**
 * Validate one exact authoritative transfer pair. This function deliberately
 * ignores unrelated documents but rejects every extra row that reuses this
 * command key, pair id, document id, or movement pair id.
 */
export function validateG3MaterialHandoffProjection(data, expected) {
  const kind = materialHandoffKind(expected?.commandType)
  const orderId = text(expected?.orderId)
  const lineId = text(expected?.lineId)
  const rawWarehouseId = text(expected?.rawWarehouseId)
  const reservationDocumentId =
    kind === 'issue' ? text(expected?.reservationDocumentId) : ''
  const reason = text(expected?.reason)
  const idempotencyKey = text(expected?.idempotencyKey)
  const commandFingerprint = text(expected?.commandFingerprint)
  const transferPairId = text(data?.transferPairId)
  const documentIds = exactStringArray(data?.documentIds)
  const warehouse = record(data?.warehouse)
  const production = record(data?.production)
  if (
    !kind ||
    !orderId ||
    !lineId ||
    !rawWarehouseId ||
    !idempotencyKey ||
    !commandFingerprint.startsWith(G3_MATERIAL_HANDOFF_FINGERPRINT_PREFIX) ||
    text(data?.orderId) !== orderId ||
    text(data?.lineId) !== lineId ||
    text(data?.kind) !== kind ||
    text(data?.rawWarehouseId) !== rawWarehouseId ||
    text(data?.reservationDocumentId) !== reservationDocumentId ||
    text(data?.reason) !== reason ||
    text(data?.idempotencyKey) !== idempotencyKey ||
    text(data?.commandFingerprint) !== commandFingerprint ||
    !transferPairId ||
    !documentIds ||
    documentIds.length !== 2 ||
    !warehouse ||
    !production
  ) {
    return { ok: false, error: G3_MATERIAL_HANDOFF_ACK_MISMATCH }
  }

  const documents = recordArray(warehouse.documents)
  const movements = recordArray(warehouse.movements)
  const handoffs = recordArray(production.handoffs)
  if (!documents || !movements || !handoffs) {
    return { ok: false, error: G3_MATERIAL_HANDOFF_ACK_MISMATCH }
  }

  const bindings = matchingLineBindings(warehouse, lineId)
  const productionWarehouseId = text(bindings[0]?.productionWarehouseId)
  const productionLocationId = text(bindings[0]?.productionLocationId)
  if (
    bindings.length !== 1 ||
    !productionWarehouseId ||
    !productionLocationId
  ) {
    return { ok: false, error: G3_MATERIAL_HANDOFF_ACK_MISMATCH }
  }

  const pairDocuments = documents.filter(
    (document) => text(document?.transferPairId) === transferPairId,
  )
  const commandDocuments = documents.filter((document) =>
    [`${idempotencyKey}::issue`, `${idempotencyKey}::receipt`].includes(
      text(document?.idempotencyKey),
    ),
  )
  const issueMatches = documents.filter(
    (document) => text(document?.id) === documentIds[0],
  )
  const receiptMatches = documents.filter(
    (document) => text(document?.id) === documentIds[1],
  )
  if (
    pairDocuments.length !== 2 ||
    commandDocuments.length !== 2 ||
    issueMatches.length !== 1 ||
    receiptMatches.length !== 1 ||
    !pairDocuments.includes(issueMatches[0]) ||
    !pairDocuments.includes(receiptMatches[0]) ||
    !commandDocuments.includes(issueMatches[0]) ||
    !commandDocuments.includes(receiptMatches[0])
  ) {
    return { ok: false, error: G3_MATERIAL_HANDOFF_ACK_MISMATCH }
  }
  const issueDocument = issueMatches[0]
  const receiptDocument = receiptMatches[0]
  const expectedPurpose =
    kind === 'issue' ? ['production_issue', 'production_receipt'] : [
      'production_material_return',
      'production_material_return',
    ]
  const expectedWarehouses =
    kind === 'issue'
      ? [rawWarehouseId, productionWarehouseId]
      : [productionWarehouseId, rawWarehouseId]
  for (const [index, document] of [issueDocument, receiptDocument].entries()) {
    if (
      document?.cancelled === true ||
      text(document?.status) !== 'posted' ||
      text(document?.type) !== (index === 0 ? 'issue' : 'receipt') ||
      text(document?.docRole) !==
        (index === 0 ? 'transfer_issue' : 'transfer_receipt') ||
      text(document?.purpose) !== expectedPurpose[index] ||
      text(document?.warehouseId) !== expectedWarehouses[index] ||
      text(document?.productionOrderId) !== orderId ||
      text(document?.productionLineId) !== lineId ||
      text(document?.reservationDocumentId) !== reservationDocumentId ||
      text(
        kind === 'issue' ? document?.overReserveReason : document?.returnReason,
      ) !== reason ||
      text(document?.transferPairId) !== transferPairId ||
      text(document?.idempotencyKey) !==
        `${idempotencyKey}::${index === 0 ? 'issue' : 'receipt'}` ||
      text(document?.commandFingerprint) !== commandFingerprint
    ) {
      return { ok: false, error: G3_MATERIAL_HANDOFF_ACK_MISMATCH }
    }
  }

  const issueLines = validateDocumentLines(issueDocument, {
    orderId,
    lineId,
    requireLocation: kind === 'return',
    forbidLocation: false,
    locationId: productionLocationId,
  })
  const receiptLines = validateDocumentLines(receiptDocument, {
    orderId,
    lineId,
    requireLocation: kind === 'issue',
    forbidLocation: kind === 'return',
    locationId: productionLocationId,
  })
  if (
    !issueLines ||
    !receiptLines ||
    !sameLineMultiset(issueLines, receiptLines) ||
    !effectsMatchSubmission(kind, issueLines, expected?.submittedLines ?? [])
  ) {
    return { ok: false, error: G3_MATERIAL_HANDOFF_ACK_MISMATCH }
  }

  const pairMovements = movements.filter(
    (movement) => text(movement?.transferPairId) === transferPairId,
  )
  const fingerprintMovements = movements.filter(
    (movement) => text(movement?.commandFingerprint) === commandFingerprint,
  )
  const expectedMovementDocumentIds = new Set(documentIds)
  const pairMovementIds = pairMovements.map((movement) => text(movement?.id))
  if (
    pairMovements.length !== issueLines.length + receiptLines.length ||
    pairMovementIds.some((id) => !id) ||
    new Set(pairMovementIds).size !== pairMovementIds.length ||
    fingerprintMovements.some(
      (movement) =>
        !expectedMovementDocumentIds.has(text(movement?.documentId)) ||
        text(movement?.transferPairId) !== transferPairId,
    )
  ) {
    return { ok: false, error: G3_MATERIAL_HANDOFF_ACK_MISMATCH }
  }
  if (
    !validateDocumentMovements(issueDocument, issueLines, movements, {
      transferPairId,
      movementType: 'issue',
      warehouseId: expectedWarehouses[0],
      orderId,
      lineId,
      reservationDocumentId,
      commandFingerprint,
      consumesReserve: kind === 'issue',
    }) ||
    !validateDocumentMovements(receiptDocument, receiptLines, movements, {
      transferPairId,
      movementType: 'receipt',
      warehouseId: expectedWarehouses[1],
      orderId,
      lineId,
      reservationDocumentId,
      commandFingerprint,
      consumesReserve: false,
    })
  ) {
    return { ok: false, error: G3_MATERIAL_HANDOFF_ACK_MISMATCH }
  }

  const relevantHandoffs = handoffs.filter(
    (handoff) =>
      text(handoff?.idempotencyKey) === idempotencyKey ||
      text(handoff?.transferPairId) === transferPairId ||
      documentIds.includes(text(handoff?.issueDocumentId)) ||
      documentIds.includes(text(handoff?.receiptDocumentId)),
  )
  const handoff = relevantHandoffs[0]
  if (
    relevantHandoffs.length !== 1 ||
    !text(handoff?.id) ||
    text(handoff?.kind) !== kind ||
    text(handoff?.orderId) !== orderId ||
    text(handoff?.lineId) !== lineId ||
    text(handoff?.rawWarehouseId) !== rawWarehouseId ||
    text(handoff?.transferPairId) !== transferPairId ||
    text(handoff?.issueDocumentId) !== documentIds[0] ||
    text(handoff?.receiptDocumentId) !== documentIds[1] ||
    text(handoff?.reservationDocumentId) !== reservationDocumentId ||
    text(kind === 'issue' ? handoff?.overReserveReason : handoff?.reason) !== reason ||
    text(handoff?.idempotencyKey) !== idempotencyKey ||
    text(handoff?.commandFingerprint) !== commandFingerprint ||
    JSON.stringify(canonicalG3MaterialHandoffLines(handoff?.submittedLines)) !==
      JSON.stringify(canonicalG3MaterialHandoffLines(expected?.submittedLines))
  ) {
    return { ok: false, error: G3_MATERIAL_HANDOFF_ACK_MISMATCH }
  }

  let sourceTransferPairIds = []
  if (kind === 'return') {
    sourceTransferPairIds = exactStringArray(data?.sourceTransferPairIds, {
      requireNonEmpty: true,
    })
    const handoffSources = exactStringArray(handoff?.sourceTransferPairIds, {
      requireNonEmpty: true,
    })
    const issueSources = exactStringArray(issueDocument?.sourceTransferPairIds, {
      requireNonEmpty: true,
    })
    const receiptSources = exactStringArray(receiptDocument?.sourceTransferPairIds, {
      requireNonEmpty: true,
    })
    const canonicalSources = JSON.stringify(sourceTransferPairIds?.slice().sort())
    if (
      !sourceTransferPairIds ||
      !handoffSources ||
      !issueSources ||
      !receiptSources ||
      canonicalSources !== JSON.stringify(handoffSources.slice().sort()) ||
      canonicalSources !== JSON.stringify(issueSources.slice().sort()) ||
      canonicalSources !== JSON.stringify(receiptSources.slice().sort())
    ) {
      return { ok: false, error: G3_MATERIAL_HANDOFF_ACK_MISMATCH }
    }
    for (const sourceTransferPairId of sourceTransferPairIds) {
      const sourceHandoffs = handoffs.filter(
        (candidate) =>
          text(candidate?.transferPairId) === sourceTransferPairId &&
          text(candidate?.kind) === 'issue' &&
          text(candidate?.orderId) === orderId &&
          text(candidate?.lineId) === lineId &&
          text(candidate?.rawWarehouseId) === rawWarehouseId,
      )
      const sourceHandoff = sourceHandoffs[0]
      const sourceDocuments = documents.filter(
        (document) => text(document?.transferPairId) === sourceTransferPairId,
      )
      const sourceIssue = sourceDocuments.find(
        (document) => text(document?.id) === text(sourceHandoff?.issueDocumentId),
      )
      const sourceReceipt = sourceDocuments.find(
        (document) => text(document?.id) === text(sourceHandoff?.receiptDocumentId),
      )
      const sourceFingerprint = text(sourceHandoff?.commandFingerprint)
      const sourceReservationDocumentId = text(
        sourceHandoff?.reservationDocumentId,
      )
      if (
        sourceHandoffs.length !== 1 ||
        sourceDocuments.length !== 2 ||
        !text(sourceHandoff?.id) ||
        !text(sourceHandoff?.idempotencyKey) ||
        !sourceReservationDocumentId ||
        !sourceFingerprint.startsWith(G3_MATERIAL_HANDOFF_FINGERPRINT_PREFIX) ||
        !sourceIssue ||
        !sourceReceipt ||
        sourceIssue?.cancelled === true ||
        sourceReceipt?.cancelled === true ||
        text(sourceIssue?.status) !== 'posted' ||
        text(sourceReceipt?.status) !== 'posted' ||
        text(sourceIssue?.type) !== 'issue' ||
        text(sourceReceipt?.type) !== 'receipt' ||
        text(sourceIssue?.docRole) !== 'transfer_issue' ||
        text(sourceReceipt?.docRole) !== 'transfer_receipt' ||
        text(sourceIssue?.purpose) !== 'production_issue' ||
        text(sourceReceipt?.purpose) !== 'production_receipt' ||
        text(sourceIssue?.warehouseId) !== rawWarehouseId ||
        text(sourceReceipt?.warehouseId) !== productionWarehouseId ||
        text(sourceIssue?.productionOrderId) !== orderId ||
        text(sourceReceipt?.productionOrderId) !== orderId ||
        text(sourceIssue?.productionLineId) !== lineId ||
        text(sourceReceipt?.productionLineId) !== lineId ||
        text(sourceIssue?.reservationDocumentId) !== sourceReservationDocumentId ||
        text(sourceReceipt?.reservationDocumentId) !== sourceReservationDocumentId ||
        text(sourceIssue?.commandFingerprint) !== sourceFingerprint ||
        text(sourceReceipt?.commandFingerprint) !== sourceFingerprint
      ) {
        return { ok: false, error: G3_MATERIAL_HANDOFF_ACK_MISMATCH }
      }
    }
  } else if (
    !exactOptional(data?.sourceTransferPairIds, '') ||
    !exactOptional(handoff?.sourceTransferPairIds, '')
  ) {
    return { ok: false, error: G3_MATERIAL_HANDOFF_ACK_MISMATCH }
  }

  return {
    ok: true,
    documentIds,
    transferPairId,
    handoffId: text(handoff.id),
    sourceTransferPairIds,
  }
}
