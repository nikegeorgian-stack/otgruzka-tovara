import type { ContainerReferenceType, SeaCarrier } from '../types'

const PORTALS: Record<SeaCarrier, string> = {
  maersk: 'https://www.maersk.com/tracking/',
  msc: 'https://www.msc.com/en/track-a-shipment',
  'cma-cgm': 'https://www.cma-cgm.com/ebusiness/tracking',
}

export function buildCarrierTrackingUrl(
  carrier: SeaCarrier,
  reference: string,
  referenceType: ContainerReferenceType = 'container',
): string {
  const ref = encodeURIComponent(reference.trim())
  switch (carrier) {
    case 'maersk':
      return `${PORTALS.maersk}${ref}`
    case 'msc':
      return `${PORTALS.msc}?agency=agency#${ref}`
    case 'cma-cgm':
      if (referenceType === 'bl') {
        return `${PORTALS['cma-cgm']}?bl=${ref}`
      }
      if (referenceType === 'booking') {
        return `${PORTALS['cma-cgm']}?booking=${ref}`
      }
      return `${PORTALS['cma-cgm']}?container=${ref}`
    default:
      return PORTALS[carrier]
  }
}

export function carrierLabel(carrier: SeaCarrier): string {
  switch (carrier) {
    case 'maersk':
      return 'Maersk'
    case 'msc':
      return 'MSC'
    case 'cma-cgm':
      return 'CMA CGM'
  }
}

export const SEA_CARRIERS: SeaCarrier[] = ['maersk', 'msc', 'cma-cgm']
