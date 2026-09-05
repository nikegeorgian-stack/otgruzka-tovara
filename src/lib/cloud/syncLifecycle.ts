/** Cloud sync lifecycle — blocks writes until hydration + stabilization complete. */

export type SyncLifecyclePhase = 'booting' | 'hydrating' | 'stabilizing' | 'ready'

export type SyncLifecycleSnapshot = {
  phase: SyncLifecyclePhase
  cloudRevision: number
  lastPullAt: number | null
  readyAt: number | null
}

const STALE_PULL_MS = 30_000

let phase: SyncLifecyclePhase = 'booting'
let cloudRevision = 0
let lastPullAt: number | null = null
let readyAt: number | null = null

const listeners = new Set<(snap: SyncLifecycleSnapshot) => void>()

function emit(): void {
  const snap = getSyncLifecycleSnapshot()
  for (const fn of listeners) fn(snap)
}

export function getSyncLifecyclePhase(): SyncLifecyclePhase {
  return phase
}

export function getSyncLifecycleSnapshot(): SyncLifecycleSnapshot {
  return { phase, cloudRevision, lastPullAt, readyAt }
}

export function subscribeSyncLifecycle(fn: (snap: SyncLifecycleSnapshot) => void): () => void {
  listeners.add(fn)
  fn(getSyncLifecycleSnapshot())
  return () => listeners.delete(fn)
}

export function resetSyncLifecycle(): void {
  phase = 'booting'
  cloudRevision = 0
  lastPullAt = null
  readyAt = null
  emit()
}

export function setSyncLifecyclePhase(next: SyncLifecyclePhase): void {
  phase = next
  if (next === 'ready' && readyAt == null) {
    readyAt = Date.now()
  }
  emit()
}

export function noteCloudRevision(revision: number): void {
  if (Number.isFinite(revision) && revision > 0) {
    cloudRevision = revision
  }
}

export function noteCloudPullCompleted(revision?: number): void {
  lastPullAt = Date.now()
  if (typeof revision === 'number' && revision > 0) {
    cloudRevision = revision
  }
  emit()
}

/** Writes allowed only in ready phase (not booting/hydrating/stabilizing). */
export function isCloudWriteLifecycleReady(): boolean {
  return phase === 'ready'
}

export function isCloudPullStale(now = Date.now()): boolean {
  if (lastPullAt == null) return true
  return now - lastPullAt > STALE_PULL_MS
}

export function canAttemptCloudWrite(opts?: {
  hasPendingUserOperations?: boolean
  bulkOverwriteConfirmed?: boolean
}): boolean {
  if (!isCloudWriteLifecycleReady()) return false
  if (opts?.bulkOverwriteConfirmed) return true
  return Boolean(opts?.hasPendingUserOperations)
}
