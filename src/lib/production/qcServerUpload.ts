/**
 * Web QC upload: initiate → signed PUT → finalize → soft QcLotAttachment (stored).
 * Fail-closed client Storage adapter must not be used on VITE_FST_WEB.
 */
import { FST_SHARED_STORE_DOC_ID } from '@/lib/cloud/firestoreSchema'
import {
  assertQcAttachmentAllowed,
  qcAttachmentStoragePath,
  sanitizeQcFilename,
  type QcAttachmentUploadInput,
  type QcLotAttachment,
} from '@/lib/production/qcAttachments'
import {
  qcUploadFinalize,
  qcUploadInitiate,
  type QcUploadSession,
} from '@/lib/production/qcServerClient'

/** RFC 1321 MD5 → standard base64 (matches GCS object md5Hash). */
export function md5Base64(bytes: ArrayBuffer | Uint8Array): string {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  // Compact MD5 (public-domain style) — Web Crypto has no MD5.
  const s = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
    14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15,
    21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ]
  const K = new Uint32Array(64)
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0

  function rotl(x: number, n: number) {
    return (x << n) | (x >>> (32 - n))
  }

  const len = data.length
  const bitLen = len * 8
  const withPad = ((len + 8) >>> 6 << 4) + 16
  const words = new Uint32Array(withPad)
  for (let i = 0; i < len; i++) words[i >> 2] |= data[i] << ((i % 4) * 8)
  words[len >> 2] |= 0x80 << ((len % 4) * 8)
  words[withPad - 2] = bitLen

  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476

  for (let i = 0; i < words.length; i += 16) {
    let A = a0
    let B = b0
    let C = c0
    let D = d0
    for (let j = 0; j < 64; j++) {
      let F: number
      let g: number
      if (j < 16) {
        F = (B & C) | (~B & D)
        g = j
      } else if (j < 32) {
        F = (D & B) | (~D & C)
        g = (5 * j + 1) % 16
      } else if (j < 48) {
        F = B ^ C ^ D
        g = (3 * j + 5) % 16
      } else {
        F = C ^ (B | ~D)
        g = (7 * j) % 16
      }
      const tmp = D
      D = C
      C = B
      B = (B + rotl((A + F + K[j] + words[i + g]) >>> 0, s[j])) >>> 0
      A = tmp
    }
    a0 = (a0 + A) >>> 0
    b0 = (b0 + B) >>> 0
    c0 = (c0 + C) >>> 0
    d0 = (d0 + D) >>> 0
  }

  const out = new Uint8Array(16)
  const regs = [a0, b0, c0, d0]
  for (let i = 0; i < 4; i++) {
    out[i * 4] = regs[i] & 0xff
    out[i * 4 + 1] = (regs[i] >>> 8) & 0xff
    out[i * 4 + 2] = (regs[i] >>> 16) & 0xff
    out[i * 4 + 3] = (regs[i] >>> 24) & 0xff
  }
  let bin = ''
  for (let i = 0; i < out.length; i++) bin += String.fromCharCode(out[i])
  return btoa(bin)
}

function asUint8Array(bytes: ArrayBuffer | Uint8Array): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
}

async function putSignedUpload(session: QcUploadSession, bytes: Uint8Array): Promise<void> {
  const headers: Record<string, string> = { ...(session.headers ?? {}) }
  if (!headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = session.contentType || 'application/pdf'
  }
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const res = await fetch(session.uploadUrl, {
    method: session.method || 'PUT',
    headers,
    body: ab,
  })
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`qc_signed_put_failed:${res.status}`)
  }
}

export type QcServerUploadResult =
  | { ok: true; attachment: QcLotAttachment }
  | { ok: false; error: string }

/**
 * Authoritative web upload path. Soft store projection only after SQL finalize=verified.
 */
export async function uploadQcAttachmentViaServer(
  input: QcAttachmentUploadInput,
): Promise<QcServerUploadResult> {
  const gate = assertQcAttachmentAllowed(input.documentKind, input.mimeType, input.sizeBytes)
  if (!gate.ok) return { ok: false, error: gate.error }

  if (!input.bytes || asUint8Array(input.bytes).byteLength === 0) {
    return { ok: false, error: 'production.qc.errAttachmentEmpty' }
  }
  const bytes = asUint8Array(input.bytes)
  if (bytes.byteLength !== input.sizeBytes) {
    return { ok: false, error: 'production.qc.errAttachmentSize' }
  }

  const storeId = input.storeDocId ?? FST_SHARED_STORE_DOC_ID
  const checksum = md5Base64(bytes)
  const attachmentId = input.attachmentId
  const idempotencyKey = `qc-ui-upload::${input.lotId}::${input.documentKind}::${checksum}`

  const init = await qcUploadInitiate({
    storeId,
    lotId: input.lotId,
    documentKind: input.documentKind,
    contentType: input.mimeType,
    sizeBytes: input.sizeBytes,
    checksum,
    attachmentId,
    idempotencyKey,
  })
  if (!init.ok) return { ok: false, error: init.message || init.error }

  const serverAtt = init.data.attachment as {
    id?: string
    storagePath?: string
    status?: string
    checksum?: string
    sizeBytes?: number
  } | null
  const upload = init.data.upload as QcUploadSession | null | undefined

  if (serverAtt?.status === 'verified' && serverAtt.id) {
    return {
      ok: true,
      attachment: {
        id: serverAtt.id,
        lotId: input.lotId,
        documentKind: input.documentKind,
        originalFilename: input.originalFilename,
        displayName: sanitizeQcFilename(input.originalFilename),
        mimeType: input.mimeType,
        sizeBytes: Number(serverAtt.sizeBytes ?? input.sizeBytes),
        checksum: String(serverAtt.checksum ?? checksum),
        storagePath:
          String(serverAtt.storagePath ?? '') ||
          qcAttachmentStoragePath(storeId, input.lotId, serverAtt.id),
        uploadedBy: input.uploadedBy,
        uploadedAt: new Date().toISOString(),
        uploadStatus: 'stored',
        version: 1,
        customerOrderId: input.customerOrderId,
      },
    }
  }

  if (!upload?.uploadUrl || !serverAtt?.id) {
    return { ok: false, error: 'qc_upload_session_missing' }
  }

  await putSignedUpload(upload, bytes)

  const fin = await qcUploadFinalize({
    storeId,
    lotId: input.lotId,
    attachmentId: serverAtt.id,
    idempotencyKey,
  })
  if (!fin.ok) return { ok: false, error: fin.message || fin.error }

  const verified = fin.data.attachment as {
    id?: string
    storagePath?: string
    checksum?: string
    sizeBytes?: number
    status?: string
  }
  if (verified?.status && verified.status !== 'verified') {
    return { ok: false, error: `qc_finalize_status:${verified.status}` }
  }
  const id = String(verified?.id || serverAtt.id)
  return {
    ok: true,
    attachment: {
      id,
      lotId: input.lotId,
      documentKind: input.documentKind,
      originalFilename: input.originalFilename,
      displayName: sanitizeQcFilename(input.originalFilename),
      mimeType: input.mimeType,
      sizeBytes: Number(verified?.sizeBytes ?? input.sizeBytes),
      checksum: String(verified?.checksum ?? checksum),
      storagePath:
        String(verified?.storagePath ?? serverAtt.storagePath ?? '') ||
        qcAttachmentStoragePath(storeId, input.lotId, id),
      uploadedBy: input.uploadedBy,
      uploadedAt: new Date().toISOString(),
      uploadStatus: 'stored',
      version: 1,
      customerOrderId: input.customerOrderId,
    },
  }
}

export function isWebQcServerUploadPath(): boolean {
  return (
    typeof import.meta !== 'undefined' &&
    Boolean((import.meta as ImportMeta & { env?: { VITE_FST_WEB?: string } }).env?.VITE_FST_WEB === 'true')
  )
}
