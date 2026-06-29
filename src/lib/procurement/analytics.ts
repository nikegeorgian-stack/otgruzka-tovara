import { orderTotalAmount } from './codes'
import { daysUntil, isOverdue, orderEtaDate, orderPlannedShipmentDate } from './status'
import type { PurchaseOrder, ProcurementScope, TransportMode } from './types'

export type ProcurementKpis = {
  activeOrders: number
  inTransit: number
  overdue: number
  arrivingThisWeek: number
  totalOpenValue: number
}

export type SupplierStatRow = {
  counterpartyId: string
  orders: number
  active: number
  overdue: number
  totalValue: number
  avgLeadDays?: number
}

export type TransportStatRow = {
  mode: TransportMode
  legs: number
  orders: number
}

export function computeProcurementKpis(
  orders: PurchaseOrder[],
  today = new Date(),
): ProcurementKpis {
  const active = orders.filter((o) => o.status !== 'received' && o.status !== 'cancelled')
  const inTransit = active.filter((o) =>
    ['shipped', 'in_transit', 'customs', 'arrived', 'partial'].includes(o.status),
  )
  const overdue = active.filter((o) => isOverdue(o, today))
  const arrivingThisWeek = active.filter((o) => {
    const eta = orderEtaDate(o)
    const d = daysUntil(eta, today)
    return d !== undefined && d >= 0 && d <= 7
  })
  const totalOpenValue = active.reduce((s, o) => s + orderTotalAmount(o), 0)
  return {
    activeOrders: active.length,
    inTransit: inTransit.length,
    overdue: overdue.length,
    arrivingThisWeek: arrivingThisWeek.length,
    totalOpenValue,
  }
}

export function supplierStats(
  orders: PurchaseOrder[],
  today = new Date(),
): SupplierStatRow[] {
  const map = new Map<string, SupplierStatRow>()
  for (const o of orders) {
    const cur = map.get(o.counterpartyId) ?? {
      counterpartyId: o.counterpartyId,
      orders: 0,
      active: 0,
      overdue: 0,
      totalValue: 0,
      avgLeadDays: undefined,
    }
    cur.orders++
    cur.totalValue += orderTotalAmount(o)
    if (o.status !== 'received' && o.status !== 'cancelled') {
      cur.active++
      if (isOverdue(o, today)) cur.overdue++
    }
    map.set(o.counterpartyId, cur)
  }

  for (const [id, row] of map) {
    const received = orders.filter(
      (o) => o.counterpartyId === id && o.status === 'received' && o.orderDate,
    )
    const leads: number[] = []
    for (const o of received) {
      const ship = orderPlannedShipmentDate(o)
      const eta = orderEtaDate(o)
      const end = o.milestones.find((m) => m.status === 'received')?.at?.slice(0, 10) ?? eta
      if (ship && end) {
        const d =
          (new Date(end).getTime() - new Date(ship).getTime()) / 86_400_000
        if (!Number.isNaN(d) && d >= 0) leads.push(Math.round(d))
      }
    }
    row.avgLeadDays = leads.length
      ? Math.round(leads.reduce((a, b) => a + b, 0) / leads.length)
      : undefined
    map.set(id, row)
  }

  return [...map.values()].sort((a, b) => b.active - a.active || b.totalValue - a.totalValue)
}

export function transportStats(orders: PurchaseOrder[]): TransportStatRow[] {
  const map = new Map<TransportMode, TransportStatRow>()
  const orderIds = new Set<string>()
  for (const o of orders) {
    for (const leg of o.legs) {
      const cur = map.get(leg.transportMode) ?? {
        mode: leg.transportMode,
        legs: 0,
        orders: 0,
      }
      cur.legs++
      if (!orderIds.has(`${leg.transportMode}:${o.id}`)) {
        cur.orders++
        orderIds.add(`${leg.transportMode}:${o.id}`)
      }
      map.set(leg.transportMode, cur)
    }
  }
  return [...map.values()].sort((a, b) => b.legs - a.legs)
}

export function ordersByScope(orders: PurchaseOrder[]): Record<ProcurementScope, number> {
  return orders.reduce(
    (acc, o) => {
      acc[o.scope]++
      return acc
    },
    { domestic: 0, international: 0 } as Record<ProcurementScope, number>,
  )
}

export function filterOrders(
  orders: PurchaseOrder[],
  filters: {
    status?: PurchaseOrder['status'] | 'active' | 'all'
    scope?: ProcurementScope | ''
    category?: PurchaseOrder['category'] | ''
    counterpartyId?: string
    transportMode?: TransportMode | ''
    search?: string
    fromDate?: string
    toDate?: string
  },
): PurchaseOrder[] {
  const q = filters.search?.trim().toLowerCase() ?? ''
  return orders.filter((o) => {
    if (filters.status === 'active') {
      if (o.status === 'received' || o.status === 'cancelled') return false
    } else if (filters.status && filters.status !== 'all' && o.status !== filters.status) {
      return false
    }
    if (filters.scope && o.scope !== filters.scope) return false
    if (filters.category && o.category !== filters.category) return false
    if (filters.counterpartyId && o.counterpartyId !== filters.counterpartyId) return false
    if (filters.transportMode) {
      if (!o.legs.some((l) => l.transportMode === filters.transportMode)) return false
    }
    if (filters.fromDate && o.orderDate < filters.fromDate) return false
    if (filters.toDate && o.orderDate > filters.toDate) return false
    if (q) {
      const hay = [o.orderNumber, o.note ?? '', ...o.lines.map((l) => l.name)].join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}
