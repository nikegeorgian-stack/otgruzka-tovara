export function buildTrackingUrl(carrier, reference, referenceType = 'container') {
  const ref = encodeURIComponent(String(reference ?? '').trim())
  switch (carrier) {
    case 'maersk':
      return `https://www.maersk.com/tracking/${ref}`
    case 'msc':
      return `https://www.msc.com/en/track-a-shipment?agency=agency#${ref}`
    case 'cma-cgm':
      if (referenceType === 'bl') return `https://www.cma-cgm.com/ebusiness/tracking?bl=${ref}`
      if (referenceType === 'booking') {
        return `https://www.cma-cgm.com/ebusiness/tracking?booking=${ref}`
      }
      return `https://www.cma-cgm.com/ebusiness/tracking?container=${ref}`
    default:
      return ''
  }
}
