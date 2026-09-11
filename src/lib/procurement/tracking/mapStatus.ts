import type { PurchaseOrderStatus } from '../types'
import type { CarrierTrackingEvent } from './types'

const STATUS_RANK: Record<PurchaseOrderStatus, number> = {
  draft: 0,
  submitted: 1,
  approved: 2,
  ordered: 3,
  production: 4,
  shipped: 5,
  in_transit: 6,
  customs: 7,
  arrived: 8,
  partial: 9,
  received: 10,
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
  DELIVERED: 'arrived',
  CUS: 'customs',
  CUSRM: 'customs',
}

const KEYWORD_STATUS: [RegExp, PurchaseOrderStatus][] = [
  [/\b(gate.?in|loaded|load)\b/i, 'shipped'],
  [/\b(depart|depa|vessel.?depart|sailed)\b/i, 'in_transit'],
  [/\b(arriv|arri|discharg|disc)\b/i, 'customs'],
  [/\b(customs|clearance|cus)\b/i, 'customs'],
  [/\b(gate.?out|delivered|delivery)\b/i, 'arrived'],
  // empty return / delivered ≠ складская приёмка — max arrived (см. fst-procurement)
  [/\b(received|empty.?return)\b/i, 'arrived'],
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

/** Макс. статус из трекинга перевозчика — до склада; `received` только после receive. */
const MAX_CARRIER_STATUS: PurchaseOrderStatus = 'arrived'

export function inferStatusFromEvents(
  events: CarrierTrackingEvent[],
  current: PurchaseOrderStatus,
): PurchaseOrderStatus {
  if (current === 'cancelled' || current === 'received' || current === 'partial') {
    return current
  }

  let best: PurchaseOrderStatus = current
  let bestRank = STATUS_RANK[current]
  const maxRank = STATUS_RANK[MAX_CARRIER_STATUS]

  for (const event of events) {
    const mapped = statusFromEvent(event)
    if (!mapped) continue
    const clamped =
      STATUS_RANK[mapped] > maxRank ? MAX_CARRIER_STATUS : mapped
    const clampedRank = STATUS_RANK[clamped]
    if (clampedRank > bestRank) {
      best = clamped
      bestRank = clampedRank
    }
  }

  return best
}

export function shouldAutoSyncStatus(status: PurchaseOrderStatus): boolean {
  return (
    status !== 'received' &&
    status !== 'cancelled' &&
    status !== 'draft' &&
    status !== 'submitted' &&
    status !== 'approved'
  )
}
