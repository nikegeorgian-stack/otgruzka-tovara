/**
 * PHASE G5 — typed sales / planning (MRP) / procurement command gateway.
 * Body: { storeId, idempotencyKey, commandType, command }
 * Rejects arbitrary payloadJson / warehousePatch / fullStore.
 * Path: /api/fst/g5-planning-command
 */
import { verifyBearerToken } from './_qcAuth.mjs'
import { jsonError, jsonOk, readJsonBody, rejectCrossOriginBrowser } from './_qcHttp.mjs'
import { executeG5Command } from './_g5SalesProcurementService.mjs'
import { G2_MAX_BODY_BYTES } from './_g1CriticalHelpers.mjs'

export default async function handler(req, res) {
  if (rejectCrossOriginBrowser(req, res)) return

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

  const result = await executeG5Command({
    actor: { uid: auth.uid, email: auth.email, claims: auth.claims },
    storeId: body.storeId,
    idempotencyKey: body.idempotencyKey,
    commandType: body.commandType,
    command: body.command,
    payloadJson: body.payloadJson,
    warehousePatch: body.warehousePatch,
    fullStore: body.fullStore,
    roleId: body.roleId,
  })

  if (!result.ok) {
    jsonError(res, result.status ?? 400, result.error)
    return
  }

  jsonOk(res, { ok: true, ...result })
}
