/**
 * PHASE G5.2 — sales order print model.
 * Uses immutable snapshots only — never live customer/product directory lookup.
 */

export type G5PrintMetaRow = { label: string; value: string }

export type G5PrintSignaturePlace = {
  /** i18n key, e.g. g5.print.sign.responsible */
  roleKey: string
  name?: string
}

export type G5SalesOrderPrintLineSnapshot = {
  lineId: string
  productCodeSnapshot?: string
  productNameSnapshot?: string
  unit: string
  qty: number
  requestedShipDate?: string
  priority?: number
  shippedQty?: number
  remainingQty?: number
  unitPrice?: number
  currency?: string
}

export type G5SalesOrderPrintSnapshot = {
  id: string
  number?: string
  status?: string
  revision?: number
  customerCodeSnapshot?: string
  customerNameSnapshot?: string
  priority?: number
  actorName?: string
  actorUid?: string
  at?: string
  lines: G5SalesOrderPrintLineSnapshot[]
}

export type G5SalesOrderPrintLine = {
  lineId: string
  productCodeSnapshot: string
  productNameSnapshot: string
  unit: string
  qty: number
  requestedShipDate?: string
  priority?: number
  shippedQty: number
  remainingQty: number
  unitPrice?: number
  currency?: string
}

export type G5SalesOrderPrintModel = {
  kind: 'sales_order'
  title: string
  docNumber: string
  docId: string
  revision: number
  status?: string
  /** ИЗМЕНЕНИЕ when revision > 1 */
  banner?: 'ИЗМЕНЕНИЕ'
  customerCodeSnapshot: string
  customerNameSnapshot: string
  metaRows: G5PrintMetaRow[]
  lines: G5SalesOrderPrintLine[]
  signaturePlaces: G5PrintSignaturePlace[]
  showPrices: boolean
  actorName?: string
  actorUid?: string
  at?: string
}

function roundQty(n: number): number {
  return Math.round((Number(n) || 0) * 1000) / 1000
}

function remainingOf(qty: number, shipped: number, explicit?: number): number {
  if (explicit != null && Number.isFinite(explicit)) return roundQty(Math.max(0, explicit))
  return roundQty(Math.max(0, qty - shipped))
}

export function buildG5SalesOrderPrintModel(
  snapshot: G5SalesOrderPrintSnapshot,
  opts?: { showPrices?: boolean; title?: string },
): G5SalesOrderPrintModel {
  const revision = Number(snapshot.revision) || 0
  const showPrices = opts?.showPrices === true
  const customerCodeSnapshot = snapshot.customerCodeSnapshot ?? ''
  const customerNameSnapshot = snapshot.customerNameSnapshot ?? ''
  const docNumber = snapshot.number ?? snapshot.id

  const lines: G5SalesOrderPrintLine[] = (snapshot.lines ?? []).map((ln) => {
    const qty = roundQty(ln.qty)
    const shippedQty = roundQty(ln.shippedQty ?? 0)
    return {
      lineId: ln.lineId,
      productCodeSnapshot: ln.productCodeSnapshot ?? '',
      productNameSnapshot: ln.productNameSnapshot ?? '',
      unit: ln.unit,
      qty,
      requestedShipDate: ln.requestedShipDate,
      priority: ln.priority,
      shippedQty,
      remainingQty: remainingOf(qty, shippedQty, ln.remainingQty),
      unitPrice: ln.unitPrice,
      currency: ln.currency,
    }
  })

  const metaRows: G5PrintMetaRow[] = [
    { label: 'customer', value: [customerCodeSnapshot, customerNameSnapshot].filter(Boolean).join(' · ') || '—' },
    { label: 'revision', value: String(revision) },
  ]
  if (snapshot.status) metaRows.push({ label: 'status', value: snapshot.status })
  if (snapshot.priority != null) metaRows.push({ label: 'priority', value: String(snapshot.priority) })
  if (snapshot.actorName || snapshot.actorUid) {
    metaRows.push({ label: 'actor', value: snapshot.actorName || snapshot.actorUid || '' })
  }
  if (snapshot.at) metaRows.push({ label: 'time', value: snapshot.at })

  return {
    kind: 'sales_order',
    title: opts?.title ?? 'Sales order',
    docNumber,
    docId: snapshot.id,
    revision,
    status: snapshot.status,
    banner: revision > 1 ? 'ИЗМЕНЕНИЕ' : undefined,
    customerCodeSnapshot,
    customerNameSnapshot,
    metaRows,
    lines,
    signaturePlaces: [
      { roleKey: 'g5.print.sign.responsible', name: snapshot.actorName },
      { roleKey: 'g5.print.sign.customer' },
      { roleKey: 'g5.print.sign.warehouse' },
    ],
    showPrices,
    actorName: snapshot.actorName,
    actorUid: snapshot.actorUid,
    at: snapshot.at,
  }
}
