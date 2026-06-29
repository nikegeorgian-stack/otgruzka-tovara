import { createStatusChange } from '../statusHistory'
import type { PurchaseOrder, PurchaseOrderStatus, SeaCarrier } from '../types'
import { carrierLabel } from './carrierUrls'

const IMPORT_FLOW: PurchaseOrderStatus[] = [
  'ordered',
  'production',
  'shipped',
  'in_transit',
  'customs',
  'arrived',
  'partial',
  'received',
]

export function importStatusFlow(current: PurchaseOrderStatus): PurchaseOrderStatus[] {
  if (current === 'cancelled') return []
  const idx = IMPORT_FLOW.indexOf(current)
  const start = idx >= 0 ? idx : 0
  return IMPORT_FLOW.slice(start)
}

export function applyManualTrackingStatus(
  order: PurchaseOrder,
  toStatus: PurchaseOrderStatus,
  opts?: { location?: string; note?: string },
): PurchaseOrder {
  if (order.status === toStatus) return order

  const now = new Date().toISOString()
  const carrier = order.containerTracking?.carrier
  const label = carrier ? carrierLabel(carrier) : ''
  const note =
    opts?.note?.trim() ||
    (label
      ? `${label}: ${opts?.location ?? 'ручное обновление'}`
      : opts?.location ?? 'Ручное обновление статуса')

  return {
    ...order,
    status: toStatus,
    statusHistory: [
      ...order.statusHistory,
      createStatusChange(order.status, toStatus, note),
    ],
    milestones: [
      {
        id: crypto.randomUUID(),
        at: now,
        status: toStatus,
        location: opts?.location,
        note,
        source: 'manual',
        carrier: carrier as SeaCarrier | undefined,
      },
      ...order.milestones,
    ],
    containerTracking: order.containerTracking
      ? {
          ...order.containerTracking,
          lastSyncedAt: now,
          lastLocation: opts?.location ?? order.containerTracking.lastLocation,
          lastEventLabel: note,
          syncError: undefined,
        }
      : undefined,
    updatedAt: now,
  }
}
