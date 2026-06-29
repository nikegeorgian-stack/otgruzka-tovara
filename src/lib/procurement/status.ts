import type { PurchaseOrder, PurchaseOrderStatus, ShipmentLeg } from './types'

export const ORDER_STATUS_FLOW: PurchaseOrderStatus[] = [
  'draft',
  'ordered',
  'production',
  'shipped',
  'in_transit',
  'customs',
  'arrived',
  'partial',
  'received',
]

export function isActiveOrderStatus(status: PurchaseOrderStatus): boolean {
  return status !== 'received' && status !== 'cancelled'
}

export function orderProgressPercent(status: PurchaseOrderStatus): number {
  const idx = ORDER_STATUS_FLOW.indexOf(status)
  if (status === 'cancelled') return 0
  if (idx < 0) return 0
  return Math.round((idx / (ORDER_STATUS_FLOW.length - 1)) * 100)
}

/** Ближайшая ETA по маршруту */
export function orderEtaDate(order: PurchaseOrder): string | undefined {
  if (order.confirmedDeliveryDate) return order.confirmedDeliveryDate
  const legEtas = order.legs
    .map((l) => l.etaDate)
    .filter(Boolean) as string[]
  if (!legEtas.length) return order.requestedDeliveryDate
  return legEtas.sort().at(-1)
}

/** Плановая отгрузка — первый этап или явная дата */
export function orderPlannedShipmentDate(order: PurchaseOrder): string | undefined {
  const legs = [...order.legs].sort((a, b) => a.sequence - b.sequence)
  const first = legs[0]
  return first?.plannedDepartureDate ?? first?.actualDepartureDate
}

export function legDurationDays(leg: ShipmentLeg): number | undefined {
  const from = leg.actualDepartureDate ?? leg.plannedDepartureDate
  const to = leg.actualArrivalDate ?? leg.etaDate
  if (!from || !to) return undefined
  const a = new Date(from).getTime()
  const b = new Date(to).getTime()
  if (Number.isNaN(a) || Number.isNaN(b)) return undefined
  return Math.max(0, Math.round((b - a) / 86_400_000))
}

export function daysUntil(dateIso: string | undefined, today = new Date()): number | undefined {
  if (!dateIso) return undefined
  const target = new Date(dateIso)
  if (Number.isNaN(target.getTime())) return undefined
  const t0 = new Date(today.toISOString().slice(0, 10)).getTime()
  const t1 = new Date(dateIso).getTime()
  return Math.round((t1 - t0) / 86_400_000)
}

export function isOverdue(order: PurchaseOrder, today = new Date()): boolean {
  if (!isActiveOrderStatus(order.status)) return false
  const eta = orderEtaDate(order)
  if (!eta) return false
  const d = daysUntil(eta, today)
  return d !== undefined && d < 0
}

export function receivedPercent(order: PurchaseOrder): number {
  if (!order.lines.length) return 0
  let ordered = 0
  let received = 0
  for (const l of order.lines) {
    ordered += l.quantity
    received += l.receivedQty
  }
  if (ordered <= 0) return 0
  return Math.min(100, Math.round((received / ordered) * 100))
}
