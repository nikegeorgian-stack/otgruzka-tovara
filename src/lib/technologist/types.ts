/** Технолог · контроль качества (логика из Excel EAD / входной / пропитка) */

import type { FormulationStore } from '@/lib/formulations/types'
import type { ProductionOrder } from '@/lib/planner/types'
import type { WarehouseStore } from '@/lib/warehouse/types'

export type CellSizeInputMode = 'instrument' | 'manual'

/** m0 — чашка; m1 — с материалом; m2 — с сухим остатком */
export type GravimetricTriple = {
  m0?: number
  m1?: number
  m2?: number
}

export type EadZoneKey = 'edgeLeft' | 'middle' | 'edgeRight'

export type EadCalculationRecord = {
  id: string
  productType: string
  substrateName: string
  manufacturedAt?: string
  testedAt?: string
  cellSizeMode: CellSizeInputMode
  /** Средний размер ячейки суровья — основа / уток (3 замера) */
  substrateCellWarp: number[]
  substrateCellWeft: number[]
  /** Размер открытой ячейки — основа / уток */
  openCellWarp: number[]
  openCellWeft: number[]
  zones: Record<EadZoneKey, GravimetricTriple>
  /** Снимок расчёта на момент сохранения */
  computed: EadCalculationComputed
  note?: string
  createdAt: string
  createdByName?: string
}

export type EadCalculationComputed = {
  substrateCellWarpMm: number | null
  substrateCellWeftMm: number | null
  openCellWarpMm: number | null
  openCellWeftMm: number | null
  zoneH1: Record<EadZoneKey, number | null>
  avgOrganicContent: number | null
  avgResidualMoisture: number | null
}

export type EadControlRecord = {
  id: string
  productType: string
  substrateName: string
  lineId: string
  manufacturedAt?: string
  targetGsm: number
  note?: string
  /** «Л» — левый край (3 замера, ×0,1 г/м²) */
  leftReadings: number[]
  /** «П» — правый край */
  rightReadings: number[]
  computed: EadControlComputed
  createdAt: string
  createdByName?: string
}

export type EadControlComputed = {
  leftAvgGsm: number | null
  rightAvgGsm: number | null
  overallAvgGsm: number | null
  deviationGsm: number | null
  deviationPct: number | null
  status: QcPassStatus
}

export type IncomingMaterialKind = 'chemistry' | 'fabric' | 'other'

export type IncomingControlRecord = {
  id: string
  kind: IncomingMaterialKind
  supplier: string
  containerNo?: string
  itemName: string
  receiptDate?: string
  controlDate?: string
  batchNo?: string
  manufacturedAt?: string
  /** Химия */
  ph?: number
  phMin?: number
  phMax?: number
  drySolidsPct?: number
  passportDrySolidsPct?: number
  /** Суровьё */
  grammageGsm?: number
  cellWarpMm?: number
  cellWeftMm?: number
  strengthWarpN?: number
  strengthWeftN?: number
  resultText?: string
  controllerName?: string
  computed: IncomingControlComputed
  createdAt: string
}

export type IncomingControlComputed = {
  drySolidsDeviationPct: number | null
  phInRange: boolean | null
  status: QcPassStatus
  summary: string
}

export type ImpregnationQcRecord = {
  id: string
  recipeCode?: string
  recipeId?: string
  batchNumber?: string
  /** Exact authoritative mixer / production lineage (absent on legacy soft rows). */
  batchRunId?: string
  batchIssueDocumentId?: string
  batchReceiptDocumentId?: string
  productionOrderId?: string
  productionLineId?: string
  outputWarehouseItemId?: string
  outputQuantity?: number
  manufacturedAt?: string
  controlledAt?: string
  operators?: string
  visualOk?: boolean
  gravimetric: GravimetricTriple
  viscositySec?: number
  viscosityTempC?: number
  theoreticalNvPct?: number
  nvTolerancePp: number
  controllerName?: string
  note?: string
  computed: ImpregnationQcComputed
  /** Lab result and release decision are intentionally separate. */
  labStatus?: QcPassStatus
  decision?: ImpregnationQcDecision
  decisionMethod?: ImpregnationQcDecisionMethod
  decisionReason?: string
  decisionRevision?: number
  effective?: boolean
  supersedesDecisionId?: string
  supersessionReason?: string
  supersededByDecisionId?: string
  supersededAt?: string
  authoritativeDecisionId?: string
  authoritativeDecisionKey?: string
  authoritativeCommandFingerprint?: string
  authoritativeActorUid?: string
  authoritativeDecidedAt?: string
  authoritativeCriticalRevision?: number
  createdAt: string
}

export type ImpregnationQcComputed = {
  nvPct: number | null
  absDeviationPp: number | null
  relDeviation: number | null
  status: QcPassStatus
}

export type QcPassStatus = 'pass' | 'fail' | 'pending'

export type ImpregnationQcDecision = 'approved' | 'rejected'

export type ImpregnationQcDecisionMethod = 'measured' | 'edu_manual_visual'

/** A confirmed mixer batch whose complete authoritative lineage is visible to QC. */
export type ConfirmedImpregnationMixerBatch = {
  batchRunId: string
  batchNo: string
  batchIssueDocumentId: string
  batchReceiptDocumentId: string
  productionOrderId: string
  productionOrderNumber: string
  productionLineId: string
  outputWarehouseItemId: string
  outputQuantity: number
  recipeId: string
  recipeCode: string
  recipeName: string
  mixedAt?: string
  confirmedAt?: string
}

export type AuthoritativeImpregnationProductionOrder = Pick<
  ProductionOrder,
  'id' | 'orderNumber' | 'status' | 'lineId'
> & { wipContractVersion?: 1 }

export type AuthoritativeImpregnationQcCommand = {
  decisionKey: string
  decisionRevision: number
  productionOrderId: string
  productionLineId: string
  batchRunId: string
  batchReceiptDocumentId: string
  outputWarehouseItemId: string
  labStatus: QcPassStatus
  decision: ImpregnationQcDecision
  decisionMethod: ImpregnationQcDecisionMethod
  visualOk: boolean
  reason?: string
  sourceQcRecordId?: string
  labEvidenceFingerprint?: string
  supersedesDecisionId?: string
  supersessionReason?: string
}

export type AuthoritativeImpregnationQcResult =
  | {
      ok: true
      decisionId: string
      decisionKey: string
      decisionRevision: number
      decision: ImpregnationQcDecision
      labStatus: QcPassStatus
      decisionMethod: ImpregnationQcDecisionMethod
      productionOrderId: string
      productionLineId: string
      batchRunId: string
      batchNo: string
      batchIssueDocumentId: string
      batchReceiptDocumentId: string
      outputWarehouseItemId: string
      outputQuantity: number
      supersedesDecisionId?: string
      supersessionReason?: string
      supersededByDecisionId?: string
      supersededAt?: string
      commandFingerprint: string
      actorUid: string
      decidedAt: string
      effective: boolean
      lineReady: boolean
      criticalRevision: number
      idempotent: boolean
    }
  | { ok: false; error: string }

/** Read-only server stream used to choose the next safe decision revision. */
export type AuthoritativeImpregnationQcDecisionSnapshot = {
  id?: string
  decisionId?: string
  decisionKey: string
  decisionRevision: number
  decision: ImpregnationQcDecision
  labStatus: QcPassStatus
  decisionMethod: ImpregnationQcDecisionMethod
  visualOk?: boolean
  reason?: string
  productionOrderId: string
  productionLineId: string
  batchRunId: string
  batchNo: string
  batchIssueDocumentId: string
  batchReceiptDocumentId: string
  outputWarehouseItemId: string
  outputQuantity: number
  effective?: boolean
  supersedesDecisionId?: string
  supersessionReason?: string
  supersededByDecisionId?: string
  supersededAt?: string
  commandFingerprint?: string
  actorUid?: string
  decidedAt?: string
}

export type AuthorizeImpregnationQcDecision = (
  command: AuthoritativeImpregnationQcCommand,
) => Promise<AuthoritativeImpregnationQcResult>

type LinkedMovement = WarehouseStore['movements'][number] & {
  productionLineId?: string
  batchRunId?: string
  cancelled?: boolean
}

type LinkedDocumentLine = WarehouseStore['documents'][number]['lines'][number] & {
  batchRunId?: string
  productionOrderId?: string
  productionLineId?: string
}

function cleanId(value: unknown): string {
  return String(value ?? '').trim()
}

/** Business-stream key. The decision value is deliberately not part of it. */
export function impregnationQcDecisionKey(batchRunId: unknown, decisionRevision = 1): string {
  const runId = cleanId(batchRunId)
  const revision = Number(decisionRevision)
  if (!runId || !Number.isInteger(revision) || revision < 1) return ''
  return `impregnation-qc:${runId}:v${revision}`
}

export type ImpregnationQcDecisionStreamResolution =
  | {
      ok: true
      current: AuthoritativeImpregnationQcDecisionSnapshot | null
      currentDecisionId?: string
      nextRevision: number
    }
  | { ok: false; error: string }

/** Validate the complete server stream before deriving a superseding revision. */
export function resolveImpregnationQcDecisionStream(
  decisions: AuthoritativeImpregnationQcDecisionSnapshot[],
  batch: ConfirmedImpregnationMixerBatch,
): ImpregnationQcDecisionStreamResolution {
  const history = decisions
    .filter((row) => cleanId(row?.batchRunId) === batch.batchRunId)
    .sort((a, b) => Number(a.decisionRevision) - Number(b.decisionRevision))
  if (history.length === 0) return { ok: true, current: null, nextRevision: 1 }

  const decisionIds = new Set<string>()
  for (let index = 0; index < history.length; index += 1) {
    const row = history[index]
    const rowId = cleanId(row.id ?? row.decisionId)
    const revision = Number(row.decisionRevision)
    const outputQuantity = Number(row.outputQuantity)
    if (!rowId) return { ok: false, error: 'impregnation_qc_current_decision_id_missing' }
    if (decisionIds.has(rowId)) {
      return { ok: false, error: 'impregnation_qc_decision_id_history_ambiguous' }
    }
    decisionIds.add(rowId)
    if (!Number.isInteger(revision) || revision !== index + 1) {
      return { ok: false, error: 'impregnation_qc_revision_history_invalid' }
    }
    if (cleanId(row.decisionKey) !== impregnationQcDecisionKey(batch.batchRunId, revision)) {
      return { ok: false, error: 'impregnation_qc_decision_key_history_invalid' }
    }
    if (
      (row.decision !== 'approved' && row.decision !== 'rejected') ||
      (row.labStatus !== 'pending' && row.labStatus !== 'pass' && row.labStatus !== 'fail') ||
      (row.decisionMethod !== 'measured' && row.decisionMethod !== 'edu_manual_visual')
    ) {
      return { ok: false, error: 'impregnation_qc_decision_status_history_invalid' }
    }
    if (
      cleanId(row.productionOrderId) !== batch.productionOrderId ||
      cleanId(row.productionLineId) !== batch.productionLineId ||
      cleanId(row.batchIssueDocumentId) !== batch.batchIssueDocumentId ||
      cleanId(row.batchReceiptDocumentId) !== batch.batchReceiptDocumentId ||
      cleanId(row.outputWarehouseItemId) !== batch.outputWarehouseItemId ||
      cleanId(row.batchNo) !== batch.batchNo ||
      !Number.isFinite(outputQuantity) ||
      outputQuantity <= 0 ||
      Math.abs(outputQuantity - batch.outputQuantity) > 1e-9
    ) {
      return { ok: false, error: 'impregnation_qc_decision_lineage_history_invalid' }
    }

    const previous = history[index - 1]
    if (!previous) {
      if (cleanId(row.supersedesDecisionId)) {
        return { ok: false, error: 'impregnation_qc_supersession_history_invalid' }
      }
    } else {
      const previousId = cleanId(previous.id ?? previous.decisionId)
      if (
        cleanId(row.supersedesDecisionId) !== previousId ||
        !cleanId(row.supersessionReason) ||
        cleanId(previous.supersededByDecisionId) !== rowId ||
        previous.effective !== false
      ) {
        return { ok: false, error: 'impregnation_qc_supersession_history_invalid' }
      }
    }
  }

  const current = history[history.length - 1]
  if (current.effective === false || cleanId(current.supersededByDecisionId)) {
    return { ok: false, error: 'impregnation_qc_effective_decision_missing' }
  }
  const currentDecisionId = cleanId(current.id ?? current.decisionId)
  return {
    ok: true,
    current,
    currentDecisionId,
    nextRevision: Number(current.decisionRevision) + 1,
  }
}

function exactMixerDocumentMovements(args: {
  document: WarehouseStore['documents'][number]
  allMovements: WarehouseStore['movements']
  expectedType: 'issue' | 'receipt'
  batchRunId: string
  productionOrderId: string
  productionLineId: string
  requireSingleLineAndMovement?: boolean
}): LinkedMovement[] | null {
  const documentId = cleanId(args.document.id)
  const documentWarehouseId = cleanId(args.document.warehouseId)
  const lines = (args.document.lines ?? []) as LinkedDocumentLine[]
  if (!documentId || !documentWarehouseId || lines.length === 0) return null
  if (args.requireSingleLineAndMovement && lines.length !== 1) return null
  if (args.requireSingleLineAndMovement && !cleanId(lines[0]?.locationId)) return null

  const lineIds = lines.map((line) => cleanId(line.lineId))
  if (lineIds.some((lineId) => !lineId) || new Set(lineIds).size !== lineIds.length) return null
  const linesById = new Map(lines.map((line) => [cleanId(line.lineId), line] as const))
  const documentMovements = args.allMovements.filter(
    (movement) => cleanId(movement.documentId) === documentId,
  ) as LinkedMovement[]
  if (documentMovements.length === 0) return null
  if (args.requireSingleLineAndMovement && documentMovements.length !== 1) return null

  const quantityByLineId = new Map<string, number>()
  for (const movement of documentMovements) {
    const documentLineId = cleanId(movement.documentLineId)
    const line = linesById.get(documentLineId)
    const movementQuantity = Number(movement.quantity)
    if (
      movement.type !== args.expectedType ||
      !documentLineId ||
      !line ||
      !cleanId(line.itemId) ||
      cleanId(movement.itemId) !== cleanId(line.itemId) ||
      cleanId(movement.warehouseId) !== documentWarehouseId ||
      (cleanId(line.locationId) &&
        cleanId(movement.locationId) !== cleanId(line.locationId)) ||
      (cleanId(line.batchNo) && cleanId(movement.batchNo) !== cleanId(line.batchNo)) ||
      (cleanId(line.expiryDate).slice(0, 10) &&
        cleanId(movement.expiryDate).slice(0, 10) !== cleanId(line.expiryDate).slice(0, 10)) ||
      cleanId(movement.batchRunId) !== args.batchRunId ||
      cleanId(movement.productionOrderId) !== args.productionOrderId ||
      cleanId(movement.productionLineId) !== args.productionLineId ||
      !Number.isFinite(movementQuantity) ||
      movementQuantity <= 0
    ) {
      return null
    }
    quantityByLineId.set(
      documentLineId,
      (quantityByLineId.get(documentLineId) ?? 0) + movementQuantity,
    )
  }

  for (const line of lines) {
    const lineId = cleanId(line.lineId)
    const lineQuantity = Number(line.quantity)
    const movedQuantity = quantityByLineId.get(lineId)
    if (
      !Number.isFinite(lineQuantity) ||
      lineQuantity <= 0 ||
      movedQuantity == null ||
      Math.abs(movedQuantity - lineQuantity) > 1e-9
    ) {
      return null
    }
  }
  return documentMovements
}

/**
 * Fail-closed UI projection. The server repeats the same checks before CAS; this
 * list only prevents users from selecting free-text or orphaned batches.
 */
export function collectConfirmedImpregnationMixerBatches(
  formulations: Pick<FormulationStore, 'batchRuns'>,
  warehouse: Pick<WarehouseStore, 'documents' | 'movements'>,
  productionOrders: AuthoritativeImpregnationProductionOrder[],
): ConfirmedImpregnationMixerBatch[] {
  const output: ConfirmedImpregnationMixerBatch[] = []
  const runIdCounts = new Map<string, number>()
  for (const run of formulations.batchRuns ?? []) {
    const runId = cleanId(run.id)
    if (runId) runIdCounts.set(runId, (runIdCounts.get(runId) ?? 0) + 1)
  }
  for (const run of formulations.batchRuns ?? []) {
    const batchRunId = cleanId(run.id)
    const productionOrderId = cleanId(run.productionOrderId)
    const productionLineId = cleanId(run.productionLineId)
    const outputWarehouseItemId = cleanId(run.outputWarehouseItemId)
    const runIssueDocumentId = cleanId(run.issueDocumentId)
    const runReceiptDocumentId = cleanId(run.receiptDocumentId)
    if (
      run.status !== 'confirmed' ||
      !batchRunId ||
      runIdCounts.get(batchRunId) !== 1 ||
      !productionOrderId ||
      !productionLineId ||
      !outputWarehouseItemId ||
      !runIssueDocumentId ||
      !runReceiptDocumentId
    ) {
      continue
    }

    const orderMatches = productionOrders.filter(
      (candidate) => cleanId(candidate.id) === productionOrderId,
    )
    if (orderMatches.length !== 1) continue
    const order = orderMatches[0]
    if (order.status !== 'active' || cleanId(order.lineId) !== productionLineId) continue

    const allDocuments = warehouse.documents ?? []
    const allMovements = warehouse.movements ?? []
    const batchDocuments = allDocuments.filter(
      (document) => cleanId(document.batchRunId) === batchRunId,
    )
    const issues = batchDocuments.filter(
      (document) => document.status === 'posted' && document.docRole === 'batch_issue',
    )
    const receipts = batchDocuments.filter(
      (document) => document.status === 'posted' && document.docRole === 'batch_receipt',
    )
    if (issues.length !== 1 || receipts.length !== 1) continue
    const issue = issues[0]
    const receipt = receipts[0]
    if (
      runIssueDocumentId === runReceiptDocumentId ||
      batchDocuments.length !== 2 ||
      issue.type !== 'issue' ||
      receipt.type !== 'receipt' ||
      issue.purpose !== 'production' ||
      receipt.purpose !== 'production' ||
      (issue as typeof issue & { cancelled?: boolean }).cancelled === true ||
      (receipt as typeof receipt & { cancelled?: boolean }).cancelled === true ||
      cleanId(issue.reversalDocumentId) ||
      cleanId(receipt.reversalDocumentId) ||
      cleanId(issue.id) !== runIssueDocumentId ||
      cleanId(receipt.id) !== runReceiptDocumentId ||
      allDocuments.filter((document) => cleanId(document.id) === runIssueDocumentId).length !== 1 ||
      allDocuments.filter((document) => cleanId(document.id) === runReceiptDocumentId).length !== 1 ||
      allDocuments.some(
        (document) =>
          cleanId(document.reversesDocumentId) === runIssueDocumentId ||
          cleanId(document.reversesDocumentId) === runReceiptDocumentId ||
          cleanId(document.cancelledDocumentId) === runIssueDocumentId ||
          cleanId(document.cancelledDocumentId) === runReceiptDocumentId,
      )
    ) {
      continue
    }
    if (
      !cleanId(issue.warehouseId) ||
      !cleanId(receipt.warehouseId) ||
      cleanId(issue.productionOrderId) !== productionOrderId ||
      cleanId(receipt.productionOrderId) !== productionOrderId ||
      cleanId(issue.productionLineId) !== productionLineId ||
      cleanId(receipt.productionLineId) !== productionLineId
    ) {
      continue
    }

    const documentLineageIsExact = (line: LinkedDocumentLine) =>
      cleanId(line.batchRunId) === batchRunId &&
      cleanId(line.productionOrderId) === productionOrderId &&
      cleanId(line.productionLineId) === productionLineId
    const issueLines = (issue.lines ?? []) as LinkedDocumentLine[]
    const receiptLines = (receipt.lines ?? []) as LinkedDocumentLine[]
    const selectedLineIds = [...issueLines, ...receiptLines].map((line) => cleanId(line.lineId))
    if (
      issueLines.length === 0 ||
      receiptLines.length !== 1 ||
      selectedLineIds.some((lineId) => !lineId) ||
      new Set(selectedLineIds).size !== selectedLineIds.length ||
      !issueLines.every(documentLineageIsExact) ||
      !receiptLines.every(documentLineageIsExact) ||
      !cleanId(receiptLines[0]?.locationId)
    ) {
      continue
    }

    const receiptItems = [
      ...new Set(receiptLines.map((line) => cleanId(line.itemId)).filter(Boolean)),
    ]
    if (receiptItems.length !== 1 || receiptItems[0] !== outputWarehouseItemId) continue

    const selectedDocumentIds = new Set([runIssueDocumentId, runReceiptDocumentId])
    const relatedMovements = allMovements.filter(
      (movement) =>
        cleanId((movement as LinkedMovement).batchRunId) === batchRunId ||
        selectedDocumentIds.has(cleanId(movement.documentId)),
    ) as LinkedMovement[]
    const movementIds = relatedMovements.map((movement) => cleanId(movement.id))
    if (
      relatedMovements.some(
        (movement) =>
          movement.cancelled === true ||
          !selectedDocumentIds.has(cleanId(movement.documentId)),
      ) ||
      movementIds.some((movementId) => !movementId) ||
      new Set(movementIds).size !== movementIds.length
    ) {
      continue
    }
    const issueMovements = exactMixerDocumentMovements({
      document: issue,
      allMovements,
      expectedType: 'issue',
      batchRunId,
      productionOrderId,
      productionLineId,
    })
    const receiptMovements = exactMixerDocumentMovements({
      document: receipt,
      allMovements,
      expectedType: 'receipt',
      batchRunId,
      productionOrderId,
      productionLineId,
      requireSingleLineAndMovement: true,
    })
    if (!issueMovements || !receiptMovements) continue

    const receiptWithBatch = receipt as typeof receipt & { batchNo?: string }
    const canonicalBatchNo = cleanId(run.documentNumber)
    if (
      !canonicalBatchNo ||
      cleanId(receiptWithBatch.batchNo) !== canonicalBatchNo ||
      !receiptLines.every((line) => cleanId(line.batchNo) === canonicalBatchNo) ||
      !receiptMovements.every((movement) => cleanId(movement.batchNo) === canonicalBatchNo)
    ) {
      continue
    }

    const outputQuantity = receiptMovements.reduce(
      (sum, movement) => sum + (Number(movement.quantity) || 0),
      0,
    )
    if (
      !(outputQuantity > 0) ||
      !(Number(run.outputKg) > 0) ||
      Math.abs(outputQuantity - Number(run.outputKg)) > 1e-9
    ) {
      continue
    }

    output.push({
      batchRunId,
      batchNo: canonicalBatchNo,
      batchIssueDocumentId: runIssueDocumentId,
      batchReceiptDocumentId: runReceiptDocumentId,
      productionOrderId,
      productionOrderNumber: order.orderNumber,
      productionLineId,
      outputWarehouseItemId,
      outputQuantity,
      recipeId: cleanId(run.recipeId),
      recipeCode: cleanId(run.recipeCode),
      recipeName: cleanId(run.recipeName),
      mixedAt: run.mixedAt || undefined,
      confirmedAt: run.confirmedAt || undefined,
    })
  }
  return output.sort((a, b) =>
    cleanId(b.confirmedAt ?? b.mixedAt).localeCompare(cleanId(a.confirmedAt ?? a.mixedAt)),
  )
}

/** EDU visual approval is exposed only on the exact isolated staging project. */
export function isEduManualVisualUiEnabled(projectId: unknown, requested: boolean): boolean {
  return requested === true && cleanId(projectId) === 'otgruzka-tovara-stg'
}

export type TechnologistQcSettings = {
  defaultNvTolerancePp: number
}

/** Температура и влажность в помещении (журнал по дням). */
export type RoomClimateRecord = {
  id: string
  /** YYYY-MM-DD */
  measuredDate: string
  /** HH:mm */
  measuredTime: string
  temperatureC: number
  humidityPct: number
  roomLabel?: string
  recordedByName?: string
  createdAt: string
}

/** Пересменка технологов: срочность сообщения. */
export type ShiftHandoffUrgency = 'normal' | 'urgent' | 'critical'

export type ShiftHandoffStatus = 'open' | 'closed'

export type ShiftHandoffAck = {
  userId?: string
  userName: string
  at: string
}

/** Передача дел смены → смены (внутренние нюансы, что где использовалось). */
export type ShiftHandoffRecord = {
  id: string
  /** YYYY-MM-DD — день исходящей смены */
  shiftDate: string
  createdAt: string
  updatedAt: string
  authorId?: string
  authorName?: string
  title: string
  body: string
  /** Зона / линия / куб / участок */
  area?: string
  urgency: ShiftHandoffUrgency
  status: ShiftHandoffStatus
  acknowledgements: ShiftHandoffAck[]
}

export type TechnologistQcStore = {
  eadCalculations: EadCalculationRecord[]
  eadControls: EadControlRecord[]
  incomingControls: IncomingControlRecord[]
  impregnationQc: ImpregnationQcRecord[]
  roomClimateLog: RoomClimateRecord[]
  /** Передача дел между сменами технологов */
  shiftHandoffs: ShiftHandoffRecord[]
  settings: TechnologistQcSettings
}
