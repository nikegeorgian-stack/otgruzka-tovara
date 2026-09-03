/**
 * PHASE P1B — WIP (semi-finished) is not finished goods and not shippable.
 */
import type { WarehouseDocument, WarehouseStore } from '@/lib/warehouse/types'

export function isSemiFinishedWipDocument(
  doc: Pick<WarehouseDocument, 'purpose' | 'docRole' | 'shiftReportId'>,
): boolean {
  const purpose = doc.purpose as string | undefined
  const role = doc.docRole as string | undefined
  return (
    purpose === 'production_wip_receipt' ||
    role === 'production_wip_receipt' ||
    (Boolean(doc.shiftReportId) && purpose === 'production_wip_receipt')
  )
}

/** Items received as WIP via shift reports — exclude from FG shipment eligibility. */
export function isItemAvailableAsFinishedGoods(
  store: WarehouseStore,
  itemId: string,
  warehouseId: string,
): boolean {
  const loc = store.locations.find((l) => l.id === warehouseId)
  if (loc?.kind === 'wip' || loc?.kind === 'packaging') return false
  if (loc?.kind === 'finished') {
    const wipReceipts = store.documents.filter(
      (d) =>
        d.warehouseId === warehouseId &&
        d.status === 'posted' &&
        isSemiFinishedWipDocument(d) &&
        d.lines.some((l) => l.itemId === itemId),
    )
    if (wipReceipts.length) return false
  }
  // Any posted WIP receipt for this item blocks shipping as FG from non-finished zones
  const hasWip = store.documents.some(
    (d) =>
      d.status === 'posted' &&
      isSemiFinishedWipDocument(d) &&
      d.lines.some((l) => l.itemId === itemId),
  )
  if (hasWip) return false
  return true
}

export function assertNotShippingWip(
  store: WarehouseStore,
  itemId: string,
  warehouseId: string,
): { ok: true } | { ok: false; error: string } {
  if (!isItemAvailableAsFinishedGoods(store, itemId, warehouseId)) {
    return { ok: false, error: 'production.shift.errWipNotShippable' }
  }
  return { ok: true }
}
