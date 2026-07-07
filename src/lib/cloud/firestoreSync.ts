import { doc, getDoc, onSnapshot, runTransaction, setDoc, serverTimestamp } from 'firebase/firestore'
import type { User } from 'firebase/auth'
import { applyAppStoreSeeds, createDefaultStore, parseStorePayload } from '@/lib/storage'
import { countA2LineSeedDocuments } from '@/lib/warehouse/loadingSeeds'
import type { AppStore } from '@/lib/types'
import { getFirebaseAuth, getFirestoreDb, isFirebaseConfigured } from './firebase'
import { stripUndefinedDeep } from './firestoreSanitize'
import { prepareCloudPayload, type PreparedCloudPayload } from './cloudPayload'
import { mergeCloudStores } from './cloudMerge'
import { syncStorePhotosForCloud } from './employeePhotoStorage'
import {
  assembleFromTransaction,
  loadAssembledCloudStore,
  writeShardedStoreToTransaction,
} from './cloudStoreIO'

import { FST_STORES_COLLECTION, resolveCloudStoreDocId, fstSyncMetaDocPath } from './firestoreSchema'

const COLLECTION = FST_STORES_COLLECTION
/** Firestore document limit is 1 MiB — warn in console if close. */
const FIRESTORE_DOC_WARN_BYTES = 900_000

/** Кэш «auth готов» — не вызывать reload/getIdTokenResult на каждое сохранение. */
let saveAuthCache: { uid: string; until: number } | null = null
const SAVE_AUTH_TTL_MS = 4 * 60 * 1000

function storeDocPath(storeDocId: string): string {
  return `${COLLECTION}/${storeDocId}`
}

function syncMetaPath(storeDocId: string): string {
  return fstSyncMetaDocPath(storeDocId)
}

function readMetaFingerprint(data: Record<string, unknown> | undefined): string {
  return typeof data?.fingerprint === 'string' ? data.fingerprint : ''
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
    saveAuthCache = null
    const user = getFirebaseAuth().currentUser
    if (!user) throw err
    await user.reload().catch(() => {})
    await user.getIdToken(true)
    await delay(300)
    return fn()
  }
}

/** Лёгкая проверка токена для частых сохранений (без user.reload). */
async function withCloudSaveAuth<T>(fn: () => Promise<T>): Promise<T> {
  const auth = getFirebaseAuth()
  const user = auth.currentUser
  if (!user) throw new Error('auth_missing')

  const now = Date.now()
  if (!saveAuthCache || saveAuthCache.uid !== user.uid || now >= saveAuthCache.until) {
    await waitForAuthToken()
    saveAuthCache = { uid: user.uid, until: now + SAVE_AUTH_TTL_MS }
  } else {
    await user.getIdToken(false)
  }

  try {
    return await fn()
  } catch (err) {
    if (!isPermissionDenied(err)) throw err
    saveAuthCache = null
    await waitForAuthToken()
    saveAuthCache = { uid: user.uid, until: Date.now() + SAVE_AUTH_TTL_MS }
    return fn()
  }
}

export async function loadCloudStore(authUid: string): Promise<AppStore | null> {
  if (!isFirebaseConfigured()) return null
  return withCloudAuthRetry(async () => {
    const docId = resolveCloudStoreDocId(authUid)
    return loadAssembledCloudStore(docId, true)
  })
}

export type CloudSnapshotMeta = {
  revision: number
  fingerprint: string
}

/**
 * Лёгкая подписка (~200 байт на событие вместо полного payload).
 * Полный store подгружается только при смене revision.
 */
export function subscribeCloudStoreMeta(
  authUid: string,
  onMeta: (meta: CloudSnapshotMeta) => void,
  onError?: (err: unknown) => void,
): () => void {
  if (!isFirebaseConfigured()) return () => {}
  const docId = resolveCloudStoreDocId(authUid)
  const ref = doc(getFirestoreDb(), syncMetaPath(docId))
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) return
      const data = snap.data() as Record<string, unknown>
      onMeta({
        revision: readRevision(data),
        fingerprint: readMetaFingerprint(data),
      })
    },
    (err) => onError?.(err),
  )
}

/** @deprecated Используйте subscribeCloudStoreMeta — меньше трафика при 15+ пользователях. */
export function subscribeCloudStore(
  authUid: string,
  onRemote: (store: AppStore, meta: CloudSnapshotMeta) => void,
  onError?: (err: unknown) => void,
): () => void {
  if (!isFirebaseConfigured()) return () => {}
  const docId = resolveCloudStoreDocId(authUid)
  const ref = doc(getFirestoreDb(), storeDocPath(docId))
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) return
      const data = snap.data() as Record<string, unknown>
      if (!data?.payload || typeof data.payload !== 'object') return
      try {
        const parsed = parseStorePayload(data.payload as Record<string, unknown>)
        if (parsed) {
          onRemote(parsed, {
            revision: readRevision(data),
            fingerprint: readMetaFingerprint(data),
          })
        }
      } catch (err) {
        onError?.(err)
      }
    },
    (err) => onError?.(err),
  )
}

export type CloudStoreSnapshot = {
  store: AppStore
  revision: number
}

function readRevision(data: Record<string, unknown> | undefined): number {
  const rev = data?.revision
  return typeof rev === 'number' && Number.isFinite(rev) ? rev : 0
}

export async function loadCloudStoreSnapshot(authUid: string): Promise<CloudStoreSnapshot | null> {
  if (!isFirebaseConfigured()) return null
  return withCloudAuthRetry(async () => {
    const docId = resolveCloudStoreDocId(authUid)
    const db = getFirestoreDb()
    const metaRef = doc(db, syncMetaPath(docId))
    const [store, metaSnap] = await Promise.all([
      loadAssembledCloudStore(docId, true),
      getDoc(metaRef),
    ])
    if (!store) return null
    const revision = metaSnap.exists()
      ? readRevision(metaSnap.data() as Record<string, unknown>)
      : 0
    return { store, revision }
  })
}

export async function saveCloudStoreMerged(
  authUid: string,
  base: AppStore,
  local: AppStore,
): Promise<{ merged: AppStore; revision: number }> {
  if (!isFirebaseConfigured()) {
    return { merged: local, revision: 0 }
  }

  return withCloudSaveAuth(async () => {
    const docId = resolveCloudStoreDocId(authUid)
    const db = getFirestoreDb()
    const metaRef = doc(db, syncMetaPath(docId))

    const withPhotos = await syncStorePhotosForCloud(local, docId)

    return runTransaction(db, async (transaction) => {
      const { store: remote, revision, monthArchiveKeys: existingArchiveKeys } =
        await assembleFromTransaction(transaction, docId)

      const { store: merged } = mergeCloudStores(base, remote ?? base, withPhotos)
      const prepared = prepareCloudPayload(merged)
      if (prepared.bytes > FIRESTORE_DOC_WARN_BYTES) {
        console.warn(
          `FST cloud: assembled store ${Math.round(prepared.bytes / 1024)} KB — шардирование снизит размер документов`,
        )
      }

      const nextRevision = revision + 1
      const { totalBytes } = writeShardedStoreToTransaction(
        transaction,
        docId,
        merged,
        nextRevision,
        existingArchiveKeys,
      )

      transaction.set(
        metaRef,
        stripUndefinedDeep({
          revision: nextRevision,
          fingerprint: prepared.fingerprint,
          bytes: totalBytes,
          sharded: true,
          updatedAt: serverTimestamp(),
        }),
        { merge: true },
      )

      return { merged, revision: nextRevision }
    })
  })
}

export async function saveCloudStore(authUid: string, store: AppStore): Promise<void> {
  await saveCloudStoreMerged(authUid, store, store)
}

/** Создать meta-документ, если его ещё нет (миграция со старых клиентов). */
export async function ensureSyncMetaDoc(authUid: string, store: AppStore): Promise<void> {
  if (!isFirebaseConfigured()) return
  await withCloudSaveAuth(async () => {
    const docId = resolveCloudStoreDocId(authUid)
    const db = getFirestoreDb()
    const metaRef = doc(db, syncMetaPath(docId))
    const metaSnap = await getDoc(metaRef)
    if (metaSnap.exists()) return

    const storeRef = doc(db, storeDocPath(docId))
    const storeSnap = await getDoc(storeRef)
    const revision = storeSnap.exists()
      ? readRevision(storeSnap.data() as Record<string, unknown>)
      : 0
    const prepared = prepareCloudPayload(store)
    await setDoc(
      metaRef,
      stripUndefinedDeep({
        revision: revision || 1,
        fingerprint: prepared.fingerprint,
        bytes: prepared.bytes,
        updatedAt: serverTimestamp(),
      }),
      { merge: true },
    )
  })
}

export async function saveCloudStorePrepared(
  authUid: string,
  prepared: PreparedCloudPayload,
): Promise<void> {
  if (!isFirebaseConfigured()) return
  await withCloudSaveAuth(async () => {
    const docId = resolveCloudStoreDocId(authUid)
    if (prepared.bytes > FIRESTORE_DOC_WARN_BYTES) {
      console.warn(
        `FST cloud: payload ${Math.round(prepared.bytes / 1024)} KB — близко к лимиту Firestore 1 MB`,
      )
    }
    const ref = doc(getFirestoreDb(), storeDocPath(docId))
    await setDoc(
      ref,
      stripUndefinedDeep({
        payload: prepared.payload,
        updatedAt: serverTimestamp(),
        app: 'FST',
        version: prepared.payload.version,
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
      } else {
        await ensureSyncMetaDoc(authUid, seeded)
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
    return `Нет доступа к облаку${who}. Проверьте, что email есть в allowlist и задеплоены правила Firestore (включая fstSyncMeta): cd fst-web && npm run deploy:firestore-rules`
  }
  if (code.includes('unavailable') || code.includes('network') || hint.includes('failed to fetch')) {
    return 'Нет связи с облаком. Проверьте интернет и повторите.'
  }
  if (code.includes('resource-exhausted') || code.includes('invalid-argument')) {
    return 'Данные слишком большие для облака (лимит Firestore 1 MB на документ). База разбита на части — повторите сохранение; если ошибка повторяется, сообщите администратору.'
  }
  if (String(err).includes('cloud_shard_too_large')) {
    const parts = String(err).split(':')
    const label = parts[1] ?? 'данные'
    const kb = parts[2] ? Math.round(Number(parts[2]) / 1024) : '?'
    return `Часть базы «${label}» слишком большая (${kb} KB). Уберите фото сотрудников или обратитесь к администратору.`
  }
  if (hint.includes('storage') && (hint.includes('not found') || hint.includes('bucket'))) {
    return 'Firebase Storage не настроен. Данные сохранятся без фото — повторите сохранение.'
  }
  if (code.includes('failed-precondition') || hint.includes('transaction')) {
    return 'Конфликт записи в облако (другой пользователь сохранял одновременно). Подождите и повторите.'
  }
  if (String(err).includes('auth_missing')) {
    return 'Сессия истекла. Войдите снова.'
  }
  const detail = [code, message].filter(Boolean).join(': ').trim()
  if (detail && detail.length < 120) {
    return `${fallback} (${detail})`
  }
  return fallback
}
