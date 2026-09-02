/**
 * Legacy fine-grained applier — superseded by conservativeMergeForSave.
 * Kept as a thin adapter so older tests compile; prefer conservativeMergeForSave.
 */
import type { AppStore } from '@/lib/types'
import { conservativeMergeForSave } from './conservativeMerge'
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
  const explicitDeletes = operations.filter((op) => op.type === 'delete' && op.explicit)
  const { store, conflicts, completedDeleteOperationIds } = conservativeMergeForSave(
    baseline,
    remote,
    local,
    explicitDeletes,
  )
  const completed = new Set(completedDeleteOperationIds)
  const appliedOperationIds = operations
    .filter((op) => {
      if (op.origin !== 'user') return false
      if (op.type === 'delete' && op.explicit) return completed.has(op.operationId)
      return !conflicts.some(
        (c) => c.domain === op.domain && (c.entityId === op.entityId || c.entityId === '*'),
      )
    })
    .map((op) => op.operationId)
  return { store, appliedOperationIds, conflicts }
}
