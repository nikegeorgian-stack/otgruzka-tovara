import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  deleteDoc,
  type Unsubscribe,
} from 'firebase/firestore'
import { getFirestoreDb, isFirebaseConfigured } from '@/lib/cloud/firebase'
import { FST_EDIT_LOCKS_COLLECTION } from '@/lib/cloud/firestoreSchema'
import {
  type EditLockHolder,
  type EditLockRecord,
  type EditLockResourceType,
  isLockExpired,
} from './types'

type FirestoreLockDoc = {
  resourceId: string
  resourceType: EditLockResourceType
  holderUid: string
  holderName: string
  tabId: string
  acquiredAtMs: number
  expiresAtMs: number
  updatedAt?: unknown
}

function toRecord(data: FirestoreLockDoc): EditLockRecord {
  return {
    resourceId: data.resourceId,
    resourceType: data.resourceType,
    holder: {
      uid: data.holderUid,
      name: data.holderName,
      tabId: data.tabId,
    },
    acquiredAt: data.acquiredAtMs,
    expiresAt: data.expiresAtMs,
  }
}

export async function firestoreGetLock(resourceId: string): Promise<EditLockRecord | null> {
  if (!isFirebaseConfigured()) return null
  try {
    const ref = doc(getFirestoreDb(), FST_EDIT_LOCKS_COLLECTION, resourceId)
    const snap = await getDoc(ref)
    if (!snap.exists()) return null
    const data = snap.data() as FirestoreLockDoc
    const lock = toRecord(data)
    if (isLockExpired(lock)) return null
    return lock
  } catch {
    return null
  }
}

export async function firestoreWriteLock(
  lock: EditLockRecord,
): Promise<boolean> {
  if (!isFirebaseConfigured()) return false
  try {
    const ref = doc(getFirestoreDb(), FST_EDIT_LOCKS_COLLECTION, lock.resourceId)
    const payload: FirestoreLockDoc = {
      resourceId: lock.resourceId,
      resourceType: lock.resourceType,
      holderUid: lock.holder.uid,
      holderName: lock.holder.name,
      tabId: lock.holder.tabId,
      acquiredAtMs: lock.acquiredAt,
      expiresAtMs: lock.expiresAt,
      updatedAt: serverTimestamp(),
    }
    await setDoc(ref, payload, { merge: true })
    return true
  } catch {
    return false
  }
}

export async function firestoreReleaseLock(
  resourceId: string,
  holder: EditLockHolder,
): Promise<void> {
  if (!isFirebaseConfigured()) return
  try {
    const ref = doc(getFirestoreDb(), FST_EDIT_LOCKS_COLLECTION, resourceId)
    const snap = await getDoc(ref)
    if (!snap.exists()) return
    const data = snap.data() as FirestoreLockDoc
    if (data.holderUid === holder.uid && data.tabId === holder.tabId) {
      await deleteDoc(ref)
    }
  } catch {
    /* ignore */
  }
}

export function subscribeFirestoreLock(
  resourceId: string,
  onChange: (lock: EditLockRecord | null) => void,
): Unsubscribe {
  if (!isFirebaseConfigured()) {
    onChange(null)
    return () => {}
  }
  try {
    const ref = doc(getFirestoreDb(), FST_EDIT_LOCKS_COLLECTION, resourceId)
    return onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          onChange(null)
          return
        }
        const lock = toRecord(snap.data() as FirestoreLockDoc)
        onChange(isLockExpired(lock) ? null : lock)
      },
      () => onChange(null),
    )
  } catch {
    onChange(null)
    return () => {}
  }
}
