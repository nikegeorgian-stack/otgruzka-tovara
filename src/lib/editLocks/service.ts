import {
  firestoreGetLock,
  firestoreReleaseLock,
  firestoreWriteLock,
  subscribeFirestoreLock,
} from './firestoreLocks'
import {
  editLockTabId,
  localGetLock,
  localHeartbeat,
  localRelease,
  localSetLock,
  subscribeLocalLocks,
} from './localChannel'
import {
  EDIT_LOCK_TTL_MS,
  type EditLockHolder,
  type EditLockRecord,
  type EditLockResourceType,
  isLockExpired,
  isOwnLock,
} from './types'

export { editLockTabId }

export type AcquireResult =
  | { status: 'acquired'; lock: EditLockRecord }
  | { status: 'blocked'; lock: EditLockRecord }

function makeLock(
  resourceId: string,
  resourceType: EditLockResourceType,
  holder: EditLockHolder,
  now = Date.now(),
): EditLockRecord {
  return {
    resourceId,
    resourceType,
    holder,
    acquiredAt: now,
    expiresAt: now + EDIT_LOCK_TTL_MS,
  }
}

function pickForeign(
  local: EditLockRecord | null,
  remote: EditLockRecord | null,
  holder: EditLockHolder,
  now = Date.now(),
): EditLockRecord | null {
  const candidates = [local, remote].filter((l): l is EditLockRecord =>
    Boolean(l && !isLockExpired(l, now) && !isOwnLock(l, holder)),
  )
  if (candidates.length === 0) return null
  return candidates.sort((a, b) => b.acquiredAt - a.acquiredAt)[0]!
}

/** Захватить замок. force=true — перехватить чужой. */
export async function acquireEditLock(options: {
  resourceId: string
  resourceType: EditLockResourceType
  holder: Omit<EditLockHolder, 'tabId'>
  force?: boolean
}): Promise<AcquireResult> {
  const holder: EditLockHolder = { ...options.holder, tabId: editLockTabId }
  const now = Date.now()
  const remote = await firestoreGetLock(options.resourceId)
  const local = localGetLock(options.resourceId)
  const foreign = pickForeign(local, remote, holder, now)

  if (foreign && !options.force) {
    return { status: 'blocked', lock: foreign }
  }

  const lock = makeLock(options.resourceId, options.resourceType, holder, now)
  localSetLock(lock)
  await firestoreWriteLock(lock)
  return { status: 'acquired', lock }
}

export async function heartbeatEditLock(
  resourceId: string,
  resourceType: EditLockResourceType,
  holder: Omit<EditLockHolder, 'tabId'>,
): Promise<void> {
  const full: EditLockHolder = { ...holder, tabId: editLockTabId }
  const lock = makeLock(resourceId, resourceType, full)
  localHeartbeat(lock)
  await firestoreWriteLock(lock)
}

export async function releaseEditLock(
  resourceId: string,
  holder: Omit<EditLockHolder, 'tabId'>,
): Promise<void> {
  const full: EditLockHolder = { ...holder, tabId: editLockTabId }
  localRelease(resourceId, full.tabId)
  await firestoreReleaseLock(resourceId, full)
}

/** Принудительно очистить чужой замок (для перехвата админом). */
export async function forceClearEditLock(lock: EditLockRecord): Promise<boolean> {
  localRelease(lock.resourceId, lock.holder.tabId)
  await firestoreReleaseLock(lock.resourceId, lock.holder)
  const remote = await firestoreGetLock(lock.resourceId)
  if (!remote) return true
  return !(
    remote.holder.uid === lock.holder.uid &&
    remote.holder.tabId === lock.holder.tabId
  )
}

export function subscribeEditLock(
  resourceId: string,
  holder: Omit<EditLockHolder, 'tabId'>,
  onForeign: (lock: EditLockRecord | null) => void,
): () => void {
  const full: EditLockHolder = { ...holder, tabId: editLockTabId }

  const emit = (remote: EditLockRecord | null) => {
    const local = localGetLock(resourceId)
    onForeign(pickForeign(local, remote, full))
  }

  let remote: EditLockRecord | null = null
  const unsubFs = subscribeFirestoreLock(resourceId, (lock) => {
    remote = lock
    emit(remote)
  })
  const unsubLocal = subscribeLocalLocks((id) => {
    if (id === resourceId) emit(remote)
  })
  emit(remote)

  return () => {
    unsubFs()
    unsubLocal()
  }
}
