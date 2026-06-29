import { createStatusChange } from '../statusHistory'
import type { PurchaseOrder, ShipmentMilestone } from '../types'
import { carrierLabel } from './carrierUrls'
import { inferStatusFromEvents } from './mapStatus'
import type { TrackingSyncResponse } from './types'

function carrierMilestoneId(carrier: string, eventId: string): string {
  return `${carrier}:${eventId}`
}

function mergeMilestones(
  existing: ShipmentMilestone[],
  response: TrackingSyncResponse,
): ShipmentMilestone[] {
  const known = new Set(existing.map((m) => m.externalId).filter(Boolean))
  const added: ShipmentMilestone[] = []

  for (const event of response.events) {
    const externalId = carrierMilestoneId(response.carrier, event.id)
    if (known.has(externalId)) continue
    known.add(externalId)
    added.push({
      id: crypto.randomUUID(),
      at: event.at,
      status: response.suggestedStatus ?? 'in_transit',
      location: event.location ?? event.facility,
      note: event.description,
      externalId,
      source: 'carrier',
      carrier: response.carrier,
    })
  }

  if (!added.length) return existing
  return [...added, ...existing]
}

function updateSeaLegEta(order: PurchaseOrder, etaDate?: string, vesselName?: string) {
  if (!etaDate && !vesselName) return order.legs

  return order.legs.map((leg, idx) => {
    if (leg.transportMode !== 'sea' && idx > 0) return leg
    return {
      ...leg,
      etaDate: etaDate ?? leg.etaDate,
      vesselOrTrain: vesselName ?? leg.vesselOrTrain,
      carrier: leg.carrier ?? carrierLabel(order.containerTracking!.carrier),
      trackingNumber: leg.trackingNumber ?? order.containerTracking!.reference,
    }
  })
}

/** Применяет ответ API отслеживания к заказу */
export function applyTrackingSyncToOrder(
  order: PurchaseOrder,
  response: TrackingSyncResponse,
): PurchaseOrder {
  const tracking = order.containerTracking
  if (!tracking) return order

  const now = new Date().toISOString()
  const syncMeta = {
    ...tracking,
    lastSyncedAt: now,
    lastLocation: response.latestLocation ?? tracking.lastLocation,
    lastEventLabel: response.latestDescription ?? tracking.lastEventLabel,
    syncError: response.ok ? undefined : response.error ?? response.message,
  }

  if (!response.ok || !response.configured) {
    return { ...order, containerTracking: syncMeta }
  }

  const nextStatus =
    response.suggestedStatus ??
    inferStatusFromEvents(response.events, order.status)

  const milestones = mergeMilestones(order.milestones, response)
  const legs = updateSeaLegEta(order, response.etaDate, response.vesselName)

  let statusHistory = order.statusHistory
  if (nextStatus !== order.status) {
    statusHistory = [
      ...statusHistory,
      createStatusChange(
        order.status,
        nextStatus,
        `${carrierLabel(response.carrier)}: ${response.latestDescription ?? 'авто-синхронизация'}`,
      ),
    ]
  }

  return {
    ...order,
    status: nextStatus,
    milestones,
    legs,
    containerTracking: syncMeta,
    statusHistory,
    confirmedDeliveryDate: response.etaDate ?? order.confirmedDeliveryDate,
    updatedAt: now,
  }
}
