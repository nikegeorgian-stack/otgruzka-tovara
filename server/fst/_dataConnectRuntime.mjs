/**
 * Runtime Data Connect routing for Admin SDK.
 * Generated SDK keeps production defaults; Preview/staging overrides via env.
 */
import { connectorConfig as generatedConnectorConfig } from '@fst/dataconnect-admin-generated'

export const FST_DC_DEFAULT_SERVICE_ID = 'otgruzka-tovara-service'
export const FST_DC_DEFAULT_LOCATION = 'europe-west3'
export const FST_DC_DEFAULT_CONNECTOR = 'fst-admin'
export const FST_STAGING_PROJECT_ID = 'otgruzka-tovara-stg'
export const FST_STAGING_SERVICE_ID = 'otgruzka-tovara-stg-service'
export const FST_PRODUCTION_PROJECT_ID = 'otgruzka-tovara'

function trimEnv(name) {
  return String(process.env[name] ?? '').trim()
}

/** Preview / explicit staging must never fall through to production DC IDs. */
export function isStagingIsolatedRuntime() {
  const cloudEnv = trimEnv('FST_CLOUD_ENV').toLowerCase()
  if (cloudEnv === 'staging' || cloudEnv === 'preview') return true
  if (trimEnv('VERCEL_ENV') === 'preview') return true
  const expected = trimEnv('FST_EXPECTED_FIREBASE_PROJECT_ID')
  if (expected === FST_STAGING_PROJECT_ID) return true
  return false
}

export function resolveAdminDataConnectConfig(base = generatedConnectorConfig) {
  const serviceId =
    trimEnv('FST_SQL_CONNECT_SERVICE_ID') ||
    trimEnv('FST_DATACONNECT_SERVICE_ID') ||
    base?.serviceId ||
    FST_DC_DEFAULT_SERVICE_ID
  const location =
    trimEnv('FST_SQL_CONNECT_LOCATION') ||
    trimEnv('FST_DATACONNECT_LOCATION') ||
    base?.location ||
    FST_DC_DEFAULT_LOCATION
  const connector =
    trimEnv('FST_SQL_CONNECT_CONNECTOR') ||
    trimEnv('FST_DATACONNECT_CONNECTOR') ||
    base?.connector ||
    FST_DC_DEFAULT_CONNECTOR

  if (isStagingIsolatedRuntime()) {
    if (serviceId === FST_DC_DEFAULT_SERVICE_ID || serviceId === 'otgruzka-tovara-service') {
      throw new Error('dataconnect_staging_service_required')
    }
    if (serviceId !== FST_STAGING_SERVICE_ID) {
      throw new Error('dataconnect_staging_service_mismatch')
    }
  }

  return {
    ...base,
    connector,
    serviceId,
    location,
  }
}
