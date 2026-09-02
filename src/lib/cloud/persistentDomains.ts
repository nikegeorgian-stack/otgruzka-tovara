import type { AppStore } from '@/lib/types'
import { STABLE_ID_COLLECTION_PATHS } from './stableIdPaths'

/** All persistent top-level AppStore keys (excluding ephemeral UI-only). */
export const APP_STORE_PERSISTENT_DOMAINS = [
  'version',
  'brigades',
  'brigadeNamesKa',
  'brigadeNamesEn',
  'brigadiers',
  'brigadeHasBrigadier',
  'brigadeUnits',
  'archivedMonths',
  'closedMonths',
  'monthClosures',
  'employees',
  'candidates',
  'months',
  'auditLog',
  'trash',
  'shiftTemplates',
  'hrStructuralUnits',
  'hrPositions',
  'production',
  'sales',
  'aiChat',
  'counterparties',
  'finishedProducts',
  'packagingRecipes',
  'formulations',
  'technologistQc',
  'otc',
  'wastewater',
  'engineerLog',
  'tasks',
  'warehouse',
  'workwear',
  'itOffice',
  'procurement',
  'access',
  'nightShifts',
  'timesheetEntries',
  'attendance',
  'meals',
  'protocols',
  'orgChart',
  'finance',
  'externalEffects',
  'settings',
] as const

export type PersistentDomainKey = (typeof APP_STORE_PERSISTENT_DOMAINS)[number]

export { STABLE_ID_COLLECTION_PATHS }

export function isPersistentDomainKey(key: string): key is PersistentDomainKey {
  return (APP_STORE_PERSISTENT_DOMAINS as readonly string[]).includes(key)
}

export function listPersistentDomainKeys(store: AppStore): PersistentDomainKey[] {
  const keys = new Set<string>(APP_STORE_PERSISTENT_DOMAINS)
  for (const k of Object.keys(store)) keys.add(k)
  return [...keys].filter(isPersistentDomainKey)
}
