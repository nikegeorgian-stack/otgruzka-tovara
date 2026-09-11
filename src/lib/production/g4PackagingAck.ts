/** R3.1C — fail-closed validation for mutating G4 packaging acknowledgements. */

export const G4_PACKAGING_ACK_INVALID = 'g4_packaging_ack_invalid' as const

type Row = Record<string, unknown>

export type PackagingMutationAck = {
  criticalRevision?: number
  packagingQcActive?: boolean
  productionActive?: boolean
  idempotent?: boolean
  idempotencyFingerprint?: string
  reportId?: string
  reportNumber?: string
  finishedGoodsLotId?: string
  lotNumber?: string
  quantityProduced?: number
  production?: {
    orders?: unknown[]
    packagingReports?: unknown[]
    finishedGoodsLots?: unknown[]
    qcDecisions?: unknown[]
  }
  warehouse?: { documents?: unknown[]; movements?: unknown[]; loadingShipments?: unknown[] }
}

type PackagingCommandClaim = {
  reportKey?: string
  productionOrderId?: string
  orderId?: string
  lineId?: string
  reportDate?: string
  date?: string
  shiftSlot?: string
  finishedProductId?: string
  warehouseItemId?: string
  packagingWarehouseId?: string
  packagingLocationId?: string
  finishedGoodsWarehouseId?: string
  finishedGoodsLocationId?: string
  outputM2?: number
  outputMp?: number
  outputRolls?: number
  outputPallets?: number
  palletCount?: number
  wipLines?: unknown[]
  materialLines?: unknown[]
  originalReportId?: string
  correctsReportId?: string
}

function text(value: unknown): string {
  return String(value ?? '').trim()
}

function number(value: unknown): number {
  return Number(value)
}

function sameNumber(left: unknown, right: unknown): boolean {
  const a = number(left)
  const b = number(right)
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9
}

function optionalNonNegativeInteger(value: unknown): number | undefined | null {
  if (value === undefined) return undefined
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    (typeof value === 'string' && !value.trim())
  ) {
    return null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

function expectedPackagingCounts(command: PackagingCommandClaim):
  | { outputRolls: number; outputPallets: number }
  | null {
  const rolls = optionalNonNegativeInteger(command.outputRolls)
  const pallets = optionalNonNegativeInteger(command.outputPallets)
  const palletAlias = optionalNonNegativeInteger(command.palletCount)
  if (rolls === null || pallets === null || palletAlias === null) return null
  if (pallets !== undefined && palletAlias !== undefined && pallets !== palletAlias) return null
  return {
    outputRolls: rolls ?? 0,
    outputPallets: pallets ?? palletAlias ?? 0,
  }
}

function optionalPositiveFinite(value: unknown): number | undefined | null {
  if (value === undefined) return undefined
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    (typeof value === 'string' && !value.trim())
  ) {
    return null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function expectedPackagingOutput(command: PackagingCommandClaim): number | null {
  const outputM2 = optionalPositiveFinite(command.outputM2)
  const outputMp = optionalPositiveFinite(command.outputMp)
  if (outputM2 === null || outputMp === null) return null
  if (outputM2 !== undefined && outputMp !== undefined && !sameNumber(outputM2, outputMp)) {
    return null
  }
  return outputM2 ?? outputMp ?? null
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

function uniqueNonEmptyLineIds(value: unknown): boolean {
  const parsed = strictRows(value)
  if (!parsed) return false
  const ids = parsed.map((entry) => text(entry.lineId))
  return ids.every(Boolean) && new Set(ids).size === ids.length
}

function hasPackagingAckShape(ack: Row): ack is PackagingMutationAck & Row {
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
        !uniqueNonEmptyLineIds(report.wipLines) ||
        !uniqueNonEmptyLineIds(report.materialLines),
    )
  ) {
    return false
  }
  const documents = strictRows(warehouse.documents)!
  if (documents.some((document) => !uniqueNonEmptyLineIds(document.lines))) return false
  const shipments = strictRows(warehouse.loadingShipments)!
  return shipments.every((shipment) => {
    if (shipment.lines === undefined) return true
    const lines = strictRows(shipment.lines)
    if (!lines) return false
    const ids = lines.map((line) => text(line.id ?? line.lineId))
    return ids.every(Boolean) && new Set(ids).size === ids.length
  })
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue)
  if (value && typeof value === 'object') {
    const record = value as Row
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .filter((key) => record[key] !== undefined)
        .map((key) => [key, canonicalJsonValue(record[key])]),
    )
  }
  return value
}

export async function computePackagingCommandFingerprint(
  commandType: 'packaging.report.confirm' | 'packaging.report.confirmCorrection',
  command: PackagingCommandClaim,
): Promise<string> {
  const encoded = new TextEncoder().encode(
    JSON.stringify(canonicalJsonValue({ commandType, command })),
  )
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded)
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return `g4-packaging:v1:sha256:${hex}`
}

function normalizeLineId(value: unknown): string {
  const raw = text(value).toLowerCase()
  return new Set(['pack', 'packing', 'packaging', 'pack-line', 'line-pack']).has(raw)
    ? 'pack'
    : raw
}

function tupleKey(raw: Row, kind: 'wip' | 'material'): string {
  const itemId = text(
    kind === 'wip'
      ? raw.semiFinishedItemId ?? raw.itemId ?? raw.warehouseItemId
      : raw.itemId ?? raw.warehouseItemId,
  )
  const lineage =
    kind === 'wip'
      ? [
          text(raw.lineId),
          text(raw.productionOrderId ?? raw.orderId),
          text(raw.shiftReportId ?? raw.sourceShiftReportId),
          text(raw.receiptDocumentId ?? raw.sourceDocumentId),
          text(raw.wipBatchId ?? raw.batchNo ?? raw.sourceWipBatchId),
        ]
      : []
  return JSON.stringify([
    itemId,
    Number(number(raw.quantity).toFixed(6)),
    text(raw.unitSnapshot ?? raw.unit),
    ...lineage,
  ])
}

function exactLineTuples(left: unknown, right: unknown, kind: 'wip' | 'material'): boolean {
  const leftRows = strictRows(left)
  const rightRows = strictRows(right)
  if (!leftRows || !rightRows) return false
  const a = leftRows.map((line) => tupleKey(line, kind)).sort()
  const b = rightRows.map((line) => tupleKey(line, kind)).sort()
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function fail(reason: string) {
  return { ok: false as const, error: G4_PACKAGING_ACK_INVALID, reason }
}

function exactOneById(value: unknown, id: string): Row | null {
  const matches = rows(value).filter((row) => text(row.id) === id)
  return matches.length === 1 ? matches[0] : null
}

function sameDocumentMovementLine(documentLine: Row, movement: Row): boolean {
  const sourceFields = [
    ['sourceDocumentId', 'sourceDocumentId'],
    ['sourceDocumentLineId', 'sourceDocumentLineId'],
    ['sourceShiftReportId', 'sourceShiftReportId'],
    ['sourceWipBatchId', 'sourceWipBatchId'],
  ] as const
  return (
    text(documentLine.lineId) === text(movement.documentLineId) &&
    text(documentLine.itemId) === text(movement.itemId) &&
    text(documentLine.locationId) === text(movement.locationId) &&
    text(documentLine.batchNo) === text(movement.batchNo) &&
    text(documentLine.unitSnapshot) === text(movement.unitSnapshot) &&
    sameNumber(documentLine.quantity, movement.quantity) &&
    sourceFields.every(
      ([documentKey, movementKey]) =>
        !text(documentLine[documentKey]) ||
        text(documentLine[documentKey]) === text(movement[movementKey]),
    )
  )
}

/**
 * Validate the complete atomic G4 result before any local mirror is applied.
 * Returning `ok:false` means the caller must keep its current AppStore unchanged.
 */
export async function validatePackagingMutationAck(input: {
  ack: PackagingMutationAck
  command: PackagingCommandClaim
  previousCriticalRevision?: number
  correction?: boolean
}) {
  const ackRow = row(input?.ack)
  const commandRow = row(input?.command)
  if (!ackRow || !commandRow || !hasPackagingAckShape(ackRow)) {
    return fail('authoritative_shape_invalid')
  }
  const ack = ackRow as PackagingMutationAck
  const command = commandRow as PackagingCommandClaim
  if (!strictRows(command.wipLines) || !strictRows(command.materialLines)) {
    return fail('command_shape_invalid')
  }
  const revision = number(ack?.criticalRevision)
  const previousRevision = Math.max(0, number(input.previousCriticalRevision) || 0)
  if (!Number.isInteger(revision) || revision <= 0) return fail('revision_missing')
  if (ack.packagingQcActive !== true || ack.productionActive !== true) {
    return fail('domain_activation_missing')
  }
  if (revision < previousRevision) return fail('revision_stale')
  if (revision === previousRevision && ack.idempotent !== true) return fail('revision_not_advanced')

  const reportId = text(ack.reportId)
  const lotId = text(ack.finishedGoodsLotId)
  const lotNumber = text(ack.lotNumber)
  const fingerprint = text(ack.idempotencyFingerprint)
  if (
    !reportId ||
    !lotId ||
    !lotNumber ||
    !/^g4-packaging:v1:sha256:[a-f0-9]{64}$/.test(fingerprint)
  ) {
    return fail('identity_or_fingerprint_missing')
  }
  let expectedFingerprint: string
  try {
    expectedFingerprint = await computePackagingCommandFingerprint(
      input.correction === true
        ? 'packaging.report.confirmCorrection'
        : 'packaging.report.confirm',
      command,
    )
  } catch {
    return fail('fingerprint_unavailable')
  }
  if (fingerprint !== expectedFingerprint) return fail('fingerprint_mismatch')

  const report = exactOneById(ack.production?.packagingReports, reportId)
  if (!report) return fail('report_not_unique')
  if (
    !uniqueNonEmptyLineIds(report.wipLines) ||
    !uniqueNonEmptyLineIds(report.materialLines)
  ) {
    return fail('authoritative_shape_invalid')
  }
  const expectedCounts = expectedPackagingCounts(command)
  if (!expectedCounts) return fail('command_output_counts_invalid')
  const expectedOutput = expectedPackagingOutput(command)
  if (expectedOutput == null) return fail('command_output_invalid')
  const reportRolls = optionalNonNegativeInteger(report.outputRolls)
  const reportPallets = optionalNonNegativeInteger(report.outputPallets)
  const sameBusinessKey = rows(ack.production?.packagingReports).filter(
    (candidate) => text(candidate.idempotencyKey) === text(command.reportKey),
  )
  if (sameBusinessKey.length !== 1 || sameBusinessKey[0] !== report) {
    return fail('report_business_key_mismatch')
  }
  if (
    text(report.status) !== 'confirmed' ||
    text(report.idempotencyFingerprint) !== fingerprint ||
    text(report.productionOrderId) !== text(command.productionOrderId ?? command.orderId) ||
    normalizeLineId(report.lineId) !== normalizeLineId(command.lineId) ||
    text(report.reportDate).slice(0, 10) !== text(command.reportDate ?? command.date).slice(0, 10) ||
    text(report.shiftSlot) !== (text(command.shiftSlot) === 'night' ? 'night' : 'day') ||
    text(report.finishedProductId) !== text(command.finishedProductId) ||
    text(report.warehouseItemId) !== text(command.warehouseItemId) ||
    !sameNumber(report.outputM2, expectedOutput) ||
    !text(report.number) ||
    text(ack.reportNumber) !== text(report.number) ||
    reportRolls === undefined ||
    reportRolls === null ||
    reportRolls !== expectedCounts.outputRolls ||
    reportPallets === undefined ||
    reportPallets === null ||
    reportPallets !== expectedCounts.outputPallets ||
    !text(report.updatedAt) ||
    !exactLineTuples(report.wipLines, command.wipLines, 'wip') ||
    !exactLineTuples(report.materialLines, command.materialLines, 'material')
  ) {
    return fail('report_payload_mismatch')
  }
  const packagingWarehouseId = text(report.packagingWarehouseId)
  const packagingLocationId = text(report.packagingLocationId)
  const finishedGoodsWarehouseId = text(report.finishedGoodsWarehouseId)
  const finishedGoodsLocationId = text(report.finishedGoodsLocationId)
  if (
    !packagingWarehouseId ||
    !packagingLocationId ||
    !finishedGoodsWarehouseId ||
    !finishedGoodsLocationId ||
    (text(command.packagingWarehouseId) &&
      text(command.packagingWarehouseId) !== packagingWarehouseId) ||
    (text(command.packagingLocationId) &&
      text(command.packagingLocationId) !== packagingLocationId) ||
    (text(command.finishedGoodsWarehouseId) &&
      text(command.finishedGoodsWarehouseId) !== finishedGoodsWarehouseId) ||
    (text(command.finishedGoodsLocationId) &&
      text(command.finishedGoodsLocationId) !== finishedGoodsLocationId)
  ) {
    return fail('report_route_mismatch')
  }
  if (
    input.correction === true &&
    text(report.correctsReportId) !== text(command.originalReportId ?? command.correctsReportId)
  ) {
    return fail('correction_lineage_mismatch')
  }

  const lot = exactOneById(ack.production?.finishedGoodsLots, lotId)
  const quantityProduced = number(ack.quantityProduced)
  if (!lot || !Number.isFinite(quantityProduced) || quantityProduced <= 0) {
    return fail('lot_not_unique_or_quantity_missing')
  }
  const lotRolls = optionalNonNegativeInteger(lot.outputRolls)
  const lotPallets = optionalNonNegativeInteger(lot.outputPallets)
  if (
    text(report.finishedGoodsLotId) !== lotId ||
    text(report.lotNumber) !== lotNumber ||
    text(lot.packagingReportId) !== reportId ||
    text(lot.productionOrderId) !== text(command.productionOrderId ?? command.orderId) ||
    text(lot.finishedProductId) !== text(command.finishedProductId) ||
    text(lot.warehouseItemId) !== text(command.warehouseItemId) ||
    text(lot.qcStatus) !== 'pending' ||
    !sameNumber(lot.quantityProduced, quantityProduced) ||
    lotRolls === undefined ||
    lotRolls === null ||
    lotRolls !== expectedCounts.outputRolls ||
    lotPallets === undefined ||
    lotPallets === null ||
    lotPallets !== expectedCounts.outputPallets ||
    !text(lot.updatedAt) ||
    text(lot.lotNumber ?? lot.batchNo) !== lotNumber
  ) {
    return fail('lot_payload_mismatch')
  }

  const documentIds = Array.isArray(report.documentIds)
    ? report.documentIds.map(text).filter(Boolean)
    : []
  if (documentIds.length < 2 || new Set(documentIds).size !== documentIds.length) {
    return fail('document_ids_invalid')
  }
  const documents = documentIds.map((id) => exactOneById(ack.warehouse?.documents, id))
  if (documents.some((document) => !document)) return fail('document_not_unique')
  const typedDocuments = documents as Row[]
  if (typedDocuments.some((document) => !uniqueNonEmptyLineIds(document.lines))) {
    return fail('authoritative_shape_invalid')
  }
  if (
    typedDocuments.some(
      (document) =>
        text(document.status) !== 'posted' ||
        text(document.productionOrderId) !== text(command.productionOrderId ?? command.orderId) ||
        text(document.packagingReportId) !== reportId ||
        text(document.finishedGoodsLotId) !== lotId,
    )
  ) {
    return fail('document_lineage_mismatch')
  }

  const wipDocuments = typedDocuments.filter(
    (document) => text(document.docRole) === 'production_wip_pack_consumption',
  )
  const materialDocuments = typedDocuments.filter(
    (document) => text(document.docRole) === 'packaging_material_consumption',
  )
  const receiptDocuments = typedDocuments.filter(
    (document) => text(document.docRole) === 'production_fg_receipt',
  )
  if (
    wipDocuments.length !== 1 ||
    receiptDocuments.length !== 1 ||
    materialDocuments.length !== (rows(command.materialLines).length > 0 ? 1 : 0) ||
    typedDocuments.length !== 2 + materialDocuments.length
  ) {
    return fail('document_roles_mismatch')
  }
  const reportDate = text(report.reportDate).slice(0, 10)
  const routeDocuments = [
    ...wipDocuments.map((document) => ({
      document,
      type: 'issue',
      purpose: 'production_issue',
      warehouseId: packagingWarehouseId,
      locationId: packagingLocationId,
    })),
    ...materialDocuments.map((document) => ({
      document,
      type: 'issue',
      purpose: 'production_issue',
      warehouseId: packagingWarehouseId,
      locationId: packagingLocationId,
    })),
    ...receiptDocuments.map((document) => ({
      document,
      type: 'receipt',
      purpose: 'production_receipt',
      warehouseId: finishedGoodsWarehouseId,
      locationId: finishedGoodsLocationId,
    })),
  ]
  for (const route of routeDocuments) {
    if (
      route.document.cancelled === true ||
      text(route.document.type) !== route.type ||
      text(route.document.purpose) !== route.purpose ||
      text(route.document.warehouseId) !== route.warehouseId ||
      text(route.document.date).slice(0, 10) !== reportDate ||
      (strictRows(route.document.lines) ?? []).some(
        (line) => text(line.locationId) !== route.locationId || !text(line.unitSnapshot),
      )
    ) {
      return fail('document_route_mismatch')
    }
  }

  const documentIdSet = new Set(documentIds)
  if (
    rows(ack.warehouse?.documents).some(
      (document) =>
        (text(document.packagingReportId) === reportId ||
          text(document.finishedGoodsLotId) === lotId) &&
        !documentIdSet.has(text(document.id)),
    ) ||
    rows(ack.warehouse?.movements).some(
      (movement) =>
        (text(movement.packagingReportId) === reportId ||
          text(movement.finishedGoodsLotId) === lotId) &&
        !documentIdSet.has(text(movement.documentId)),
    )
  ) {
    return fail('unexpected_report_effect')
  }

  const wipLines = rows(wipDocuments[0].lines)
  const reportWip = rows(report.wipLines)
  if (wipLines.length !== reportWip.length) return fail('wip_document_mismatch')
  for (const line of reportWip) {
    const matches = wipLines.filter(
      (documentLine) =>
        text(documentLine.itemId) === text(line.itemId) &&
        text(documentLine.batchNo) === text(line.wipBatchId ?? line.batchNo) &&
        text(documentLine.sourceDocumentId) === text(line.receiptDocumentId) &&
        text(documentLine.sourceDocumentLineId) === text(line.lineId) &&
        text(documentLine.sourceShiftReportId) === text(line.shiftReportId) &&
        sameNumber(documentLine.quantity, line.quantity),
    )
    if (matches.length !== 1) return fail('wip_document_mismatch')
  }

  if (materialDocuments.length === 1) {
    const allocationByItem = new Map<string, number>()
    for (const line of rows(materialDocuments[0].lines)) {
      const itemId = text(line.itemId)
      allocationByItem.set(itemId, (allocationByItem.get(itemId) ?? 0) + number(line.quantity))
    }
    const expectedByItem = new Map<string, number>()
    for (const line of rows(command.materialLines)) {
      const itemId = text(line.itemId ?? line.warehouseItemId)
      expectedByItem.set(itemId, (expectedByItem.get(itemId) ?? 0) + number(line.quantity))
    }
    if (
      allocationByItem.size !== expectedByItem.size ||
      [...expectedByItem].some(
        ([itemId, quantity]) => !sameNumber(allocationByItem.get(itemId), quantity),
      )
    ) {
      return fail('material_document_mismatch')
    }
  }

  const receiptLines = rows(receiptDocuments[0].lines)
  if (
    receiptLines.length !== 1 ||
    text(receiptLines[0].itemId) !== text(command.warehouseItemId) ||
    text(receiptLines[0].batchNo) !== text(lot.lotNumber ?? lot.batchNo) ||
    !sameNumber(receiptLines[0].quantity, quantityProduced)
  ) {
    return fail('fg_receipt_mismatch')
  }

  for (const document of typedDocuments) {
    const documentId = text(document.id)
    const documentLines = rows(document.lines)
    const movements = rows(ack.warehouse?.movements).filter(
      (movement) => text(movement.documentId) === documentId,
    )
    if (movements.length !== documentLines.length) return fail('movement_mismatch')
    const unmatchedLines = [...documentLines]
    for (const movement of movements) {
      if (
        movement.cancelled === true ||
        text(movement.type) !== text(document.type) ||
        text(movement.warehouseId) !== text(document.warehouseId) ||
        text(movement.date).slice(0, 10) !== text(document.date).slice(0, 10) ||
        text(movement.packagingReportId) !== reportId ||
        text(movement.finishedGoodsLotId) !== lotId
      ) {
        return fail('movement_mismatch')
      }
      const lineIndex = unmatchedLines.findIndex((line) =>
        sameDocumentMovementLine(line, movement),
      )
      if (lineIndex < 0) return fail('movement_mismatch')
      unmatchedLines.splice(lineIndex, 1)
    }
  }

  return { ok: true as const, criticalRevision: revision, report, lot }
}
