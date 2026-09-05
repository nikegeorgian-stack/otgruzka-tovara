/**
 * PHASE G5.2 — purchase order print model.
 * Uses immutable supplier/item snapshots only — never live directory lookup.
 */

import type { G5PrintMetaRow, G5PrintSignaturePlace } from './g5SalesOrderPrint'

export type G5PurchaseOrderPrintLineSnapshot = {
  lineId: string
  itemCodeSnapshot?: string
  itemNameSnapshot?: string
  unit: string
  requestedQty: number
  receivedQty?: number
  moq?: number
  orderMultiple?: number
  unitPrice?: number
  currency?: string
  requiredDate?: string
  eta?: string
  sourceShortageIds?: string[]
}

export type G5PurchaseOrderPrintSnapshot = {
  id: string
  number?: string
  status?: string
  revision?: number
  supplierCodeSnapshot?: string
  supplierNameSnapshot?: string
  currency?: string
  changeReason?: string
  approvedByName?: string
  approvedBy?: string
  approvedAt?: string
  actorName?: string
  actorUid?: string
  at?: string
  lines: G5PurchaseOrderPrintLineSnapshot[]
}

export type G5PurchaseOrderPrintLine = {
  lineId: string
  itemCodeSnapshot: string
  itemNameSnapshot: string
  unit: string
  requestedQty: number
  receivedQty: number
  remainingQty: number
  moq?: number
  orderMultiple?: number
  unitPrice?: number
  currency?: string
  requiredDate?: string
  eta?: string
  sourceShortageIds: string[]
}

export type G5PurchaseOrderPrintModel = {
  kind: 'purchase_order'
  title: string
  docNumber: string
  docId: string
  revision: number
  status?: string
  banner?: 'ИЗМЕНЕНИЕ'
  supplierCodeSnapshot: string
  supplierNameSnapshot: string
  currency?: string
  changeReason?: string
  metaRows: G5PrintMetaRow[]
  lines: G5PurchaseOrderPrintLine[]
  signaturePlaces: G5PrintSignaturePlace[]
  showPrices: boolean
  approvedByName?: string
  approvedBy?: string
  approvedAt?: string
  actorName?: string
  actorUid?: string
  at?: string
}

function roundQty(n: number): number {
  return Math.round((Number(n) || 0) * 1000) / 1000
}

export function buildG5PurchaseOrderPrintModel(
  snapshot: G5PurchaseOrderPrintSnapshot,
  opts?: { showPrices?: boolean; title?: string },
): G5PurchaseOrderPrintModel {
  const revision = Number(snapshot.revision) || 0
  const showPrices = opts?.showPrices === true
  const supplierCodeSnapshot = snapshot.supplierCodeSnapshot ?? ''
  const supplierNameSnapshot = snapshot.supplierNameSnapshot ?? ''
  const docNumber = snapshot.number ?? snapshot.id

  const lines: G5PurchaseOrderPrintLine[] = (snapshot.lines ?? []).map((ln) => {
    const requestedQty = roundQty(ln.requestedQty)
    const receivedQty = roundQty(ln.receivedQty ?? 0)
    return {
      lineId: ln.lineId,
      itemCodeSnapshot: ln.itemCodeSnapshot ?? '',
      itemNameSnapshot: ln.itemNameSnapshot ?? '',
      unit: ln.unit,
      requestedQty,
      receivedQty,
      remainingQty: roundQty(Math.max(0, requestedQty - receivedQty)),
      moq: ln.moq,
      orderMultiple: ln.orderMultiple,
      unitPrice: ln.unitPrice,
      currency: ln.currency ?? snapshot.currency,
      requiredDate: ln.requiredDate,
      eta: ln.eta,
      sourceShortageIds: Array.isArray(ln.sourceShortageIds) ? [...ln.sourceShortageIds] : [],
    }
  })

  const metaRows: G5PrintMetaRow[] = [
    {
      label: 'supplier',
      value: [supplierCodeSnapshot, supplierNameSnapshot].filter(Boolean).join(' · ') || '—',
    },
    { label: 'revision', value: String(revision) },
  ]
  if (snapshot.status) metaRows.push({ label: 'status', value: snapshot.status })
  if (snapshot.currency) metaRows.push({ label: 'currency', value: snapshot.currency })
  if (snapshot.approvedByName || snapshot.approvedBy) {
    metaRows.push({
      label: 'approvedBy',
      value: snapshot.approvedByName || snapshot.approvedBy || '',
    })
  }
  if (snapshot.approvedAt) metaRows.push({ label: 'approvedAt', value: snapshot.approvedAt })
  if (snapshot.changeReason) metaRows.push({ label: 'changeReason', value: snapshot.changeReason })
  if (snapshot.actorName || snapshot.actorUid) {
    metaRows.push({ label: 'actor', value: snapshot.actorName || snapshot.actorUid || '' })
  }
  if (snapshot.at) metaRows.push({ label: 'time', value: snapshot.at })

  return {
    kind: 'purchase_order',
    title: opts?.title ?? 'Purchase order',
    docNumber,
    docId: snapshot.id,
    revision,
    status: snapshot.status,
    banner: revision > 1 ? 'ИЗМЕНЕНИЕ' : undefined,
    supplierCodeSnapshot,
    supplierNameSnapshot,
    currency: snapshot.currency,
    changeReason: snapshot.changeReason,
    metaRows,
    lines,
    signaturePlaces: [
      {
        roleKey: 'g5.print.sign.approver',
        name: snapshot.approvedByName || snapshot.approvedBy,
      },
      { roleKey: 'g5.print.sign.procurement', name: snapshot.actorName },
      { roleKey: 'g5.print.sign.supplier' },
    ],
    showPrices,
    approvedByName: snapshot.approvedByName,
    approvedBy: snapshot.approvedBy,
    approvedAt: snapshot.approvedAt,
    actorName: snapshot.actorName,
    actorUid: snapshot.actorUid,
    at: snapshot.at,
  }
}
