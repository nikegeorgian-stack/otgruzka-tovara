import type { PurchaseOrderStatus } from '../types'
import type { CarrierTrackingEvent } from './types'

const STATUS_RANK: Record<PurchaseOrderStatus, number> = {
  draft: 0,
  ordered: 1,
  production: 2,
  shipped: 3,
  in_transit: 4,
  customs: 5,
  arrived: 6,
  partial: 7,
  received: 8,
  cancelled: -1,
}

/** DCSA / carrier event codes → статус заказа (импорт) */
const CODE_STATUS: Record<string, PurchaseOrderStatus> = {
  GATE_IN: 'shipped',
  GTIN: 'shipped',
  LOAD: 'shipped',
  DEPA: 'in_transit',
  ARRI: 'customs',
  DISC: 'arrived',
  GATE_OUT: 'arrived',
  GTOT: 'arrived',
  DELIVERED: 'received',
  CUS: 'customs',
  CUSRM: 'customs',
}

const KEYWORD_STATUS: [RegExp, PurchaseOrderStatus][] = [
  [/\b(gate.?in|loaded|load)\b/i, 'shipped'],
  [/\b(depart|depa|vessel.?depart|sailed)\b/i, 'in_transit'],
  [/\b(arriv|arri|discharg|disc)\b/i, 'customs'],
  [/\b(customs|clearance|cus)\b/i, 'customs'],
  [/\b(gate.?out|delivered|delivery)\b/i, 'arrived'],
  [/\b(received|empty.?return)\b/i, 'received'],
]

function statusFromEvent(event: CarrierTrackingEvent): PurchaseOrderStatus | null {
  const code = (event.eventCode ?? '').toUpperCase().replace(/[^A-Z]/g, '')
  if (code && CODE_STATUS[code]) return CODE_STATUS[code]

  const text = `${event.description} ${event.location ?? ''} ${event.facility ?? ''}`
  for (const [re, status] of KEYWORD_STATUS) {
    if (re.test(text)) return status
  }
  return null
}

export function inferStatusFromEvents(
  events: CarrierTrackingEvent[],
  current: PurchaseOrderStatus,
): PurchaseOrderStatus {
  if (current === 'cancelled' || current === 'received') return current

  let best: PurchaseOrderStatus = current
  let bestRank = STATUS_RANK[current]

  for (const event of events) {
    const mapped = statusFromEvent(event)
    if (!mapped) continue
    const rank = STATUS_RANK[mapped]
    if (rank > bestRank) {
      best = mapped
      bestRank = rank
    }
  }

  return best
}

export function shouldAutoSyncStatus(status: PurchaseOrderStatus): boolean {
  return (
    status !== 'received' &&
    status !== 'cancelled' &&
    status !== 'draft'
  )
}
