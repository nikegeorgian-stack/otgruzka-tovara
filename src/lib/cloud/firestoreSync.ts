import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import type { User } from 'firebase/auth'
import { applyAppStoreSeeds, createDefaultStore, parseStorePayload } from '@/lib/storage'
import { countA2LineSeedDocuments } from '@/lib/warehouse/loadingSeeds'
import type { AppStore } from '@/lib/types'
import { getFirebaseAuth, getFirestoreDb, isFirebaseConfigured } from './firebase'
import { stripUndefinedDeep } from './firestoreSanitize'

import { FST_STORES_COLLECTION, resolveCloudStoreDocId } from './firestoreSchema'

const COLLECTION = FST_STORES_COLLECTION
/** Firestore document limit is 1 MiB — warn in console if close. */
const FIRESTORE_DOC_WARN_BYTES = 900_000

function storeDocPath(storeDocId: string): string {
  return `${COLLECTION}/${storeDocId}`
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isPermissionDenied(err: unknown): boolean {
  const code =
    err && typeof err === 'object' && 'code' in err ? String((err as { code: string }).code) : ''
  const message = err instanceof Error ? err.message : String(err ?? '')
  const hint = `${code} ${message}`.toLowerCase()
  return (
    code.includes('permission-denied') ||
    hint.includes('permission') ||
    hint.includes('insufficient permissions')
  )
}

/** Дождаться JWT с email — на новых устройствах токен иногда без email при первом запросе. */
async function waitForAuthToken(): Promise<User> {
  const auth = getFirebaseAuth()
  let user = auth.currentUser
  if (!user) throw new Error('auth_missing')

  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await user.reload()
    } catch {
      /* ignore transient reload errors */
    }
    const forceRefresh = attempt > 0
    const tokenResult = await user.getIdTokenResult(forceRefresh)
    const email =
      (typeof tokenResult.claims.email === 'string' && tokenResult.claims.email) ||
      user.email ||
      ''
    if (email.trim()) {
      await user.getIdToken(forceRefresh)
      return user
    }
    await delay(200 * (attempt + 1))
    user = auth.currentUser ?? user
  }

  throw new Error('auth_email_missing')
}

async function withCloudAuthRetry<T>(fn: () => Promise<T>): Promise<T> {
  await waitForAuthToken()
  try {
    return await fn()
  } catch (err) {
    if (!isPermissionDenied(err)) throw err
    const user = getFirebaseAuth().currentUser
    if (!user) throw err
    await user.reload().catch(() => {})
    await user.getIdToken(true)
    await delay(300)
    return fn()
  }
}

export async function loadCloudStore(authUid: string): Promise<AppStore | null> {
  if (!isFirebaseConfigured()) return null
  return withCloudAuthRetry(async () => {
    const docId = resolveCloudStoreDocId(authUid)
    const ref = doc(getFirestoreDb(), storeDocPath(docId))
    const snap = await getDoc(ref)
    if (!snap.exists()) return null
    const data = snap.data()
    if (!data?.payload || typeof data.payload !== 'object') return null
    return parseStorePayload(data.payload)
  })
}

export async function saveCloudStore(authUid: string, store: AppStore): Promise<void> {
  if (!isFirebaseConfigured()) return
  await withCloudAuthRetry(async () => {
    const docId = resolveCloudStoreDocId(authUid)
    const payload = stripUndefinedDeep(store)
    const size = JSON.stringify(payload).length
    if (size > FIRESTORE_DOC_WARN_BYTES) {
      console.warn(`FST cloud: payload ${Math.round(size / 1024)} KB — близко к лимиту Firestore 1 MB`)
    }
    const ref = doc(getFirestoreDb(), storeDocPath(docId))
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
  })
}

export async function ensureCloudStore(authUid: string): Promise<AppStore> {
  return withCloudAuthRetry(async () => {
    const docId = resolveCloudStoreDocId(authUid)
    const existing = await loadCloudStore(authUid)
    if (existing) {
      const before = countA2LineSeedDocuments(existing.warehouse)
      const seeded = applyAppStoreSeeds(existing)
      const after = countA2LineSeedDocuments(seeded.warehouse)
      if (after > before || seeded.warehouse !== existing.warehouse) {
        await saveCloudStore(authUid, seeded)
      }
      return seeded
    }
    if (docId !== authUid) {
      const legacy = await loadCloudStoreLegacy(authUid)
      if (legacy) {
        const seeded = applyAppStoreSeeds(legacy)
        await saveCloudStore(authUid, seeded)
        return seeded
      }
    }
    const fresh = applyAppStoreSeeds(createDefaultStore())
    await saveCloudStore(authUid, fresh)
    return fresh
  })
}

/** Документ fstStores/{authUid} до общей базы fibercell-main */
async function loadCloudStoreLegacy(authUid: string): Promise<AppStore | null> {
  const ref = doc(getFirestoreDb(), storeDocPath(authUid))
  const snap = await getDoc(ref)
  if (!snap.exists()) return null
  const data = snap.data()
  if (!data?.payload || typeof data.payload !== 'object') return null
  return parseStorePayload(data.payload)
}

export function cloudErrorMessage(err: unknown, fallback: string): string {
  const authEmail = getFirebaseAuth().currentUser?.email?.trim().toLowerCase()
  const code =
    err && typeof err === 'object' && 'code' in err ? String((err as { code: string }).code) : ''
  const message = err instanceof Error ? err.message : String(err ?? '')
  const hint = `${code} ${message}`.toLowerCase()

  if (String(err).includes('auth_email_missing')) {
    return 'Не удалось подтвердить email сессии. Выйдите и войдите снова.'
  }
  if (
    code.includes('permission-denied') ||
    hint.includes('permission') ||
    hint.includes('insufficient permissions')
  ) {
    const who = authEmail ? ` (${authEmail})` : ''
    return `Нет доступа к облаку${who}. Администратор должен добавить email в Firestore rules и выполнить: cd fst-web && npm run deploy:firestore-rules`
  }
  if (code.includes('unavailable') || code.includes('network') || hint.includes('failed to fetch')) {
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
