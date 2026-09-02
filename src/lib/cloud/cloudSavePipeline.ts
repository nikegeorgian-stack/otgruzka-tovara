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
import {
  atomicGroupBlockedConflicts,
  buildSparseLocalForOps,
  isAtomicGroupOp,
  overlayAtomicGroupOntoStore,
  partitionDirtyOperations,
} from './transactionGroups'

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

function opTouchesConflict(op: DirtyOperation, c: EntityConflict): boolean {
  return (
    c.domain === op.domain &&
    (op.entityId === '*' || c.entityId === op.entityId || c.entityId === '*')
  )
}

function appliedIdsForOps(
  ops: DirtyOperation[],
  conflicts: EntityConflict[],
  completedDeletes: Set<string>,
  monthApplied: Set<string>,
): string[] {
  return ops
    .filter((op) => {
      if (isMonthsGranularOp(op)) return monthApplied.has(op.operationId)
      if (op.type === 'delete' && op.explicit) return completedDeletes.has(op.operationId)
      return !conflicts.some((c) => opTouchesConflict(op, c))
    })
    .map((op) => op.operationId)
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
  const monthOps = userOps.filter(isMonthsGranularOp)
  const nonMonth = userOps.filter((op) => !isMonthsGranularOp(op))
  const { ungrouped, groups } = partitionDirtyOperations(nonMonth)

  const ungroupedDeletes = ungrouped.filter((op) => op.type === 'delete' && op.explicit)
  // When atomic groups are present, sparse-local ungrouped ops so group entities cannot leak.
  // Legacy / ungrouped-only saves keep full local (settings and other non-id domains).
  const ungroupedLocal =
    groups.size > 0
      ? buildSparseLocalForOps(input.remote, input.local, ungrouped)
      : input.local
  const {
    store: ungroupedMerged,
    conflicts: ungroupedConflicts,
    changedDomains,
    completedDeleteOperationIds,
  } = conservativeMergeForSave(
    input.baseline,
    input.remote,
    ungroupedLocal,
    ungroupedDeletes,
  )

  let acc: AppStore = ungroupedMerged
  const conflicts: EntityConflict[] = [...ungroupedConflicts]
  const completedDeletes = new Set(completedDeleteOperationIds)
  const appliedOperationIds: string[] = appliedIdsForOps(
    ungrouped,
    ungroupedConflicts,
    completedDeletes,
    new Set(),
  )

  for (const groupOps of groups.values()) {
    const groupDeletes = groupOps.filter((op) => op.type === 'delete' && op.explicit)
    const groupLocal = buildSparseLocalForOps(input.remote, input.local, groupOps)
    const groupMerge = conservativeMergeForSave(
      input.baseline,
      input.remote,
      groupLocal,
      groupDeletes,
    )
    const groupCompleted = new Set(groupMerge.completedDeleteOperationIds)
    const groupApplied = new Set(
      appliedIdsForOps(groupOps, groupMerge.conflicts, groupCompleted, new Set()),
    )
    const relatedConflicts = groupMerge.conflicts.filter((c) =>
      groupOps.some((op) => opTouchesConflict(op, c)),
    )
    const allOk =
      relatedConflicts.length === 0 && groupOps.every((op) => groupApplied.has(op.operationId))

    if (allOk) {
      overlayAtomicGroupOntoStore(acc, groupMerge.store, groupOps)
      for (const id of groupOps.map((o) => o.operationId)) appliedOperationIds.push(id)
      for (const id of groupMerge.completedDeleteOperationIds) completedDeletes.add(id)
      changedDomains.push(...groupMerge.changedDomains)
    } else {
      conflicts.push(...atomicGroupBlockedConflicts(groupOps, relatedConflicts))
    }
  }

  const monthResult = applyMonthsGranularOperations(
    input.remote.months,
    input.baseline.months,
    input.local.months,
    monthOps,
  )

  acc = {
    ...acc,
    months: monthResult.months,
  }
  if (
    JSON.stringify(monthResult.months ?? {}) !== JSON.stringify(input.remote.months ?? {})
  ) {
    changedDomains.push('months')
  }

  conflicts.push(...monthResult.conflicts)
  appliedOperationIds.push(...monthResult.appliedOperationIds)

  // Legacy path: if there are no atomic groups and we used sparse ungrouped,
  // behavior matches entity-level apply. When all ops are ungrouped without sparse
  // gaps, also accept ops that were stamped without atomic flag (pre-W0.6).
  if (groups.size === 0 && ungrouped.length === 0 && nonMonth.some((o) => !isAtomicGroupOp(o))) {
    // no-op — handled above
  }

  const privilegeSafe = clampClientPrivilegeFields(acc, input.remote, input.actorEmail ?? null)
  assertNoMassStoreWipe(input.remote, privilegeSafe)

  return {
    store: privilegeSafe,
    conflicts,
    changedDomains,
    appliedOperationIds,
    completedDeleteOperationIds: [...completedDeletes],
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
