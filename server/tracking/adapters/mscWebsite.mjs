import {
  inferSuggestedStatus,
  pickLatest,
} from '../normalize.mjs'

const MSC_PAGE = 'https://www.msc.com/en/track-a-shipment'
const MSC_API = 'https://www.msc.com/api/feature/tools/TrackingInfo'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function parseCookies(res) {
  const raw = res.headers.getSetCookie?.() ?? []
  return raw.map((c) => c.split(';')[0]).join('; ')
}

function mscDateToIso(dateStr) {
  const m = String(dateStr ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return new Date().toISOString()
  const [, dd, mm, yyyy] = m
  return `${yyyy}-${mm}-${dd}T12:00:00.000Z`
}

function trackingModeFor(referenceType) {
  return referenceType === 'booking' ? '1' : '0'
}

function normalizeMscEvents(containers, reference) {
  const events = []
  for (const container of containers ?? []) {
    const containerNo = container?.ContainerNumber ?? reference
    for (const event of container?.Events ?? []) {
      const detailLabel = event.Detail?.[0]
      const cargoMarker = detailLabel === 'EMPTY' || detailLabel === 'LADEN'
      const vesselName =
        event?.Vessel?.IMO && detailLabel && !cargoMarker ? detailLabel : undefined

      events.push({
        id: `msc-${containerNo}-${event.Order}-${event.Date}-${event.Description}`,
        at: mscDateToIso(event.Date),
        eventCode: String(event.Description ?? '')
          .replace(/\s+/g, '_')
          .toUpperCase()
          .slice(0, 40),
        description: String(event.Description ?? 'Event'),
        location: event.Location ?? event.UnLocationCode,
        facility: event.EquipmentHandling?.Name,
        vesselName: vesselName || event.Detail?.join(' '),
        transportMode: event.Vessel ? 'VESSEL' : undefined,
        equipmentReference: containerNo,
        raw: event,
      })
    }
  }

  return events.sort((a, b) => a.at.localeCompare(b.at))
}

async function fetchMscSessionCookies() {
  const res = await fetch(MSC_PAGE, {
    headers: {
      'User-Agent': UA,
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Upgrade-Insecure-Requests': '1',
    },
  })
  const cookies = parseCookies(res)
  await res.text()
  return cookies
}

export async function fetchMscWebsiteTracking({
  reference,
  referenceType,
  currentStatus,
}) {
  const ref = String(reference).trim().toUpperCase()
  const cookies = await fetchMscSessionCookies()

  const res = await fetch(MSC_API, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Content-Type': 'application/json',
      'User-Agent': UA,
      Origin: 'https://www.msc.com',
      Referer: MSC_PAGE,
      'X-Requested-With': 'XMLHttpRequest',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      Cookie: cookies,
    },
    body: JSON.stringify({
      trackingNumber: ref,
      trackingMode: trackingModeFor(referenceType),
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`msc_website_${res.status}:${text.slice(0, 120)}`)
  }

  const payload = await res.json()
  if (!payload?.IsSuccess || !payload?.Data) {
    throw new Error(`msc_website_no_data:${ref}`)
  }

  const bill = payload.Data.BillOfLadings?.[0]
  const containers = bill?.ContainersInfo ?? []
  const events = normalizeMscEvents(containers, ref)

  if (!events.length) {
    throw new Error(`msc_no_events_for_reference:${ref}`)
  }

  const etaRaw = bill?.GeneralTrackingInfo?.FinalPodEtaDate
  const latest = pickLatest(events)

  return {
    events,
    suggestedStatus: inferSuggestedStatus(events, currentStatus),
    etaDate: etaRaw ? mscDateToIso(etaRaw).slice(0, 10) : undefined,
    ...latest,
  }
}
