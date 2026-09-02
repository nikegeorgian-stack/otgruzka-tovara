import type { AppStore } from '@/lib/types'
import type { SetStore } from '@/store/storeApi'
import type { StoreUpdateMeta } from '@/lib/cloud/storeMutationOrigin'

/** Применяет изменение store; ошибки из updater пробрасываются наружу (для try/catch в UI). */
export function applyStoreUpdate(
  setStore: SetStore,
  updater: (s: AppStore) => AppStore,
  meta: StoreUpdateMeta = { origin: 'user' },
): void {
  let err: Error | null = null
  setStore((s) => {
    try {
      return updater(s)
    } catch (e) {
      err = e instanceof Error ? e : new Error(String(e))
      return s
    }
  }, meta)
  if (err) throw err
}
