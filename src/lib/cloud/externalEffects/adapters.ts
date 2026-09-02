import type { AccessStore } from '@/lib/access/types'
import { deleteFirebaseWebUser } from '@/lib/cloud/webUserAdmin'
import { syncWebAccessAllowlistFromStore } from '@/lib/cloud/webAccessConfig'
import { deleteTaskAttachmentFile } from '@/lib/tasks/taskAttachmentStorage'

export type AuthDeleteResult =
  | { ok: true }
  | { ok: false; error: string; idempotent?: boolean }

export type StorageDeleteResult =
  | { ok: true; notFound?: boolean }
  | { ok: false; error: string }

export type ExternalEffectsAdapters = {
  deleteAuthUser: (email: string) => Promise<AuthDeleteResult>
  syncAllowlist: (access: AccessStore) => Promise<void>
  deleteStorageObject: (storagePath: string) => Promise<StorageDeleteResult>
}

let adapters: ExternalEffectsAdapters = {
  deleteAuthUser: async (email) => {
    const res = await deleteFirebaseWebUser(email)
    if (res.ok) return { ok: true }
    if (res.error === 'user_not_found') return { ok: true }
    return { ok: false, error: res.error }
  },
  syncAllowlist: async (access) => {
    await syncWebAccessAllowlistFromStore(access)
  },
  deleteStorageObject: async (storagePath) => {
    return deleteTaskAttachmentFile(storagePath)
  },
}

export function getExternalEffectsAdapters(): ExternalEffectsAdapters {
  return adapters
}

/** Test-only — inject mocks; never call in production paths from tests that hit real Firebase. */
export function setExternalEffectsAdapters(next: Partial<ExternalEffectsAdapters>): void {
  adapters = { ...adapters, ...next }
}

export function resetExternalEffectsAdapters(): void {
  adapters = {
    deleteAuthUser: async (email) => {
      const res = await deleteFirebaseWebUser(email)
      if (res.ok) return { ok: true }
      if (res.error === 'user_not_found') return { ok: true }
      return { ok: false, error: res.error }
    },
    syncAllowlist: async (access) => {
      await syncWebAccessAllowlistFromStore(access)
    },
    deleteStorageObject: async (storagePath) => deleteTaskAttachmentFile(storagePath),
  }
}
