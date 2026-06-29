import { applyTrackingSyncToOrder } from './applySync'
import { syncContainerTracking } from './client'
import { guessReferenceType } from './referenceType'
import type { PurchaseOrder } from '../types'
import type { TrackingSyncResponse } from './types'

export const TRACKING_SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000

export async function syncOrderFromCarrier(
  order: PurchaseOrder,
): Promise<{ order: PurchaseOrder; response: TrackingSyncResponse } | null> {
  const tr = order.containerTracking
  if (!tr?.reference.trim()) return null

  const reference = tr.reference.trim()
  const referenceType =
    tr.referenceType === guessReferenceType(reference)
      ? tr.referenceType
      : guessReferenceType(reference)

  const response = await syncContainerTracking({
    carrier: tr.carrier,
    reference,
    referenceType,
    currentStatus: order.status,
  })

  const updated = applyTrackingSyncToOrder(order, response)
  return { order: updated, response }
}
