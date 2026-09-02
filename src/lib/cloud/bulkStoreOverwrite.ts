/** Import / restore / reset — fail-closed preview; never ordinary autosave. */

import type { AppStore } from '@/lib/types'
import { cloudDirtyTracker } from '@/lib/cloud/dirtyOperations'
import { hasPendingOutboxWork } from '@/lib/cloud/externalEffects/outbox'

export type BulkOverwriteKind = 'import' | 'restore' | 'reset' | 'clear_months'

export type BulkOverwriteState = {
  kind: BulkOverwriteKind
  pending: boolean
  confirmedForProduction: boolean
  previewCounts?: Record<string, number>
  message: string
}

export type BulkStartBlockReason =
  | 'pending_ops'
  | 'conflicts'
  | 'active_outbox'
  | 'bulk_active'

export type BulkStartResult =
  | { ok: true }
  | { ok: false; reason: BulkStartBlockReason; message: string }

const BULK_MESSAGE =
  'Изменения находятся только в предварительном просмотре и не сохранены в облако'

export const BULK_BLOCKED_MESSAGE =
  'Сначала сохраните, отмените или разрешите текущие изменения'

let state: BulkOverwriteState | null = null
const listeners = new Set<(s: BulkOverwriteState | null) => void>()

function emit(): void {
  for (const fn of listeners) fn(state)
}

export function subscribeBulkOverwrite(fn: (s: BulkOverwriteState | null) => void): () => void {
  listeners.add(fn)
  fn(state)
  return () => listeners.delete(fn)
}

export function getBulkOverwriteState(): BulkOverwriteState | null {
  return state
}

/** Fail-closed: refuse preview when unrelated work is in flight. */
export function canBeginBulkStoreOverwrite(store?: AppStore | null): BulkStartResult {
  if (isBulkOverwriteBlockingAutosave()) {
    return { ok: false, reason: 'bulk_active', message: BULK_BLOCKED_MESSAGE }
  }
  if (cloudDirtyTracker.hasPendingUserOperations()) {
    return { ok: false, reason: 'pending_ops', message: BULK_BLOCKED_MESSAGE }
  }
  if (cloudDirtyTracker.getConflicts().length > 0) {
    return { ok: false, reason: 'conflicts', message: BULK_BLOCKED_MESSAGE }
  }
  if (store && hasPendingOutboxWork(store)) {
    return { ok: false, reason: 'active_outbox', message: BULK_BLOCKED_MESSAGE }
  }
  return { ok: true }
}

/**
 * Start bulk preview only when clean.
 * Prefer this over beginBulkStoreOverwrite at call sites that can show UI.
 */
export function tryBeginBulkStoreOverwrite(
  kind: BulkOverwriteKind,
  previewCounts?: Record<string, number>,
  store?: AppStore | null,
): BulkStartResult {
  const check = canBeginBulkStoreOverwrite(store)
  if (!check.ok) return check
  state = {
    kind,
    pending: true,
    confirmedForProduction: false,
    previewCounts,
    message: BULK_MESSAGE,
  }
  emit()
  return { ok: true }
}

/** Starts preview when allowed; returns false without mutating when blocked. */
export function beginBulkStoreOverwrite(
  kind: BulkOverwriteKind,
  previewCounts?: Record<string, number>,
  store?: AppStore | null,
): boolean {
  return tryBeginBulkStoreOverwrite(kind, previewCounts, store).ok
}

export function clearBulkStoreOverwrite(): void {
  state = null
  emit()
}

export function confirmBulkStoreProductionOverwrite(): void {
  if (!state) return
  state = { ...state, confirmedForProduction: true }
  emit()
}

export function isBulkOverwriteBlockingAutosave(): boolean {
  return Boolean(state?.pending && !state.confirmedForProduction)
}

export function isBulkProductionOverwriteConfirmed(): boolean {
  return Boolean(state?.confirmedForProduction)
}

export function getBulkPreviewUserMessage(): string | null {
  if (!isBulkOverwriteBlockingAutosave()) return null
  return state?.message ?? BULK_MESSAGE
}
