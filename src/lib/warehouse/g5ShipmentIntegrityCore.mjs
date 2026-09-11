/**
 * Canonical semantic payloads shared by the G5 shipment server and web ACK guard.
 * Callers must pass effective (default-resolved) values, not raw aliases.
 */
function text(value) {
  return String(value ?? '').trim()
}

function quantity(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number * 1e6) / 1e6 : null
}

function date(value) {
  return text(value).slice(0, 10)
}

export function canonicalG5ShipmentPost(input = {}) {
  return {
    version: 1,
    commandType: 'sales.shipment.post',
    shipmentId: text(input.shipmentId),
    salesOrderId: text(input.salesOrderId),
    salesLineId: text(input.salesLineId),
    finishedProductId: text(input.finishedProductId),
    finishedGoodsLotId: text(input.finishedGoodsLotId ?? input.lotId),
    quantity: quantity(input.quantity),
    warehouseId: text(input.warehouseId),
    date: date(input.date),
    counterpartyId: text(input.counterpartyId),
  }
}

export function canonicalG5ShipmentCancel(input = {}) {
  return {
    version: 1,
    commandType: 'sales.shipment.cancel',
    shipmentId: text(input.shipmentId),
    reason: text(input.reason ?? input.cancellationReason),
    date: date(input.date),
  }
}

export function stableG5ShipmentJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableG5ShipmentJson(entry)).join(',')}]`
  }
  const keys = Object.keys(value).sort()
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableG5ShipmentJson(value[key])}`)
    .join(',')}}`
}
