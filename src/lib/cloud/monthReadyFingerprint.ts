import type { AppStore } from '@/lib/types'
import { prepareCloudPayload } from '@/lib/cloud/cloudPayload'

/** True when ensureMonthReady changes exported cloud fingerprint (may trigger save if mis-wired). */
export function ensureMonthReadyChangesFingerprint(before: AppStore, after: AppStore): boolean {
  return prepareCloudPayload(before).fingerprint !== prepareCloudPayload(after).fingerprint
}

/**
 * Heuristic: ensureMonthReady only adds/normalizes month scaffolding and schedule defaults.
 * It must not remove remote-backed entities from the exported payload.
 */
export function ensureMonthReadyIsAdditiveForRemote(
  remote: AppStore,
  afterLocalEnsure: AppStore,
): boolean {
  const remoteIds = new Set(remote.employees.map((e) => e.id))
  for (const e of afterLocalEnsure.employees) {
    if (!remoteIds.has(e.id)) return false
  }
  for (const key of Object.keys(remote.months ?? {})) {
    if (!afterLocalEnsure.months[key]) return false
  }
  return true
}
