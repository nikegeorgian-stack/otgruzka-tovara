import type { PurchaseOrder, ProcurementStore } from './types'

export function formatOrderNumber(year: number, seq: number): string {
  return `ЗЗ-${year}-${String(seq).padStart(4, '0')}`
}

export function nextOrderNumber(store: ProcurementStore, date = new Date()): string {
  const year = date.getFullYear()
  const fromSeq = store.nextOrderSeq ?? 1
  const fromOrders = store.orders.reduce((max, o) => {
    const m = o.orderNumber.match(/ЗЗ-(\d{4})-(\d+)/)
    if (!m || Number(m[1]) !== year) return max
    return Math.max(max, Number(m[2]))
  }, 0)
  return formatOrderNumber(year, Math.max(fromSeq, fromOrders + 1))
}

export function allocateOrderNumber(store: ProcurementStore): {
  orderNumber: string
  nextOrderSeq: number
} {
  const now = new Date()
  const year = now.getFullYear()
  const seq = (() => {
    const fromSeq = store.nextOrderSeq ?? 1
    const fromOrders = store.orders.reduce((max, o) => {
      const m = o.orderNumber.match(/ЗЗ-(\d{4})-(\d+)/)
      if (!m || Number(m[1]) !== year) return max
      return Math.max(max, Number(m[2]))
    }, 0)
    return Math.max(fromSeq, fromOrders + 1)
  })()
  return { orderNumber: formatOrderNumber(year, seq), nextOrderSeq: seq + 1 }
}

export function orderTotalAmount(order: PurchaseOrder): number {
  return order.lines.reduce((sum, l) => sum + (l.unitPrice ?? 0) * l.quantity, 0)
}
