export const G3_MATERIAL_HANDOFF_ACK_MISMATCH: string
export const G3_MATERIAL_HANDOFF_FINGERPRINT_PREFIX: string

export type G3MaterialHandoffCommandType =
  | 'production.material.issueToLine'
  | 'production.material.returnFromLine'

export type CanonicalG3MaterialHandoffLine = {
  itemId: string
  quantity: number | null
  batchNo: string
  expiryDate: string
}

export function materialHandoffKind(
  commandType: unknown,
): 'issue' | 'return' | ''
export function canonicalG3MaterialHandoffLines(
  lines: unknown,
): CanonicalG3MaterialHandoffLine[]
export function canonicalG3MaterialHandoffCommand(
  commandType: unknown,
  command: unknown,
): {
  version: 1
  commandType: string
  orderId: string
  lineId: string
  rawWarehouseId: string
  reservationDocumentId: string
  reason: string
  lines: CanonicalG3MaterialHandoffLine[]
}
export function canonicalG3MaterialHandoffPayload(
  commandType: unknown,
  command: unknown,
): string
export function formatG3MaterialHandoffFingerprint(
  hexDigest: unknown,
): string
export function validateG3MaterialHandoffProjection(
  data: unknown,
  expected: unknown,
):
  | {
      ok: true
      documentIds: string[]
      transferPairId: string
      handoffId: string
      sourceTransferPairIds: string[]
    }
  | { ok: false; error: string }
