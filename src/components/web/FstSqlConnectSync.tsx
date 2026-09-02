import { startTransition, useCallback, useEffect, useRef, useState } from 'react'
import { useFstAuth } from '@/context/FstAuthContext'
import { useI18n } from '@/context/I18nContext'
import {
  applyAppStoreSeeds,
  parseStorePayload,
  restoreLocalSecrets,
  sanitizeStoreForExport,
} from '@/lib/storage'
import { mergeCloudStores } from '@/lib/cloud/cloudMerge'
import { prepareCloudPayload } from '@/lib/cloud/cloudPayload'
import { clampClientPrivilegeFields } from '@/lib/cloud/privilegeClamp'
import { FST_SHARED_STORE_DOC_ID } from '@/lib/cloud/firestoreSchema'
import {
  listenStoreTabMessages,
  notifyStoreTabsSaved,
  requestStoreTabsRefresh,
} from '@/lib/cloud/storeTabSync'
import {
  isSqlRevisionConflict,
  sqlConnectErrorMessage,
  sqlGetFstStore,
  sqlSubscribeFstStoreMeta,
  sqlUpdateFstStore,
} from '@/lib/sqlconnect/fstStoreSqlSync'
import { assertNoMassStoreWipe } from '@/lib/cloud/refuseStoreWipe'
import type { AppStore } from '@/lib/types'
import type { FstCloudSyncProps } from './fstCloudTypes'

const SAVE_DEBOUNCE_MS = 2500
const LOAD_TIMEOUT_MS = 45_000
const SAVE_TIMEOUT_MS = 60_000
const REMOTE_PULL_DEBOUNCE_MS = 250
/** Частый poll: вкладки на vercel.app и web.app — разные origin, BroadcastChannel не связывает. */
const IDLE_POLL_MS = 10_000
const SAVED_FLASH_MS = 2500
const MERGED_HINT_MS = 3000
const MAX_SAVE_RETRIES = 5

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

type SyncStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'pulling' | 'updated'

function parsePayloadJson(payload: unknown): AppStore | null {
  try {
    let raw: unknown = payload
    if (typeof payload === 'string') {
      raw = JSON.parse(payload)
      if (typeof raw === 'string') raw = JSON.parse(raw)
    } else if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return null
    }
    return parseStorePayload(raw)
  } catch (err) {
    console.warn('[FST SQL] payload parse failed', err, typeof payload)
    return null
  }
}

export function FstSqlConnectSync({ store, replaceStore }: FstCloudSyncProps) {
  const { user, configured } = useFstAuth()
  const { t, tf } = useI18n()
  const uid = user?.uid ?? null
  const storeId = FST_SHARED_STORE_DOC_ID

  const [ready, setReady] = useState(!configured)
  const [readOnly, setReadOnly] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [remotePending, setRemotePending] = useState(false)
  const [conflictCount, setConflictCount] = useState(0)
  const [status, setStatus] = useState<SyncStatus>('idle')
  const [reloadKey, setReloadKey] = useState(0)

  const storeRef = useRef(store)
  const skipSave = useRef(true)
  const lastRevision = useRef(0)
  const lastFingerprint = useRef<string | null>(null)
  const lastSyncedStore = useRef<AppStore | null>(null)
  const editGen = useRef(0)
  const savedGen = useRef(0)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pullTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveInFlight = useRef(false)
  const pendingSave = useRef(false)
  const pullInFlight = useRef(false)
  const applyingRemote = useRef(false)
  const hasLoadedOnce = useRef(false)
  const remoteStoreRef = useRef<AppStore | null>(null)
  const tRef = useRef(t)

  storeRef.current = store
  tRef.current = t

  const flashStatus = useCallback((next: SyncStatus, ms?: number) => {
    setStatus(next)
    if (statusTimer.current) clearTimeout(statusTimer.current)
    if (ms && ms > 0) {
      statusTimer.current = setTimeout(() => {
        const dirty = editGen.current !== savedGen.current
        setStatus(dirty ? 'dirty' : 'idle')
      }, ms)
    }
  }, [])

  const applyStore = useCallback(
    (next: AppStore) => {
      startTransition(() => replaceStore(next))
    },
    [replaceStore],
  )

  const commitSyncedState = useCallback(
    (next: AppStore, revision?: number, fingerprint?: string) => {
      const seeded = applyAppStoreSeeds(next)
      lastSyncedStore.current = seeded
      lastFingerprint.current = fingerprint ?? prepareCloudPayload(seeded).fingerprint
      savedGen.current = editGen.current
      if (typeof revision === 'number' && revision > 0) {
        lastRevision.current = revision
      }
      skipSave.current = false
      setRemotePending(false)
      setConflictCount(0)
      remoteStoreRef.current = null
      if (statusTimer.current) clearTimeout(statusTimer.current)
      setStatus('idle')
      return seeded
    },
    [],
  )

  const applyRemoteStore = useCallback(
    (raw: AppStore, opts?: { force?: boolean; revision?: number; silentHint?: boolean }) => {
      const force = opts?.force ?? false
      const base = lastSyncedStore.current ?? storeRef.current
      const local = storeRef.current
      const remote = applyAppStoreSeeds(raw)
      const fpBefore = lastFingerprint.current
      const { store: merged, conflictCount: conflicts } = mergeCloudStores(base, remote, local)
      const mergedSeeded = applyAppStoreSeeds(restoreLocalSecrets(local, merged))
      const localDirty = editGen.current !== savedGen.current

      if (!force && !localDirty) {
        applyStore(mergedSeeded)
        commitSyncedState(mergedSeeded, opts?.revision)
        const fpAfter = lastFingerprint.current
        if (opts?.silentHint !== false && fpBefore && fpAfter && fpBefore !== fpAfter) {
          flashStatus('updated', MERGED_HINT_MS)
        }
        return
      }

      if (!force && localDirty) {
        remoteStoreRef.current = remote
        setConflictCount(conflicts)
        if (conflicts > 0) {
          setRemotePending(true)
          if (typeof opts?.revision === 'number') {
            lastRevision.current = Math.max(lastRevision.current, opts.revision)
          }
        }
        return
      }

      applyingRemote.current = true
      applyStore(mergedSeeded)
      commitSyncedState(mergedSeeded, opts?.revision)
      applyingRemote.current = false
    },
    [applyStore, commitSyncedState, flashStatus],
  )

  const pullRemote = useCallback(
    async (force = false, silentHint = true) => {
      if (pullInFlight.current) return
      pullInFlight.current = true
      if (force) flashStatus('pulling')
      try {
        const row = await sqlGetFstStore(storeId)
        if (!row) {
          if (force) {
            setError(
              sqlConnectErrorMessage(
                new Error('sql_shared_store_missing'),
                tRef.current('web.cloud.loadFailed'),
              ),
            )
          }
          return
        }
        const parsed = parsePayloadJson(row.payloadJson)
        if (!parsed) throw new Error('invalid_payload')
        applyRemoteStore(parsed, { force, revision: row.revision, silentHint })
        if (force) setError(null)
      } catch (err) {
        console.warn('FST SQL pull failed', err)
        // Idle poll: только лог. Ручной/forced pull — показать пользователю.
        if (force) {
          setError(sqlConnectErrorMessage(err, tRef.current('web.cloud.loadFailed')))
        }
      } finally {
        pullInFlight.current = false
        if (force) {
          const dirty = editGen.current !== savedGen.current
          if (!dirty) setStatus('idle')
        }
      }
    },
    [applyRemoteStore, flashStatus, storeId],
  )

  const schedulePullRemote = useCallback(
    (force = false) => {
      if (pullTimer.current) clearTimeout(pullTimer.current)
      if (force) {
        void pullRemote(true)
        return
      }
      pullTimer.current = setTimeout(() => {
        void pullRemote(false)
      }, REMOTE_PULL_DEBOUNCE_MS)
    },
    [pullRemote],
  )

  const flushSave = useCallback(async () => {
    if (!uid || !ready || skipSave.current) return
    if (saveInFlight.current) {
      pendingSave.current = true
      return
    }

    saveInFlight.current = true
    flashStatus('saving')
    setError(null)

    try {
      for (let attempt = 0; attempt < MAX_SAVE_RETRIES; attempt++) {
        const local = storeRef.current
        const synced = lastSyncedStore.current
        if (
          synced &&
          synced.employees.length >= 8 &&
          local.employees.length < Math.ceil(synced.employees.length * 0.85)
        ) {
          console.error('FST SQL: refuse save — sparse local employees vs last sync', {
            local: local.employees.length,
            synced: synced.employees.length,
          })
          setError(
            'Сохранение остановлено: в браузере неполный список сотрудников. Идёт обновление из SQL…',
          )
          schedulePullRemote(true)
          return
        }

        const base = lastSyncedStore.current ?? local
        const preparedLocal = prepareCloudPayload(sanitizeStoreForExport(local))
        if (preparedLocal.fingerprint === lastFingerprint.current) {
          savedGen.current = editGen.current
          setStatus('idle')
          return
        }

        const row = await withTimeout(
          sqlGetFstStore(storeId),
          SAVE_TIMEOUT_MS,
          'sql_save_timeout',
        )
        if (!row) {
          // Общая prod-база: никогда не создавать из createDefaultStore()/seed в браузере.
          throw new Error('sql_shared_store_missing')
        }

        const expectedRevision = Number(row.revision)
        if (!Number.isFinite(expectedRevision) || expectedRevision < 1) {
          throw new Error('invalid_revision')
        }

        const remoteParsed = parsePayloadJson(row.payloadJson)
        if (!remoteParsed) throw new Error('invalid_payload')

        const { store: merged } = mergeCloudStores(base, remoteParsed, local)
        const privilegeSafe = clampClientPrivilegeFields(merged, remoteParsed, user?.email ?? null)
        assertNoMassStoreWipe(remoteParsed, privilegeSafe)
        const cloudSafe = sanitizeStoreForExport(privilegeSafe)
        const prepared = prepareCloudPayload(cloudSafe)
        const nextRevision = expectedRevision + 1

        try {
          await withTimeout(
            sqlUpdateFstStore(
              storeId,
              expectedRevision,
              nextRevision,
              prepared.json,
              prepared.fingerprint,
              uid,
            ),
            SAVE_TIMEOUT_MS,
            'sql_save_timeout',
          )
        } catch (err) {
          if (isSqlRevisionConflict(err) && attempt < MAX_SAVE_RETRIES - 1) {
            // Тихий retry: кто-то успел записать раньше — читаем свежее и пробуем снова.
            await new Promise((r) => setTimeout(r, 80 * (attempt + 1)))
            continue
          }
          throw err
        }

        const current = storeRef.current
        const { store: reconciled } = mergeCloudStores(base, applyAppStoreSeeds(privilegeSafe), current)
        const finalStore = applyAppStoreSeeds(reconciled)
        const finalPrepared = prepareCloudPayload(finalStore)
        commitSyncedState(finalStore, nextRevision, finalPrepared.fingerprint)
        if (finalPrepared.fingerprint !== prepareCloudPayload(current).fingerprint) {
          applyStore(finalStore)
        }
        notifyStoreTabsSaved(nextRevision, finalPrepared.fingerprint)
        flashStatus('saved', SAVED_FLASH_MS)
        return
      }
      // Исчерпали retry по revision — подтянуть и один отложенный повтор, без вечного цикла.
      schedulePullRemote(true)
      flashStatus('dirty')
      window.setTimeout(() => {
        if (editGen.current !== savedGen.current) void flushSave()
      }, 1500)
    } catch (err) {
      console.error('FST SQL save failed', err)
      if (isSqlRevisionConflict(err)) {
        schedulePullRemote(true)
        flashStatus('dirty')
        window.setTimeout(() => {
          if (editGen.current !== savedGen.current) void flushSave()
        }, 1500)
        return
      }
      const timedOut =
        err instanceof Error && (err.message === 'sql_save_timeout' || err.message === 'cloud_save_timeout')
      setError(
        timedOut
          ? tRef.current('web.cloud.saveTimeout')
          : sqlConnectErrorMessage(err, tRef.current('web.cloud.loadFailed')),
      )
      const dirty = editGen.current !== savedGen.current
      setStatus(dirty ? 'dirty' : 'idle')
    } finally {
      saveInFlight.current = false
      if (pendingSave.current) {
        pendingSave.current = false
        window.setTimeout(() => {
          void flushSave()
        }, 200)
      }
    }
  }, [applyStore, commitSyncedState, flashStatus, ready, schedulePullRemote, storeId, uid, user?.email])

  const markDirty = useCallback(() => {
    if (skipSave.current || applyingRemote.current) return
    editGen.current += 1
    const dirty = editGen.current !== savedGen.current
    if (dirty && status !== 'saving' && status !== 'pulling') {
      setStatus('dirty')
    }
  }, [status])

  const retryLoad = useCallback(() => {
    setError(null)
    setRemotePending(false)
    setConflictCount(0)
    setReady(false)
    setReloadKey((k) => k + 1)
  }, [])

  useEffect(() => {
    if (!configured || !uid) {
      setReady(!configured)
      return
    }

    let cancelled = false
    if (!hasLoadedOnce.current) setReady(false)
    setError(null)

    void (async () => {
      try {
        const row = await Promise.race([
          sqlGetFstStore(storeId),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('cloud_load_timeout')), LOAD_TIMEOUT_MS)
          }),
        ])
        if (cancelled) return

        if (!row) {
          // Пустой SQL ≠ «создать из seed»: seed затрёт живые журналы/табель.
          setError(
            sqlConnectErrorMessage(
              new Error('sql_shared_store_missing'),
              tRef.current('web.cloud.loadFailed'),
            ),
          )
          setReadOnly(true)
          skipSave.current = true
          hasLoadedOnce.current = true
          setReady(true)
          return
        }

        const parsed = parsePayloadJson(row.payloadJson)
        if (!parsed) throw new Error('invalid_payload')

        // Стартовый store — seed. Пока React не применил SQL, storeRef ещё seed;
        // без sync-записи flushSave мог уйти в SQL и стереть людей/журналы.
        applyingRemote.current = true
        try {
          const local = storeRef.current
          const seeded = applyAppStoreSeeds(restoreLocalSecrets(local, parsed))
          storeRef.current = seeded
          const committed = commitSyncedState(seeded, Number(row.revision) || 1)
          applyStore(committed)
          setReadOnly(false)
          hasLoadedOnce.current = true
          setReady(true)
        } finally {
          applyingRemote.current = false
        }
      } catch (err) {
        console.error('FST SQL load failed', err)
        if (cancelled) return
        hasLoadedOnce.current = true
        if (err instanceof Error && err.message === 'invalid_payload') {
          setError(tRef.current('web.cloud.loadFailed') + ' (invalid_payload)')
          setReadOnly(true)
          skipSave.current = true
          setReady(true)
          return
        }
        const msg =
          err instanceof Error && err.message === 'cloud_load_timeout'
            ? tRef.current('web.cloud.loadTimeout')
            : sqlConnectErrorMessage(err, tRef.current('web.cloud.loadFailed'))
        setError(msg)
        setReadOnly(true)
        skipSave.current = true
        setReady(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [applyStore, commitSyncedState, configured, reloadKey, storeId, uid])

  useEffect(() => {
    if (!configured || !uid || !ready) return

    const unsubMeta = sqlSubscribeFstStoreMeta(
      storeId,
      (meta) => {
        if (applyingRemote.current || saveInFlight.current) return
        const rev = Number(meta.revision) || 0
        if (rev <= lastRevision.current) return
        if (meta.fingerprint && meta.fingerprint === lastFingerprint.current) return
        schedulePullRemote()
      },
      (err) => console.warn('FST SQL meta subscribe error', err),
    )

    const unsubTabs = listenStoreTabMessages((msg) => {
      if (msg.type === 'cloud-saved') {
        if (msg.revision > 0 && msg.revision <= lastRevision.current) return
        if (msg.fingerprint && msg.fingerprint === lastFingerprint.current) return
        schedulePullRemote()
      }
      if (msg.type === 'request-refresh') {
        schedulePullRemote(true)
      }
    })

    return () => {
      unsubMeta()
      unsubTabs()
      if (pullTimer.current) clearTimeout(pullTimer.current)
    }
  }, [configured, ready, schedulePullRemote, storeId, uid])

  useEffect(() => {
    markDirty()
    if (!configured || !uid || !ready || skipSave.current || applyingRemote.current) return

    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void flushSave()
    }, SAVE_DEBOUNCE_MS)

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [store, configured, flushSave, markDirty, ready, uid])

  useEffect(() => {
    if (!configured || !uid || !ready) return
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (saveTimer.current) clearTimeout(saveTimer.current)
        void flushSave()
      } else {
        // Вернулись на вкладку (часто другой CDN/устройство писал в SQL) — сразу подтянуть.
        schedulePullRemote(true)
      }
    }
    const onFocus = () => schedulePullRemote()
    const onUnload = () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      void flushSave()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    window.addEventListener('pagehide', onUnload)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pagehide', onUnload)
    }
  }, [configured, flushSave, ready, schedulePullRemote, uid])

  useEffect(() => {
    if (!configured || !uid || !ready) return
    const id = setInterval(() => {
      if (editGen.current !== savedGen.current) return
      if (saveInFlight.current || pullInFlight.current) return
      void pullRemote(false)
    }, IDLE_POLL_MS)
    return () => clearInterval(id)
  }, [configured, pullRemote, ready, uid])

  useEffect(
    () => () => {
      if (statusTimer.current) clearTimeout(statusTimer.current)
      if (pullTimer.current) clearTimeout(pullTimer.current)
    },
    [],
  )

  function acceptRemote() {
    void (async () => {
      setStatus('pulling')
      try {
        const row = await sqlGetFstStore(storeId)
        const remote =
          (row ? parsePayloadJson(row.payloadJson) : null) ?? remoteStoreRef.current
        if (!remote) {
          schedulePullRemote(true)
          return
        }
        applyingRemote.current = true
        const seeded = commitSyncedState(
          applyAppStoreSeeds(restoreLocalSecrets(storeRef.current, remote)),
          row ? Number(row.revision) || undefined : undefined,
        )
        applyStore(seeded)
        setRemotePending(false)
        setConflictCount(0)
        flashStatus('updated', MERGED_HINT_MS)
      } catch (err) {
        setError(sqlConnectErrorMessage(err, t('web.cloud.loadFailed')))
        schedulePullRemote(true)
      } finally {
        applyingRemote.current = false
      }
    })()
  }

  if (!configured) return null

  if (!ready) {
    return (
      <div className="fixed inset-0 z-[430] flex flex-col items-center justify-center gap-3 bg-paper px-6">
        <p className="text-base font-semibold text-ink">{t('web.cloud.loading')}</p>
        <p className="max-w-sm text-center text-sm text-stone-500">{t('web.sql.loadingHint')}</p>
      </div>
    )
  }

  const conflictMessage =
    conflictCount > 4
      ? tf('web.cloud.conflictMany', { count: String(conflictCount) })
      : tf('web.cloud.conflict', { count: String(conflictCount) })

  return (
    <>
      {readOnly && (
        <div className="fixed inset-x-0 top-0 z-[440] border-b border-amber-400 bg-amber-100 px-4 py-2.5 text-sm text-amber-950 shadow-sm print:hidden">
          <p className="font-semibold">{t('web.cloud.readOnly')}</p>
          <p className="mt-0.5 text-xs text-amber-900/90">{t('web.cloud.readOnlyHint')}</p>
        </div>
      )}
      {error && (
        <div className="fixed bottom-4 right-4 z-[200] max-w-sm rounded-sm border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-sm max-lg:bottom-[calc(5.5rem+env(safe-area-inset-bottom))]">
          <p>{error}</p>
          <button
            type="button"
            className="mt-2 rounded-sm bg-amber-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-900"
            onClick={retryLoad}
          >
            {t('web.cloud.retry')}
          </button>
        </div>
      )}
      {remotePending && (
        <div className="fixed bottom-4 left-4 z-[200] max-w-md rounded-sm border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-950 shadow-sm max-lg:bottom-[calc(5.5rem+env(safe-area-inset-bottom))] lg:left-[calc(var(--app-sidebar-w,3.5rem)+1rem)] lg:bottom-16">
          <p>{conflictCount > 0 ? conflictMessage : t('web.cloud.remotePending')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-sm bg-sky-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-900"
              onClick={acceptRemote}
            >
              {t('web.cloud.acceptRemote')}
            </button>
            <button
              type="button"
              className="rounded-sm border border-sky-400 px-3 py-1.5 text-xs font-semibold text-sky-900 hover:bg-sky-100"
              onClick={() => {
                requestStoreTabsRefresh()
                schedulePullRemote(true)
              }}
            >
              {t('web.cloud.syncAll')}
            </button>
            <button
              type="button"
              className="text-xs text-sky-700 underline"
              onClick={() => setRemotePending(false)}
            >
              {t('web.cloud.later')}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
