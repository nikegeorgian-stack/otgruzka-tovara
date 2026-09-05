import type { AppStore } from '@/lib/types'

export type FstCloudSyncProps = {
  store: AppStore
  /**
   * Cloud hydration / pull — must NOT open bulk gate or create dirty ops.
   * Prefer this for SQL Connect and any remote pull path.
   */
  applyCloudStore: (next: AppStore) => void
  /** User-origin local patch (creates dirty ops for SQL save). */
  patchUserStore?: (fn: (s: AppStore) => AppStore) => void
  /**
   * Legacy alias used by non-SQL sync (Firestore) and LocalDb until migrated.
   * Prefer applyCloudStore for hydration; replaceStoreForBulk for import preview.
   */
  replaceStore?: (next: AppStore) => void
}
