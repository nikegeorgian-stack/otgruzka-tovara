/** Конфигурация API линий — ключи в .env локального сервера */
export function getCarrierConfig(carrier) {
  switch (carrier) {
    case 'maersk':
      return {
        clientId: process.env.MAERSK_CLIENT_ID,
        clientSecret: process.env.MAERSK_CLIENT_SECRET,
        tokenUrl:
          process.env.MAERSK_TOKEN_URL ||
          'https://api.maersk.com/customer-identity/oauth/v2/access_token',
        eventsUrl:
          process.env.MAERSK_EVENTS_URL ||
          'https://api.maersk.com/track-and-trace/v2/events',
      }
    case 'msc':
      return {
        clientId: process.env.MSC_CLIENT_ID,
        clientSecret: process.env.MSC_CLIENT_SECRET,
        tokenUrl:
          process.env.MSC_TOKEN_URL ||
          'https://api.msc.com/dsca/oauth/v2/access_token',
        eventsUrl:
          process.env.MSC_EVENTS_URL ||
          'https://api.msc.com/dsca/track-and-trace/v2/events',
      }
    case 'cma-cgm':
      return {
        clientId: process.env.CMA_CGM_CLIENT_ID,
        clientSecret: process.env.CMA_CGM_CLIENT_SECRET,
        tokenUrl:
          process.env.CMA_CGM_TOKEN_URL ||
          'https://apis.cma-cgm.net/oauth/token',
        eventsUrl:
          process.env.CMA_CGM_EVENTS_URL ||
          'https://apis.cma-cgm.net/dcsa/track-and-trace/v2/events',
      }
    default:
      return {}
  }
}

export function isCarrierConfigured(carrier) {
  const cfg = getCarrierConfig(carrier)
  return Boolean(cfg.clientId && cfg.clientSecret)
}

export const CARRIER_META = {
  maersk: {
    name: 'Maersk',
    portalUrl: 'https://www.maersk.com/tracking/',
    docsUrl: 'https://developer.maersk.com/',
  },
  msc: {
    name: 'MSC',
    portalUrl: 'https://www.msc.com/en/track-a-shipment',
    docsUrl: 'https://developerportal.msc.com/',
  },
  'cma-cgm': {
    name: 'CMA CGM',
    portalUrl: 'https://www.cma-cgm.com/ebusiness/tracking',
    docsUrl: 'https://api-portal.cma-cgm.com/',
  },
}
