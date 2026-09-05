/**
 * Firebase SQL Connect — конфигурация коннектора FST.
 * Production defaults stay hardcoded; Preview overrides via VITE_FST_SQL_CONNECT_*.
 * Persistence value (from vite define + this check): `sqlconnect`.
 */
export const FST_SQL_CONNECT_SERVICE_ID_DEFAULT = 'otgruzka-tovara-service'
export const FST_SQL_CONNECT_LOCATION_DEFAULT = 'europe-west3'
export const FST_SQL_CONNECT_CONNECTOR_DEFAULT = 'fst'

/** @deprecated Prefer FST_SQL_CONNECT_SERVICE_ID_DEFAULT — kept for call sites expecting the constant. */
export const FST_SQL_CONNECT_SERVICE_ID = FST_SQL_CONNECT_SERVICE_ID_DEFAULT
/** @deprecated Prefer FST_SQL_CONNECT_LOCATION_DEFAULT */
export const FST_SQL_CONNECT_LOCATION = FST_SQL_CONNECT_LOCATION_DEFAULT
/** @deprecated Prefer FST_SQL_CONNECT_CONNECTOR_DEFAULT */
export const FST_SQL_CONNECT_CONNECTOR = FST_SQL_CONNECT_CONNECTOR_DEFAULT

function viteTrim(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function resolveFstSqlConnectConfig() {
  const service =
    viteTrim(import.meta.env.VITE_FST_SQL_CONNECT_SERVICE_ID) || FST_SQL_CONNECT_SERVICE_ID_DEFAULT
  const location =
    viteTrim(import.meta.env.VITE_FST_SQL_CONNECT_LOCATION) || FST_SQL_CONNECT_LOCATION_DEFAULT
  const connector =
    viteTrim(import.meta.env.VITE_FST_SQL_CONNECT_CONNECTOR) || FST_SQL_CONNECT_CONNECTOR_DEFAULT
  const projectId = viteTrim(import.meta.env.VITE_FIREBASE_PROJECT_ID)
  if (projectId === 'otgruzka-tovara-stg' && service === FST_SQL_CONNECT_SERVICE_ID_DEFAULT) {
    throw new Error('dataconnect_staging_service_required')
  }
  return { service, location, connector } as const
}

export const fstSqlConnectConfig = resolveFstSqlConnectConfig()

/**
 * Otgruzka web (Vercel/Hosting): только SQL Connect.
 * Valid persistence token from source: `sqlconnect` (also hardcoded in fst-web/vite.config.ts).
 */
export function isSqlConnectPersistence(): boolean {
  if (import.meta.env.VITE_FST_WEB === 'true') return true
  return import.meta.env.VITE_FST_PERSISTENCE === 'sqlconnect'
}
