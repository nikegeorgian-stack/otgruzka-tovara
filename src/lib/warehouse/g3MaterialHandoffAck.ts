import type {
  HandoffLineInput,
} from './productionMaterialHandoff'
import {
  canonicalG3MaterialHandoffPayload,
  formatG3MaterialHandoffFingerprint,
  G3_MATERIAL_HANDOFF_ACK_MISMATCH,
  validateG3MaterialHandoffProjection,
  type G3MaterialHandoffCommandType,
} from './g3MaterialHandoffIntegrityCore.mjs'

export type G3MaterialHandoffAck = {
  criticalRevision?: number
  idempotent?: boolean
  orderId?: string
  lineId?: string
  kind?: 'issue' | 'return'
  rawWarehouseId?: string
  transferPairId?: string
  reservationDocumentId?: string
  sourceTransferPairIds?: string[]
  idempotencyKey?: string
  commandFingerprint?: string
  documentIds?: string[]
  warehouse?: unknown
  production?: unknown
}

export type G3MaterialHandoffAckExpected = {
  commandType: G3MaterialHandoffCommandType
  orderId: string
  lineId: string
  rawWarehouseId: string
  reservationDocumentId?: string
  reason?: string
  lines: readonly HandoffLineInput[]
  idempotencyKey: string
  previousCriticalRevision: unknown
}

export type ValidatedG3MaterialHandoffAck = {
  ok: true
  documentIds: string[]
  transferPairId: string
  handoffId: string
  sourceTransferPairIds: string[]
  criticalRevision: number
  commandFingerprint: string
}

async function browserSha256(payload: string): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle
    if (!subtle) return null
    const digest = await subtle.digest(
      'SHA-256',
      new TextEncoder().encode(payload),
    )
    return [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('')
  } catch {
    return null
  }
}

export async function g3MaterialHandoffCommandFingerprint(
  commandType: G3MaterialHandoffCommandType,
  command: Record<string, unknown>,
): Promise<string | null> {
  const digest = await browserSha256(
    canonicalG3MaterialHandoffPayload(commandType, command),
  )
  return digest ? formatG3MaterialHandoffFingerprint(digest) : null
}

export async function validateG3MaterialHandoffAck(
  data: G3MaterialHandoffAck,
  expected: G3MaterialHandoffAckExpected,
): Promise<
  | ValidatedG3MaterialHandoffAck
  | { ok: false; error: typeof G3_MATERIAL_HANDOFF_ACK_MISMATCH }
> {
  const criticalRevision = Number(data?.criticalRevision)
  const previousCriticalRevision = Number(expected.previousCriticalRevision)
  const idempotent = data?.idempotent === true
  if (
    !Number.isInteger(criticalRevision) ||
    criticalRevision <= 0 ||
    !Number.isInteger(previousCriticalRevision) ||
    previousCriticalRevision < 0 ||
    (idempotent
      ? criticalRevision < previousCriticalRevision
      : criticalRevision <= previousCriticalRevision)
  ) {
    return { ok: false, error: G3_MATERIAL_HANDOFF_ACK_MISMATCH }
  }

  const command = {
    orderId: expected.orderId,
    lineId: expected.lineId,
    rawWarehouseId: expected.rawWarehouseId,
    reservationDocumentId: expected.reservationDocumentId,
    reason: expected.reason,
    overReserveReason:
      expected.commandType === 'production.material.issueToLine'
        ? expected.reason
        : undefined,
    lines: expected.lines.map((line) => ({
      itemId: line.itemId,
      quantity: line.quantity,
      batchNo: line.batchNo,
      expiryDate: line.expiryDate,
    })),
  }
  const commandFingerprint = await g3MaterialHandoffCommandFingerprint(
    expected.commandType,
    command,
  )
  if (!commandFingerprint) {
    return { ok: false, error: G3_MATERIAL_HANDOFF_ACK_MISMATCH }
  }
  const validated = validateG3MaterialHandoffProjection(data, {
    ...command,
    commandType: expected.commandType,
    idempotencyKey: expected.idempotencyKey,
    commandFingerprint,
    submittedLines: command.lines,
  })
  if (!validated.ok) return validated
  return {
    ...validated,
    criticalRevision,
    commandFingerprint,
  }
}
