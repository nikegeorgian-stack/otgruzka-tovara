import { getOAuthToken } from '../oauth.mjs'
import {
  inferSuggestedStatus,
  normalizeDcsaEvents,
  pickEta,
  pickLatest,
} from '../normalize.mjs'

function buildQuery(reference, referenceType) {
  const params = new URLSearchParams()
  const ref = String(reference).trim()
  if (referenceType === 'container') {
    params.set('equipmentReference', ref)
  } else if (referenceType === 'bl') {
    params.set('transportDocumentReference', ref)
  } else {
    params.set('carrierBookingReference', ref)
  }
  return params
}

/** Общий DCSA v2 адаптер для Maersk / MSC / CMA CGM */
export async function fetchDcsaTracking({
  carrier,
  reference,
  referenceType,
  config,
  currentStatus,
}) {
  const token = await getOAuthToken(carrier, config)
  const params = buildQuery(reference, referenceType)
  const url = `${config.eventsUrl}?${params}`

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(config.clientId ? { 'Consumer-Key': config.clientId } : {}),
    },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`api_${carrier}_failed:${res.status}:${text.slice(0, 240)}`)
  }

  const payload = await res.json()
  const events = normalizeDcsaEvents(payload, carrier)
  const latest = pickLatest(events)

  return {
    events,
    suggestedStatus: inferSuggestedStatus(events, currentStatus),
    etaDate: pickEta(payload),
    ...latest,
  }
}
