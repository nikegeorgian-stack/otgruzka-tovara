import { getStorage } from 'firebase-admin/storage'

export const QC_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024
/** Vercel Functions hard request body limit — binary must NOT transit api/fst. */
export const VERCEL_FUNCTION_BODY_LIMIT_BYTES = 4.5 * 1024 * 1024

const ALLOWED_MANDATORY = new Set(['application/pdf'])
const ALLOWED_OPTIONAL = new Set(['application/pdf', 'image/jpeg', 'image/png'])

const memoryObjects = new Map()
const memorySessions = new Map()
let memoryGeneration = 0

function sanitizeIdSegment(value, fallback) {
  const safe = String(value ?? '')
    .replace(/[^a-zA-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return safe || fallback
}

export function buildQcStoragePath(storeId, lotId, attachmentId) {
  return `fstFiles/${sanitizeIdSegment(storeId, 'store')}/qc-lots/${sanitizeIdSegment(
    lotId,
    'lot',
  )}/${sanitizeIdSegment(attachmentId, 'attachment')}/blob`
}

export function assertMime(kind, contentType) {
  const mime = String(contentType ?? '').trim().toLowerCase()
  const allowed = kind === 'other' ? ALLOWED_OPTIONAL : ALLOWED_MANDATORY
  if (!allowed.has(mime)) {
    return { ok: false, error: 'content_type_not_allowed' }
  }
  return { ok: true }
}

export function isTestMemoryMode() {
  return (
    String(process.env.QC_STORAGE_ADAPTER ?? '').trim().toLowerCase() === 'memory' ||
    (process.env.NODE_ENV === 'test' && !String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? '').trim()) ||
    process.env.QC_LOCAL_EMULATOR === '1'
  )
}

export function memoryPutObject(storagePath, entry) {
  const generation = String(entry?.generation ?? ++memoryGeneration)
  memoryObjects.set(storagePath, {
    contentType: String(entry?.contentType ?? 'application/octet-stream'),
    sizeBytes: Number(entry?.sizeBytes ?? 0),
    checksum: String(entry?.checksum ?? ''),
    generation,
    bytes: entry?.bytes ?? null,
  })
  return generation
}

/**
 * Short-lived write session bound to exact storagePath + contentType.
 * Browser uploads PDF directly to Storage — never through Vercel function body.
 */
export async function createSignedUploadSession({
  storagePath,
  contentType,
  sizeBytes,
  checksum,
  expiresInMs = 10 * 60 * 1000,
}) {
  const objectPath = String(storagePath ?? '').trim()
  const mime = String(contentType ?? '').trim().toLowerCase()
  const size = Number(sizeBytes)
  if (!objectPath || !mime) return { ok: false, error: 'invalid_input' }
  if (!Number.isFinite(size) || size <= 0 || size > QC_ATTACHMENT_MAX_BYTES) {
    return { ok: false, error: 'invalid_size' }
  }

  if (isTestMemoryMode()) {
    const token = `mem-${crypto.randomUUID()}`
    const expiresAt = new Date(Date.now() + expiresInMs).toISOString()
    memorySessions.set(token, {
      storagePath: objectPath,
      contentType: mime,
      sizeBytes: size,
      checksum: String(checksum ?? ''),
      expiresAt,
    })
    return {
      ok: true,
      method: 'PUT',
      uploadUrl: `memory://qc-upload/${token}`,
      storagePath: objectPath,
      contentType: mime,
      expiresAt,
      headers: {
        'Content-Type': mime,
        'x-qc-checksum': String(checksum ?? ''),
      },
    }
  }

  try {
    const { initFirebaseAdmin, resolveFirebaseStorageBucket } = await import('./_adminAuth.mjs')
    initFirebaseAdmin()
    const bucketName = resolveFirebaseStorageBucket()
    const bucket = bucketName ? getStorage().bucket(bucketName) : getStorage().bucket()
    const file = bucket.file(objectPath)
    const expires = Date.now() + expiresInMs
    const [uploadUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires,
      contentType: mime,
      extensionHeaders: {
        'x-goog-if-generation-match': '0',
      },
    })
    return {
      ok: true,
      method: 'PUT',
      uploadUrl,
      storagePath: objectPath,
      contentType: mime,
      expiresAt: new Date(expires).toISOString(),
      headers: {
        'Content-Type': mime,
        // Must match extensionHeaders used when signing the URL.
        'x-goog-if-generation-match': '0',
      },
    }
  } catch {
    return { ok: false, error: 'storage_unavailable' }
  }
}

/** Test/local helper: redeem memory signed session without Vercel body proxy. */
export function redeemMemorySignedUpload({ uploadUrl, bytes, contentType, checksum }) {
  const match = String(uploadUrl ?? '').match(/^memory:\/\/qc-upload\/(.+)$/)
  if (!match) return { ok: false, error: 'invalid_session' }
  const session = memorySessions.get(match[1])
  if (!session) return { ok: false, error: 'session_not_found' }
  if (Date.parse(session.expiresAt) < Date.now()) return { ok: false, error: 'session_expired' }
  if (String(contentType ?? '').toLowerCase() !== session.contentType) {
    return { ok: false, error: 'content_type_mismatch' }
  }
  if (checksum && checksum !== session.checksum) return { ok: false, error: 'checksum_mismatch' }
  const sizeBytes = bytes?.byteLength ?? bytes?.length ?? 0
  if (sizeBytes !== session.sizeBytes) return { ok: false, error: 'size_mismatch' }
  const generation = memoryPutObject(session.storagePath, {
    contentType: session.contentType,
    sizeBytes,
    checksum: session.checksum,
    bytes,
  })
  memorySessions.delete(match[1])
  return { ok: true, generation, storagePath: session.storagePath }
}

export function assertSignedSessionPathBound(session, expectedPath, expectedContentType) {
  if (!session?.ok) return { ok: false, error: 'invalid_session' }
  if (session.storagePath !== expectedPath) return { ok: false, error: 'path_mismatch' }
  if (String(session.contentType).toLowerCase() !== String(expectedContentType).toLowerCase()) {
    return { ok: false, error: 'content_type_mismatch' }
  }
  return { ok: true }
}

async function verifyMemoryObject(storagePath, expectedContentType, expectedSizeBytes, expectedChecksum) {
  const entry = memoryObjects.get(storagePath)
  if (!entry) {
    return { ok: false, error: 'not_found' }
  }
  if (
    expectedContentType &&
    String(entry.contentType).toLowerCase() !== String(expectedContentType).trim().toLowerCase()
  ) {
    return { ok: false, error: 'content_type_mismatch' }
  }
  if (Number.isFinite(expectedSizeBytes) && entry.sizeBytes !== Number(expectedSizeBytes)) {
    return { ok: false, error: 'size_mismatch' }
  }
  if (Number(expectedSizeBytes) > QC_ATTACHMENT_MAX_BYTES) {
    return { ok: false, error: 'invalid_size' }
  }
  if (expectedChecksum && entry.checksum !== expectedChecksum) {
    return { ok: false, error: 'checksum_mismatch' }
  }
  return { ok: true, generation: entry.generation }
}

async function verifyAdminStorageObject(storagePath, expectedContentType, expectedSizeBytes, expectedChecksum) {
  try {
    const { initFirebaseAdmin, resolveFirebaseStorageBucket } = await import('./_adminAuth.mjs')
    initFirebaseAdmin()
    const bucketName = resolveFirebaseStorageBucket()
    const bucket = bucketName ? getStorage().bucket(bucketName) : getStorage().bucket()
    const file = bucket.file(storagePath)
    const [metadata] = await file.getMetadata()
    const contentType = String(metadata?.contentType ?? '')
    const sizeBytes = Number(metadata?.size ?? 0)
    const checksum = String(metadata?.md5Hash ?? metadata?.crc32c ?? metadata?.metadata?.checksum ?? '')
    const generation = String(metadata?.generation ?? '')

    if (sizeBytes > QC_ATTACHMENT_MAX_BYTES) {
      return { ok: false, error: 'invalid_size' }
    }
    if (
      expectedContentType &&
      contentType.trim().toLowerCase() !== String(expectedContentType).trim().toLowerCase()
    ) {
      return { ok: false, error: 'content_type_mismatch' }
    }
    if (Number.isFinite(expectedSizeBytes) && sizeBytes !== Number(expectedSizeBytes)) {
      return { ok: false, error: 'size_mismatch' }
    }
    if (expectedChecksum && checksum && checksum !== expectedChecksum) {
      return { ok: false, error: 'checksum_mismatch' }
    }
    return { ok: true, generation }
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String(err.code ?? '') : ''
    if (code.includes('object-not-found') || code.includes('storage/object-not-found')) {
      return { ok: false, error: 'not_found' }
    }
    return { ok: false, error: 'storage_unavailable' }
  }
}

export async function verifyStorageObject({
  storagePath,
  expectedContentType,
  expectedSizeBytes,
  expectedChecksum,
}) {
  if (isTestMemoryMode()) {
    return verifyMemoryObject(storagePath, expectedContentType, expectedSizeBytes, expectedChecksum)
  }
  return verifyAdminStorageObject(storagePath, expectedContentType, expectedSizeBytes, expectedChecksum)
}
