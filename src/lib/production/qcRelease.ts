/**
 * PHASE P1C — finished goods QC release / regrade / reject.
 */
import type { AccessStore, AppUser } from '@/lib/access/types'
import { canReleaseFinishedGoodsQc } from '@/lib/access/permissions'
import type { ProductionStore } from './types'
import type { FinishedGoodsLot, FinishedGoodsQcStatus } from './finishedGoodsLots'
import type { QcLotAttachment } from './qcAttachments'
import type { WarehouseStore } from '@/lib/warehouse/types'
import { postWarehouseDocumentsAtomic, postWarehouseTransfer } from '@/lib/warehouse/documents'

export const QC_RELEASE_FORBIDDEN = 'production.qc.errReleaseForbidden' as const
export const QC_RELEASE_ATTACHMENTS = 'production.qc.errReleaseAttachments' as const
export const QC_RELEASE_QTY = 'production.qc.errReleaseQty' as const
export const QC_RELEASE_IMMUTABLE = 'production.qc.errReleaseImmutable' as const
export const QC_REGRADE_FORBIDDEN = 'production.qc.errRegradeForbidden' as const
export const QC_REGRADE_REASON = 'production.qc.errRegradeReason' as const
export const QC_REGRADE_QTY = 'production.qc.errRegradeQty' as const
export const QC_REJECT_FORBIDDEN = 'production.qc.errRejectForbidden' as const
export const QC_REJECT_REASON = 'production.qc.errRejectReason' as const
export const QC_NOT_FOUND = 'production.qc.errLotNotFound' as const
export const QC_SHIPMENT_BLOCKED = 'production.qc.errShipmentBlocked' as const

function findLot(store: ProductionStore, lotId: string): FinishedGoodsLot | undefined {
  return (store.finishedGoodsLots ?? []).find((lot) => lot.id === lotId)
}

function findAttachment(store: ProductionStore, attachmentId: string | undefined): QcLotAttachment | undefined {
  if (!attachmentId) return undefined
  return (store.qcAttachments ?? []).find((a) => a.id === attachmentId)
}

function attachmentIsStored(store: ProductionStore, attachmentId: string | undefined): boolean {
  const att = findAttachment(store, attachmentId)
  return att?.uploadStatus === 'stored'
}

function computeLotRemaining(lot: FinishedGoodsLot): number {
  return Math.max(0, (lot.quantityQcReleased || 0) - (lot.quantityShipped || 0))
}

function asActorUser(actor: ReleaseFinishedGoodsLotInput['actor'] | RequestRegradeInput['actor'] | RejectFinishedGoodsLotInput['actor']): AppUser | null {
  if (!actor) return null
  return {
    id: actor.id ?? 'qc-actor',
    login: actor.id ?? 'qc-actor',
    displayName: actor.name ?? actor.id ?? 'qc-actor',
    roleId: actor.roleId ?? 'otc',
    passwordHash: '',
    passwordSalt: '',
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

export function startQcReview(lot: FinishedGoodsLot): FinishedGoodsLot {
  if (lot.qcStatus !== 'pending') return lot
  return {
    ...lot,
    qcStatus: 'in_review',
    updatedAt: new Date().toISOString(),
  }
}

export type ReleaseFinishedGoodsLotInput = {
  lotId: string
  access?: AccessStore | null
  actor?: { id?: string; name?: string; roleId?: AppUser['roleId'] }
  attachments?: {
    passportAttachmentId?: string
    protocolAttachmentId?: string
  }
}

export type ReleaseFinishedGoodsLotResult = {
  ok: boolean
  error?: string
  auditDetail?: string
  lot?: FinishedGoodsLot
}

export function releaseFinishedGoodsLot(
  production: ProductionStore,
  input: ReleaseFinishedGoodsLotInput,
): { production: ProductionStore; result: ReleaseFinishedGoodsLotResult } {
  if (!canReleaseFinishedGoodsQc(asActorUser(input.actor), input.access)) {
    return { production, result: { ok: false, error: QC_RELEASE_FORBIDDEN } }
  }

  const lot = findLot(production, input.lotId)
  if (!lot) return { production, result: { ok: false, error: QC_NOT_FOUND } }
  if (lot.qcStatus === 'released') {
    return { production, result: { ok: true, lot } }
  }
  if (lot.qcStatus !== 'pending' && lot.qcStatus !== 'in_review') {
    return { production, result: { ok: false, error: QC_RELEASE_IMMUTABLE } }
  }

  const passportAttachmentId = input.attachments?.passportAttachmentId ?? lot.passportAttachmentId
  const protocolAttachmentId = input.attachments?.protocolAttachmentId ?? lot.protocolAttachmentId
  if (
    !passportAttachmentId ||
    !protocolAttachmentId ||
    !attachmentIsStored(production, passportAttachmentId) ||
    !attachmentIsStored(production, protocolAttachmentId)
  ) {
    return { production, result: { ok: false, error: QC_RELEASE_ATTACHMENTS } }
  }

  if (lot.quantityProduced <= 0) {
    return { production, result: { ok: false, error: QC_RELEASE_QTY } }
  }

  const now = new Date().toISOString()
  const updated: FinishedGoodsLot = {
    ...lot,
    qcStatus: 'released',
    quantityQcReleased: lot.quantityProduced,
    quantityRemaining: Math.max(0, lot.quantityProduced - lot.quantityShipped),
    passportAttachmentId,
    protocolAttachmentId,
    releasedAt: now,
    releasedBy: input.actor?.id,
    releasedByName: input.actor?.name,
    updatedAt: now,
  }

  const next = {
    ...production,
    finishedGoodsLots: (production.finishedGoodsLots ?? []).map((row) => (row.id === lot.id ? updated : row)),
  }

  return {
    production: next,
    result: {
      ok: true,
      auditDetail: `QC release: lot ${lot.batchNo} by ${input.actor?.name ?? input.actor?.id ?? 'unknown'}`,
      lot: updated,
    },
  }
}

/** UI mirror after authoritative server QcLotDecision ack (skips client ACL). */
export function applyServerQcReleaseMirror(
  production: ProductionStore,
  input: {
    lotId: string
    decisionId: string
    decisionRevision?: number
    decidedByUid?: string
    decidedAt?: string
  },
): { production: ProductionStore; lot?: FinishedGoodsLot } {
  const lot = findLot(production, input.lotId)
  if (!lot) return { production }
  const now = input.decidedAt ?? new Date().toISOString()
  const updated: FinishedGoodsLot = {
    ...lot,
    qcStatus: 'released',
    quantityQcReleased: lot.quantityProduced,
    quantityRemaining: Math.max(0, lot.quantityProduced - lot.quantityShipped),
    serverQcDecisionId: input.decisionId,
    serverQcDecisionStatus: 'released',
    serverQcDecisionRevision: input.decisionRevision,
    releasedAt: now,
    releasedBy: input.decidedByUid ?? lot.releasedBy,
    updatedAt: now,
  }
  return {
    production: {
      ...production,
      finishedGoodsLots: (production.finishedGoodsLots ?? []).map((row) => (row.id === lot.id ? updated : row)),
    },
    lot: updated,
  }
}

export type RequestRegradeInput = {
  lotId: string
  targetFinishedProductId: string
  targetWarehouseItemId: string
  reason: string
  quantity?: number
  access?: AccessStore | null
  actor?: { id?: string; name?: string; roleId?: AppUser['roleId'] }
  idempotencyKey: string
  batchNo?: string
}

export type RequestRegradeResult = {
  ok: boolean
  error?: string
  originalLot?: FinishedGoodsLot
  newLot?: FinishedGoodsLot
  documentIds?: string[]
}

export function requestRegrade(
  production: ProductionStore,
  warehouse: WarehouseStore | undefined,
  input: RequestRegradeInput,
): { production: ProductionStore; warehouse: WarehouseStore | undefined; result: RequestRegradeResult } {
  if (!canReleaseFinishedGoodsQc(asActorUser(input.actor), input.access)) {
    return { production, warehouse, result: { ok: false, error: QC_REGRADE_FORBIDDEN } }
  }
  if (!input.reason?.trim()) {
    return { production, warehouse, result: { ok: false, error: QC_REGRADE_REASON } }
  }

  const existingOriginal = findLot(production, input.lotId)
  const existingNew = (production.finishedGoodsLots ?? []).find(
    (lot) => lot.originalLotId === input.lotId && lot.transactionGroupId === input.idempotencyKey,
  )
  if (existingOriginal && existingNew) {
    return {
      production,
      warehouse,
      result: { ok: true, originalLot: existingOriginal, newLot: existingNew, documentIds: [] },
    }
  }

  const original = existingOriginal
  if (!original) return { production, warehouse, result: { ok: false, error: QC_NOT_FOUND } }

  if (warehouse) {
    const targetItem = warehouse.items.find((item) => item.id === input.targetWarehouseItemId)
    if (!targetItem) {
      return { production, warehouse, result: { ok: false, error: QC_NOT_FOUND } }
    }
  }

  const now = new Date().toISOString()
  const transferableQty = Math.max(0, original.quantityProduced - original.quantityShipped)
  const requestedQty = input.quantity ?? transferableQty
  if (!Number.isFinite(requestedQty) || requestedQty <= 0 || requestedQty > transferableQty) {
    return { production, warehouse, result: { ok: false, error: QC_REGRADE_QTY } }
  }
  const newLotId = crypto.randomUUID()
  const newLot: FinishedGoodsLot = {
    ...original,
    id: newLotId,
    finishedProductId: input.targetFinishedProductId,
    warehouseItemId: input.targetWarehouseItemId,
    batchNo: input.batchNo ?? `${original.batchNo}-R`,
    qcStatus: 'pending',
    quantityProduced: requestedQty,
    quantityQcReleased: 0,
    quantityShipped: 0,
    quantityRemaining: 0,
    passportAttachmentId: undefined,
    protocolAttachmentId: undefined,
    releasedAt: undefined,
    releasedBy: undefined,
    releasedByName: undefined,
    originalLotId: original.id,
    regradedLotId: undefined,
    regradeTargetFinishedProductId: input.targetFinishedProductId,
    regradeTargetWarehouseItemId: input.targetWarehouseItemId,
    regradeReason: input.reason.trim(),
    updatedAt: now,
    createdAt: now,
    transactionGroupId: input.idempotencyKey,
  }

  const updatedOriginal: FinishedGoodsLot = {
    ...original,
    qcStatus: 'regrade_pending',
    regradedLotId: newLot.id,
    regradeTargetFinishedProductId: input.targetFinishedProductId,
    regradeTargetWarehouseItemId: input.targetWarehouseItemId,
    regradeReason: input.reason.trim(),
    updatedAt: now,
    transactionGroupId: input.idempotencyKey,
  }

  const next = {
    ...production,
    finishedGoodsLots: (production.finishedGoodsLots ?? []).flatMap((lot) => (lot.id === original.id ? [updatedOriginal, newLot] : [lot])),
  }

  return {
    production: next,
    warehouse,
    result: { ok: true, originalLot: updatedOriginal, newLot },
  }
}

export type ApplyRegradeWarehouseTransferInput = RequestRegradeInput & {
  sourceLocationId?: string
}

export type RegradeWarehouseTransferResult = {
  ok: boolean
  error?: string
  originalLot?: FinishedGoodsLot
  newLot?: FinishedGoodsLot
  documentIds?: string[]
}

export function applyRegradeWarehouseTransfer(
  production: ProductionStore,
  warehouse: WarehouseStore,
  input: ApplyRegradeWarehouseTransferInput,
): { production: ProductionStore; warehouse: WarehouseStore; result: RegradeWarehouseTransferResult } {
  const originalProduction = production
  const originalWarehouse = warehouse
  const regrade = requestRegrade(production, warehouse, input)
  if (!regrade.result.ok || !regrade.result.originalLot || !regrade.result.newLot) {
    return {
      production: originalProduction,
      warehouse: originalWarehouse,
      result: { ok: false, error: regrade.result.error },
    }
  }

  const original = regrade.result.originalLot
  const target = regrade.result.newLot
  const locationId = input.sourceLocationId ?? original.locationId
  const qty = input.quantity ?? Math.max(0, original.quantityProduced - original.quantityShipped)
  if (qty <= 0) {
    return {
      production: originalProduction,
      warehouse: originalWarehouse,
      result: { ok: false, error: QC_SHIPMENT_BLOCKED },
    }
  }

  const atomic = postWarehouseDocumentsAtomic(warehouse, [
    {
      type: 'issue',
      number: `ПЕРЕ-${original.batchNo}`,
      date: new Date().toISOString().slice(0, 10),
      warehouseId: locationId,
      purpose: 'production_fg_regrade_transfer',
      docRole: 'production_fg_regrade_transfer',
      productionOrderId: original.productionOrderId,
      packagingReportId: original.packagingReportId,
      finishedGoodsLotId: original.id,
      basisType: 'production_fg_regrade_transfer',
      basisId: original.id,
      basisNumber: original.batchNo,
      comment: `Regrade issue ${original.batchNo} → ${target.batchNo}`,
      lines: [
        {
          lineId: crypto.randomUUID(),
          itemId: original.warehouseItemId,
          quantity: qty,
          itemCodeSnapshot: original.warehouseItemId,
          itemNameSnapshot: original.batchNo,
          unitSnapshot: 'm2',
          batchNo: original.batchNo,
        },
      ],
      transactionGroupId: input.idempotencyKey,
      idempotencyKey: `${input.idempotencyKey}::issue`,
      status: 'posted',
      postedAt: new Date().toISOString(),
      postedBy: input.actor?.id,
      postedByName: input.actor?.name,
      createdBy: input.actor?.id,
      createdByName: input.actor?.name,
    },
    {
      type: 'receipt',
      number: `ПЕРЕ-${target.batchNo}`,
      date: new Date().toISOString().slice(0, 10),
      warehouseId: locationId,
      purpose: 'production_fg_regrade_transfer',
      docRole: 'production_fg_regrade_transfer',
      productionOrderId: target.productionOrderId,
      packagingReportId: target.packagingReportId,
      finishedGoodsLotId: target.id,
      basisType: 'production_fg_regrade_transfer',
      basisId: target.id,
      basisNumber: target.batchNo,
      comment: `Regrade receipt ${original.batchNo} → ${target.batchNo}`,
      lines: [
        {
          lineId: crypto.randomUUID(),
          itemId: target.warehouseItemId,
          quantity: qty,
          itemCodeSnapshot: target.warehouseItemId,
          itemNameSnapshot: target.batchNo,
          unitSnapshot: 'm2',
          batchNo: target.batchNo,
        },
      ],
      transactionGroupId: input.idempotencyKey,
      idempotencyKey: `${input.idempotencyKey}::receipt`,
      status: 'posted',
      postedAt: new Date().toISOString(),
      postedBy: input.actor?.id,
      postedByName: input.actor?.name,
      createdBy: input.actor?.id,
      createdByName: input.actor?.name,
    },
  ])
  if (!atomic.result.ok) {
    return {
      production: originalProduction,
      warehouse: originalWarehouse,
      result: { ok: false, error: atomic.result.error },
    }
  }

  const nextLots: FinishedGoodsLot[] = (regrade.production.finishedGoodsLots ?? []).map((lot) => {
    if (lot.id === original.id) {
      return {
        ...lot,
        regradedLotId: target.id,
        qcStatus: 'regrade_pending' as FinishedGoodsQcStatus,
      }
    }
    if (lot.id === target.id) {
      return {
        ...target,
        updatedAt: new Date().toISOString(),
      }
    }
    return lot
  })

  return {
    production: {
      ...regrade.production,
      finishedGoodsLots: nextLots,
    },
    warehouse: atomic.store,
    result: { ok: true, originalLot: original, newLot: target, documentIds: atomic.result.documentIds },
  }
}

export type RejectFinishedGoodsLotInput = {
  lotId: string
  reason: string
  access?: AccessStore | null
  actor?: { id?: string; name?: string; roleId?: AppUser['roleId'] }
}

export type RejectFinishedGoodsLotResult = {
  ok: boolean
  error?: string
  lot?: FinishedGoodsLot
}

export function rejectFinishedGoodsLot(
  production: ProductionStore,
  input: RejectFinishedGoodsLotInput,
): { production: ProductionStore; result: RejectFinishedGoodsLotResult } {
  if (!canReleaseFinishedGoodsQc(asActorUser(input.actor), input.access)) {
    return { production, result: { ok: false, error: QC_REJECT_FORBIDDEN } }
  }
  if (!input.reason?.trim()) {
    return { production, result: { ok: false, error: QC_REJECT_REASON } }
  }
  const lot = findLot(production, input.lotId)
  if (!lot) return { production, result: { ok: false, error: QC_NOT_FOUND } }

  const now = new Date().toISOString()
  const updated: FinishedGoodsLot = {
    ...lot,
    qcStatus: 'rejected',
    rejectReason: input.reason.trim(),
    rejectedAt: now,
    rejectedBy: input.actor?.id,
    updatedAt: now,
  }
  return {
    production: {
      ...production,
      finishedGoodsLots: (production.finishedGoodsLots ?? []).map((row) => (row.id === lot.id ? updated : row)),
    },
    result: { ok: true, lot: updated },
  }
}

export type ApplyRejectTransferInput = {
  lotId: string
  scrapLocationId: string
  actor?: { id?: string; name?: string; roleId?: AppUser['roleId'] }
  reason?: string
}

export type RejectTransferResult = {
  ok: boolean
  error?: string
  lot?: FinishedGoodsLot
  documentIds?: string[]
}

export function applyRejectTransferToScrap(
  production: ProductionStore,
  warehouse: WarehouseStore,
  input: ApplyRejectTransferInput,
): { production: ProductionStore; warehouse: WarehouseStore; result: RejectTransferResult } {
  const lot = findLot(production, input.lotId)
  if (!lot) return { production, warehouse, result: { ok: false, error: QC_NOT_FOUND } }
  const qty = computeLotRemaining(lot) || Math.max(0, lot.quantityProduced - lot.quantityShipped)
  if (qty <= 0) return { production, warehouse, result: { ok: false, error: QC_SHIPMENT_BLOCKED } }

  const transfer = postWarehouseTransfer(warehouse, {
    number: `СПИС-${lot.batchNo}`,
    date: new Date().toISOString().slice(0, 10),
    documentDateTime: new Date().toISOString(),
    warehouseId: lot.locationId,
    targetWarehouseId: input.scrapLocationId,
    sourceWarehouseId: lot.locationId,
    destinationWarehouseId: input.scrapLocationId,
    purpose: 'production_fg_reject_transfer',
    docRole: 'production_fg_reject_transfer',
    productionOrderId: lot.productionOrderId,
    packagingReportId: lot.packagingReportId,
    finishedGoodsLotId: lot.id,
    basisType: 'production_fg_reject_transfer',
    basisId: lot.id,
    basisNumber: lot.batchNo,
    comment: input.reason ? `Reject transfer: ${input.reason}` : `Reject transfer ${lot.batchNo}`,
    lines: [
      {
        lineId: crypto.randomUUID(),
        itemId: lot.warehouseItemId,
        quantity: qty,
        itemCodeSnapshot: lot.warehouseItemId,
        itemNameSnapshot: lot.batchNo,
        unitSnapshot: 'm2',
        batchNo: lot.batchNo,
      },
    ],
    transactionGroupId: `${lot.id}::reject`,
    idempotencyKey: `${lot.id}::reject`,
    status: 'posted',
    postedAt: new Date().toISOString(),
    postedBy: input.actor?.id,
    postedByName: input.actor?.name,
    createdBy: input.actor?.id,
    createdByName: input.actor?.name,
  })
  if (!transfer.result.ok) {
    return { production, warehouse, result: { ok: false, error: transfer.result.error } }
  }

  const now = new Date().toISOString()
  const postedDocumentId = transfer.result.ok ? transfer.result.documentId : undefined
  const pairId = postedDocumentId ? transfer.store.documents.find((d) => d.id === postedDocumentId)?.transferPairId : undefined
  const updated: FinishedGoodsLot = {
    ...lot,
    qcStatus: 'scrap_pending',
    scrapTransferPairId: pairId,
    warehouseId: input.scrapLocationId,
    locationId: input.scrapLocationId,
    updatedAt: now,
  }

  return {
    production: {
      ...production,
      finishedGoodsLots: (production.finishedGoodsLots ?? []).map((row) => (row.id === lot.id ? updated : row)),
    },
    warehouse: transfer.store,
    result: {
      ok: true,
      lot: updated,
      documentIds: pairId ? transfer.store.documents.filter((d) => d.transferPairId === pairId).map((d) => d.id) : [transfer.result.documentId],
    },
  }
}
