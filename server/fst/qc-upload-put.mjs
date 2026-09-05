/**
 * Issues a short-lived Storage write session for an initiated QC attachment.
 * Does NOT accept file bytes — Vercel function body limit is 4.5 MiB; QC PDF max is 10 MiB.
 * Browser must PUT directly to the returned uploadUrl.
 */
import { verifyBearerToken } from './_qcAuth.mjs'
import { jsonError, jsonOk, readJsonBody } from './_qcHttp.mjs'
import { getQcAttachmentRecord, getQcDataConnect } from './_qcDataConnect.mjs'
import { requireActivePermission } from './_qcService.mjs'
import { createSignedUploadSession } from './_qcStorage.mjs'

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
  const attachmentId = String(body.attachmentId ?? '').trim()
  if (!storeId || !attachmentId) {
    jsonError(res, 400, 'invalid_input')
    return
  }
  // Reject any attempt to proxy binary through this endpoint.
  if (body.bytesBase64 != null || body.bytes != null || body.file != null) {
    jsonError(res, 400, 'binary_proxy_forbidden')
    return
  }

  const permission = await requireActivePermission(auth.uid, storeId, 'canUpload')
  if (!permission.ok) {
    jsonError(res, permission.status ?? 403, permission.error)
    return
  }

  const dc = getQcDataConnect()
  const { data } = await getQcAttachmentRecord(dc, { id: attachmentId })
  const record = data?.qcAttachmentRecord ?? null
  if (!record || record.storeId !== storeId) {
    jsonError(res, 404, 'not_found')
    return
  }
  if (record.status === 'verified') {
    jsonOk(res, { ok: true, alreadyVerified: true, storagePath: record.storagePath })
    return
  }

  const session = await createSignedUploadSession({
    storagePath: record.storagePath,
    contentType: record.contentType,
    sizeBytes: record.sizeBytes,
    checksum: record.checksum,
  })
  if (!session.ok) {
    jsonError(res, 400, session.error)
    return
  }

  // Do not echo checksum into durable logs; response is ephemeral client-only.
  jsonOk(res, {
    ok: true,
    upload: {
      method: session.method,
      uploadUrl: session.uploadUrl,
      storagePath: session.storagePath,
      contentType: session.contentType,
      expiresAt: session.expiresAt,
      headers: session.headers,
      maxBytes: record.sizeBytes,
    },
  })
}
