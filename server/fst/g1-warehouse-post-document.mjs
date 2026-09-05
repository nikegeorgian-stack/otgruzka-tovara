import { verifyBearerToken } from './_qcAuth.mjs'
import { jsonError, jsonOk, readJsonBody } from './_qcHttp.mjs'
import { postWarehouseDocumentCommand } from './_g1WarehouseService.mjs'

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

  const body = await readJsonBody(req)
  const result = await postWarehouseDocumentCommand({
    actor: { uid: auth.uid, email: auth.email, claims: auth.claims },
    storeId: body.storeId,
    idempotencyKey: body.idempotencyKey,
    command: body.command,
    // Explicitly ignore any forged legacy fields:
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
