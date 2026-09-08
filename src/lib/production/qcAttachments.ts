/**
 * PHASE P1C — QC attachment metadata (no binaries in AppStore).
 * Production uploads use Firebase Storage in browser; tests use the in-memory adapter.
 */
import {
  deleteObject,
  getDownloadURL,
  getStorage,
  ref,
  uploadBytes,
} from 'firebase/storage'
import { getFirebaseApp, getFirebaseAuth, isFirebaseConfigured } from '@/lib/cloud/firebase'

export type QcDocumentKind = 'passport' | 'protocol' | 'other'

export type QcAttachmentUploadStatus = 'pending' | 'stored' | 'failed'

export type QcLotAttachment = {
  id: string
  lotId: string
  documentKind: QcDocumentKind
  originalFilename: string
  displayName: string
  mimeType: string
  sizeBytes: number
  checksum: string
  storagePath: string
  uploadedBy?: string
  uploadedAt?: string
  uploadStatus: QcAttachmentUploadStatus
  version: number
  customerOrderId?: string
}

/** Centralized safe size limit (10 MiB) for QC mandatory/optional files. */
export const QC_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024

const ALLOWED_MANDATORY = new Set(['application/pdf'])
const ALLOWED_OPTIONAL = new Set(['application/pdf', 'image/jpeg', 'image/png'])

function sanitizeStorageSegment(value: string, fallback: string): string {
  const safe = value.replace(/[^a-zA-Z0-9-]/g, '')
  return safe || fallback
}

export function sanitizeQcFilename(name: string): string {
  return name.replace(/[^\w.\-()+]/g, '_').slice(0, 80) || 'file'
}

export function qcAttachmentStoragePath(
  storeDocId: string,
  lotId: string,
  attachmentId: string,
): string {
  return `fstFiles/${sanitizeStorageSegment(storeDocId, 'store')}/qc-lots/${sanitizeStorageSegment(lotId, 'lot')}/${sanitizeStorageSegment(attachmentId, 'attachment')}/blob`
}

export function assertQcAttachmentAllowed(
  kind: QcDocumentKind,
  mimeType: string,
  sizeBytes: number,
): { ok: true } | { ok: false; error: string } {
  if (sizeBytes <= 0 || sizeBytes > QC_ATTACHMENT_MAX_BYTES) {
    return { ok: false, error: 'production.qc.errAttachmentSize' }
  }
  const allowed = kind === 'other' ? ALLOWED_OPTIONAL : ALLOWED_MANDATORY
  if (!allowed.has(mimeType)) {
    return { ok: false, error: 'production.qc.errAttachmentType' }
  }
  return { ok: true }
}

export type QcAttachmentUploadInput = {
  lotId: string
  documentKind: QcDocumentKind
  originalFilename: string
  mimeType: string
  sizeBytes: number
  bytes?: ArrayBuffer | Uint8Array
  uploadedBy?: string
  customerOrderId?: string
  storeDocId?: string
  attachmentId?: string
}

export interface QcAttachmentStorageAdapter {
  upload(input: QcAttachmentUploadInput): Promise<QcLotAttachment>
}

function asUint8Array(bytes: ArrayBuffer | Uint8Array): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
}

function hexFromBytes(bytes: ArrayBuffer | Uint8Array): string {
  const data = asUint8Array(bytes)
  return [...data].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function hashStringToHex(value: string): string {
  let h = 2166136261
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

async function checksumForAttachment(input: QcAttachmentUploadInput): Promise<string> {
  if (input.bytes) {
    const bytes = asUint8Array(input.bytes)
    const digest = await crypto.subtle.digest(
      'SHA-256',
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    )
    return hexFromBytes(digest)
  }
  return hashStringToHex(`${input.sizeBytes}|${input.mimeType}|${sanitizeQcFilename(input.originalFilename)}`)
}

function baseAttachmentMetadata(
  input: QcAttachmentUploadInput,
  storagePath: string,
  checksum: string,
  attachmentId: string,
  uploadStatus: QcAttachmentUploadStatus,
): QcLotAttachment {
  return {
    id: attachmentId,
    lotId: input.lotId,
    documentKind: input.documentKind,
    originalFilename: input.originalFilename,
    displayName: sanitizeQcFilename(input.originalFilename),
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    checksum,
    storagePath,
    uploadedBy: input.uploadedBy,
    uploadedAt: uploadStatus === 'stored' ? new Date().toISOString() : undefined,
    uploadStatus,
    version: 1,
    customerOrderId: input.customerOrderId,
  }
}

/** In-memory adapter for tests — marks stored without Firebase. */
export function createMemoryQcAttachmentAdapter(): QcAttachmentStorageAdapter {
  return {
    async upload(input) {
      const gate = assertQcAttachmentAllowed(input.documentKind, input.mimeType, input.sizeBytes)
      if (!gate.ok) throw new Error(gate.error)
      const attachmentId = sanitizeStorageSegment(input.attachmentId ?? crypto.randomUUID(), 'qc')
      const storeDocId = input.storeDocId ?? 'test-store'
      const checksum = await checksumForAttachment(input)
      return baseAttachmentMetadata(
        input,
        qcAttachmentStoragePath(storeDocId, input.lotId, attachmentId),
        checksum,
        attachmentId,
        'stored',
      )
    },
  }
}

export function createFirebaseQcAttachmentAdapter(): QcAttachmentStorageAdapter {
  return {
    async upload(input) {
      const gate = assertQcAttachmentAllowed(input.documentKind, input.mimeType, input.sizeBytes)
      if (!gate.ok) throw new Error(gate.error)
      const auth = getFirebaseAuth()
      if (!auth.currentUser) throw new Error('not_authenticated')
      if (!input.bytes || (input.bytes instanceof ArrayBuffer ? input.bytes.byteLength === 0 : input.bytes.length === 0)) {
        throw new Error('production.qc.errAttachmentEmpty')
      }
      const attachmentId = sanitizeStorageSegment(input.attachmentId ?? crypto.randomUUID(), 'qc')
      const storeDocId = input.storeDocId ?? 'fibercell-main'
      const checksum = await checksumForAttachment(input)
      const storagePath = qcAttachmentStoragePath(storeDocId, input.lotId, attachmentId)
      try {
        await uploadBytes(ref(getStorage(getFirebaseApp()), storagePath), input.bytes, {
          contentType: input.mimeType || undefined,
          customMetadata: {
            displayName: sanitizeQcFilename(input.originalFilename),
            originalFilename: input.originalFilename.slice(0, 180),
            checksum,
          },
        })
        return baseAttachmentMetadata(input, storagePath, checksum, attachmentId, 'stored')
      } catch (err) {
        const failed = baseAttachmentMetadata(input, storagePath, checksum, attachmentId, 'failed')
        const code =
          err && typeof err === 'object' && 'code' in err
            ? String((err as { code?: string }).code ?? '')
            : 'storage_upload_failed'
        return { ...failed, checksum: `${failed.checksum}:${hashStringToHex(code)}` }
      }
    },
  }
}

export function resolveQcAttachmentAdapter(): QcAttachmentStorageAdapter {
  const isWeb =
    typeof import.meta !== 'undefined' &&
    Boolean((import.meta as ImportMeta & { env?: { VITE_FST_WEB?: string } }).env?.VITE_FST_WEB === 'true')
  // Production web: no memory mock fallback; direct client Storage write is closed by rules.
  if (isWeb) {
    return createFailClosedQcAttachmentAdapter()
  }
  if (typeof window !== 'undefined' && isFirebaseConfigured()) {
    return createFirebaseQcAttachmentAdapter()
  }
  return createMemoryQcAttachmentAdapter()
}

export function createFailClosedQcAttachmentAdapter(): QcAttachmentStorageAdapter {
  return {
    async upload(input) {
      const gate = assertQcAttachmentAllowed(input.documentKind, input.mimeType, input.sizeBytes)
      if (!gate.ok) throw new Error(gate.error)
      const attachmentId = sanitizeStorageSegment(input.attachmentId ?? crypto.randomUUID(), 'qc')
      const storeDocId = input.storeDocId ?? 'fibercell-main'
      const checksum = await checksumForAttachment(input)
      return baseAttachmentMetadata(
        input,
        qcAttachmentStoragePath(storeDocId, input.lotId, attachmentId),
        `${checksum}:server_upload_required`,
        attachmentId,
        'failed',
      )
    },
  }
}

export async function qcAttachmentDownloadUrl(storagePath: string): Promise<string | undefined> {
  if (typeof window === 'undefined' || !isFirebaseConfigured()) return undefined
  try {
    return await getDownloadURL(ref(getStorage(getFirebaseApp()), storagePath))
  } catch {
    return undefined
  }
}

export async function deleteDraftQcAttachmentFile(
  attachment: Pick<QcLotAttachment, 'storagePath' | 'uploadStatus'>,
): Promise<{ ok: true; notFound?: boolean } | { ok: false; error: string }> {
  if (attachment.uploadStatus !== 'pending') {
    return { ok: false, error: 'production.qc.errAttachmentDeleteState' }
  }
  if (typeof window === 'undefined' || !isFirebaseConfigured()) return { ok: true }
  try {
    await deleteObject(ref(getStorage(getFirebaseApp()), attachment.storagePath))
    return { ok: true }
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: string }).code ?? '')
        : 'storage_delete_failed'
    if (code.includes('object-not-found') || code.includes('storage/object-not-found')) {
      return { ok: true, notFound: true }
    }
    return { ok: false, error: code }
  }
}

export function isMandatoryAttachmentStored(
  attachments: QcLotAttachment[],
  lotId: string,
  kind: 'passport' | 'protocol',
): boolean {
  return attachments.some(
    (a) => a.lotId === lotId && a.documentKind === kind && a.uploadStatus === 'stored',
  )
}
