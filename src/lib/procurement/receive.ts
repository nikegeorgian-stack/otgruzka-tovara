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

/**
 * Принять заказ закупки: создаёт приходный документ на оставшееся количество,
 * заводит недостающие позиции номенклатуры, проставляет receivedQty/статус заказа
 * и связь с документом. Кросс-стор операция (закупки + склад) в одном патче.
 */
export function receivePurchaseOrderInStore(
  app: AppStore,
  orderId: string,
  date = new Date().toISOString().slice(0, 10),
): { store: AppStore; result: ReceiveOrderResult } {
  const proc = app.procurement
  const order = proc?.orders.find((o) => o.id === orderId)
  if (!proc || !order) {
    return { store: app, result: { ok: false, error: 'procurement.receive.errNotFound' } }
  }

  let warehouse: WarehouseStore = app.warehouse
  const destId = order.destinationWarehouseId || warehouse.locations[0]?.id || ''
  if (!destId) {
    return { store: app, result: { ok: false, error: 'procurement.receive.errNoWarehouse' } }
  }

  // line.id -> resolved warehouse item id (for both existing and newly created)
  const itemByLine = new Map<string, string>()
  const docLines: WarehouseDocumentLine[] = []

  for (const line of order.lines) {
    const remaining = Math.max(0, line.quantity - line.receivedQty)
    if (remaining <= 0) continue

    let itemId = line.warehouseItemId
    const exists = itemId ? warehouse.items.some((i) => i.id === itemId) : false
    if (!itemId || !exists) {
      const created = warehouseItemFromOrderLine(line, warehouse, destId)
      warehouse = upsertWarehouseItemInStore(warehouse, created)
      itemId = created.id
    }
    itemByLine.set(line.id, itemId)
    docLines.push({
      itemId,
      quantity: remaining,
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
    lines: docLines,
  })

  if (!result.ok) {
    return { store: app, result: { ok: false, error: result.error } }
  }

  const documentId = result.documentId
  const updatedLines = order.lines.map((line) =>
    itemByLine.has(line.id)
      ? {
          ...line,
          warehouseItemId: itemByLine.get(line.id),
          receivedQty: line.quantity,
        }
      : line,
  )
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
        : [...order.statusHistory, createStatusChange(order.status, nextStatus, `Приход ${number}`)],
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
