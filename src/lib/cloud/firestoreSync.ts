import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { createDefaultStore, parseStorePayload } from '@/lib/storage'
import type { AppStore } from '@/lib/types'
import { getFirebaseAuth, getFirestoreDb, isFirebaseConfigured } from './firebase'
import { stripUndefinedDeep } from './firestoreSanitize'

const COLLECTION = 'fstStores'
/** Firestore document limit is 1 MiB — warn in console if close. */
const FIRESTORE_DOC_WARN_BYTES = 900_000

function storeDocPath(uid: string): string {
  return `${COLLECTION}/${uid}`
}

async function waitForAuthToken(): Promise<void> {
  const user = getFirebaseAuth().currentUser
  if (!user) throw new Error('auth_missing')
  await user.getIdToken()
}

export async function loadCloudStore(uid: string): Promise<AppStore | null> {
  if (!isFirebaseConfigured()) return null
  await waitForAuthToken()
  const ref = doc(getFirestoreDb(), storeDocPath(uid))
  const snap = await getDoc(ref)
  if (!snap.exists()) return null
  const data = snap.data()
  if (!data?.payload || typeof data.payload !== 'object') return null
  return parseStorePayload(data.payload)
}

export async function saveCloudStore(uid: string, store: AppStore): Promise<void> {
  if (!isFirebaseConfigured()) return
  await waitForAuthToken()
  const payload = stripUndefinedDeep(store)
  const size = JSON.stringify(payload).length
  if (size > FIRESTORE_DOC_WARN_BYTES) {
    console.warn(`FST cloud: payload ${Math.round(size / 1024)} KB — близко к лимиту Firestore 1 MB`)
  }
  const ref = doc(getFirestoreDb(), storeDocPath(uid))
  await setDoc(
    ref,
    stripUndefinedDeep({
      payload,
      updatedAt: serverTimestamp(),
      app: 'FST',
      version: store.version,
    }),
    { merge: true },
  )
}

export async function ensureCloudStore(uid: string): Promise<AppStore> {
  await waitForAuthToken()
  const existing = await loadCloudStore(uid)
  if (existing) return existing
  const fresh = createDefaultStore()
  await saveCloudStore(uid, fresh)
  return fresh
}

export function cloudErrorMessage(err: unknown, fallback: string): string {
  const code =
    err && typeof err === 'object' && 'code' in err ? String((err as { code: string }).code) : ''
  if (code.includes('permission-denied')) {
    return 'Нет доступа к облаку. Выйдите и войдите снова.'
  }
  if (code.includes('unavailable') || code.includes('network')) {
    return 'Нет связи с облаком. Проверьте интернет и повторите.'
  }
  if (code.includes('resource-exhausted') || code.includes('invalid-argument')) {
    return 'Данные слишком большие для облака (лимит Firestore 1 MB).'
  }
  if (String(err).includes('auth_missing')) {
    return 'Сессия истекла. Войдите снова.'
  }
  return fallback
}
