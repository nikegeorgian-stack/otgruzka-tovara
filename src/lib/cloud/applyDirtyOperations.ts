/**
 * Legacy fine-grained applier — superseded by buildCloudSavePayload / mergeStoreForCloudSave.
 * Kept as a thin adapter so older tests compile; prefer buildCloudSavePayload.
 */
import type { AppStore } from '@/lib/types'
import { mergeStoreForCloudSave } from './cloudSavePipeline'
import type { DirtyOperation, EntityConflict } from './dirtyOperations'

export type ApplyDirtyOperationsResult = {
  store: AppStore
  appliedOperationIds: string[]
  conflicts: EntityConflict[]
}

export function applyDirtyOperationsToRemote(
  remote: AppStore,
  local: AppStore,
  baseline: AppStore,
  operations: DirtyOperation[],
  remoteRevision: number,
): ApplyDirtyOperationsResult {
  void remoteRevision
  const merged = mergeStoreForCloudSave({
    remote,
    local,
    baseline,
    operations,
  })
  return {
    store: merged.store,
    appliedOperationIds: merged.appliedOperationIds,
    conflicts: merged.conflicts,
  }
}
