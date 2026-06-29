/**
 * Схема Firebase Firestore для FST (FiberCell — табель).
 *
 * Проект: fst-uchet (отдельно от FBeda / fbeda-5c061)
 * Режим: Native Firestore (не Realtime Database)
 */

/** Корневая коллекция — документ на организацию (web) или пользователя (legacy). */
export const FST_STORES_COLLECTION = 'fstStores' as const

/** Общая база FiberCell для всех облачных учёток (admin, HR, …). */
export const FST_SHARED_STORE_DOC_ID = 'fibercell-main' as const

/** Путь документа: fstStores/{id} */
export function fstStoreDocPath(storeDocId: string): string {
  return `${FST_STORES_COLLECTION}/${storeDocId}`
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
}
