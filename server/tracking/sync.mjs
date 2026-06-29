import { fetchDcsaTracking } from './adapters/dcsa.mjs'
import {
  fetchPublicPortalTracking,
  PUBLIC_PORTAL_CARRIERS,
} from './adapters/publicPortal.mjs'
import { buildTrackingUrl } from './carrierUrls.mjs'
import { CARRIER_META, getCarrierConfig, isCarrierConfigured } from './config.mjs'

const VALID_CARRIERS = ['maersk', 'msc', 'cma-cgm']
const VALID_REF_TYPES = ['container', 'bl', 'booking']

export function getCapabilities() {
  const carriers = {}
  for (const id of VALID_CARRIERS) {
    const apiConfigured = isCarrierConfigured(id)
    const publicPortal = PUBLIC_PORTAL_CARRIERS.includes(id)
    carriers[id] = {
      name: CARRIER_META[id].name,
      configured: apiConfigured || publicPortal,
      apiConfigured,
      publicPortal,
      trackingUrl: CARRIER_META[id].portalUrl,
      portalUrl: CARRIER_META[id].portalUrl,
      docsUrl: CARRIER_META[id].docsUrl,
    }
  }
  return { carriers }
}

export async function syncTracking({
  carrier,
  reference,
  referenceType = 'container',
  currentStatus = 'ordered',
}) {
  if (!VALID_CARRIERS.includes(carrier)) {
    return { ok: false, error: 'unknown_carrier' }
  }
  if (!VALID_REF_TYPES.includes(referenceType)) {
    return { ok: false, error: 'invalid_reference_type' }
  }

  const ref = String(reference ?? '').trim()
  if (!ref) {
    return { ok: false, error: 'reference_required' }
  }

  const trackingUrl = buildTrackingUrl(carrier, ref, referenceType)
  const apiConfigured = isCarrierConfigured(carrier)
  const publicPortal = PUBLIC_PORTAL_CARRIERS.includes(carrier)
  const base = {
    carrier,
    reference: ref,
    trackingUrl,
    events: [],
    configured: apiConfigured || publicPortal,
    source: 'none',
  }

  try {
    if (apiConfigured) {
      const config = getCarrierConfig(carrier)
      const data = await fetchDcsaTracking({
        carrier,
        reference: ref,
        referenceType,
        config,
        currentStatus,
      })
      return {
        ...base,
        ok: true,
        configured: true,
        source: 'api',
        events: data.events,
        suggestedStatus: data.suggestedStatus,
        latestLocation: data.latestLocation,
        latestDescription: data.latestDescription,
        latestEventAt: data.latestEventAt,
        etaDate: data.etaDate,
        vesselName: data.vesselName,
      }
    }

    const portalData = await fetchPublicPortalTracking({
      carrier,
      reference: ref,
      referenceType,
      currentStatus,
    })

    if (portalData) {
      return {
        ...base,
        ok: true,
        configured: true,
        source: 'portal',
        events: portalData.events,
        suggestedStatus: portalData.suggestedStatus,
        latestLocation: portalData.latestLocation,
        latestDescription: portalData.latestDescription,
        latestEventAt: portalData.latestEventAt,
        vesselName: portalData.vesselName,
      }
    }

    return {
      ...base,
      ok: false,
      message: 'portal_not_available',
    }
  } catch (err) {
    return {
      ...base,
      ok: false,
      error: String(err?.message ?? err),
      message: 'sync_failed',
    }
  }
}
