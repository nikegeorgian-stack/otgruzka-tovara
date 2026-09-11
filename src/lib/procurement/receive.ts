import type { AppStore } from '@/lib/types'
import { nextDocumentNumber } from '@/lib/warehouse/docNumbering'
import { postWarehouseDocument } from '@/lib/warehouse/documents'
import { upsertWarehouseItemInStore } from '@/lib/warehouse/itemHistory'
import type { WarehouseDocumentLine, WarehouseStore } from '@/lib/warehouse/types'
import { receivedPercent } from './status'
import { createStatusChange } from './statusHistory'
import type { PurchaseOrder } from './types'
import { warehouseItemFromOrderLine } from './warehouseFromLine'

export type ReceiveOrderResult =
  | { ok: true; documentId: string }
  | { ok: false; error: string }

export type ReceiveOrderOpts = {
  date?: string
  /** lineId → qty к приёмке (не больше остатка). Без карты — всё оставшееся. */
  lineQtys?: Record<string, number>
  locationIdByLine?: Record<string, string>
  batchNoByLine?: Record<string, string>
  expiryDateByLine?: Record<string, string>
}

export type AuthoritativePurchaseOrderReceiptPlan =
  | {
      ok: true
      purchaseOrderId: string
      warehouseId: string
      date: string
      lines: Array<{
        lineId: string
        itemId: string
        quantity: number
        unit: string
        locationId?: string
        batchNo?: string
        expiryDate?: string
        expectedReceivedQty: number
      }>
    }
  | { ok: false; error: string }

/**
 * Build the strict G5 receipt command without inventing a destination or a
 * catalogue identity. Unlike the legacy local helper, this function is pure
 * and never auto-creates warehouse items.
 */
export function buildAuthoritativePurchaseOrderReceiptPlan(
  app: AppStore,
  orderId: string,
  opts: ReceiveOrderOpts = {},
): AuthoritativePurchaseOrderReceiptPlan {
  const order = app.procurement?.orders.find((row) => row.id === orderId)
  if (!order) return { ok: false, error: 'procurement.receive.errNotFound' }
  if (order.status === 'cancelled') {
    return { ok: false, error: 'procurement.receive.errCancelled' }
  }
  if (!['approved', 'ordered', 'partial', 'partially_received'].includes(String(order.status))) {
    return { ok: false, error: 'procurement.receive.errDraft' }
  }
  const date = String(opts.date ?? new Date().toISOString().slice(0, 10)).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: 'procurement.receive.errDate' }
  }
  const warehouseId = String(order.destinationWarehouseId ?? '').trim()
  const destinationExists =
    warehouseId &&
    (app.warehouse.locations.some((location) => location.id === warehouseId) ||
      (app.warehouse.accountingByWarehouse ?? []).some(
        (row) =>
          (row.warehouseId === warehouseId || row.id === warehouseId) &&
          row.status === 'active',
      ))
  if (!destinationExists) {
    return { ok: false, error: 'procurement.receive.errNoWarehouse' }
  }

  const ids = order.lines.map((line) => line.id)
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    return { ok: false, error: 'procurement.receive.errInvalidLines' }
  }
  const lines: Extract<AuthoritativePurchaseOrderReceiptPlan, { ok: true }>['lines'] = []
  for (const line of order.lines) {
    const requested = Number(line.quantity)
    const received = Number(line.receivedQty)
    if (
      !Number.isFinite(requested) ||
      requested <= 0 ||
      !Number.isFinite(received) ||
      received < 0 ||
      received > requested + 1e-9
    ) {
      return { ok: false, error: 'procurement.receive.errInvalidLines' }
    }
    const remaining = Math.max(0, requested - received)
    if (remaining <= 1e-9) continue
    const hasExplicitQty = opts.lineQtys != null && Object.hasOwn(opts.lineQtys, line.id)
    const quantity = hasExplicitQty ? Number(opts.lineQtys?.[line.id]) : remaining
    if (opts.lineQtys != null && !hasExplicitQty) continue
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > remaining + 1e-9) {
      return { ok: false, error: 'procurement.receive.errOverRemain' }
    }
    const itemId = String(line.warehouseItemId ?? '').trim()
    const item = app.warehouse.items.find((row) => row.id === itemId && row.active !== false)
    if (!item || !itemId || !line.unit || item.unit !== line.unit) {
      return { ok: false, error: 'procurement.receive.errCatalogueItemRequired' }
    }
    const locationId = String(opts.locationIdByLine?.[line.id] ?? '').trim()
    if (locationId && !app.warehouse.locations.some((location) => location.id === locationId)) {
      return { ok: false, error: 'procurement.receive.errNoWarehouse' }
    }
    const batchNo = String(opts.batchNoByLine?.[line.id] ?? '').trim()
    const expiryDate = String(opts.expiryDateByLine?.[line.id] ?? '').trim().slice(0, 10)
    if (expiryDate && !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) {
      return { ok: false, error: 'procurement.receive.errDate' }
    }
    lines.push({
      lineId: line.id,
      itemId,
      quantity,
      unit: line.unit,
      ...(locationId ? { locationId } : {}),
      ...(batchNo ? { batchNo } : {}),
      ...(expiryDate ? { expiryDate } : {}),
      expectedReceivedQty: received + quantity,
    })
  }
  if (lines.length === 0) return { ok: false, error: 'procurement.receive.errNothing' }
  return { ok: true, purchaseOrderId: order.id, warehouseId, date, lines }
}

/**
 * Принять заказ закупки: создаёт приходный документ,
 * заводит недостающие позиции номенклатуры, проставляет receivedQty/статус заказа
 * и связь с документом. Кросс-стор операция (закупки + склад) в одном патче.
 *
 * На web G1/G5 путь вызывающий код обязан провести склад через сервер
 * (preparePurchaseOrderReceipt + authoritative post), иначе локальный success
 * будет стёрт G1 overlay после reload (FST-CYCLE-003).
 */
export function receivePurchaseOrderInStore(
  app: AppStore,
  orderId: string,
  opts: ReceiveOrderOpts = {},
): { store: AppStore; result: ReceiveOrderResult } {
  const prepared = preparePurchaseOrderReceipt(app, orderId, opts)
  if (!prepared.ok) {
    return { store: app, result: { ok: false, error: prepared.error } }
  }

  const { store: warehouseAfter, result } = postWarehouseDocument(
    prepared.warehouseWithItems,
    prepared.documentInput,
  )

  if (!result.ok) {
    return { store: app, result: { ok: false, error: result.error } }
  }

  return {
    store: applyPurchaseOrderReceiptAck(app, prepared, result.documentId, warehouseAfter),
    result: { ok: true, documentId: result.documentId },
  }
}

export type PreparePurchaseOrderReceipt =
  | {
      ok: true
      order: PurchaseOrder
      warehouseWithItems: WarehouseStore
      documentInput: Omit<
        import('@/lib/warehouse/types').WarehouseDocument,
        'id' | 'createdAt' | 'status' | 'movements'
      > & { lines: WarehouseDocumentLine[] }
      receivedAdd: Map<string, number>
      itemByLine: Map<string, string>
      number: string
    }
  | { ok: false; error: string }

/** Build receipt plan without posting (for G1/G5 authoritative path). */
export function preparePurchaseOrderReceipt(
  app: AppStore,
  orderId: string,
  opts: ReceiveOrderOpts = {},
): PreparePurchaseOrderReceipt {
  const date = opts.date ?? new Date().toISOString().slice(0, 10)
  const lineQtys = opts.lineQtys
  const proc = app.procurement
  const order = proc?.orders.find((o) => o.id === orderId)
  if (!proc || !order) {
    return { ok: false, error: 'procurement.receive.errNotFound' }
  }
  if (order.status === 'cancelled') {
    return { ok: false, error: 'procurement.receive.errCancelled' }
  }
  if (order.status === 'draft') {
    return { ok: false, error: 'procurement.receive.errDraft' }
  }

  let warehouse: WarehouseStore = app.warehouse
  const destId = order.destinationWarehouseId || warehouse.locations[0]?.id || ''
  if (!destId) {
    return { ok: false, error: 'procurement.receive.errNoWarehouse' }
  }

  const itemByLine = new Map<string, string>()
  const receivedAdd = new Map<string, number>()
  const docLines: WarehouseDocumentLine[] = []

  for (const line of order.lines) {
    const remaining = Math.max(0, line.quantity - line.receivedQty)
    if (remaining <= 0) continue

    let qty = remaining
    if (lineQtys) {
      const asked = Number(lineQtys[line.id])
      if (!Number.isFinite(asked) || asked <= 0) continue
      qty = Math.min(remaining, asked)
    }
    if (qty <= 0) continue

    let itemId = line.warehouseItemId
    const exists = itemId ? warehouse.items.some((i) => i.id === itemId) : false
    if (!itemId || !exists) {
      const created = warehouseItemFromOrderLine(line, warehouse, destId)
      warehouse = upsertWarehouseItemInStore(warehouse, created)
      itemId = created.id
    }
    itemByLine.set(line.id, itemId)
    receivedAdd.set(line.id, qty)
    const catalogItem = warehouse.items.find((i) => i.id === itemId)
    docLines.push({
      itemId,
      quantity: qty,
      inputUnit: line.unit || catalogItem?.unit || undefined,
      unitPrice: line.unitPrice,
      // G1/G2 critical may lack SQL-only cards; snapshots protect identity (R2.9H).
      itemNameSnapshot: catalogItem?.name,
      itemCodeSnapshot: catalogItem?.internalCode,
      unitSnapshot: catalogItem?.unit || line.unit || undefined,
    })
  }

  if (docLines.length === 0) {
    return { ok: false, error: 'procurement.receive.errNothing' }
  }

  const number = nextDocumentNumber(warehouse.documents, 'receipt', date)
  const supplier = app.counterparties.items.find((c) => c.id === order.counterpartyId)
  return {
    ok: true,
    order,
    warehouseWithItems: warehouse,
    documentInput: {
      type: 'receipt',
      number,
      date,
      warehouseId: destId,
      purpose: 'purchase',
      counterpartyId: order.counterpartyId,
      counterparty: supplier?.name,
      comment: order.orderNumber,
      purchaseOrderId: order.id,
      lines: docLines,
    },
    receivedAdd,
    itemByLine,
    number,
  }
}

/** Apply PO line/status updates after a successful warehouse document id is known. */
export function applyPurchaseOrderReceiptAck(
  app: AppStore,
  prepared: Extract<PreparePurchaseOrderReceipt, { ok: true }>,
  documentId: string,
  warehouseOverride?: WarehouseStore,
): AppStore {
  const proc = app.procurement
  if (!proc) return app
  const { order, receivedAdd, itemByLine, number } = prepared
  const updatedLines = order.lines.map((line) => {
    const add = receivedAdd.get(line.id)
    if (add == null) {
      return itemByLine.has(line.id)
        ? { ...line, warehouseItemId: itemByLine.get(line.id) }
        : line
    }
    return {
      ...line,
      warehouseItemId: itemByLine.get(line.id) ?? line.warehouseItemId,
      receivedQty: Math.min(line.quantity, line.receivedQty + add),
    }
  })
  const pct = receivedPercent({ ...order, lines: updatedLines })
  const nextStatus: PurchaseOrder['status'] = pct >= 100 ? 'received' : 'partial'
  const updatedOrder: PurchaseOrder = {
    ...order,
    lines: updatedLines,
    warehouseDocumentIds: [...order.warehouseDocumentIds, documentId],
    status: nextStatus,
    statusHistory:
      order.status === nextStatus
        ? order.statusHistory
        : [
            ...order.statusHistory,
            createStatusChange(order.status, nextStatus, `Приход ${number}`, documentId),
          ],
    updatedAt: new Date().toISOString(),
  }

  return {
    ...app,
    warehouse: warehouseOverride ?? prepared.warehouseWithItems,
    procurement: {
      ...proc,
      orders: proc.orders.map((o) => (o.id === order.id ? updatedOrder : o)),
    },
  }
}
