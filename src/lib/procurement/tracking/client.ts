import { LOCAL_DB_API } from '@/lib/localDb/config'
import type { ContainerReferenceType, SeaCarrier } from '../types'
import type { TrackingCapabilities, TrackingSyncResponse } from './types'

export async function fetchTrackingCapabilities(): Promise<TrackingCapabilities> {
  const res = await fetch(`${LOCAL_DB_API}/tracking/capabilities`)
  if (!res.ok) throw new Error('tracking_capabilities_failed')
  return res.json() as Promise<TrackingCapabilities>
}

export async function syncContainerTracking(input: {
  carrier: SeaCarrier
  reference: string
  referenceType: ContainerReferenceType
  currentStatus?: string
}): Promise<TrackingSyncResponse> {
  let res: Response
  try {
    res = await fetch(`${LOCAL_DB_API}/tracking/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  } catch {
    throw new Error('tracking_server_unreachable')
  }

  if (res.status === 404) {
    throw new Error('tracking_route_missing')
  }

  let data: TrackingSyncResponse
  try {
    data = (await res.json()) as TrackingSyncResponse
  } catch {
    throw new Error('tracking_bad_response')
  }

  if (!res.ok && !data.trackingUrl) {
    throw new Error(data.error ?? 'tracking_sync_failed')
  }
  return data
}
