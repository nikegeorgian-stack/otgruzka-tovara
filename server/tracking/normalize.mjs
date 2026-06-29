const CODE_STATUS = {
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
}

const STATUS_RANK = {
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

function pickLocation(event) {
  return (
    event?.transportCall?.location?.locationName ||
    event?.eventLocation?.locationName ||
    event?.location?.locationName ||
    event?.facilityCode ||
    event?.unLocationCode ||
    undefined
  )
}

function pickDescription(event) {
  return (
    event?.description ||
    event?.eventType ||
    event?.equipmentEventTypeCode ||
    event?.transportEventTypeCode ||
    event?.shipmentEventTypeCode ||
    'Event'
  )
}

function pickCode(event) {
  return (
    event?.equipmentEventTypeCode ||
    event?.transportEventTypeCode ||
    event?.shipmentEventTypeCode ||
    event?.eventType ||
    ''
  )
}

function pickAt(event) {
  const raw =
    event?.eventDateTime ||
    event?.eventCreatedDateTime ||
    event?.timestamp ||
    event?.date
  if (!raw) return new Date().toISOString()
  return String(raw)
}

function pickVessel(event) {
  return (
    event?.transportCall?.vessel?.vesselName ||
    event?.vessel?.vesselName ||
    event?.vesselName ||
    undefined
  )
}

/** DCSA events[] → нормализованный список */
export function normalizeDcsaEvents(payload, carrier) {
  const list = Array.isArray(payload)
    ? payload
    : payload?.events ||
      payload?.transportEvents ||
      payload?.equipmentEvents ||
      payload?.data ||
      []

  return list
    .map((event, idx) => {
      const at = pickAt(event)
      const description = String(pickDescription(event))
      const eventCode = String(pickCode(event)).toUpperCase()
      const id =
        event?.eventID ||
        event?.eventId ||
        event?.id ||
        `${carrier}-${at}-${eventCode}-${idx}`

      return {
        id: String(id),
        at,
        eventCode,
        description,
        location: pickLocation(event),
        facility: event?.facilityTypeCode,
        vesselName: pickVessel(event),
        transportMode: event?.modeOfTransport,
      }
    })
    .sort((a, b) => a.at.localeCompare(b.at))
}

function statusFromEvent(event) {
  const code = (event.eventCode ?? '').replace(/[^A-Z]/g, '')
  if (CODE_STATUS[code]) return CODE_STATUS[code]
  const text = `${event.description} ${event.location ?? ''}`.toLowerCase()
  if (/gate.?in|load/.test(text)) return 'shipped'
  if (/depart|depa|sailed/.test(text)) return 'in_transit'
  if (/customs|clearance/.test(text)) return 'customs'
  if (/arriv|discharg/.test(text)) return 'customs'
  if (/gate.?out|deliver/.test(text)) return 'arrived'
  return null
}

export function inferSuggestedStatus(events, currentStatus = 'ordered') {
  let best = currentStatus
  let bestRank = STATUS_RANK[currentStatus] ?? 0
  for (const event of events) {
    const mapped = statusFromEvent(event)
    if (!mapped) continue
    const rank = STATUS_RANK[mapped] ?? 0
    if (rank > bestRank) {
      best = mapped
      bestRank = rank
    }
  }
  return best
}

export function pickLatest(events) {
  if (!events.length) return {}
  const latest = events[events.length - 1]
  return {
    latestLocation: latest.location,
    latestDescription: latest.description,
    latestEventAt: latest.at,
    vesselName: latest.vesselName,
  }
}

export function pickEta(payload) {
  const eta =
    payload?.estimatedTimeOfArrival ||
    payload?.eta ||
    payload?.delivery?.estimatedTimeOfArrival
  if (!eta) return undefined
  return String(eta).slice(0, 10)
}
