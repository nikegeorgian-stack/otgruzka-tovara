import {
  inferSuggestedStatus,
  normalizeDcsaEvents,
  pickLatest,
} from '../normalize.mjs'
import {
  filterEventsForReference,
  referenceTypesToTry,
} from '../referenceType.mjs'
import { fetchMscWebsiteTracking } from './mscWebsite.mjs'

const BROWSER_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9,ru;q=0.8',
}

const MSC_PUBLIC_EVENTS =
  'https://ovhweportalapim.azure-api.net/dpo/trackandtrace/v2.2/events'

export const PUBLIC_PORTAL_CARRIERS = ['msc']

function buildMscParams(reference, referenceType) {
  const params = new URLSearchParams()
  const ref = String(reference).trim().toUpperCase()
  if (referenceType === 'container') {
    params.set('equipmentReference', ref)
  } else if (referenceType === 'bl') {
    params.set('transportDocumentReference', ref)
  } else {
    params.set('carrierBookingReference', ref)
  }
  return params
}

async function fetchMscDcsaRaw(reference, referenceType) {
  const params = buildMscParams(reference, referenceType)
  const headers = { ...BROWSER_HEADERS }
  const subKey = process.env.MSC_APIM_SUBSCRIPTION_KEY
  if (subKey) {
    headers['Ocp-Apim-Subscription-Key'] = subKey
  }

  const res = await fetch(`${MSC_PUBLIC_EVENTS}?${params}`, { headers })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`msc_portal_${res.status}:${text.slice(0, 160)}`)
  }

  const payload = await res.json()
  const events = normalizeDcsaEvents(payload, 'msc').map((e) => ({
    ...e,
    raw: payload,
  }))
  return filterEventsForReference(events, reference)
}

async function fetchMscDcsaFallback(reference, referenceType, currentStatus) {
  const ref = String(reference).trim().toUpperCase()
  const types = referenceTypesToTry(ref, referenceType)

  for (const type of types) {
    const events = await fetchMscDcsaRaw(ref, type)
    if (events.length) {
      const latest = pickLatest(events)
      return {
        events,
        usedReferenceType: type,
        suggestedStatus: inferSuggestedStatus(events, currentStatus),
        ...latest,
      }
    }
  }

  return null
}

async function fetchMscPublic(reference, referenceType, currentStatus) {
  try {
    return await fetchMscWebsiteTracking({
      reference,
      referenceType,
      currentStatus,
    })
  } catch (websiteErr) {
    const fallback = await fetchMscDcsaFallback(reference, referenceType, currentStatus)
    if (fallback) return fallback
    throw websiteErr
  }
}

export async function fetchPublicPortalTracking({
  carrier,
  reference,
  referenceType,
  currentStatus,
}) {
  switch (carrier) {
    case 'msc':
      return fetchMscPublic(reference, referenceType, currentStatus)
    default:
      return null
  }
}
