import { startTransition, useCallback, useEffect, useRef, useState } from 'react'
import { useFstAuth } from '@/context/FstAuthContext'
import { useI18n } from '@/context/I18nContext'
import { applyAppStoreSeeds, restoreLocalSecrets } from '@/lib/storage'
import { mergeCloudStores } from '@/lib/cloud/cloudMerge'
import { prepareCloudPayload } from '@/lib/cloud/cloudPayload'
import {
  cloudErrorMessage,
  ensureCloudStore,
  loadCloudStore,
  saveCloudStoreMerged,
  subscribeCloudStoreMeta,
} from '@/lib/cloud/firestoreSync'
import {
  listenStoreTabMessages,
  notifyStoreTabsSaved,
  requestStoreTabsRefresh,
} from '@/lib/cloud/storeTabSync'
import type { AppStore } from '@/lib/types'
import type { FstCloudSyncProps } from './fstCloudTypes'

/** Пауза перед записью в Firestore — длиннее, чтобы набор табеля не дёргал stringify/shards. */
const SAVE_DEBOUNCE_MS = 2500
/** Не зависать на белом экране, если Firestore не отвечает. */
const CLOUD_LOAD_TIMEOUT_MS = 45_000
/** Запись в облако не должна вечно держать «сохранение…». */
const CLOUD_SAVE_TIMEOUT_MS = 60_000
/** Сглаживание частых правок коллег — один pull на пачку revision. */
const REMOTE_PULL_DEBOUNCE_MS = 250
/** Фоновое обновление, когда пользователь не редактирует. */
const IDLE_POLL_MS = 30_000
const SAVED_FLASH_MS = 2500
const MERGED_HINT_MS = 3000

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

type CloudStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'pulling' | 'updated'

export function FstCloudSync({ store, applyCloudStore, replaceStore }: FstCloudSyncProps) {
  const hydrateStore = applyCloudStore ?? replaceStore
  const { user, configured } = useFstAuth()
  const { t, tf } = useI18n()
  const [cloudReady, setCloudReady] = useState(!configured)
  const [cloudReadOnly, setCloudReadOnly] = useState(false)
  const [cloudError, setCloudError] = useState<string | null>(null)
  const [remotePending, setRemotePending] = useState(false)
  const [conflictCount, setConflictCount] = useState(0)
  const [status, setStatus] = useState<CloudStatus>('idle')
  const [reloadKey, setReloadKey] = useState(0)

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pullTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skipSave = useRef(true)
  const storeRef = useRef(store)
  const lastSyncedStore = useRef<AppStore | null>(null)
  const lastSavedFingerprint = useRef<string | null>(null)
  const lastAckRevision = useRef(0)
  const editGeneration = useRef(0)
  const savedGeneration = useRef(0)
  const saveInFlight = useRef(false)
  const pendingSave = useRef(false)
  const remoteStoreRef = useRef<AppStore | null>(null)
  const applyingRemote = useRef(false)
  const pullInFlight = useRef(false)

  storeRef.current = store

  const flashStatus = useCallback((next: CloudStatus, ms?: number) => {
    setStatus(next)
    if (statusTimer.current) clearTimeout(statusTimer.current)
    if (ms && ms > 0) {
      statusTimer.current = setTimeout(() => {
        const dirty = editGeneration.current !== savedGeneration.current
        setStatus(dirty ? 'dirty' : 'idle')
      }, ms)
    }
  }, [])

  const applyStore = useCallback(
    (next: AppStore) => {
      if (!hydrateStore) return
      startTransition(() => hydrateStore(next))
    },
    [hydrateStore],
  )

  const markDirty = useCallback(() => {
    if (skipSave.current || applyingRemote.current) return
    editGeneration.current += 1
    const dirty = editGeneration.current !== savedGeneration.current
    if (dirty && status !== 'saving' && status !== 'pulling') {
      setStatus('dirty')
    }
  }, [status])

  const retryLoad = useCallback(() => {
    setCloudError(null)
    setRemotePending(false)
    setConflictCount(0)
    setCloudReady(false)
    setReloadKey((k) => k + 1)
  }, [])

  const commitSyncedState = useCallback((next: AppStore, revision?: number, fingerprint?: string) => {
    const seeded = applyAppStoreSeeds(next)
    lastSyncedStore.current = seeded
    if (fingerprint) {
      lastSavedFingerprint.current = fingerprint
    } else {
      lastSavedFingerprint.current = prepareCloudPayload(seeded).fingerprint
    }
    savedGeneration.current = editGeneration.current
    if (statusTimer.current) clearTimeout(statusTimer.current)
    setStatus('idle')
    if (typeof revision === 'number' && revision > 0) {
      lastAckRevision.current = revision
    }
    skipSave.current = false
    setRemotePending(false)
    setConflictCount(0)
    remoteStoreRef.current = null
    return seeded
  }, [])

  const applyRemoteStore = useCallback(
    (raw: AppStore, opts?: { force?: boolean; revision?: number; silentHint?: boolean }) => {
      const force = opts?.force ?? false
      const base = lastSyncedStore.current ?? storeRef.current
      const local = storeRef.current
      const remote = applyAppStoreSeeds(raw)
      const fpBefore = lastSavedFingerprint.current
      const { store: merged, conflictCount: conflicts } = mergeCloudStores(base, remote, local)
      const mergedSeeded = applyAppStoreSeeds(restoreLocalSecrets(local, merged))

      const localDirty = editGeneration.current !== savedGeneration.current

      if (!force && !localDirty) {
        applyStore(mergedSeeded)
        commitSyncedState(mergedSeeded, opts?.revision)
        const fpAfter = lastSavedFingerprint.current
        if (opts?.silentHint !== false && fpBefore && fpAfter && fpBefore !== fpAfter) {
          flashStatus('updated', MERGED_HINT_MS)
        }
        return
      }

      // Пока пользователь правит — не подменять store (микрофриз на листе табеля).
      // Буферизуем remote; после save merge подтянет через flushSave / acceptRemote.
      if (!force && localDirty) {
        remoteStoreRef.current = remote
        setConflictCount(conflicts)
        if (conflicts > 0) setRemotePending(true)
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
      if (!user || pullInFlight.current) return
      pullInFlight.current = true
      if (force) flashStatus('pulling')
      try {
        const data = await loadCloudStore(user.uid)
        if (!data) {
          if (force) {
            setCloudError(cloudErrorMessage(new Error('cloud_shared_store_missing'), t('web.cloud.loadFailed')))
          }
          return
        }
        applyRemoteStore(data, { force, silentHint })
        if (force) setCloudError(null)
      } catch (err) {
        console.error('FST cloud refresh failed', err)
        if (force) {
          setCloudError(cloudErrorMessage(err, t('web.cloud.loadFailed')))
        }
      } finally {
        pullInFlight.current = false
        if (force) {
          const dirty = editGeneration.current !== savedGeneration.current
          if (!dirty) setStatus('idle')
        }
      }
    },
    [applyRemoteStore, flashStatus, t, user],
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
    if (!configured || !user || !cloudReady || skipSave.current) return
    if (saveInFlight.current) {
      pendingSave.current = true
      return
    }

    const local = storeRef.current
    const synced = lastSyncedStore.current
    if (
      synced &&
      synced.employees.length >= 8 &&
      local.employees.length < Math.ceil(synced.employees.length * 0.85)
    ) {
      console.error('FST cloud: refuse save — sparse local employees vs last sync', {
        local: local.employees.length,
        synced: synced.employees.length,
      })
      setCloudError(
        'Сохранение остановлено: в браузере неполный список сотрудников. Идёт обновление из облака…',
      )
      schedulePullRemote(true)
      return
    }

    const prepared = prepareCloudPayload(local)
    if (prepared.fingerprint === lastSavedFingerprint.current) {
      savedGeneration.current = editGeneration.current
      setStatus('idle')
      return
    }

    const base = lastSyncedStore.current ?? local
    saveInFlight.current = true
    flashStatus('saving')
    try {
      const { merged, revision } = await withTimeout(
        saveCloudStoreMerged(user.uid, base, local),
        CLOUD_SAVE_TIMEOUT_MS,
        'cloud_save_timeout',
      )
      const seeded = applyAppStoreSeeds(merged)
      const current = storeRef.current
      const { store: reconciled } = mergeCloudStores(base, seeded, current)
      const finalStore = applyAppStoreSeeds(reconciled)
      const finalPrepared = prepareCloudPayload(finalStore)
      commitSyncedState(finalStore, revision, finalPrepared.fingerprint)
      if (finalPrepared.fingerprint !== prepareCloudPayload(current).fingerprint) {
        applyStore(finalStore)
      }
      notifyStoreTabsSaved(revision, finalPrepared.fingerprint)
      setCloudError(null)
      flashStatus('saved', SAVED_FLASH_MS)
    } catch (err) {
      console.error('FST cloud save failed', err)
      const timedOut = err instanceof Error && err.message === 'cloud_save_timeout'
      setCloudError(
        timedOut ? t('web.cloud.saveTimeout') : cloudErrorMessage(err, 'Ошибка сохранения в облако.'),
      )
      const dirty = editGeneration.current !== savedGeneration.current
      setStatus(dirty ? 'dirty' : 'idle')
    } finally {
      saveInFlight.current = false
      if (pendingSave.current) {
        pendingSave.current = false
        void flushSave()
      }
    }
  }, [applyStore, cloudReady, commitSyncedState, configured, flashStatus, schedulePullRemote, t, user])

  useEffect(() => {
    if (!configured || !user) {
      setCloudReady(!configured)
      return
    }

    let cancelled = false
    setCloudReady(false)
    setCloudError(null)

    void (async () => {
      try {
        const data = await Promise.race([
          ensureCloudStore(user.uid),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('cloud_load_timeout')), CLOUD_LOAD_TIMEOUT_MS)
          }),
        ])
        if (cancelled) return
        // Важно: стартовый store — createDefaultStore()/seed, не рабочие данные.
        // Нельзя mergeCloudStores(cloud, cloud, seed): seed считался бы «локальными правками»
        // и затирал бы табель/сотрудников, которых параллельно заполняют в проде.
        //
        // Гонка: applyStore через startTransition откладывает storeRef → flushSave
        // мог уйти в облако со seed и стереть людей. Пишем storeRef синхронно и
        // держим applyingRemote, пока не применим облако.
        applyingRemote.current = true
        try {
          const local = storeRef.current
          const seeded = applyAppStoreSeeds(restoreLocalSecrets(local, data))
          storeRef.current = seeded
          const committed = commitSyncedState(seeded)
          applyStore(committed)
          setCloudReadOnly(false)
          setCloudReady(true)
        } finally {
          applyingRemote.current = false
        }
      } catch (err) {
        console.error('FST cloud load failed', err)
        if (!cancelled) {
          const fallback =
            err instanceof Error && err.message === 'cloud_load_timeout'
              ? t('web.cloud.loadTimeout')
              : cloudErrorMessage(err, t('web.cloud.loadFailed'))
          setCloudError(fallback)
          setCloudReadOnly(true)
          setCloudReady(true)
          skipSave.current = true
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [configured, user, applyStore, reloadKey, commitSyncedState, t])

  useEffect(() => {
    if (!configured || !user || !cloudReady) return

    const unsubMeta = subscribeCloudStoreMeta(
      user.uid,
      (meta) => {
        if (applyingRemote.current) return
        if (meta.revision > 0 && meta.revision <= lastAckRevision.current) return
        if (meta.fingerprint && meta.fingerprint === lastSavedFingerprint.current) return
        schedulePullRemote()
      },
      (err) => console.warn('FST cloud meta snapshot error', err),
    )

    const unsubTabs = listenStoreTabMessages((msg) => {
      if (msg.type === 'cloud-saved') {
        if (msg.revision > 0 && msg.revision <= lastAckRevision.current) return
        if (msg.fingerprint && msg.fingerprint === lastSavedFingerprint.current) return
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
  }, [cloudReady, configured, schedulePullRemote, user])

  useEffect(() => {
    markDirty()
    if (!configured || !user || !cloudReady || skipSave.current || applyingRemote.current) return

    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void flushSave()
    }, SAVE_DEBOUNCE_MS)

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [store, configured, user, cloudReady, flushSave, markDirty])

  useEffect(() => {
    if (!configured || !user || !cloudReady) return
    const onHide = () => {
      if (document.visibilityState !== 'hidden') return
      if (saveTimer.current) clearTimeout(saveTimer.current)
      void flushSave()
    }
    const onShow = () => {
      if (document.visibilityState !== 'visible') return
      schedulePullRemote(true)
    }
    const onUnload = () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      void flushSave()
    }
    document.addEventListener('visibilitychange', onHide)
    document.addEventListener('visibilitychange', onShow)
    window.addEventListener('pagehide', onUnload)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      document.removeEventListener('visibilitychange', onShow)
      window.removeEventListener('pagehide', onUnload)
    }
  }, [cloudReady, configured, flushSave, schedulePullRemote, user])

  useEffect(() => {
    if (!configured || !user || !cloudReady) return
    const id = setInterval(() => {
      if (editGeneration.current !== savedGeneration.current) return
      if (saveInFlight.current || pullInFlight.current) return
      void pullRemote(false)
    }, IDLE_POLL_MS)
    return () => clearInterval(id)
  }, [cloudReady, configured, pullRemote, user])

  useEffect(
    () => () => {
      if (statusTimer.current) clearTimeout(statusTimer.current)
    },
    [],
  )

  function acceptRemote() {
    void (async () => {
      if (!user) {
        schedulePullRemote(true)
        return
      }
      setStatus('pulling')
      try {
        const fresh = await loadCloudStore(user.uid)
        const remote = fresh ?? remoteStoreRef.current
        if (!remote) {
          schedulePullRemote(true)
          return
        }
        applyingRemote.current = true
        const seeded = commitSyncedState(
          applyAppStoreSeeds(restoreLocalSecrets(storeRef.current, remote)),
        )
        applyStore(seeded)
        setRemotePending(false)
        setConflictCount(0)
        flashStatus('updated')
      } catch (err) {
        console.warn('FST acceptRemote failed', err)
        schedulePullRemote(true)
      } finally {
        applyingRemote.current = false
      }
    })()
  }

  const conflictMessage =
    conflictCount > 4
      ? tf('web.cloud.conflictMany', { count: String(conflictCount) })
      : tf('web.cloud.conflict', { count: String(conflictCount) })

  if (!configured) return null
  if (!cloudReady) {
    return (
      <div className="fixed inset-0 z-[430] flex flex-col items-center justify-center gap-3 bg-paper px-6">
        <p className="text-base font-semibold text-ink">{t('web.cloud.loading')}</p>
        <p className="max-w-sm text-center text-sm text-stone-500">{t('web.cloud.loadingHint')}</p>
      </div>
    )
  }

  return (
    <>
      {cloudReadOnly && (
        <div
          className="fixed inset-x-0 top-0 z-[440] border-b border-amber-400 bg-amber-100 px-4 py-2.5 text-sm text-amber-950 shadow-sm print:hidden"
          role="status"
        >
          <p className="font-semibold">{t('web.cloud.readOnly')}</p>
          <p className="mt-0.5 text-xs text-amber-900/90">{t('web.cloud.readOnlyHint')}</p>
        </div>
      )}
      {cloudError && (
        <div className="fixed bottom-4 right-4 z-[200] max-w-sm rounded-sm border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-sm max-lg:bottom-[calc(5.5rem+env(safe-area-inset-bottom))]">
          <p>{cloudError}</p>
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
