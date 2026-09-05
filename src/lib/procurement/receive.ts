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
}

/**
 * Принять заказ закупки: создаёт приходный документ,
 * заводит недостающие позиции номенклатуры, проставляет receivedQty/статус заказа
 * и связь с документом. Кросс-стор операция (закупки + склад) в одном патче.
 */
export function receivePurchaseOrderInStore(
  app: AppStore,
  orderId: string,
  opts: ReceiveOrderOpts = {},
): { store: AppStore; result: ReceiveOrderResult } {
  const date = opts.date ?? new Date().toISOString().slice(0, 10)
  const lineQtys = opts.lineQtys
  const proc = app.procurement
  const order = proc?.orders.find((o) => o.id === orderId)
  if (!proc || !order) {
    return { store: app, result: { ok: false, error: 'procurement.receive.errNotFound' } }
  }
  if (order.status === 'cancelled') {
    return { store: app, result: { ok: false, error: 'procurement.receive.errCancelled' } }
  }
  if (order.status === 'draft') {
    return { store: app, result: { ok: false, error: 'procurement.receive.errDraft' } }
  }

  let warehouse: WarehouseStore = app.warehouse
  const destId = order.destinationWarehouseId || warehouse.locations[0]?.id || ''
  if (!destId) {
    return { store: app, result: { ok: false, error: 'procurement.receive.errNoWarehouse' } }
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
    docLines.push({
      itemId,
      quantity: qty,
      inputUnit: line.unit || undefined,
      unitPrice: line.unitPrice,
    })
  }

  if (docLines.length === 0) {
    return { store: app, result: { ok: false, error: 'procurement.receive.errNothing' } }
  }

  const number = nextDocumentNumber(warehouse.documents, 'receipt', date)
  const supplier = app.counterparties.items.find((c) => c.id === order.counterpartyId)
  const { store: warehouseAfter, result } = postWarehouseDocument(warehouse, {
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
  })

  if (!result.ok) {
    return { store: app, result: { ok: false, error: result.error } }
  }

  const documentId = result.documentId
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
            createStatusChange(
              order.status,
              nextStatus,
              `Приход ${number}`,
              documentId,
            ),
          ],
    updatedAt: new Date().toISOString(),
  }

  return {
    store: {
      ...app,
      warehouse: warehouseAfter,
      procurement: {
        ...proc,
        orders: proc.orders.map((o) => (o.id === orderId ? updatedOrder : o)),
      },
    },
    result: { ok: true, documentId },
  }
}
