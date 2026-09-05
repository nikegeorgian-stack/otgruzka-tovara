/**
 * PHASE G5.2 — procurement receipt print model.
 * Snapshot-only: item/batch/expiry and PO remaining — no live directory lookup.
 */

import type { G5PrintMetaRow, G5PrintSignaturePlace } from './g5SalesOrderPrint'

export type G5ReceiptPrintLineSnapshot = {
  lineId: string
  itemCodeSnapshot?: string
  itemNameSnapshot?: string
  unit: string
  receivedQty: number
  /** Open remaining on PO line after this receipt */
  remainingPoQty?: number
  /** PO line requested qty (for remaining math when remainingPoQty omitted) */
  poRequestedQty?: number
  /** PO line received qty after this receipt (for remaining math) */
  poReceivedQtyAfter?: number
  batchNo?: string
  expiryDate?: string
  locationId?: string
  locationNameSnapshot?: string
  unitPrice?: number
  currency?: string
}

export type G5ReceiptPrintSnapshot = {
  id: string
  number?: string
  purchaseOrderId: string
  purchaseOrderNumber?: string
  warehouseId?: string
  warehouseNameSnapshot?: string
  locationNameSnapshot?: string
  actorName?: string
  actorUid?: string
  at?: string
  warehouseDocumentNumber?: string
  lines: G5ReceiptPrintLineSnapshot[]
}

export type G5ReceiptPrintLine = {
  lineId: string
  itemCodeSnapshot: string
  itemNameSnapshot: string
  unit: string
  receivedQty: number
  remainingPoQty: number
  batchNo?: string
  expiryDate?: string
  locationNameSnapshot?: string
  unitPrice?: number
  currency?: string
}

export type G5ReceiptPrintModel = {
  kind: 'receipt'
  title: string
  docNumber: string
  docId: string
  purchaseOrderRef: string
  warehouseNameSnapshot: string
  locationNameSnapshot?: string
  warehouseDocumentNumber?: string
  metaRows: G5PrintMetaRow[]
  lines: G5ReceiptPrintLine[]
  signaturePlaces: G5PrintSignaturePlace[]
  showPrices: boolean
  actorName?: string
  actorUid?: string
  at?: string
}

function roundQty(n: number): number {
  return Math.round((Number(n) || 0) * 1000) / 1000
}

function remainingPoQtyOf(ln: G5ReceiptPrintLineSnapshot): number {
  if (ln.remainingPoQty != null && Number.isFinite(ln.remainingPoQty)) {
    return roundQty(Math.max(0, ln.remainingPoQty))
  }
  if (ln.poRequestedQty != null && ln.poReceivedQtyAfter != null) {
    return roundQty(Math.max(0, ln.poRequestedQty - ln.poReceivedQtyAfter))
  }
  return 0
}

export function buildG5ReceiptPrintModel(
  snapshot: G5ReceiptPrintSnapshot,
  opts?: { showPrices?: boolean; title?: string },
): G5ReceiptPrintModel {
  const showPrices = opts?.showPrices === true
  const docNumber = snapshot.number ?? snapshot.warehouseDocumentNumber ?? snapshot.id
  const purchaseOrderRef = snapshot.purchaseOrderNumber ?? snapshot.purchaseOrderId
  const warehouseNameSnapshot = snapshot.warehouseNameSnapshot ?? snapshot.warehouseId ?? ''

  const lines: G5ReceiptPrintLine[] = (snapshot.lines ?? []).map((ln) => ({
    lineId: ln.lineId,
    itemCodeSnapshot: ln.itemCodeSnapshot ?? '',
    itemNameSnapshot: ln.itemNameSnapshot ?? '',
    unit: ln.unit,
    receivedQty: roundQty(ln.receivedQty),
    remainingPoQty: remainingPoQtyOf(ln),
    batchNo: ln.batchNo,
    expiryDate: ln.expiryDate,
    locationNameSnapshot: ln.locationNameSnapshot ?? snapshot.locationNameSnapshot,
    unitPrice: ln.unitPrice,
    currency: ln.currency,
  }))

  const metaRows: G5PrintMetaRow[] = [
    { label: 'purchaseOrder', value: purchaseOrderRef },
    { label: 'warehouse', value: warehouseNameSnapshot || '—' },
  ]
  if (snapshot.locationNameSnapshot) {
    metaRows.push({ label: 'location', value: snapshot.locationNameSnapshot })
  }
  if (snapshot.warehouseDocumentNumber) {
    metaRows.push({ label: 'warehouseDocument', value: snapshot.warehouseDocumentNumber })
  }
  if (snapshot.actorName || snapshot.actorUid) {
    metaRows.push({ label: 'actor', value: snapshot.actorName || snapshot.actorUid || '' })
  }
  if (snapshot.at) metaRows.push({ label: 'time', value: snapshot.at })

  return {
    kind: 'receipt',
    title: opts?.title ?? 'Receipt',
    docNumber,
    docId: snapshot.id,
    purchaseOrderRef,
    warehouseNameSnapshot,
    locationNameSnapshot: snapshot.locationNameSnapshot,
    warehouseDocumentNumber: snapshot.warehouseDocumentNumber,
    metaRows,
    lines,
    signaturePlaces: [
      { roleKey: 'g5.print.sign.receivedBy', name: snapshot.actorName },
      { roleKey: 'g5.print.sign.deliveredBy' },
      { roleKey: 'g5.print.sign.warehouse' },
    ],
    showPrices,
    actorName: snapshot.actorName,
    actorUid: snapshot.actorUid,
    at: snapshot.at,
  }
}
