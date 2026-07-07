import type { WarehouseDocument, WarehouseStore } from './types'

const LOCK_TTL_MS = 30 * 60 * 1000

function lockExpired(doc: WarehouseDocument): boolean {
  if (!doc.lockedAt) return true
  return Date.now() - new Date(doc.lockedAt).getTime() > LOCK_TTL_MS
}

export function isDocumentLockedByOther(
  doc: WarehouseDocument | undefined,
  actorId: string | undefined,
): boolean {
  if (!doc?.lockedBy || !actorId) return false
  if (doc.lockedBy === actorId) return false
  return !lockExpired(doc)
}

export function acquireWarehouseDocumentLock(
  store: WarehouseStore,
  documentId: string,
  actor: { actorId: string; actorName?: string },
): { store: WarehouseStore; result: { ok: true } | { ok: false; error: string; lockedByName?: string } } {
  const doc = store.documents.find((d) => d.id === documentId)
  if (!doc) return { store, result: { ok: false, error: 'not_found' } }
  if (doc.status !== 'draft') return { store, result: { ok: false, error: 'warehouse.doc.errAlreadyPosted' } }
  if (isDocumentLockedByOther(doc, actor.actorId)) {
    return {
      store,
      result: { ok: false, error: 'warehouse.inventory.lockFailed', lockedByName: doc.lockedByName },
    }
  }
  const now = new Date().toISOString()
  const documents = store.documents.map((d) =>
    d.id === documentId
      ? { ...d, lockedBy: actor.actorId, lockedByName: actor.actorName, lockedAt: now }
      : d,
  )
  return { store: { ...store, documents }, result: { ok: true } }
}

export function releaseWarehouseDocumentLock(
  store: WarehouseStore,
  documentId: string,
  actorId?: string,
): WarehouseStore {
  const doc = store.documents.find((d) => d.id === documentId)
  if (!doc?.lockedBy) return store
  if (actorId && doc.lockedBy !== actorId) return store
  const documents = store.documents.map((d) =>
    d.id === documentId
      ? { ...d, lockedBy: undefined, lockedByName: undefined, lockedAt: undefined }
      : d,
  )
  return { ...store, documents }
}

export function touchWarehouseDocumentLock(
  store: WarehouseStore,
  documentId: string,
  actorId: string,
): WarehouseStore {
  const doc = store.documents.find((d) => d.id === documentId)
  if (!doc || doc.lockedBy !== actorId) return store
  const now = new Date().toISOString()
  const documents = store.documents.map((d) =>
    d.id === documentId ? { ...d, lockedAt: now } : d,
  )
  return { ...store, documents }
}
