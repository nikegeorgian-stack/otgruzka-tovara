import type { AppStore } from '@/lib/types'
import { sanitizeStoreForExport } from '@/lib/storage'
import { prepareCloudPayload } from './cloudPayload'
import { clampClientPrivilegeFields } from './privilegeClamp'
import { assertNoMassStoreWipe } from './refuseStoreWipe'
import { conservativeMergeForSave } from './conservativeMerge'
import type { DirtyOperation, EntityConflict } from './dirtyOperations'
import { isBulkOverwriteBlockingAutosave, isBulkProductionOverwriteConfirmed } from './bulkStoreOverwrite'
import {
  canAttemptCloudWrite,
  isCloudPullStale,
  isCloudWriteLifecycleReady,
} from './syncLifecycle'

export type CloudSaveBuildInput = {
  remote: AppStore
  remoteRevision: number
  local: AppStore
  baseline: AppStore
  operations: DirtyOperation[]
  actorEmail?: string | null
}

export type CloudSaveBuildResult = {
  allowed: boolean
  reason?: string
  store?: AppStore
  payloadJson?: string
  fingerprint?: string
  expectedRevision?: number
  nextRevision?: number
  appliedOperationIds: string[]
  conflicts: EntityConflict[]
  changedDomains: string[]
}

export function canCloudWriteNow(hasPendingUserOperations: boolean): { ok: boolean; reason?: string } {
  if (!isCloudWriteLifecycleReady()) return { ok: false, reason: 'lifecycle_not_ready' }
  if (isBulkOverwriteBlockingAutosave()) return { ok: false, reason: 'bulk_overwrite_preview' }
  if (!hasPendingUserOperations && !isBulkProductionOverwriteConfirmed()) {
    return { ok: false, reason: 'no_user_operations' }
  }
  return { ok: true }
}

export function needsPullBeforeWrite(): boolean {
  return isCloudPullStale()
}

export function shouldScheduleCloudSave(hasPendingUserOperations: boolean): boolean {
  if (isBulkOverwriteBlockingAutosave()) return false
  return canAttemptCloudWrite({ hasPendingUserOperations })
}

/** Build payload: fresh remote + conservative user changes + explicit deletes only. */
export function buildCloudSavePayload(input: CloudSaveBuildInput): CloudSaveBuildResult {
  const userOps = input.operations.filter((op) => op.origin === 'user')
  const gate = canCloudWriteNow(userOps.length > 0)
  if (!gate.ok) {
    return {
      allowed: false,
      reason: gate.reason,
      appliedOperationIds: [],
      conflicts: [],
      changedDomains: [],
    }
  }

  const explicitDeletes = userOps.filter((op) => op.type === 'delete' && op.explicit)
  const {
    store: merged,
    conflicts,
    changedDomains,
    completedDeleteOperationIds,
  } = conservativeMergeForSave(
    input.baseline,
    input.remote,
    input.local,
    explicitDeletes,
  )

  const privilegeSafe = clampClientPrivilegeFields(merged, input.remote, input.actorEmail ?? null)
  assertNoMassStoreWipe(input.remote, privilegeSafe)
  const prepared = prepareCloudPayload(sanitizeStoreForExport(privilegeSafe))

  const completedDeletes = new Set(completedDeleteOperationIds)
  const appliedOperationIds = userOps
    .filter((op) => {
      if (op.type === 'delete' && op.explicit) {
        // Only acknowledge deletes that completed (applied or remote already absent).
        // Conflicts keep pending local delete — never silent retry-delete of newer remote.
        return completedDeletes.has(op.operationId)
      }
      return !conflicts.some(
        (c) => c.domain === op.domain && (op.entityId === '*' || c.entityId === op.entityId || c.entityId === '*'),
      )
    })
    .map((op) => op.operationId)

  return {
    allowed: true,
    store: privilegeSafe,
    payloadJson: prepared.json,
    fingerprint: prepared.fingerprint,
    expectedRevision: input.remoteRevision,
    nextRevision: input.remoteRevision + 1,
    appliedOperationIds,
    conflicts,
    changedDomains,
  }
}

export function reconcileRevisionConflict(
  remote: AppStore,
  local: AppStore,
  baseline: AppStore,
  operations: DirtyOperation[],
  remoteRevision: number,
  actorEmail?: string | null,
): CloudSaveBuildResult {
  return buildCloudSavePayload({
    remote,
    remoteRevision,
    local,
    baseline,
    operations,
    actorEmail,
  })
}
