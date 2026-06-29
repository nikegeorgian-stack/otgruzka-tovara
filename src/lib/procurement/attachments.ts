import { fileToDataUrl } from '@/lib/hr/files'
import { newId } from '@/lib/production/files'
import type { PurchaseOrderAttachment, PurchaseOrderAttachmentKind } from './types'

export const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024
export const MAX_ATTACHMENTS_PER_ORDER = 12

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export async function readOrderAttachment(
  file: File,
  kind: PurchaseOrderAttachmentKind = 'other',
): Promise<PurchaseOrderAttachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error('file_too_large')
  }
  if (file.type && !ALLOWED_MIME.has(file.type) && !file.type.startsWith('image/')) {
    throw new Error('file_type')
  }
  const dataUrl = await fileToDataUrl(file)
  return {
    id: newId(),
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    kind,
    sizeBytes: file.size,
    dataUrl,
    uploadedAt: new Date().toISOString(),
  }
}
