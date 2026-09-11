export type G5ShipmentSemanticInput = {
  shipmentId?: unknown
  salesOrderId?: unknown
  salesLineId?: unknown
  finishedProductId?: unknown
  finishedGoodsLotId?: unknown
  lotId?: unknown
  quantity?: unknown
  warehouseId?: unknown
  date?: unknown
  counterpartyId?: unknown
  reason?: unknown
  cancellationReason?: unknown
}

export type CanonicalG5ShipmentPost = {
  version: 1
  commandType: 'sales.shipment.post'
  shipmentId: string
  salesOrderId: string
  salesLineId: string
  finishedProductId: string
  finishedGoodsLotId: string
  quantity: number | null
  warehouseId: string
  date: string
  counterpartyId: string
}

export type CanonicalG5ShipmentCancel = {
  version: 1
  commandType: 'sales.shipment.cancel'
  shipmentId: string
  reason: string
  date: string
}

export function canonicalG5ShipmentPost(
  input?: G5ShipmentSemanticInput,
): CanonicalG5ShipmentPost
export function canonicalG5ShipmentCancel(
  input?: G5ShipmentSemanticInput,
): CanonicalG5ShipmentCancel
export function stableG5ShipmentJson(value: unknown): string
