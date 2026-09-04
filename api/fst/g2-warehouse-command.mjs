/**
 * PHASE G2 — unified typed warehouse command gateway.
 * Body: { storeId, idempotencyKey, commandType, command }
 * Rejects arbitrary payloadJson / warehousePatch / fullStore.
 */
import { verifyBearerToken } from './_qcAuth.mjs'
import { jsonError, jsonOk, readJsonBody } from './_qcHttp.mjs'
import { executeG2Command } from './_g2WarehouseService.mjs'
import { G2_MAX_BODY_BYTES } from './_g1CriticalHelpers.mjs'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    jsonError(res, 405, 'method_not_allowed')
    return
  }

  const auth = await verifyBearerToken(req)
  if (!auth.ok) {
    jsonError(res, auth.status, auth.error)
    return
  }

  const contentLength = Number(req.headers?.['content-length'] ?? 0)
  if (Number.isFinite(contentLength) && contentLength > G2_MAX_BODY_BYTES) {
    jsonError(res, 413, 'body_too_large')
    return
  }

  let body
  try {
    body = await readJsonBody(req)
  } catch {
    jsonError(res, 400, 'invalid_json')
    return
  }

  const result = await executeG2Command({
    actor: { uid: auth.uid, email: auth.email, claims: auth.claims },
    storeId: body.storeId,
    idempotencyKey: body.idempotencyKey,
    commandType: body.commandType,
    command: body.command,
    // Explicitly pass-through forged fields so service can reject them:
    payloadJson: body.payloadJson,
    warehousePatch: body.warehousePatch,
    fullStore: body.fullStore,
  })

  if (!result.ok) {
    jsonError(res, result.status ?? 400, result.error)
    return
  }

  jsonOk(res, { ok: true, ...result })
}
