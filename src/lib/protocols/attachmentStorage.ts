import {
  getDownloadURL,
  getStorage,
  ref,
  uploadBytes,
} from 'firebase/storage'
import type { ProtocolAttachment } from './types'
import { getFirebaseApp, isFirebaseConfigured } from '@/lib/cloud/firebase'
import { FST_SHARED_STORE_DOC_ID } from '@/lib/cloud/firestoreSchema'

export function protocolAttachmentPath(
  storeDocId: string,
  ownerKind: 'protocol' | 'item',
  ownerId: string,
  attachmentId: string,
  fileName: string,
): string {
  const safe = fileName.replace(/[^\w.\-()+]/g, '_').slice(0, 80)
  return `fstFiles/${storeDocId}/protocols/${ownerKind}/${ownerId}/${attachmentId}/${safe}`
}

export async function uploadProtocolAttachmentFile(
  ownerKind: 'protocol' | 'item',
  ownerId: string,
  file: File,
  uploadedBy: string,
  kind: ProtocolAttachment['kind'] = 'general',
  storeDocId = FST_SHARED_STORE_DOC_ID,
): Promise<ProtocolAttachment | null> {
  if (!isFirebaseConfigured()) return null
  const id = crypto.randomUUID()
  const storagePath = protocolAttachmentPath(
    storeDocId,
    ownerKind,
    ownerId,
    id,
    file.name,
  )
  const storage = getStorage(getFirebaseApp())
  await uploadBytes(ref(storage, storagePath), file, {
    contentType: file.type || undefined,
  })
  return {
    id,
    ownerKind,
    ownerId,
    storagePath,
    fileName: file.name,
    mimeType: file.type || undefined,
    sizeBytes: file.size,
    uploadedBy,
    uploadedAt: new Date().toISOString(),
    kind,
  }
}

export async function protocolAttachmentDownloadUrl(
  storagePath: string,
): Promise<string | undefined> {
  if (!isFirebaseConfigured()) return undefined
  try {
    return await getDownloadURL(ref(getStorage(getFirebaseApp()), storagePath))
  } catch {
    return undefined
  }
}
