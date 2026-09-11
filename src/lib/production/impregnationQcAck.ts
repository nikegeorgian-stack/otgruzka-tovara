import {
  resolveImpregnationQcDecisionStream,
  type AuthoritativeImpregnationQcCommand,
  type AuthoritativeImpregnationQcDecisionSnapshot,
  type ConfirmedImpregnationMixerBatch,
} from '@/lib/technologist/types'

export const IMPREGNATION_QC_ACK_MISMATCH = 'impregnation_qc_ack_mismatch' as const

type Row = Record<string, unknown>

function text(value: unknown): string {
  return String(value ?? '').trim()
}

function nullableText(value: unknown): string | null {
  const valueText = text(value)
  return valueText || null
}

function canonicalCommand(command: AuthoritativeImpregnationQcCommand) {
  const revision = Number(command.decisionRevision ?? 1)
  return {
    decisionKey: text(command.decisionKey),
    productionOrderId: text(command.productionOrderId),
    productionLineId: text(command.productionLineId),
    batchRunId: text(command.batchRunId),
    batchReceiptDocumentId: nullableText(command.batchReceiptDocumentId),
    outputWarehouseItemId: text(command.outputWarehouseItemId),
    labStatus: text(command.labStatus),
    decision: text(command.decision),
    decisionMethod: text(command.decisionMethod),
    visualOk: command.visualOk === true,
    reason: text(command.reason),
    sourceQcRecordId: nullableText(command.sourceQcRecordId),
    labEvidenceFingerprint: nullableText(command.labEvidenceFingerprint),
    decisionRevision:
      Number.isInteger(revision) && revision >= 1 ? revision : null,
    supersedesDecisionId: nullableText(command.supersedesDecisionId),
    supersessionReason: nullableText(command.supersessionReason),
  }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(',')}]`
  const record = value as Row
  const keys = Object.keys(record).sort()
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`
}

function isPlainRecord(value: unknown): value is Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function strictRows(value: unknown): { ok: true; rows: Row[] } | { ok: false } {
  if (!Array.isArray(value) || !value.every(isPlainRecord)) return { ok: false }
  return { ok: true, rows: value }
}

function sameOptionalText(left: unknown, right: unknown): boolean {
  return text(left) === text(right)
}

function sameNumber(left: unknown, right: unknown): boolean {
  const a = Number(left)
  const b = Number(right)
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9
}

async function sha256Hex(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return ''
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Same canonical SHA-256 used by the authoritative G3 reducer. */
export async function impregnationQcCommandFingerprint(
  command: AuthoritativeImpregnationQcCommand,
): Promise<string> {
  return sha256Hex(stableJson(canonicalCommand(command)))
}

function fail(reason: string) {
  return { ok: false as const, error: IMPREGNATION_QC_ACK_MISMATCH, reason }
}

/**
 * Prove the full authoritative QC decision stream before mirroring it locally.
 * A top-level success flag, toast, or echoed decision fields are insufficient.
 */
export async function validateImpregnationQcMutationAck(input: {
  ack: Row
  command: AuthoritativeImpregnationQcCommand
  previousCriticalRevision?: number
}) {
  const { ack, command } = input
  const criticalRevision = Number(ack.criticalRevision)
  const previousCriticalRevision = Math.max(
    0,
    Number(input.previousCriticalRevision) || 0,
  )
  if (!Number.isInteger(criticalRevision) || criticalRevision <= 0) {
    return fail('critical_revision_missing')
  }
  if (criticalRevision < previousCriticalRevision) return fail('critical_revision_stale')
  if (criticalRevision === previousCriticalRevision && ack.idempotent !== true) {
    return fail('critical_revision_not_advanced')
  }
  // A QC disposition changes only the production decision stream. Never let a
  // successful QC response smuggle a warehouse projection into the local store.
  if (ack.touchesWarehouse !== false) return fail('warehouse_mutation_not_allowed')

  const expectedFingerprint = await impregnationQcCommandFingerprint(command)
  if (!expectedFingerprint || text(ack.commandFingerprint) !== expectedFingerprint) {
    return fail('command_fingerprint_mismatch')
  }

  const decisionId = text(ack.decisionId)
  const batchIssueDocumentId = text(ack.batchIssueDocumentId)
  const batchNo = text(ack.batchNo)
  const outputQuantity = Number(ack.outputQuantity)
  const actorUid = text(ack.actorUid)
  const decidedAt = text(ack.decidedAt)
  if (
    !decisionId ||
    !batchIssueDocumentId ||
    !batchNo ||
    !Number.isFinite(outputQuantity) ||
    outputQuantity <= 0 ||
    !actorUid ||
    !decidedAt
  ) {
    return fail('authoritative_identity_missing')
  }

  const production = isPlainRecord(ack.production) ? ack.production : null
  if (!production) return fail('production_projection_missing')
  const decisionRows = strictRows(production.impregnationQcDecisions)
  if (!decisionRows.ok) return fail('decision_projection_shape_invalid')
  const decisions = decisionRows.rows
  const keyMatches = decisions.filter(
    (row) => text(row.decisionKey) === text(command.decisionKey),
  )
  const idMatches = decisions.filter(
    (row) => text(row.id ?? row.decisionId) === decisionId,
  )
  if (keyMatches.length !== 1 || idMatches.length !== 1 || keyMatches[0] !== idMatches[0]) {
    return fail('decision_projection_not_unique')
  }
  const row = keyMatches[0]

  const exactCommandFields =
    text(row.decisionKey) === text(command.decisionKey) &&
    Number(row.decisionRevision) === Number(command.decisionRevision) &&
    text(row.productionOrderId) === text(command.productionOrderId) &&
    text(row.productionLineId) === text(command.productionLineId) &&
    text(row.batchRunId) === text(command.batchRunId) &&
    text(row.batchReceiptDocumentId) === text(command.batchReceiptDocumentId) &&
    text(row.outputWarehouseItemId) === text(command.outputWarehouseItemId) &&
    text(row.labStatus) === text(command.labStatus) &&
    text(row.decision) === text(command.decision) &&
    text(row.decisionMethod) === text(command.decisionMethod) &&
    row.visualOk === (command.visualOk === true) &&
    sameOptionalText(row.reason, command.reason) &&
    sameOptionalText(row.sourceQcRecordId, command.sourceQcRecordId) &&
    sameOptionalText(row.labEvidenceFingerprint, command.labEvidenceFingerprint) &&
    sameOptionalText(row.supersedesDecisionId, command.supersedesDecisionId) &&
    sameOptionalText(row.supersessionReason, command.supersessionReason)

  const exactAuthoritativeFields =
    text(row.id ?? row.decisionId) === decisionId &&
    text(row.batchIssueDocumentId) === batchIssueDocumentId &&
    text(row.batchNo) === batchNo &&
    sameNumber(row.outputQuantity, outputQuantity) &&
    text(row.commandFingerprint) === expectedFingerprint &&
    text(row.actorUid) === actorUid &&
    text(row.decidedAt) === decidedAt &&
    row.effective === true &&
    !text(row.supersededByDecisionId)

  const exactTopLevel =
    text(ack.decisionKey) === text(command.decisionKey) &&
    Number(ack.decisionRevision) === Number(command.decisionRevision) &&
    text(ack.productionOrderId) === text(command.productionOrderId) &&
    text(ack.productionLineId) === text(command.productionLineId) &&
    text(ack.batchRunId) === text(command.batchRunId) &&
    text(ack.batchReceiptDocumentId) === text(command.batchReceiptDocumentId) &&
    text(ack.outputWarehouseItemId) === text(command.outputWarehouseItemId) &&
    text(ack.labStatus) === text(command.labStatus) &&
    text(ack.decision) === text(command.decision) &&
    text(ack.decisionMethod) === text(command.decisionMethod) &&
    sameOptionalText(ack.supersedesDecisionId, command.supersedesDecisionId) &&
    sameOptionalText(ack.supersessionReason, command.supersessionReason) &&
    ack.effective === true &&
    !text(ack.supersededByDecisionId) &&
    ack.lineReady === (command.decision === 'approved')

  if (!exactCommandFields || !exactAuthoritativeFields || !exactTopLevel) {
    return fail('decision_payload_mismatch')
  }

  const batch: ConfirmedImpregnationMixerBatch = {
    batchRunId: text(command.batchRunId),
    batchNo,
    batchIssueDocumentId,
    batchReceiptDocumentId: text(command.batchReceiptDocumentId),
    productionOrderId: text(command.productionOrderId),
    productionOrderNumber: text(command.productionOrderId),
    productionLineId: text(command.productionLineId),
    outputWarehouseItemId: text(command.outputWarehouseItemId),
    outputQuantity,
    recipeId: 'authoritative-ack',
    recipeCode: 'authoritative-ack',
    recipeName: 'authoritative-ack',
  }
  const stream = resolveImpregnationQcDecisionStream(
    decisions as unknown as AuthoritativeImpregnationQcDecisionSnapshot[],
    batch,
  )
  if (
    !stream.ok ||
    text(stream.current?.id ?? stream.current?.decisionId) !== decisionId ||
    Number(stream.current?.decisionRevision) !== Number(command.decisionRevision)
  ) {
    return fail('decision_stream_invalid')
  }

  return {
    ok: true as const,
    criticalRevision,
    decisionId,
    batchIssueDocumentId,
    batchNo,
    outputQuantity,
    actorUid,
    decidedAt,
    commandFingerprint: expectedFingerprint,
  }
}
