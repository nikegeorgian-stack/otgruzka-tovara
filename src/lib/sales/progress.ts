import type {
  SalesFulfillmentStatus,
  SalesLineProgress,
  SalesOrder,
  SalesOrderLine,
  SalesProductionAllocation,
  SalesStockReservation,
} from './types'
import { isSalesOrderOpen } from './statuses'

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export function emptyLineProgress(orderedQty = 0): SalesLineProgress {
  const ordered = Math.max(0, orderedQty)
  return {
    orderedQty: ordered,
    cancelledQty: 0,
    reservedFinishedGoodsQty: 0,
    productionAllocatedQty: 0,
    productionStartedQty: 0,
    producedGoodQty: 0,
    qcApprovedQty: 0,
    readyToShipQty: 0,
    shipmentReservedQty: 0,
    shippedQty: 0,
    remainingToPlanQty: ordered,
    remainingToProduceQty: ordered,
    remainingToShipQty: ordered,
  }
}

export function recalculateSalesOrderLineProgress(
  line: SalesOrderLine,
  allocations: SalesProductionAllocation[],
  reservations: SalesStockReservation[],
): SalesLineProgress {
  const ordered = Math.max(0, Number(line.qtyMp) || 0)
  const cancelled = Math.max(0, Number(line.cancelledQty) || 0)
  const openOrdered = Math.max(0, ordered - cancelled)

  const lineAllocs = allocations.filter(
    (a) => a.salesLineId === line.id && a.status !== 'cancelled',
  )
  const lineRes = reservations.filter(
    (r) =>
      r.salesLineId === line.id &&
      r.status === 'active' &&
      (r.reservationType === 'sales_order' || r.reservationType === 'shipment'),
  )

  const reservedFinishedGoodsQty = round1(
    lineRes
      .filter((r) => r.reservationType === 'sales_order')
      .reduce((s, r) => s + (r.quantity || 0), 0),
  )
  const shipmentReservedQty = round1(
    lineRes
      .filter((r) => r.reservationType === 'shipment')
      .reduce((s, r) => s + (r.quantity || 0), 0),
  )
  const productionAllocatedQty = round1(
    lineAllocs.reduce((s, a) => s + (a.plannedGoodQty || 0), 0),
  )
  const producedGoodQty = round1(
    lineAllocs.reduce((s, a) => s + (a.producedAllocatedQty || 0), 0),
  )
  const readyToShipQty = round1(
    lineAllocs.reduce((s, a) => s + (a.readyAllocatedQty || 0), 0),
  )
  const shippedFromAlloc = round1(
    lineAllocs.reduce((s, a) => s + (a.shippedQty || 0), 0),
  )
  const shippedQty = round1(
    Math.max(shippedFromAlloc, Number(line.progress?.shippedQty) || 0),
  )

  const ensured = reservedFinishedGoodsQty + productionAllocatedQty
  const remainingToPlanQty = round1(Math.max(0, openOrdered - ensured))
  const remainingToProduceQty = round1(
    Math.max(0, openOrdered - reservedFinishedGoodsQty - producedGoodQty),
  )
  const remainingToShipQty = round1(Math.max(0, openOrdered - shippedQty))

  return {
    orderedQty: ordered,
    cancelledQty: cancelled,
    reservedFinishedGoodsQty,
    productionAllocatedQty,
    productionStartedQty: round1(Number(line.progress?.productionStartedQty) || 0),
    producedGoodQty,
    qcApprovedQty: round1(Number(line.progress?.qcApprovedQty) || 0),
    readyToShipQty: Math.max(readyToShipQty, reservedFinishedGoodsQty),
    shipmentReservedQty,
    shippedQty,
    remainingToPlanQty,
    remainingToProduceQty,
    remainingToShipQty,
  }
}

/**
 * Приоритет (ТЗ §6.3) по неотменённым количествам строки / заказа.
 * `in_production` только при фактическом старте (productionStartedQty / produced), не от draft ПЗ.
 */
export function fulfillmentFromProgress(
  lines: { progress: SalesLineProgress }[],
): SalesFulfillmentStatus {
  if (!lines.length) return 'unplanned'

  let openOrdered = 0
  let reserved = 0
  let allocated = 0
  let started = 0
  let produced = 0
  let ready = 0
  let shipped = 0

  for (const { progress: p } of lines) {
    const open = Math.max(0, p.orderedQty - p.cancelledQty)
    openOrdered += open
    reserved += p.reservedFinishedGoodsQty
    allocated += p.productionAllocatedQty
    started += p.productionStartedQty
    produced += p.producedGoodQty
    ready += p.readyToShipQty
    shipped += p.shippedQty
  }

  if (openOrdered <= 0) return 'unplanned'
  const eps = 0.05

  if (shipped + eps >= openOrdered) return 'shipped'
  if (shipped > eps) return 'partially_shipped'
  if (ready + eps >= openOrdered) return 'ready_to_ship'
  if (ready > eps) return 'partially_ready'
  if (started > eps || produced > eps) return 'in_production'

  const ensured = reserved + allocated
  if (ensured + eps >= openOrdered) return 'planned'
  if (ensured > eps) return 'partially_planned'
  return 'unplanned'
}

export function recalculateSalesOrderProgress(
  order: SalesOrder,
  allocations: SalesProductionAllocation[],
  reservations: SalesStockReservation[],
): SalesOrder {
  const orderAllocs = allocations.filter((a) => a.salesOrderId === order.id)
  const orderRes = reservations.filter((r) => r.salesOrderId === order.id)
  const lines = order.lines.map((line) => ({
    ...line,
    progress: recalculateSalesOrderLineProgress(line, orderAllocs, orderRes),
  }))
  const fulfillmentStatus = isSalesOrderOpen(order.commercialStatus)
    ? fulfillmentFromProgress(lines.map((l) => ({ progress: l.progress! })))
    : order.fulfillmentStatus

  return {
    ...order,
    lines,
    fulfillmentStatus,
  }
}
