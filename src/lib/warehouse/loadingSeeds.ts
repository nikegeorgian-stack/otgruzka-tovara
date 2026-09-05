import type { WarehouseStore } from './types'

export const LEGACY_A2LINE_LOADING_ID = 'seed-a2line-portugal-2026-05'

const SEED_DOC_IDS = [
  'seed-a2line-loading-160',
  'seed-a2line-loading-145',
  'seed-a2line-loading-145light',
  'seed-a2line-loading-75',
] as const

const DEMO_LOADING_IDS = new Set<string>([LEGACY_A2LINE_LOADING_ID, ...SEED_DOC_IDS])

/** Не подставляем макеты. Удаляем старые демо-погрузки с seed-id. */
export function ensureLoadingSeeds(store: WarehouseStore): WarehouseStore {
  const shipments = store.loadingShipments ?? []
  const next = shipments.filter((s) => !DEMO_LOADING_IDS.has(s.id))
  if (next.length === shipments.length) return store
  return { ...store, loadingShipments: next }
}

export function countA2LineSeedDocuments(store: WarehouseStore): number {
  return (store.loadingShipments ?? []).filter((s) => DEMO_LOADING_IDS.has(s.id)).length
}
