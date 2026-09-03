import { verifyBearerToken } from './_qcAuth.mjs'
import { jsonError, jsonOk, readJsonBody } from './_qcHttp.mjs'
import { applyShipment } from './_qcService.mjs'

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
  const storeId = String(body.storeId ?? '').trim()
  const lotId = String(body.lotId ?? '').trim()
  const quantity = Number(body.quantity)
  if (!storeId || !lotId || !Number.isFinite(quantity)) {
    jsonError(res, 400, 'invalid_input')
    return
  }

  const result = await applyShipment({
    actor: { uid: auth.uid, email: auth.email, claims: auth.claims },
    storeId,
    lotId,
    quantity,
    finishedProductId: String(body.finishedProductId ?? '').trim() || undefined,
    warehouseItemId: String(body.warehouseItemId ?? '').trim() || undefined,
    idempotencyKey: String(body.idempotencyKey ?? '').trim() || undefined,
  })

  if (!result.ok) {
    jsonError(res, result.status ?? 400, result.error)
    return
  }

  jsonOk(res, { ok: true, lot: result.lot, decision: result.decision, quantity: result.quantity })
}
