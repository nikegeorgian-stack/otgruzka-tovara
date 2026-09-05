import { verifyBearerToken } from './_qcAuth.mjs'
import { jsonError, jsonOk, readJsonBody, rejectCrossOriginBrowser } from './_qcHttp.mjs'
import { initiateAttachment } from './_qcService.mjs'

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

  const body = await readJsonBody(req)
  const storeId = String(body.storeId ?? '').trim()
  const lotId = String(body.lotId ?? '').trim()
  const documentKind = String(body.documentKind ?? '').trim()
  const contentType = String(body.contentType ?? '').trim()
  const sizeBytes = Number(body.sizeBytes)
  const checksum = String(body.checksum ?? '').trim()
  if (!storeId || !lotId || !documentKind || !contentType || !checksum || !Number.isFinite(sizeBytes)) {
    jsonError(res, 400, 'invalid_input')
    return
  }

  const result = await initiateAttachment({
    actor: { uid: auth.uid, email: auth.email, claims: auth.claims },
    storeId,
    lotId,
    documentKind,
    contentType,
    sizeBytes,
    checksum,
    attachmentId: String(body.attachmentId ?? '').trim() || undefined,
    storagePath: String(body.storagePath ?? '').trim() || undefined,
    idempotencyKey: String(body.idempotencyKey ?? '').trim() || undefined,
  })

  if (!result.ok) {
    jsonError(res, result.status ?? 400, result.error)
    return
  }

  jsonOk(res, {
    ok: true,
    attachment: result.attachment,
    upload: result.upload ?? null,
  })
}
