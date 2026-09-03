import { verifyBearerToken } from './_qcAuth.mjs'
import { jsonError, jsonOk, readJsonBody } from './_qcHttp.mjs'
import { finalizeAttachment } from './_qcService.mjs'

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
  if (!storeId) {
    jsonError(res, 400, 'invalid_input')
    return
  }

  const result = await finalizeAttachment({
    actor: { uid: auth.uid, email: auth.email, claims: auth.claims },
    storeId,
    lotId: String(body.lotId ?? '').trim() || undefined,
    attachmentId: String(body.attachmentId ?? '').trim() || undefined,
    idempotencyKey: String(body.idempotencyKey ?? '').trim() || undefined,
  })

  if (!result.ok) {
    jsonError(res, result.status ?? 400, result.error)
    return
  }

  jsonOk(res, { ok: true, attachment: result.attachment })
}
