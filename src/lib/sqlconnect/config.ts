/**
 * Firebase SQL Connect — конфигурация коннектора FST.
 * После `firebase dataconnect:sdk:generate` можно заменить на generated connectorConfig.
 */
export const FST_SQL_CONNECT_SERVICE_ID = 'otgruzka-tovara-service'
export const FST_SQL_CONNECT_LOCATION = 'europe-west3'
export const FST_SQL_CONNECT_CONNECTOR = 'fst'

export const fstSqlConnectConfig = {
  service: FST_SQL_CONNECT_SERVICE_ID,
  location: FST_SQL_CONNECT_LOCATION,
  connector: FST_SQL_CONNECT_CONNECTOR,
} as const

/**
 * Otgruzka web (Vercel/Hosting): только SQL Connect.
 * Не полагаемся на «забытый» env — иначе бандл уходит в Firestore sync и зеркалит/затирает.
 */
export function isSqlConnectPersistence(): boolean {
  if (import.meta.env.VITE_FST_WEB === 'true') return true
  return import.meta.env.VITE_FST_PERSISTENCE === 'sqlconnect'
}
