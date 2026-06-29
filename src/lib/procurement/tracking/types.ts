import type { PurchaseOrderStatus, SeaCarrier } from '@/lib/procurement/types'

export type { SeaCarrier }

export type ContainerReferenceType = 'container' | 'bl' | 'booking'

/** Нормализованное событие от линии (DCSA-совместимый формат) */
export type CarrierTrackingEvent = {
  id: string
  at: string
  eventCode?: string
  description: string
  location?: string
  facility?: string
  vesselName?: string
  transportMode?: string
}

export type TrackingSyncResponse = {
  ok: boolean
  configured: boolean
  source?: 'api' | 'portal' | 'none'
  carrier: SeaCarrier
  reference: string
  trackingUrl: string
  events: CarrierTrackingEvent[]
  latestLocation?: string
  latestDescription?: string
  latestEventAt?: string
  etaDate?: string
  vesselName?: string
  suggestedStatus?: PurchaseOrderStatus
  message?: string
  error?: string
}

export type TrackingCapabilities = {
  carriers: Record<
    SeaCarrier,
    {
      name: string
      configured: boolean
      apiConfigured?: boolean
      publicPortal?: boolean
      trackingUrl: string
      portalUrl: string
    }
  >
}
