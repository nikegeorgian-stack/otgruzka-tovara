import type {
  ConfirmShiftReportInput,
  ProductionShiftReport,
  ShiftMaterialActualLine,
  ShiftWasteLine,
} from './shiftReports'

export const G3_SHIFT_ACK_INVALID = 'production.shift.errAuthoritativeAck' as const

type ShiftReportDraft = ConfirmShiftReportInput['report']

type AdaptShiftReportInput = {
  serverReport: unknown
  reportId: string | undefined
  criticalRevision: unknown
  previousCriticalRevision: unknown
  idempotent?: boolean
  warehouse: unknown
  production: unknown
  productionOrderId: string
  expectedBusinessKey: string
  submitted: ShiftReportDraft
  correctsReportId?: string
  correctionReason?: string
  emergencyReason?: string
}

export type AdaptShiftReportResult =
  | {
      ok: true
      report: ProductionShiftReport
      /** Complete authoritative projection; never rebuild this list from stale client state. */
      authoritativeReports: ProductionShiftReport[]
    }
  | { ok: false; error: typeof G3_SHIFT_ACK_INVALID }

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function recordArray(value: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(value)) return null
  const rows = value.map(record)
  return rows.some((row) => row == null)
    ? null
    : (rows as Record<string, unknown>[])
}

function text(value: unknown): string {
  return String(value ?? '').trim()
}

function finite(value: unknown): number | null {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function sameNumber(left: unknown, right: unknown): boolean {
  const a = finite(left)
  const b = finite(right)
  return a != null && b != null && Math.abs(a - b) <= 1e-9
}

function actualSignature(row: Record<string, unknown>) {
  return JSON.stringify([
    text(row.itemId),
    text(row.batchNo),
    text(row.expiryDate),
    text(row.batchRunId),
    finite(row.quantity ?? row.actualInputQty),
    text(row.deviationReason),
  ])
}

function submittedActualSignature(row: ShiftMaterialActualLine) {
  return actualSignature({
    ...row,
    quantity: row.actualInputQty,
  })
}

function wasteSignature(row: Record<string, unknown>) {
  return JSON.stringify([
    text(row.itemId),
    text(row.batchNo),
    text(row.expiryDate),
    text(row.batchRunId),
    finite(row.quantity),
    text(row.reason ?? row.comment ?? row.reasonCode),
    text(row.unit ?? row.unitSnapshot),
  ])
}

function sameRows(
  serverRows: unknown,
  submittedRows: readonly (ShiftMaterialActualLine | ShiftWasteLine)[],
  kind: 'actual' | 'waste',
): boolean {
  if (!Array.isArray(serverRows)) return false
  const records = serverRows.map(record)
  if (records.some((row) => row == null)) return false
  const typedRows = records as Record<string, unknown>[]
  if (
    typedRows.some((row) => {
      const quantity = finite(row.quantity ?? row.actualInputQty)
      return quantity == null || quantity <= 0
    })
  ) {
    return false
  }
  const server = typedRows
    .map(kind === 'actual' ? actualSignature : wasteSignature)
    .sort()
  const submitted = submittedRows
    .filter(
      (row) => kind === 'actual' || (row as ShiftWasteLine).quantity > 1e-9,
    )
    .map((row) =>
      kind === 'actual'
        ? submittedActualSignature(row as ShiftMaterialActualLine)
        : wasteSignature({
            ...(row as ShiftWasteLine),
            reason:
              (row as ShiftWasteLine).comment || (row as ShiftWasteLine).reasonCode,
            unit: (row as ShiftWasteLine).unitSnapshot,
          }),
    )
    .sort()
  return JSON.stringify(server) === JSON.stringify(submitted)
}

function canonicalStockTuple(row: Record<string, unknown>) {
  return {
    itemId: text(row.itemId),
    batchNo: text(row.batchNo),
    expiryDate: text(row.expiryDate),
    batchRunId: text(row.batchRunId),
  }
}

function sortedCanonicalRows(rows: Record<string, unknown>[]) {
  return rows.sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  )
}

function canonicalSubmittedShiftCommand(input: AdaptShiftReportInput) {
  return {
    originalReportId: text(input.correctsReportId),
    correctionReason: text(input.correctionReason),
    emergencyReason: text(input.emergencyReason),
    orderId: text(input.productionOrderId),
    lineId: text(input.submitted.lineId),
    shiftDate: text(input.submitted.shiftDate).slice(0, 10),
    shiftSlot: text(input.submitted.shift) || 'day',
    outputMp: finite(input.submitted.outputM2),
    outputRolls: finite(input.submitted.rollCount) ?? 0,
    semiFinishedItemId: text(input.submitted.semiFinishedItemId),
    packLocationId: text(input.submitted.packagingLocationId),
    impregnationQcDecisionId: text(input.submitted.impregnationQcDecisionId),
    batchRunId: text(input.submitted.batchRunId),
    actualInputs: sortedCanonicalRows(
      input.submitted.materialLines.map((row) => ({
        ...canonicalStockTuple(row as unknown as Record<string, unknown>),
        quantity: finite(row.actualInputQty),
        deviationReason: text(row.deviationReason),
      })),
    ),
    wasteLines: sortedCanonicalRows(
      input.submitted.wasteLines
        .filter((row) => row.quantity > 1e-9)
        .map((row) => ({
          ...canonicalStockTuple(row as unknown as Record<string, unknown>),
          quantity: finite(row.quantity),
          reason: text(row.comment || row.reasonCode),
          unit: text(row.unitSnapshot),
        })),
    ),
  }
}

async function submittedShiftFingerprint(input: AdaptShiftReportInput): Promise<string | null> {
  try {
    const bytes = new TextEncoder().encode(
      JSON.stringify(canonicalSubmittedShiftCommand(input)),
    )
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
    return [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('')
  } catch {
    return null
  }
}

function exactOptional(server: unknown, submitted: unknown): boolean {
  return text(server) === text(submitted)
}

/** Validate a WIP-v1/current-command row before exposing it as the UI model. */
function canonicalUiShiftReport(value: unknown): ProductionShiftReport | null {
  const row = record(value)
  if (!row) return null
  const recipe = record(row.recipeNormSnapshot)
  const recipeComponents = recordArray(recipe?.components)
  const materialLines = recordArray(row.materialLines)
  const wasteLines = recordArray(row.wasteLines)
  const outputM2 = finite(row.outputM2)
  const rollCount = finite(row.rollCount)
  const status = text(row.status)
  const shift = text(row.shift)
  const fingerprint = text(row.commandFingerprint)
  if (
    !text(row.id) ||
    !text(row.number) ||
    status !== 'confirmed' ||
    !text(row.productionOrderId) ||
    !text(row.lineId) ||
    !text(row.shiftDate) ||
    !['day', 'night'].includes(shift) ||
    outputM2 == null ||
    outputM2 <= 0 ||
    rollCount == null ||
    !Number.isInteger(rollCount) ||
    rollCount < 0 ||
    !text(row.productionLocationId) ||
    !text(row.packagingLocationId) ||
    !text(row.semiFinishedItemId) ||
    !text(row.createdAt) ||
    !text(row.updatedAt) ||
    !text(row.confirmedAt) ||
    !text(row.idempotencyKey) ||
    !/^[a-f0-9]{64}$/.test(fingerprint) ||
    !recipe ||
    !recipeComponents ||
    !text(recipe.recipeId) ||
    !text(recipe.recipeVersionId) ||
    !text(recipe.contentHash) ||
    !materialLines ||
    !wasteLines
  ) {
    return null
  }
  if (
    materialLines.some((line) => {
      const normQty = finite(line.normQty)
      const actualQty = finite(line.actualInputQty)
      const wasteQty = finite(line.wasteQty)
      const processQty = finite(line.processConsumedQty)
      const deviationQty = finite(line.deviationQty)
      const deviationPct = finite(line.deviationPct)
      const tolerancePct = finite(line.tolerancePct)
      return (
        !text(line.lineId) ||
        !text(line.itemId) ||
        !text(line.unitSnapshot) ||
        normQty == null ||
        actualQty == null ||
        wasteQty == null ||
        processQty == null ||
        deviationQty == null ||
        deviationPct == null ||
        tolerancePct == null ||
        actualQty <= 0 ||
        wasteQty < 0 ||
        processQty < 0 ||
        Math.abs(actualQty - wasteQty - processQty) > 1e-9 ||
        Math.abs(actualQty - normQty - deviationQty) > 1e-9
      )
    }) ||
    wasteLines.some((line) => {
      const quantity = finite(line.quantity)
      return (
        !text(line.lineId) ||
        !text(line.itemId) ||
        !text(line.unitSnapshot) ||
        !text(line.reasonCode) ||
        quantity == null ||
        quantity <= 0
      )
    }) ||
    (text(row.correctsReportId) && !text(row.correctionReason)) ||
    (row.wipContractVersion != null && finite(row.wipContractVersion) !== 1)
  ) {
    return null
  }

  // The cast is limited to enum fields after the runtime checks above. Build
  // the public UI model explicitly so internal DTO aliases never leak through.
  return {
    id: text(row.id),
    number: text(row.number),
    status: 'confirmed',
    productionOrderId: text(row.productionOrderId),
    lineId: text(row.lineId) as ProductionShiftReport['lineId'],
    shiftDate: text(row.shiftDate).slice(0, 10),
    shift: shift as ProductionShiftReport['shift'],
    responsibleUserId: text(row.responsibleUserId) || undefined,
    responsibleNameSnapshot: text(row.responsibleNameSnapshot) || undefined,
    responsibleRoleSnapshot:
      (text(row.responsibleRoleSnapshot) as ProductionShiftReport['responsibleRoleSnapshot']) ||
      undefined,
    recipeNormSnapshot: structuredClone(recipe) as ProductionShiftReport['recipeNormSnapshot'],
    productionWarehouseId: text(row.productionWarehouseId) || undefined,
    productionLocationId: text(row.productionLocationId),
    packagingWarehouseId: text(row.packagingWarehouseId) || undefined,
    packagingLocationId: text(row.packagingLocationId),
    scrapLocationId: text(row.scrapLocationId) || undefined,
    materialLines: structuredClone(materialLines) as ProductionShiftReport['materialLines'],
    wasteLines: structuredClone(wasteLines) as ProductionShiftReport['wasteLines'],
    outputM2,
    rollCount,
    m2PerRollSnapshot: finite(row.m2PerRollSnapshot) ?? undefined,
    conversionTolerancePct: finite(row.conversionTolerancePct) ?? undefined,
    conversionDeviationReason: text(row.conversionDeviationReason) || undefined,
    semiFinishedItemId: text(row.semiFinishedItemId),
    semiFinishedUnitSnapshot: text(row.semiFinishedUnitSnapshot) || undefined,
    wipContractVersion: finite(row.wipContractVersion) === 1 ? 1 : undefined,
    impregnationQcDecisionId: text(row.impregnationQcDecisionId) || undefined,
    batchRunId: text(row.batchRunId) || undefined,
    createdAt: text(row.createdAt),
    updatedAt: text(row.updatedAt),
    confirmedAt: text(row.confirmedAt),
    confirmedBy: text(row.confirmedBy) || undefined,
    confirmedByName: text(row.confirmedByName) || undefined,
    idempotencyKey: text(row.idempotencyKey),
    correctsReportId: text(row.correctsReportId) || undefined,
    correctionReason: text(row.correctionReason) || undefined,
    correctedAt: text(row.correctedAt) || undefined,
    correctedBy: text(row.correctedBy) || undefined,
    correctionOpen: row.correctionOpen === true || undefined,
    consumptionDocumentId: text(row.consumptionDocumentId) || undefined,
    wipReceiptDocumentId: text(row.wipReceiptDocumentId) || undefined,
    wasteTransferPairId: text(row.wasteTransferPairId) || undefined,
    transactionGroupId: text(row.transactionGroupId) || undefined,
  }
}

const LEGACY_CANONICAL_FIELDS = [
  'productionOrderId',
  'shift',
  'outputM2',
  'rollCount',
  'recipeNormSnapshot',
  'materialLines',
  'wasteInputs',
  'productionLocationId',
  'packagingLocationId',
  'updatedAt',
  'commandFingerprint',
] as const

function hasOwn(row: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(row, key)
}

function conflictingTextAliases(
  row: Record<string, unknown>,
  left: string,
  right: string,
): boolean {
  return (
    hasOwn(row, left) &&
    hasOwn(row, right) &&
    text(row[left]) !== text(row[right])
  )
}

function legacyRecipeSnapshot(
  row: Record<string, unknown>,
  production: Record<string, unknown>,
  productionOrderId: string,
  recipeVersionId: string,
  contentHash: string,
): ProductionShiftReport['recipeNormSnapshot'] | null {
  const orders = recordArray(production.orders)
  if (!orders) return null
  const matchingOrders = orders.filter((order) => text(order.id) === productionOrderId)
  if (matchingOrders.length > 1) return null
  const direct = record(row.recipeNormSnapshot)
  const fromOrder = matchingOrders.length === 1
    ? record(matchingOrders[0].recipeNormSnapshot)
    : null
  const snapshot = direct ?? fromOrder
  const components = recordArray(snapshot?.components)
  const versionNumber = finite(snapshot?.versionNumber)
  const normBase = text(snapshot?.normBase)
  if (
    !snapshot ||
    !text(snapshot.recipeId) ||
    text(snapshot.recipeVersionId) !== recipeVersionId ||
    versionNumber == null ||
    !Number.isInteger(versionNumber) ||
    versionNumber <= 0 ||
    text(snapshot.contentHash) !== contentHash ||
    (normBase !== 'per_m2' && normBase !== 'per_batch') ||
    (normBase === 'per_batch' && (finite(snapshot.batchSize) ?? 0) <= 0) ||
    !components ||
    !text(snapshot.snappedAt)
  ) {
    return null
  }
  return structuredClone(snapshot) as ProductionShiftReport['recipeNormSnapshot']
}

/**
 * Read-only projection for the exact pre-WIP-v1 DTO emitted by the historical
 * G3 reducer. It deliberately does not infer locations, document links, norm
 * lines, or waste lineage from current client state. Recipe evidence must be a
 * complete authoritative frozen snapshot on the row or its exact order.
 */
function legacyUiShiftReport(
  value: unknown,
  production: Record<string, unknown>,
): ProductionShiftReport | null {
  const row = record(value)
  if (!row || row.wipContractVersion != null) return null

  // A partially canonical row is corruption, not a legacy DTO. Never downgrade
  // it to the permissive reader after strict validation has failed.
  if (LEGACY_CANONICAL_FIELDS.some((field) => hasOwn(row, field))) return null
  if (
    conflictingTextAliases(row, 'orderId', 'productionOrderId') ||
    conflictingTextAliases(row, 'shiftSlot', 'shift') ||
    conflictingTextAliases(row, 'packLocationId', 'packagingLocationId')
  ) {
    return null
  }

  const id = text(row.id)
  const productionOrderId = text(row.orderId)
  const lineId = text(row.lineId)
  const shiftDate = text(row.shiftDate).slice(0, 10)
  const shift = text(row.shiftSlot)
  const outputM2 = finite(row.outputMp)
  const rollCount = finite(row.outputRolls)
  const semiFinishedItemId = text(row.semiFinishedItemId)
  const packagingLocationId = text(row.packLocationId)
  const recipeVersionId = text(row.recipeVersionId)
  const contentHash = text(row.contentHash)
  const confirmedAt = text(row.confirmedAt)
  const createdAt = text(row.createdAt)
  const idempotencyKey = text(row.idempotencyKey)
  const wipBatchId = text(row.wipBatchId)
  const actualInputs = recordArray(row.actualInputs)
  const wasteInputs = recordArray(row.wasteLines)
  const recipeNormSnapshot = legacyRecipeSnapshot(
    row,
    production,
    productionOrderId,
    recipeVersionId,
    contentHash,
  )

  if (
    !id ||
    row.status !== 'confirmed' ||
    !productionOrderId ||
    !lineId ||
    !/^\d{4}-\d{2}-\d{2}$/.test(shiftDate) ||
    !['day', 'night'].includes(shift) ||
    outputM2 == null ||
    outputM2 <= 0 ||
    rollCount == null ||
    !Number.isInteger(rollCount) ||
    rollCount < 0 ||
    !semiFinishedItemId ||
    !packagingLocationId ||
    !recipeVersionId ||
    !contentHash ||
    !recipeNormSnapshot ||
    !confirmedAt ||
    !createdAt ||
    !idempotencyKey ||
    !wipBatchId ||
    !actualInputs ||
    !wasteInputs ||
    actualInputs.some((input) => {
      const quantity = finite(input.quantity)
      return !text(input.itemId) || quantity == null || quantity <= 0
    }) ||
    wasteInputs.some((input) => {
      const quantity = finite(input.quantity)
      return (
        !text(input.itemId) ||
        quantity == null ||
        quantity <= 0 ||
        !text(input.reason ?? input.reasonCode)
      )
    }) ||
    (text(row.correctsReportId) && !text(row.correctionReason))
  ) {
    return null
  }

  return {
    id,
    number: text(row.number) || id,
    status: 'confirmed',
    productionOrderId,
    lineId: lineId as ProductionShiftReport['lineId'],
    shiftDate,
    shift: shift as ProductionShiftReport['shift'],
    responsibleUserId: text(row.confirmedBy) || undefined,
    responsibleNameSnapshot: text(row.confirmedByName) || undefined,
    recipeNormSnapshot,
    productionLocationId: '',
    packagingLocationId,
    materialLines: [],
    wasteLines: [],
    outputM2,
    rollCount,
    semiFinishedItemId,
    createdAt,
    updatedAt: text(row.updatedAt) || createdAt,
    confirmedAt,
    confirmedBy: text(row.confirmedBy) || undefined,
    confirmedByName: text(row.confirmedByName) || undefined,
    idempotencyKey,
    correctsReportId: text(row.correctsReportId) || undefined,
    correctionReason: text(row.correctionReason) || undefined,
    legacyReadOnlyProjection: true,
    legacyActualInputs: structuredClone(actualInputs),
    legacyWasteInputs: structuredClone(wasteInputs),
    legacyWipBatchId: wipBatchId,
  } as ProductionShiftReport
}

function projectAuthoritativeShiftReport(
  row: Record<string, unknown>,
  acknowledgedReportId: string,
  production: Record<string, unknown>,
): ProductionShiftReport | null {
  if (
    text(row.id) === acknowledgedReportId ||
    finite(row.wipContractVersion) === 1
  ) {
    return canonicalUiShiftReport(row)
  }
  return canonicalUiShiftReport(row) ?? legacyUiShiftReport(row, production)
}

function effectSignature(row: Record<string, unknown>) {
  return JSON.stringify([
    text(row.itemId),
    text(row.batchNo),
    text(row.expiryDate),
    text(row.batchRunId),
    finite(row.quantity),
  ])
}

function sameEffectRows(
  rows: Record<string, unknown>[],
  expected: Record<string, unknown>[],
): boolean {
  if (
    rows.length !== expected.length ||
    rows.some((row) => {
      const quantity = finite(row.quantity)
      return quantity == null || quantity <= 0
    }) ||
    expected.some((row) => {
      const quantity = finite(row.quantity)
      return quantity == null || quantity <= 0
    })
  ) {
    return false
  }
  return (
    JSON.stringify(rows.map(effectSignature).sort()) ===
    JSON.stringify(expected.map(effectSignature).sort())
  )
}

function exactEffectDocument(
  document: Record<string, unknown>,
  allMovements: Record<string, unknown>[],
  expected: {
    id: string
    role: string
    documentType: 'issue' | 'receipt'
    movementType: 'issue' | 'receipt'
    orderId: string
    lineId: string
    shiftReportId: string
    warehouseId: string
    locationId: string
    transferPairId?: string
    rows: Record<string, unknown>[]
  },
): boolean {
  const lines = recordArray(document.lines)
  const movements = allMovements.filter((row) => text(row.documentId) === expected.id)
  if (
    !lines ||
    document.status !== 'posted' ||
    document.type !== expected.documentType ||
    text(document.docRole) !== expected.role ||
    text(document.productionOrderId) !== expected.orderId ||
    text(document.productionLineId) !== expected.lineId ||
    text(document.shiftReportId) !== expected.shiftReportId ||
    text(document.warehouseId) !== expected.warehouseId ||
    text(document.transferPairId) !== text(expected.transferPairId) ||
    !sameEffectRows(lines, expected.rows) ||
    movements.length !== lines.length
  ) {
    return false
  }
  const lineIds = new Set<string>()
  for (const line of lines) {
    const lineId = text(line.lineId)
    if (
      !lineId ||
      lineIds.has(lineId) ||
      text(line.locationId) !== expected.locationId
    ) {
      return false
    }
    lineIds.add(lineId)
    const candidates = movements.filter(
      (movement) => text(movement.documentLineId) === lineId,
    )
    const movement = candidates[0] ?? {}
    const quantity = finite(movement.quantity)
    if (
      candidates.length !== 1 ||
      movement.cancelled === true ||
      movement.type !== expected.movementType ||
      quantity == null ||
      quantity <= 0 ||
      text(movement.warehouseId) !== expected.warehouseId ||
      text(movement.locationId) !== expected.locationId ||
      text(movement.productionOrderId) !== expected.orderId ||
      text(movement.productionLineId) !== expected.lineId ||
      text(movement.shiftReportId) !== expected.shiftReportId ||
      effectSignature(movement) !== effectSignature(line)
    ) {
      return false
    }
  }
  return true
}

function exactAuthoritativeWipGraph(
  input: AdaptShiftReportInput,
  server: Record<string, unknown>,
  reportId: string,
): boolean {
  const production = record(input.production)
  const warehouse = record(input.warehouse)
  if (!production || !warehouse) return false
  const reports = recordArray(production.shiftReports)
  const wipRows = recordArray(production.wipBatches)
  const documents = recordArray(warehouse.documents)
  const movements = recordArray(warehouse.movements)
  if (!reports || !wipRows || !documents || !movements) return false
  const projectedReports = reports.filter((row) => text(row.id) === reportId)
  const businessKeyReports = reports.filter(
    (row) => text(row.idempotencyKey) === input.expectedBusinessKey,
  )
  if (
    projectedReports.length !== 1 ||
    businessKeyReports.length !== 1 ||
    text(businessKeyReports[0]?.id) !== reportId ||
    text(projectedReports[0].idempotencyKey) !== text(server.idempotencyKey) ||
    text(projectedReports[0].commandFingerprint) !== text(server.commandFingerprint)
  ) {
    return false
  }

  const wipBatchId = text(server.wipBatchId)
  const wipReceiptDocumentId = text(server.wipReceiptDocumentId)
  if (!wipBatchId || !wipReceiptDocumentId) return false
  const matchingWip = wipRows.filter(
    (row) => text(row.id) === wipBatchId || text(row.shiftReportId) === reportId,
  )
  const wip = matchingWip[0] ?? {}
  if (
    matchingWip.length !== 1 ||
    text(wip.id) !== wipBatchId ||
    text(wip.shiftReportId) !== reportId ||
    text(wip.orderId) !== input.productionOrderId ||
    text(wip.lineId) !== text(server.lineId) ||
    text(wip.itemId) !== text(server.semiFinishedItemId) ||
    text(wip.locationId) !== text(server.packagingLocationId ?? server.packLocationId) ||
    wip.isFinishedGoods === true ||
    !sameNumber(wip.quantityMp, server.outputMp ?? server.outputM2) ||
    !sameNumber(wip.rolls ?? 0, server.outputRolls ?? server.rollCount ?? 0) ||
    finite(wip.wipContractVersion) !== finite(server.wipContractVersion) ||
    text(wip.unitSnapshot) !== text(server.semiFinishedUnitSnapshot) ||
    text(wip.impregnationQcDecisionId) !== text(server.impregnationQcDecisionId) ||
    text(wip.batchRunId) !== text(server.batchRunId)
  ) {
    return false
  }

  const receiptCandidates = documents.filter(
    (row) =>
      text(row.id) === wipReceiptDocumentId ||
      (text(row.shiftReportId) === reportId && text(row.docRole) === 'wip_receipt'),
  )
  const receipt = receiptCandidates[0] ?? {}
  const lines = Array.isArray(receipt?.lines)
    ? receipt.lines.map(record).filter((row): row is Record<string, unknown> => row != null)
    : []
  const line = lines[0] ?? {}
  if (
    receiptCandidates.length !== 1 ||
    text(receipt.id) !== wipReceiptDocumentId ||
    receipt.status !== 'posted' ||
    receipt.type !== 'receipt' ||
    receipt.docRole !== 'wip_receipt' ||
    text(receipt.productionOrderId) !== input.productionOrderId ||
    text(receipt.productionLineId) !== text(server.lineId) ||
    text(receipt.shiftReportId) !== reportId ||
    text(receipt.warehouseId) !== text(server.packagingWarehouseId) ||
    lines.length !== 1 ||
    !text(line.lineId) ||
    text(line.itemId) !== text(server.semiFinishedItemId) ||
    text(line.locationId) !== text(server.packagingLocationId ?? server.packLocationId) ||
    text(line.batchNo) !== wipBatchId ||
    !sameNumber(line.quantity, server.outputMp ?? server.outputM2)
  ) {
    return false
  }

  const receiptMovements = movements.filter(
    (row) =>
      text(row.documentId) === wipReceiptDocumentId ||
      (text(row.shiftReportId) === reportId && row.isWip === true),
  )
  const movement = receiptMovements[0] ?? {}
  const wipGraphValid = (
    receiptMovements.length === 1 &&
    movement.cancelled !== true &&
    movement.type === 'receipt' &&
    text(movement.documentId) === wipReceiptDocumentId &&
    text(movement.documentLineId) === text(line.lineId) &&
    text(movement.warehouseId) === text(receipt.warehouseId) &&
    text(movement.locationId) === text(line.locationId) &&
    text(movement.itemId) === text(line.itemId) &&
    text(movement.batchNo) === wipBatchId &&
    text(movement.productionOrderId) === input.productionOrderId &&
    text(movement.productionLineId) === text(server.lineId) &&
    text(movement.shiftReportId) === reportId &&
    movement.isWip === true &&
    sameNumber(movement.quantity, line.quantity)
  )
  if (!wipGraphValid) return false

  const consumptionRows: Record<string, unknown>[] = []
  for (const row of input.submitted.materialLines) {
    const quantity = finite(row.processConsumedQty)
    if (quantity == null || quantity < 0) return false
    if (quantity > 1e-9) {
      consumptionRows.push({
        ...canonicalStockTuple(row as unknown as Record<string, unknown>),
        quantity,
      })
    }
  }
  const consumptionId = text(server.consumptionDocumentId)
  const consumptionCandidates = documents.filter(
    (row) =>
      (consumptionId && text(row.id) === consumptionId) ||
      (text(row.shiftReportId) === reportId && text(row.docRole) === 'shift_consumption'),
  )
  if (consumptionRows.length === 0) {
    if (consumptionId || consumptionCandidates.length !== 0) return false
  } else {
    if (
      !consumptionId ||
      consumptionCandidates.length !== 1 ||
      text(consumptionCandidates[0]?.id) !== consumptionId ||
      !exactEffectDocument(consumptionCandidates[0]!, movements, {
        id: consumptionId,
        role: 'shift_consumption',
        documentType: 'issue',
        movementType: 'issue',
        orderId: input.productionOrderId,
        lineId: text(server.lineId),
        shiftReportId: reportId,
        warehouseId: text(server.productionWarehouseId),
        locationId: text(server.productionLocationId),
        rows: consumptionRows,
      })
    ) {
      return false
    }
  }

  const wasteRows = input.submitted.wasteLines
    .filter((row) => row.quantity > 1e-9)
    .map((row) => ({
      ...canonicalStockTuple(row as unknown as Record<string, unknown>),
      quantity: finite(row.quantity),
    }))
  const wastePairId = text(server.wasteTransferPairId)
  const wasteCandidates = documents.filter(
    (row) =>
      text(row.shiftReportId) === reportId &&
      ['waste_to_scrap', 'scrap_receipt'].includes(text(row.docRole)),
  )
  if (wasteRows.length === 0) {
    return !wastePairId && !text(server.scrapLocationId) && wasteCandidates.length === 0
  }
  const scrapLocationId = text(server.scrapLocationId)
  if (!wastePairId || !scrapLocationId || wasteCandidates.length !== 2) return false
  const wasteIssue = wasteCandidates.filter((row) => text(row.docRole) === 'waste_to_scrap')
  const wasteReceipt = wasteCandidates.filter((row) => text(row.docRole) === 'scrap_receipt')
  if (wasteIssue.length !== 1 || wasteReceipt.length !== 1) return false
  return (
    text(wasteIssue[0].transferPairId) === wastePairId &&
    text(wasteReceipt[0].transferPairId) === wastePairId &&
    exactEffectDocument(wasteIssue[0], movements, {
      id: text(wasteIssue[0].id),
      role: 'waste_to_scrap',
      documentType: 'issue',
      movementType: 'issue',
      orderId: input.productionOrderId,
      lineId: text(server.lineId),
      shiftReportId: reportId,
      warehouseId: text(server.productionWarehouseId),
      locationId: text(server.productionLocationId),
      transferPairId: wastePairId,
      rows: wasteRows,
    }) &&
    exactEffectDocument(wasteReceipt[0], movements, {
      id: text(wasteReceipt[0].id),
      role: 'scrap_receipt',
      documentType: 'receipt',
      movementType: 'receipt',
      orderId: input.productionOrderId,
      lineId: text(server.lineId),
      shiftReportId: reportId,
      warehouseId: text(server.productionWarehouseId),
      locationId: scrapLocationId,
      transferPairId: wastePairId,
      rows: wasteRows,
    })
  )
}

/**
 * Convert the authoritative server DTO to the UI model only after verifying
 * every business field that can affect stock, lineage, or idempotent replay.
 */
export async function adaptAuthoritativeShiftReport(
  input: AdaptShiftReportInput,
): Promise<AdaptShiftReportResult> {
  const server = record(input.serverReport)
  if (!server) return { ok: false, error: G3_SHIFT_ACK_INVALID }

  const reportId = text(input.reportId)
  const serverId = text(server.id)
  const number = text(server.number)
  const confirmedAt = text(server.confirmedAt)
  const commandFingerprint = text(server.commandFingerprint)
  const expectedCommandFingerprint = await submittedShiftFingerprint(input)
  const productionWarehouseId = text(server.productionWarehouseId)
  const productionLocationId = text(server.productionLocationId)
  const packagingWarehouseId = text(server.packagingWarehouseId)
  const packagingLocationId = text(server.packagingLocationId ?? server.packLocationId)
  const criticalRevision = finite(input.criticalRevision)
  const previousCriticalRevision = finite(input.previousCriticalRevision) ?? 0

  if (
    !reportId ||
    criticalRevision == null ||
    !Number.isInteger(criticalRevision) ||
    criticalRevision <= 0 ||
    criticalRevision < previousCriticalRevision ||
    (criticalRevision === previousCriticalRevision && input.idempotent !== true) ||
    serverId !== reportId ||
    server.status !== 'confirmed' ||
    !number ||
    !confirmedAt ||
    !expectedCommandFingerprint ||
    commandFingerprint !== expectedCommandFingerprint ||
    text(server.idempotencyKey) !== input.expectedBusinessKey ||
    text(server.orderId ?? server.productionOrderId) !== input.productionOrderId ||
    text(server.lineId) !== text(input.submitted.lineId) ||
    text(server.shiftDate).slice(0, 10) !== text(input.submitted.shiftDate).slice(0, 10) ||
    text(server.shiftSlot ?? server.shift) !== text(input.submitted.shift) ||
    !sameNumber(server.outputMp ?? server.outputM2, input.submitted.outputM2) ||
    !sameNumber(server.outputRolls ?? server.rollCount ?? 0, input.submitted.rollCount ?? 0) ||
    !productionWarehouseId ||
    !productionLocationId ||
    !packagingWarehouseId ||
    !packagingLocationId ||
    productionWarehouseId !== text(input.submitted.productionWarehouseId) ||
    productionLocationId !== text(input.submitted.productionLocationId) ||
    packagingWarehouseId !== text(input.submitted.packagingWarehouseId) ||
    packagingLocationId !== text(input.submitted.packagingLocationId) ||
    text(server.semiFinishedItemId) !== text(input.submitted.semiFinishedItemId) ||
    finite(server.wipContractVersion) !== finite(input.submitted.wipContractVersion) ||
    !exactOptional(
      server.semiFinishedUnitSnapshot,
      input.submitted.semiFinishedUnitSnapshot,
    ) ||
    !exactOptional(server.impregnationQcDecisionId, input.submitted.impregnationQcDecisionId) ||
    !exactOptional(server.batchRunId, input.submitted.batchRunId) ||
    text(server.recipeVersionId) !== text(input.submitted.recipeNormSnapshot.recipeVersionId) ||
    text(server.contentHash) !== text(input.submitted.recipeNormSnapshot.contentHash) ||
    !sameRows(server.actualInputs, input.submitted.materialLines, 'actual') ||
    !sameRows(server.wasteInputs ?? server.wasteLines, input.submitted.wasteLines, 'waste') ||
    !exactAuthoritativeWipGraph(input, server, reportId)
  ) {
    return { ok: false, error: G3_SHIFT_ACK_INVALID }
  }

  if (
    input.correctsReportId &&
    text(server.correctsReportId) !== text(input.correctsReportId)
  ) {
    return { ok: false, error: G3_SHIFT_ACK_INVALID }
  }
  if (
    input.correctionReason &&
    text(server.correctionReason) !== text(input.correctionReason)
  ) {
    return { ok: false, error: G3_SHIFT_ACK_INVALID }
  }

  const production = record(input.production)
  if (!production) return { ok: false, error: G3_SHIFT_ACK_INVALID }
  const authoritativeRows = recordArray(production.shiftReports)
  const authoritativeReports =
    authoritativeRows?.map((row) => projectAuthoritativeShiftReport(row, reportId, production)) ?? []
  const authoritativeIds = authoritativeReports.map((row) => row?.id ?? '')
  const report = canonicalUiShiftReport(server)
  const authoritativeTarget = authoritativeReports.find((row) => row?.id === reportId)
  if (
    !authoritativeRows ||
    authoritativeReports.length !== authoritativeRows.length ||
    authoritativeReports.some((row) => row == null) ||
    new Set(authoritativeIds).size !== authoritativeIds.length ||
    !report ||
    authoritativeIds.filter((id) => id === reportId).length !== 1 ||
    !authoritativeTarget ||
    JSON.stringify(authoritativeTarget) !== JSON.stringify(report)
  ) {
    return { ok: false, error: G3_SHIFT_ACK_INVALID }
  }
  return {
    ok: true,
    report,
    authoritativeReports: authoritativeReports as ProductionShiftReport[],
  }
}

export function canonicalShiftBusinessKey(input: {
  productionOrderId: string
  lineId: string
  shiftDate: string
  shift: string
}): string {
  return [
    'production-shift',
    text(input.productionOrderId),
    text(input.lineId),
    text(input.shiftDate).slice(0, 10),
    text(input.shift) || 'day',
  ].join(':')
}
