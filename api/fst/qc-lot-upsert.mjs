import { verifyBearerToken } from './_qcAuth.mjs'
import { jsonError, jsonOk, readJsonBody } from './_qcHttp.mjs'
import { upsertLotProjection } from './_qcService.mjs'

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
  const id = String(body.id ?? body.lotId ?? '').trim()
  const storeId = String(body.storeId ?? '').trim()
  const finishedProductId = String(body.finishedProductId ?? '').trim()
  const warehouseItemId = String(body.warehouseItemId ?? '').trim()
  const batchNo = String(body.batchNo ?? '').trim()
  const packagingReportId = String(body.packagingReportId ?? '').trim()
  const quantityProduced = Number(body.quantityProduced)
  if (!id || !storeId || !finishedProductId || !warehouseItemId || !batchNo || !packagingReportId) {
    jsonError(res, 400, 'invalid_input')
    return
  }
  if (!Number.isFinite(quantityProduced)) {
    jsonError(res, 400, 'invalid_input')
    return
  }

  const result = await upsertLotProjection({
    actor: { uid: auth.uid, email: auth.email, claims: auth.claims },
    id,
    storeId,
    finishedProductId,
    warehouseItemId,
    batchNo,
    quantityProduced,
    quantityShipped: Number(body.quantityShipped ?? 0),
    packagingReportId,
    status: String(body.status ?? 'pending').trim() || 'pending',
  })

  if (!result.ok) {
    jsonError(res, result.status ?? 400, result.error)
    return
  }

  jsonOk(res, { ok: true, lot: result.lot })
}
