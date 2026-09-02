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
import {
  applyMonthsGranularOperations,
  isLegacyWholeMonthsOp,
  isStructuralMonthOp,
  isTimesheetCellOp,
} from './timesheetCellOps'

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

function isMonthsGranularOp(op: DirtyOperation): boolean {
  return isTimesheetCellOp(op) || isStructuralMonthOp(op) || isLegacyWholeMonthsOp(op)
}

/** Core merge used by save build and legacy apply adapter (no lifecycle gate). */
export function mergeStoreForCloudSave(input: {
  remote: AppStore
  local: AppStore
  baseline: AppStore
  operations: DirtyOperation[]
  actorEmail?: string | null
}): {
  store: AppStore
  conflicts: EntityConflict[]
  changedDomains: string[]
  appliedOperationIds: string[]
  completedDeleteOperationIds: string[]
} {
  const userOps = input.operations.filter((op) => op.origin === 'user')
  const explicitDeletes = userOps.filter(
    (op) => op.type === 'delete' && op.explicit && !isMonthsGranularOp(op),
  )
  const {
    store: mergedBase,
    conflicts: domainConflicts,
    changedDomains,
    completedDeleteOperationIds,
  } = conservativeMergeForSave(
    input.baseline,
    input.remote,
    input.local,
    explicitDeletes,
  )

  const monthOps = userOps.filter(isMonthsGranularOp)
  const monthResult = applyMonthsGranularOperations(
    input.remote.months,
    input.baseline.months,
    input.local.months,
    monthOps,
  )

  const merged: AppStore = {
    ...mergedBase,
    months: monthResult.months,
  }
  if (
    JSON.stringify(monthResult.months ?? {}) !== JSON.stringify(input.remote.months ?? {})
  ) {
    changedDomains.push('months')
  }

  const conflicts: EntityConflict[] = [...domainConflicts, ...monthResult.conflicts]
  const monthApplied = new Set(monthResult.appliedOperationIds)
  const completedDeletes = new Set(completedDeleteOperationIds)

  const privilegeSafe = clampClientPrivilegeFields(merged, input.remote, input.actorEmail ?? null)
  assertNoMassStoreWipe(input.remote, privilegeSafe)

  const appliedOperationIds = userOps
    .filter((op) => {
      if (isMonthsGranularOp(op)) return monthApplied.has(op.operationId)
      if (op.type === 'delete' && op.explicit) return completedDeletes.has(op.operationId)
      return !conflicts.some(
        (c) =>
          c.domain === op.domain &&
          (op.entityId === '*' || c.entityId === op.entityId || c.entityId === '*'),
      )
    })
    .map((op) => op.operationId)

  return {
    store: privilegeSafe,
    conflicts,
    changedDomains,
    appliedOperationIds,
    completedDeleteOperationIds,
  }
}

/** Build payload: fresh remote + conservative user changes + granular months ops. */
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

  const merged = mergeStoreForCloudSave({
    remote: input.remote,
    local: input.local,
    baseline: input.baseline,
    operations: input.operations,
    actorEmail: input.actorEmail,
  })

  const prepared = prepareCloudPayload(sanitizeStoreForExport(merged.store))

  return {
    allowed: true,
    store: merged.store,
    payloadJson: prepared.json,
    fingerprint: prepared.fingerprint,
    expectedRevision: input.remoteRevision,
    nextRevision: input.remoteRevision + 1,
    appliedOperationIds: merged.appliedOperationIds,
    conflicts: merged.conflicts,
    changedDomains: merged.changedDomains,
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
