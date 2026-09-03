import { nextDocumentNumber } from '@/lib/warehouse/docNumbering'
import { postWarehouseDocument } from '@/lib/warehouse/documents'
import type { StockMovement, WarehouseStore } from '@/lib/warehouse/types'

/** Добавить документный резерв ГП под ЗК (снижает available, не balance). */
export function appendSalesFgReserveMovement(
  warehouse: WarehouseStore,
  input: {
    warehouseItemId: string
    quantity: number
    comment: string
    date?: string
    salesOrderId?: string
    actor?: { id?: string; name?: string }
  },
): { store: WarehouseStore; movement: StockMovement } | null {
  const qty = Math.max(0, Number(input.quantity) || 0)
  if (qty <= 0) return null
  const item = warehouse.items.find((i) => i.id === input.warehouseItemId)
  if (!item) return null
  const now = new Date().toISOString()
  const date = (input.date ?? now).slice(0, 10)
  const number = nextDocumentNumber(warehouse.documents, 'reservation', date)
  const idempotencyKey = `sales-fg-reserve::${input.salesOrderId ?? 'anon'}::${item.id}::${qty}::${date}::${input.comment}`
  const posted = postWarehouseDocument(warehouse, {
    type: 'reservation',
    number,
    date,
    documentDateTime: now,
    warehouseId: item.warehouseId,
    purpose: 'other',
    basisType: 'sales_order',
    basisId: input.salesOrderId,
    comment: input.comment,
    idempotencyKey,
    lines: [
      {
        lineId: crypto.randomUUID(),
        itemId: item.id,
        quantity: qty,
        requiredQty: qty,
        reservedQty: qty,
        shortageQty: 0,
        itemCodeSnapshot: item.internalCode,
        itemNameSnapshot: item.name,
        unitSnapshot: item.unit,
      },
    ],
    status: 'posted',
    postedAt: now,
    postedBy: input.actor?.id,
    postedByName: input.actor?.name,
    createdBy: input.actor?.id,
    createdByName: input.actor?.name,
    docRole: 'production_reservation',
  })
  if (!posted.result.ok || !('documentId' in posted.result) || !posted.result.documentId) {
    return null
  }
  const documentId = posted.result.documentId
  const movement = posted.store.movements.find(
    (m) => m.documentId === documentId && m.type === 'reserve',
  )
  if (!movement) return null
  return { store: posted.store, movement }
}
