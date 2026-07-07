/**
 * Схема Firebase Firestore для FST (FiberCell — табель).
 *
 * Проект: fst-uchet (отдельно от FBeda / fbeda-5c061)
 * Режим: Native Firestore (не Realtime Database)
 */

/** Корневая коллекция — документ на организацию (web) или пользователя (legacy). */
export const FST_STORES_COLLECTION = 'fstStores' as const

/** Лёгкий документ-сигнал: revision + fingerprint (~200 байт вместо полного payload). */
export const FST_SYNC_META_COLLECTION = 'fstSyncMeta' as const

/** Шарды большой базы: employees, months, warehouse (отдельные документы < 1 MB). */
export const FST_STORE_SHARDS_COLLECTION = 'fstStoreShards' as const

/** Архив табеля: один документ на месяц YYYY-MM. */
export const FST_MONTH_ARCHIVE_COLLECTION = 'fstMonthArchive' as const

export const CLOUD_STORAGE_FORMAT_SHARDED = 2 as const

/** Общая база FiberCell для всех облачных учёток (admin, HR, …). */
export const FST_SHARED_STORE_DOC_ID = 'fibercell-main' as const

/** Путь документа: fstStores/{id} */
export function fstStoreDocPath(storeDocId: string): string {
  return `${FST_STORES_COLLECTION}/${storeDocId}`
}

/** Путь лёгкого meta-документа: fstSyncMeta/{id} */
export function fstSyncMetaDocPath(storeDocId: string): string {
  return `${FST_SYNC_META_COLLECTION}/${storeDocId}`
}

export function fstStoreShardDocPath(storeDocId: string, shard: string): string {
  return `${FST_STORE_SHARDS_COLLECTION}/${storeDocId}__${shard}`
}

export function fstMonthArchiveDocPath(storeDocId: string, monthKey: string): string {
  return `${FST_MONTH_ARCHIVE_COLLECTION}/${storeDocId}__${monthKey}`
}

/** Web: одна база на компанию. Desktop cloud: per-user (legacy). */
export function resolveCloudStoreDocId(authUid: string): string {
  if (import.meta.env.VITE_FST_WEB === 'true') return FST_SHARED_STORE_DOC_ID
  return authUid
}

/** Поля документа fstStores/{uid} */
export type FstStoreDocument = {
  /** Полный снимок AppStore (табель, склад, справочники, производство…) */
  payload: Record<string, unknown>
  /** Метка приложения */
  app: 'FST'
  /** Версия схемы store (сейчас 6) */
  version: number
  /** Время последнего сохранения (serverTimestamp) */
  updatedAt: unknown
  /** Счётчик ревизий для отсечения эха собственных записей */
  revision?: number
}
