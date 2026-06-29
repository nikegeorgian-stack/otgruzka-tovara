import type { ProductionOrder } from '@/lib/planner/types'
import type { SalesOrder, SalesOrderLine } from './types'

export type ProductionSalesLink = {
  salesOrder: SalesOrder
  salesLine?: SalesOrderLine
}

/** Обратная связь: произв. заказ → заказ клиента */
export function resolveProductionOrderSalesLink(
  order: Pick<ProductionOrder, 'salesOrderId' | 'salesLineId'>,
  salesOrders: SalesOrder[],
): ProductionSalesLink | null {
  if (!order.salesOrderId) return null
  const salesOrder = salesOrders.find((o) => o.id === order.salesOrderId)
  if (!salesOrder) {
    return {
      salesOrder: {
        id: order.salesOrderId,
        orderNumber: '—',
        customer: '—',
        status: 'draft',
        priority: 'normal',
        orderDate: '',
        lines: [],
        history: [],
        createdAt: '',
        updatedAt: '',
      },
    }
  }
  const salesLine = order.salesLineId
    ? salesOrder.lines.find((l) => l.id === order.salesLineId)
    : undefined
  return { salesOrder, salesLine }
}

export function formatSalesOrderLinkLabel(
  link: ProductionSalesLink,
  opts?: { includeLine?: boolean },
): string {
  const num = link.salesOrder.orderNumber || '—'
  if (opts?.includeLine && link.salesLine?.productName) {
    return `${num} · ${link.salesLine.productName}`
  }
  return num
}
