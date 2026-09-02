/**
 * PHASE W1 — central warehouse document lifecycle API.
 * Lifecycle: draft → posted → cancelled (via reversal). No posted→draft.
 */
import type { AccessStore, AccessRoleId, AppUser } from '@/lib/access/types'
import { roleAllowsDocumentCancel } from '@/lib/access/permissions'
import {
  cancelWarehouseDocument,
  postExistingWarehouseDocument,
  postWarehouseDocument,
  removeWarehouseDraftDocument,
  saveWarehouseDocumentDraft,
  type CancelDocumentResult,
  type PostDocumentResult,
  type PostWarehouseDocumentInput,
  type SaveDraftInput,
  type UnpostDocumentResult,
} from './documents'
import { documentCanBeCancelled } from './documentValidation'
import type { WarehouseDocument, WarehouseStore } from './types'

export type LifecycleActor = {
  actorId?: string
  actorName?: string
  roleId?: AccessRoleId
}

/** Create or update draft (no stock movements). */
export function createDraft(
  store: WarehouseStore,
  input: SaveDraftInput,
  actor?: LifecycleActor,
): { store: WarehouseStore; result: PostDocumentResult } {
  return saveWarehouseDocumentDraft(store, input, actor)
}

export function updateDraft(
  store: WarehouseStore,
  input: SaveDraftInput & { id: string },
  actor?: LifecycleActor,
): { store: WarehouseStore; result: PostDocumentResult } {
  const existing = store.documents.find((d) => d.id === input.id)
  if (!existing) return { store, result: { ok: false, error: 'not_found' } }
  if ((existing.status ?? 'posted') !== 'draft') {
    return { store, result: { ok: false, error: 'warehouse.doc.errPostedImmutable' } }
  }
  return saveWarehouseDocumentDraft(store, input, actor)
}

export function postDraft(
  store: WarehouseStore,
  documentId: string,
  actor?: LifecycleActor,
): { store: WarehouseStore; result: PostDocumentResult } {
  const doc = store.documents.find((d) => d.id === documentId)
  if (!doc) return { store, result: { ok: false, error: 'not_found' } }
  if ((doc.status ?? 'posted') !== 'draft') {
    return { store, result: { ok: false, error: 'warehouse.doc.errNotDraft' } }
  }
  return postExistingWarehouseDocument(store, documentId, actor)
}

/** Post a new document in one step (auto-docs). */
export function postNewDocument(
  store: WarehouseStore,
  input: PostWarehouseDocumentInput,
): { store: WarehouseStore; result: PostDocumentResult } {
  return postWarehouseDocument(store, input)
}

export function cancelPosted(
  store: WarehouseStore,
  documentId: string,
  args: {
    cancelledBy?: string
    cancelledByName?: string
    reason?: string
    access?: AccessStore
    roleId?: AccessRoleId
    transactionGroupId?: string
  },
): { store: WarehouseStore; result: CancelDocumentResult } {
  if (args.access && args.roleId && !roleAllowsDocumentCancel(args.access, args.roleId)) {
    return { store, result: { ok: false, error: 'warehouse.doc.errCancelForbidden' } }
  }
  const reason = args.reason?.trim()
  if (!reason) {
    return { store, result: { ok: false, error: 'warehouse.doc.errCancelReasonRequired' } }
  }
  return cancelWarehouseDocument(store, documentId, {
    cancelledBy: args.cancelledBy,
    cancelledByName: args.cancelledByName,
    reason,
    transactionGroupId: args.transactionGroupId,
  })
}

/**
 * @deprecated PHASE W1 — destructive unpost is forbidden.
 * Use cancelPosted (reversal) instead.
 */
export function unpostForbidden(
  store: WarehouseStore,
  documentId: string,
): { store: WarehouseStore; result: UnpostDocumentResult } {
  void documentId
  return {
    store,
    result: {
      ok: false,
      error: 'warehouse.doc.errUnpostRemoved',
    },
  }
}

export function deleteDraft(
  store: WarehouseStore,
  documentId: string,
  actor?: LifecycleActor,
): { store: WarehouseStore; result: UnpostDocumentResult } {
  return removeWarehouseDraftDocument(store, documentId, actor)
}

/** Copy posted/cancelled document into a new draft (no stock effect). */
export function copyDocument(
  store: WarehouseStore,
  documentId: string,
  actor?: LifecycleActor,
): { store: WarehouseStore; result: PostDocumentResult } {
  const src = store.documents.find((d) => d.id === documentId)
  if (!src) return { store, result: { ok: false, error: 'not_found' } }
  return saveWarehouseDocumentDraft(
    store,
    {
      type: src.type,
      number: `${src.number}-COPY`,
      date: src.date,
      documentDateTime: src.documentDateTime,
      warehouseId: src.warehouseId,
      sourceWarehouseId: src.sourceWarehouseId,
      destinationWarehouseId: src.destinationWarehouseId,
      purpose: src.purpose,
      counterparty: src.counterparty,
      counterpartyId: src.counterpartyId,
      contractId: src.contractId,
      contractNumber: src.contractNumber,
      basisType: src.basisType,
      basisId: src.basisId,
      basisNumber: src.basisNumber,
      responsibleEmployeeId: src.responsibleEmployeeId,
      responsibleEmployeeNameSnapshot: src.responsibleEmployeeNameSnapshot,
      brigade: src.brigade,
      comment: [src.comment, `Копия ${src.number}`].filter(Boolean).join(' · '),
      writeoffReason: src.writeoffReason,
      targetWarehouseId: src.targetWarehouseId,
      lines: src.lines.map((l) => ({
        ...l,
        lineId: crypto.randomUUID(),
      })),
      createdBy: actor?.actorId,
      createdByName: actor?.actorName,
    },
    actor,
  )
}

/** Create a correction draft based on a posted/cancelled document. */
export function createCorrection(
  store: WarehouseStore,
  documentId: string,
  actor?: LifecycleActor,
): { store: WarehouseStore; result: PostDocumentResult } {
  const src = store.documents.find((d) => d.id === documentId)
  if (!src) return { store, result: { ok: false, error: 'not_found' } }
  const status = src.status ?? 'posted'
  if (status !== 'posted' && status !== 'cancelled') {
    return { store, result: { ok: false, error: 'warehouse.doc.errNotPosted' } }
  }
  return copyDocument(store, documentId, actor)
}

export function canEditDraft(doc: WarehouseDocument | undefined): boolean {
  if (!doc) return false
  return (doc.status ?? 'posted') === 'draft'
}

export function canCancelPosted(
  access: AccessStore | undefined,
  actor: LifecycleActor | undefined,
): boolean {
  if (!access || !actor?.roleId) return false
  return roleAllowsDocumentCancel(access, actor.roleId)
}

export function canViewWarehouseAudit(user: AppUser | null | undefined): boolean {
  return Boolean(user?.active)
}

export function assertDocumentEditable(
  doc: WarehouseDocument,
): { ok: true } | { ok: false; error: string } {
  if ((doc.status ?? 'posted') !== 'draft') {
    return { ok: false, error: 'warehouse.doc.errPostedImmutable' }
  }
  return { ok: true }
}

export { documentCanBeCancelled }
