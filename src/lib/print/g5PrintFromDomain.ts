/**
 * PHASE G5.3 — map domain orders/docs → G5 print models.
 * Prefer immutable snapshots; freeze live directory names only when snapshot missing.
 */

import {
  buildG5PurchaseOrderPrintModel,
  type G5PurchaseOrderPrintModel,
} from './g5PurchaseOrderPrint'
import {
  buildG5ReceiptPrintModel,
  type G5ReceiptPrintModel,
  type G5ReceiptPrintLineSnapshot,
} from './g5ReceiptPrint'
import {
  buildG5ReversalPrintModel,
  type G5ReversalPrintModel,
  type G5ReversalKind,
  type G5ReversalPrintLineSnapshot,
} from './g5ReversalPrint'
import {
  buildG5SalesOrderPrintModel,
  type G5SalesOrderPrintModel,
} from './g5SalesOrderPrint'

export type G5PrintDirectoryLookup = {
  customers?: Array<{ id: string; code?: string; name?: string }>
  suppliers?: Array<{ id: string; code?: string; name?: string }>
  products?: Array<{ id: string; code?: string; name?: string; sku?: string }>
  items?: Array<{
    id: string
    internalCode?: string
    code?: string
    sku?: string
    name?: string
  }>
  warehouses?: Array<{ id: string; name?: string }>
}

type LooseLine = Record<string, unknown>
type LooseOrder = Record<string, unknown>

function str(v: unknown): string {
  return v == null ? '' : String(v)
}

/** Prefer explicit opt, else snapshot/domain string; empty → undefined. */
function pickOptStr(opt: string | undefined, fallback: unknown): string | undefined {
  const v = opt ?? str(fallback)
  return v || undefined
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function findById<T extends { id: string }>(list: T[] | undefined, id: string | undefined): T | undefined {
  if (!id || !list) return undefined
  return list.find((x) => x.id === id)
}

function lineIdOf(ln: LooseLine, fallback: string): string {
  return str(ln.lineId || ln.id) || fallback
}

function salesQtyOf(ln: LooseLine): number {
  if (ln.quantity != null) return num(ln.quantity)
  if (ln.qty != null) return num(ln.qty)
  if (ln.qtyMp != null) return num(ln.qtyMp)
  return 0
}

function salesShippedOf(ln: LooseLine): number {
  if (ln.shippedQty != null) return num(ln.shippedQty)
  const progress = ln.progress as { shippedQty?: number } | undefined
  if (progress?.shippedQty != null) return num(progress.shippedQty)
  return 0
}

function poRequestedOf(ln: LooseLine): number {
  if (ln.requestedQty != null) return num(ln.requestedQty)
  if (ln.quantity != null) return num(ln.quantity)
  return 0
}

function orderRevision(order: LooseOrder): number {
  return num(order.revision) || 0
}

function orderStatus(order: LooseOrder): string {
  return str(order.commercialStatus || order.status)
}

/** True when print should use ИЗМЕНЕНИЕ reversal (revision>1 or explicit status change). */
export function shouldPrintChange(
  order: LooseOrder,
  opts?: { statusChanged?: boolean },
): boolean {
  if (opts?.statusChanged === true) return true
  return orderRevision(order) > 1
}

export function isCancelledStatus(status: string | undefined): boolean {
  const s = (status ?? '').toLowerCase()
  return s === 'cancelled' || s === 'canceled'
}

export type SalesOrderToPrintOpts = {
  showPrices?: boolean
  title?: string
  directories?: G5PrintDirectoryLookup
  actorName?: string
  actorUid?: string
  at?: string
}

export function salesOrderToPrintModel(
  order: LooseOrder,
  opts?: SalesOrderToPrintOpts,
): G5SalesOrderPrintModel {
  const directories = opts?.directories
  const customerId = str(order.customerId || order.counterpartyId)
  const customer = findById(directories?.customers, customerId)
  const customerCodeSnapshot =
    str(order.customerCodeSnapshot) || customer?.code || ''
  const customerNameSnapshot =
    str(order.customerNameSnapshot) ||
    customer?.name ||
    str(order.customer) ||
    ''

  const priorityRaw = order.priority
  let priority: number | undefined
  if (typeof priorityRaw === 'number') priority = priorityRaw
  else if (priorityRaw === 'urgent') priority = 10
  else if (priorityRaw === 'normal') priority = 1
  else if (priorityRaw != null) priority = num(priorityRaw)

  const linesIn = Array.isArray(order.lines) ? (order.lines as LooseLine[]) : []
  const lines = linesIn.map((ln, i) => {
    const fpId = str(ln.finishedProductId || ln.productId)
    const fp = findById(directories?.products, fpId)
    return {
      lineId: lineIdOf(ln, `sol-${i + 1}`),
      productCodeSnapshot:
        str(ln.productCodeSnapshot) || fp?.code || fp?.sku || '',
      productNameSnapshot:
        str(ln.productNameSnapshot) || fp?.name || str(ln.productName) || '',
      unit: str(ln.unit) || 'mp',
      qty: salesQtyOf(ln),
      requestedShipDate:
        str(ln.requestedShipDate) || str(order.dueDate) || undefined,
      priority: ln.priority != null ? num(ln.priority) : priority,
      shippedQty: salesShippedOf(ln),
      remainingQty: ln.remainingQty != null ? num(ln.remainingQty) : undefined,
      unitPrice: ln.unitPrice != null ? num(ln.unitPrice) : undefined,
      currency: str(ln.currency) || undefined,
    }
  })

  return buildG5SalesOrderPrintModel(
    {
      id: str(order.id),
      number: str(order.orderNumber || order.number) || undefined,
      status: orderStatus(order) || undefined,
      revision: orderRevision(order) || 1,
      customerCodeSnapshot,
      customerNameSnapshot,
      priority,
      actorName: pickOptStr(opts?.actorName, order.actorName || order.updatedByName),
      actorUid: pickOptStr(opts?.actorUid, order.actorUid || order.updatedBy),
      at: pickOptStr(opts?.at, order.updatedAt || order.at),
      lines,
    },
    { showPrices: opts?.showPrices === true, title: opts?.title },
  )
}

export type PurchaseOrderToPrintOpts = {
  showPrices?: boolean
  title?: string
  directories?: G5PrintDirectoryLookup
  actorName?: string
  actorUid?: string
  at?: string
}

export function purchaseOrderToPrintModel(
  order: LooseOrder,
  opts?: PurchaseOrderToPrintOpts,
): G5PurchaseOrderPrintModel {
  const directories = opts?.directories
  const supplierId = str(order.supplierId || order.counterpartyId)
  const supplier = findById(directories?.suppliers, supplierId)
  const supplierCodeSnapshot =
    str(order.supplierCodeSnapshot) || supplier?.code || ''
  const supplierNameSnapshot =
    str(order.supplierNameSnapshot) || supplier?.name || ''

  const linesIn = Array.isArray(order.lines) ? (order.lines as LooseLine[]) : []
  const lines = linesIn.map((ln, i) => {
    const itemId = str(ln.itemId || ln.warehouseItemId)
    const item = findById(directories?.items, itemId)
    return {
      lineId: lineIdOf(ln, `pol-${i + 1}`),
      itemCodeSnapshot:
        str(ln.itemCodeSnapshot) ||
        item?.internalCode ||
        item?.code ||
        item?.sku ||
        str(ln.supplierSku) ||
        '',
      itemNameSnapshot:
        str(ln.itemNameSnapshot) || item?.name || str(ln.name) || '',
      unit: str(ln.unit) || 'шт',
      requestedQty: poRequestedOf(ln),
      receivedQty: num(ln.receivedQty),
      moq: ln.moq != null ? num(ln.moq) : undefined,
      orderMultiple: ln.orderMultiple != null ? num(ln.orderMultiple) : undefined,
      unitPrice: ln.unitPrice != null ? num(ln.unitPrice) : undefined,
      currency: str(ln.currency) || str(order.currency) || undefined,
      requiredDate:
        str(ln.requiredDate) ||
        str(order.requestedDeliveryDate) ||
        undefined,
      eta: str(ln.eta) || str(order.confirmedDeliveryDate) || undefined,
      sourceShortageIds: Array.isArray(ln.sourceShortageIds)
        ? (ln.sourceShortageIds as unknown[]).map(str)
        : undefined,
    }
  })

  return buildG5PurchaseOrderPrintModel(
    {
      id: str(order.id),
      number: str(order.orderNumber || order.number) || undefined,
      status: str(order.status) || undefined,
      revision: orderRevision(order) || 1,
      supplierCodeSnapshot,
      supplierNameSnapshot,
      currency: str(order.currency) || undefined,
      changeReason: str(order.changeReason) || undefined,
      approvedByName: str(order.approvedByName) || undefined,
      approvedBy: str(order.approvedBy) || undefined,
      approvedAt: str(order.approvedAt) || undefined,
      actorName: pickOptStr(opts?.actorName, order.actorName || order.updatedByName),
      actorUid: pickOptStr(opts?.actorUid, order.actorUid || order.updatedBy),
      at: pickOptStr(opts?.at, order.updatedAt || order.at),
      lines,
    },
    { showPrices: opts?.showPrices === true, title: opts?.title },
  )
}

export type ReceiptToPrintOpts = {
  showPrices?: boolean
  title?: string
  directories?: G5PrintDirectoryLookup
  actorName?: string
  actorUid?: string
  at?: string
}

/** Warehouse doc or embedded receipt → G5 receipt print model. */
export function receiptToPrintModel(
  receiptOrDoc: LooseOrder,
  po?: LooseOrder | null,
  opts?: ReceiptToPrintOpts,
): G5ReceiptPrintModel {
  const directories = opts?.directories
  const warehouseId = str(receiptOrDoc.warehouseId)
  const wh = findById(directories?.warehouses, warehouseId)
  const purchaseOrderId =
    str(receiptOrDoc.purchaseOrderId) || str(po?.id) || ''
  const purchaseOrderNumber =
    str(receiptOrDoc.purchaseOrderNumber) ||
    str(po?.orderNumber || po?.number) ||
    undefined

  const poLines = Array.isArray(po?.lines) ? (po!.lines as LooseLine[]) : []
  const poLineById = new Map(poLines.map((ln) => [lineIdOf(ln, ''), ln]))

  const linesIn = Array.isArray(receiptOrDoc.lines)
    ? (receiptOrDoc.lines as LooseLine[])
    : []

  const lines: G5ReceiptPrintLineSnapshot[] = linesIn.map((ln, i) => {
    const itemId = str(ln.itemId || ln.warehouseItemId)
    const item = findById(directories?.items, itemId)
    const poLineId = str(ln.purchaseOrderLineId || ln.poLineId || ln.lineId || ln.id)
    const poLine = poLineById.get(poLineId) || poLines.find((p) => str(p.itemId || p.warehouseItemId) === itemId)
    const receivedQty = num(ln.receivedQty != null ? ln.receivedQty : ln.quantity)
    const poRequested = poLine ? poRequestedOf(poLine) : undefined
    const poReceivedAfter =
      poLine != null
        ? num(poLine.receivedQty)
        : ln.poReceivedQtyAfter != null
          ? num(ln.poReceivedQtyAfter)
          : undefined

    return {
      lineId: lineIdOf(ln, `rl-${i + 1}`),
      itemCodeSnapshot:
        str(ln.itemCodeSnapshot) ||
        item?.internalCode ||
        item?.code ||
        item?.sku ||
        '',
      itemNameSnapshot:
        str(ln.itemNameSnapshot) || item?.name || str(ln.name) || '',
      unit: str(ln.unit || ln.unitSnapshot) || 'шт',
      receivedQty,
      remainingPoQty:
        ln.remainingPoQty != null ? num(ln.remainingPoQty) : undefined,
      poRequestedQty: poRequested,
      poReceivedQtyAfter: poReceivedAfter,
      batchNo: str(ln.batchNo) || undefined,
      expiryDate: str(ln.expiryDate) || undefined,
      locationId: str(ln.locationId || ln.destinationLocationId) || undefined,
      locationNameSnapshot: str(ln.locationNameSnapshot) || undefined,
      unitPrice: ln.unitPrice != null ? num(ln.unitPrice) : undefined,
      currency: str(ln.currency) || str(po?.currency) || undefined,
    }
  })

  return buildG5ReceiptPrintModel(
    {
      id: str(receiptOrDoc.id),
      number:
        str(receiptOrDoc.number || receiptOrDoc.receiptNumber) || undefined,
      purchaseOrderId,
      purchaseOrderNumber,
      warehouseId: warehouseId || undefined,
      warehouseNameSnapshot:
        str(receiptOrDoc.warehouseNameSnapshot) || wh?.name || warehouseId || undefined,
      locationNameSnapshot: str(receiptOrDoc.locationNameSnapshot) || undefined,
      actorName: pickOptStr(
        opts?.actorName,
        receiptOrDoc.actorName || receiptOrDoc.postedByName || receiptOrDoc.keeperName,
      ),
      actorUid: pickOptStr(opts?.actorUid, receiptOrDoc.actorUid || receiptOrDoc.postedBy),
      at: pickOptStr(opts?.at, receiptOrDoc.at || receiptOrDoc.postedAt || receiptOrDoc.updatedAt),
      warehouseDocumentNumber:
        str(receiptOrDoc.warehouseDocumentNumber || receiptOrDoc.number) ||
        undefined,
      lines,
    },
    { showPrices: opts?.showPrices === true, title: opts?.title },
  )
}

/** Merge multiple partial receipt docs into one print model (history). */
export function purchaseOrderReceiptsHistoryToPrintModel(
  order: LooseOrder,
  receiptsOrDocs: LooseOrder[],
  opts?: ReceiptToPrintOpts,
): G5ReceiptPrintModel | null {
  if (!receiptsOrDocs.length) return null
  if (receiptsOrDocs.length === 1) {
    return receiptToPrintModel(receiptsOrDocs[0], order, opts)
  }
  const mergedLines: G5ReceiptPrintLineSnapshot[] = []
  for (const doc of receiptsOrDocs) {
    const one = receiptToPrintModel(doc, order, opts)
    for (const ln of one.lines) {
      mergedLines.push({
        lineId: `${one.docId}:${ln.lineId}`,
        itemCodeSnapshot: ln.itemCodeSnapshot,
        itemNameSnapshot: ln.itemNameSnapshot,
        unit: ln.unit,
        receivedQty: ln.receivedQty,
        remainingPoQty: ln.remainingPoQty,
        batchNo: ln.batchNo,
        expiryDate: ln.expiryDate,
        locationNameSnapshot: ln.locationNameSnapshot,
        unitPrice: ln.unitPrice,
        currency: ln.currency,
      })
    }
  }
  const first = receiptsOrDocs[0]
  return buildG5ReceiptPrintModel(
    {
      id: `rcpt-hist-${str(order.id)}`,
      number: str(order.orderNumber || order.number)
        ? `${str(order.orderNumber || order.number)}-RCPT`
        : undefined,
      purchaseOrderId: str(order.id),
      purchaseOrderNumber: str(order.orderNumber || order.number) || undefined,
      warehouseId: str(first.warehouseId) || undefined,
      warehouseNameSnapshot:
        str(first.warehouseNameSnapshot) ||
        findById(opts?.directories?.warehouses, str(first.warehouseId))?.name,
      warehouseDocumentNumber: receiptsOrDocs
        .map((d) => str(d.number))
        .filter(Boolean)
        .join(', '),
      actorName: opts?.actorName,
      actorUid: opts?.actorUid,
      at: opts?.at,
      lines: mergedLines,
    },
    { showPrices: opts?.showPrices === true, title: opts?.title },
  )
}

export type ReversalToPrintArgs = {
  kind: G5ReversalKind
  id: string
  number?: string
  originalDocRef: string
  revision?: number
  reason?: string
  actorName?: string
  actorUid?: string
  at?: string
  lines?: G5ReversalPrintLineSnapshot[]
  showPrices?: boolean
  title?: string
  /** Domain order used to fill lines/snapshots when lines omitted. */
  order?: LooseOrder
  directories?: G5PrintDirectoryLookup
}

export function reversalToPrintModel(args: ReversalToPrintArgs): G5ReversalPrintModel {
  let lines = args.lines
  if ((!lines || lines.length === 0) && args.order) {
    const order = args.order
    const linesIn = Array.isArray(order.lines) ? (order.lines as LooseLine[]) : []
    const isSales = Boolean(
      order.customerId ||
        order.counterpartyId ||
        order.customer ||
        order.customerNameSnapshot ||
        linesIn.some((ln) => ln.finishedProductId || ln.productNameSnapshot || ln.qtyMp != null),
    )
    lines = linesIn.map((ln, i) => {
      if (isSales) {
        const fpId = str(ln.finishedProductId || ln.productId)
        const fp = findById(args.directories?.products, fpId)
        return {
          lineId: lineIdOf(ln, `rl-${i + 1}`),
          itemCodeSnapshot:
            str(ln.productCodeSnapshot) || fp?.code || fp?.sku || '',
          itemNameSnapshot:
            str(ln.productNameSnapshot) || fp?.name || str(ln.productName) || '',
          unit: str(ln.unit) || 'mp',
          qty: salesQtyOf(ln),
          unitPrice: ln.unitPrice != null ? num(ln.unitPrice) : undefined,
          currency: str(ln.currency) || undefined,
        }
      }
      const itemId = str(ln.itemId || ln.warehouseItemId)
      const item = findById(args.directories?.items, itemId)
      return {
        lineId: lineIdOf(ln, `rl-${i + 1}`),
        itemCodeSnapshot:
          str(ln.itemCodeSnapshot) ||
          item?.internalCode ||
          item?.code ||
          item?.sku ||
          '',
        itemNameSnapshot:
          str(ln.itemNameSnapshot) || item?.name || str(ln.name) || '',
        unit: str(ln.unit) || 'шт',
        qty: poRequestedOf(ln) || num(ln.quantity),
        unitPrice: ln.unitPrice != null ? num(ln.unitPrice) : undefined,
        currency: str(ln.currency) || str(order.currency) || undefined,
      }
    })
  }

  return buildG5ReversalPrintModel(
    {
      id: args.id,
      number: args.number,
      originalDocRef: args.originalDocRef,
      kind: args.kind,
      revision: args.revision ?? (args.order ? orderRevision(args.order) : 0),
      reason: args.reason,
      actorName: args.actorName,
      actorUid: args.actorUid,
      at: args.at,
      lines,
    },
    { showPrices: args.showPrices === true, title: args.title },
  )
}

/** Detect G5 / procurement-linked warehouse document for preferential print path. */
export function isG5WarehousePrintDoc(doc: LooseOrder): boolean {
  if (str(doc.purchaseOrderId)) return true
  if (str(doc.purpose) === 'purchase') return true
  const role = str(doc.docRole)
  if (
    role === 'procurement_receipt' ||
    role === 'reversal' ||
    role === 'finished_goods_shipment_cancel'
  ) {
    return true
  }
  if (str(doc.reversesDocumentId)) return true
  return false
}

export function warehouseDocToReversalPrintModel(
  doc: LooseOrder,
  opts?: {
    showPrices?: boolean
    directories?: G5PrintDirectoryLookup
    originalDocRef?: string
    reason?: string
  },
): G5ReversalPrintModel {
  const linesIn = Array.isArray(doc.lines) ? (doc.lines as LooseLine[]) : []
  const lines: G5ReversalPrintLineSnapshot[] = linesIn.map((ln, i) => {
    const itemId = str(ln.itemId)
    const item = findById(opts?.directories?.items, itemId)
    return {
      lineId: lineIdOf(ln, `wdl-${i + 1}`),
      itemCodeSnapshot:
        str(ln.itemCodeSnapshot) ||
        item?.internalCode ||
        item?.code ||
        item?.sku ||
        '',
      itemNameSnapshot:
        str(ln.itemNameSnapshot) || item?.name || '',
      unit: str(ln.unit || ln.unitSnapshot) || 'шт',
      qty: num(ln.quantity),
      unitPrice: ln.unitPrice != null ? num(ln.unitPrice) : undefined,
    }
  })
  return reversalToPrintModel({
    kind: 'storno',
    id: str(doc.id),
    number: str(doc.number) || undefined,
    originalDocRef:
      opts?.originalDocRef ||
      str(doc.reversesDocumentId) ||
      str(doc.number) ||
      str(doc.id),
    revision: num(doc.revision) || 1,
    reason: opts?.reason || str(doc.cancellationReason) || undefined,
    actorName: str(doc.cancelledByName || doc.postedByName || doc.actorName) || undefined,
    actorUid: str(doc.cancelledBy || doc.postedBy || doc.actorUid) || undefined,
    at: str(doc.cancelledAt || doc.postedAt || doc.at) || undefined,
    lines,
    showPrices: opts?.showPrices === true,
  })
}
