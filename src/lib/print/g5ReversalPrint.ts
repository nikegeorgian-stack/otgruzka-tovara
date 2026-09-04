/**
 * PHASE G5.2 — reversal / revision print model.
 * Banner СТОРНО or ИЗМЕНЕНИЕ from snapshot kind — no live directory lookup.
 */

import type { G5PrintMetaRow, G5PrintSignaturePlace } from './g5SalesOrderPrint'

export type G5ReversalKind = 'storno' | 'change'

export type G5ReversalPrintLineSnapshot = {
  lineId: string
  itemCodeSnapshot?: string
  itemNameSnapshot?: string
  unit: string
  qty: number
  unitPrice?: number
  currency?: string
}

export type G5ReversalPrintSnapshot = {
  id: string
  number?: string
  /** Original document ref (number or id) */
  originalDocRef: string
  kind: G5ReversalKind
  revision?: number
  reason?: string
  actorName?: string
  actorUid?: string
  at?: string
  lines?: G5ReversalPrintLineSnapshot[]
}

export type G5ReversalPrintLine = {
  lineId: string
  itemCodeSnapshot: string
  itemNameSnapshot: string
  unit: string
  qty: number
  unitPrice?: number
  currency?: string
}

export type G5ReversalPrintModel = {
  kind: 'reversal'
  title: string
  docNumber: string
  docId: string
  originalDocRef: string
  reversalKind: G5ReversalKind
  revision: number
  reason?: string
  /** СТОРНО or ИЗМЕНЕНИЕ */
  banner: 'СТОРНО' | 'ИЗМЕНЕНИЕ'
  metaRows: G5PrintMetaRow[]
  lines: G5ReversalPrintLine[]
  signaturePlaces: G5PrintSignaturePlace[]
  showPrices: boolean
  actorName?: string
  actorUid?: string
  at?: string
}

function roundQty(n: number): number {
  return Math.round((Number(n) || 0) * 1000) / 1000
}

export function buildG5ReversalPrintModel(
  snapshot: G5ReversalPrintSnapshot,
  opts?: { showPrices?: boolean; title?: string },
): G5ReversalPrintModel {
  const showPrices = opts?.showPrices === true
  const revision = Number(snapshot.revision) || 0
  const docNumber = snapshot.number ?? snapshot.id
  const banner: 'СТОРНО' | 'ИЗМЕНЕНИЕ' =
    snapshot.kind === 'storno' ? 'СТОРНО' : 'ИЗМЕНЕНИЕ'

  const lines: G5ReversalPrintLine[] = (snapshot.lines ?? []).map((ln) => ({
    lineId: ln.lineId,
    itemCodeSnapshot: ln.itemCodeSnapshot ?? '',
    itemNameSnapshot: ln.itemNameSnapshot ?? '',
    unit: ln.unit,
    qty: roundQty(ln.qty),
    unitPrice: ln.unitPrice,
    currency: ln.currency,
  }))

  const metaRows: G5PrintMetaRow[] = [
    { label: 'originalDoc', value: snapshot.originalDocRef },
    { label: 'revision', value: String(revision) },
    { label: 'kind', value: banner },
  ]
  if (snapshot.reason) metaRows.push({ label: 'reason', value: snapshot.reason })
  if (snapshot.actorName || snapshot.actorUid) {
    metaRows.push({ label: 'actor', value: snapshot.actorName || snapshot.actorUid || '' })
  }
  if (snapshot.at) metaRows.push({ label: 'time', value: snapshot.at })

  return {
    kind: 'reversal',
    title: opts?.title ?? 'Reversal',
    docNumber,
    docId: snapshot.id,
    originalDocRef: snapshot.originalDocRef,
    reversalKind: snapshot.kind,
    revision,
    reason: snapshot.reason,
    banner,
    metaRows,
    lines,
    signaturePlaces: [
      { roleKey: 'g5.print.sign.responsible', name: snapshot.actorName },
      { roleKey: 'g5.print.sign.accountant' },
      { roleKey: 'g5.print.sign.director' },
    ],
    showPrices,
    actorName: snapshot.actorName,
    actorUid: snapshot.actorUid,
    at: snapshot.at,
  }
}
