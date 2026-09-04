/**
 * PHASE P1C — finished goods shipment gate.
 */
import type { FinishedGoodsLot } from './finishedGoodsLots'

export const SHIP_LOT_REQUIRED = 'production.ship.errLotRequired' as const
export const SHIP_LOT_MISMATCH = 'production.ship.errLotMismatch' as const
export const SHIP_LOT_NOT_RELEASED = 'production.ship.errLotNotReleased' as const
export const SHIP_LOT_QTY = 'production.ship.errLotQty' as const
export const SHIP_LOT_ITEM = 'production.ship.errLotItem' as const

export type LoadingLineShippableInput = {
  quantity: number
  finishedProductId?: string
  warehouseItemId?: string
  lotId?: string
  batchNo?: string
  name?: string
}

export function assertLotShippable(
  lot: Pick<
    FinishedGoodsLot,
    | 'qcStatus'
    | 'finishedProductId'
    | 'warehouseItemId'
    | 'quantityQcReleased'
    | 'quantityShipped'
    | 'serverQcDecisionStatus'
  >,
  qty: number,
  finishedProductId: string,
  warehouseItemId: string,
): { ok: true } | { ok: false; error: string } {
  if (qty <= 0) return { ok: false, error: SHIP_LOT_QTY }
  if (lot.finishedProductId !== finishedProductId || lot.warehouseItemId !== warehouseItemId) {
    return { ok: false, error: SHIP_LOT_ITEM }
  }
  // On web, forged qcStatus is ignored unless server decision mirror says released.
  // When G4 packagingQc is active, overlay sets serverQcDecisionStatus from critical qcDecisions.
  const isWeb =
    typeof import.meta !== 'undefined' &&
    Boolean((import.meta as ImportMeta & { env?: { VITE_FST_WEB?: string } }).env?.VITE_FST_WEB === 'true')
  if (isWeb) {
    if (lot.serverQcDecisionStatus !== 'released') return { ok: false, error: SHIP_LOT_NOT_RELEASED }
  } else if (lot.qcStatus !== 'released') {
    return { ok: false, error: SHIP_LOT_NOT_RELEASED }
  }
  const remaining = Math.max(0, (lot.quantityQcReleased || 0) - (lot.quantityShipped || 0))
  if (qty > remaining + 1e-9) return { ok: false, error: SHIP_LOT_QTY }
  return { ok: true }
}

export function assertLoadingLineShippable(
  lots: FinishedGoodsLot[],
  line: LoadingLineShippableInput,
): { ok: true; lot: FinishedGoodsLot } | { ok: false; error: string } {
  if (line.quantity <= 0) return { ok: false, error: SHIP_LOT_QTY }
  if (!line.finishedProductId || !line.warehouseItemId) {
    return { ok: false, error: SHIP_LOT_ITEM }
  }
  if (!line.lotId && !line.batchNo) {
    return { ok: false, error: SHIP_LOT_REQUIRED }
  }

  const byLotId = line.lotId ? lots.find((lot) => lot.id === line.lotId) : undefined
  const byBatchNo = line.batchNo ? lots.find((lot) => lot.batchNo === line.batchNo) : undefined
  const lot = byLotId ?? byBatchNo
  if (!lot) return { ok: false, error: SHIP_LOT_REQUIRED }
  if (byLotId && byBatchNo && byLotId.id !== byBatchNo.id) {
    return { ok: false, error: SHIP_LOT_MISMATCH }
  }
  if (line.lotId && lot.id !== line.lotId) return { ok: false, error: SHIP_LOT_MISMATCH }
  if (line.batchNo && lot.batchNo !== line.batchNo) return { ok: false, error: SHIP_LOT_MISMATCH }
  const gate = assertLotShippable(lot, line.quantity, line.finishedProductId, line.warehouseItemId)
  if (!gate.ok) return gate
  return { ok: true, lot }
}

export function applyShipmentToLot(lot: FinishedGoodsLot, qty: number): FinishedGoodsLot {
  const nextShipped = Math.max(0, (lot.quantityShipped || 0) + Math.max(0, qty))
  const released = Math.max(0, lot.quantityQcReleased || 0)
  return {
    ...lot,
    quantityShipped: Math.min(released, nextShipped),
    quantityRemaining: Math.max(0, released - Math.min(released, nextShipped)),
    updatedAt: new Date().toISOString(),
  }
}

export function reverseShipmentOnLot(lot: FinishedGoodsLot, qty: number): FinishedGoodsLot {
  const nextShipped = Math.max(0, (lot.quantityShipped || 0) - Math.max(0, qty))
  const released = Math.max(0, lot.quantityQcReleased || 0)
  return {
    ...lot,
    quantityShipped: nextShipped,
    quantityRemaining: Math.max(0, released - nextShipped),
    updatedAt: new Date().toISOString(),
  }
}

