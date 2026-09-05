import {
  deleteObject,
  getDownloadURL,
  getStorage,
  ref,
  uploadBytes,
} from 'firebase/storage'
import type { TaskAttachment } from './types'
import { getFirebaseApp, isFirebaseConfigured } from '@/lib/cloud/firebase'
import { FST_SHARED_STORE_DOC_ID } from '@/lib/cloud/firestoreSchema'

export function taskAttachmentPath(
  storeDocId: string,
  taskId: string,
  attachmentId: string,
  fileName: string,
): string {
  const safe = fileName.replace(/[^\w.\-()+]/g, '_').slice(0, 80)
  return `fstFiles/${storeDocId}/tasks/${taskId}/${attachmentId}/${safe}`
}

export async function uploadTaskAttachmentFile(
  taskId: string,
  file: File,
  uploadedBy: string,
  storeDocId = FST_SHARED_STORE_DOC_ID,
): Promise<TaskAttachment | null> {
  if (!isFirebaseConfigured()) return null
  const id = crypto.randomUUID()
  const storagePath = taskAttachmentPath(storeDocId, taskId, id, file.name)
  const storage = getStorage(getFirebaseApp())
  await uploadBytes(ref(storage, storagePath), file, {
    contentType: file.type || undefined,
  })
  return {
    id,
    taskId,
    storagePath,
    fileName: file.name,
    mimeType: file.type || undefined,
    sizeBytes: file.size,
    uploadedBy,
    uploadedAt: new Date().toISOString(),
  }
}

export async function taskAttachmentDownloadUrl(storagePath: string): Promise<string | undefined> {
  if (!isFirebaseConfigured()) return undefined
  try {
    return await getDownloadURL(ref(getStorage(getFirebaseApp()), storagePath))
  } catch {
    return undefined
  }
}

export async function deleteTaskAttachmentFile(
  storagePath: string,
): Promise<{ ok: true; notFound?: boolean } | { ok: false; error: string }> {
  if (!isFirebaseConfigured()) return { ok: true }
  try {
    await deleteObject(ref(getStorage(getFirebaseApp()), storagePath))
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
