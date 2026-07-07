import { startTransition, useCallback, useEffect, useRef, useState } from 'react'
import { useFstAuth } from '@/context/FstAuthContext'
import { applyAppStoreSeeds } from '@/lib/storage'
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

/** Пауза перед записью полного payload в Firestore. */
const SAVE_DEBOUNCE_MS = 2500
/** Сглаживание частых правок коллег — один pull на пачку revision. */
const REMOTE_PULL_DEBOUNCE_MS = 400

export function FstCloudSync({ store, replaceStore }: FstCloudSyncProps) {
  const { user, configured } = useFstAuth()
  const [cloudReady, setCloudReady] = useState(!configured)
  const [cloudError, setCloudError] = useState<string | null>(null)
  const [remotePending, setRemotePending] = useState(false)
  const [conflictCount, setConflictCount] = useState(0)
  const [isDirty, setIsDirty] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pullTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
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

  const applyStore = useCallback(
    (next: AppStore) => {
      startTransition(() => replaceStore(next))
    },
    [replaceStore],
  )

  const markDirty = useCallback(() => {
    if (skipSave.current || applyingRemote.current) return
    editGeneration.current += 1
    setIsDirty(editGeneration.current !== savedGeneration.current)
  }, [])

  const retryLoad = useCallback(() => {
    setCloudError(null)
    setRemotePending(false)
    setConflictCount(0)
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
    setIsDirty(false)
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
    (raw: AppStore, opts?: { force?: boolean; revision?: number }) => {
      const force = opts?.force ?? false
      const base = lastSyncedStore.current ?? storeRef.current
      const local = storeRef.current
      const remote = applyAppStoreSeeds(raw)
      const { store: merged, conflictCount: conflicts } = mergeCloudStores(base, remote, local)
      const mergedSeeded = applyAppStoreSeeds(merged)

      const localDirty = editGeneration.current !== savedGeneration.current

      if (!force && !localDirty) {
        applyStore(mergedSeeded)
        commitSyncedState(mergedSeeded, opts?.revision)
        return
      }

      if (!force && localDirty) {
        if (conflicts > 0) {
          remoteStoreRef.current = mergedSeeded
          setConflictCount(conflicts)
          setRemotePending(true)
          return
        }
        applyingRemote.current = true
        applyStore(mergedSeeded)
        lastSyncedStore.current = mergedSeeded
        applyingRemote.current = false
        setRemotePending(false)
        setConflictCount(0)
        if (typeof opts?.revision === 'number') {
          lastAckRevision.current = Math.max(lastAckRevision.current, opts.revision)
        }
        return
      }

      applyingRemote.current = true
      applyStore(mergedSeeded)
      commitSyncedState(mergedSeeded, opts?.revision)
      applyingRemote.current = false
    },
    [applyStore, commitSyncedState],
  )

  const pullRemote = useCallback(
    async (force = false) => {
      if (!user || pullInFlight.current) return
      pullInFlight.current = true
      try {
        const data = await loadCloudStore(user.uid)
        if (!data) return
        applyRemoteStore(data, { force })
      } catch (err) {
        console.error('FST cloud refresh failed', err)
      } finally {
        pullInFlight.current = false
      }
    },
    [applyRemoteStore, user],
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
        const data = await ensureCloudStore(user.uid)
        if (cancelled) return
        const seeded = commitSyncedState(data)
        applyStore(seeded)
        setCloudReady(true)
      } catch (err) {
        console.error('FST cloud load failed', err)
        if (!cancelled) {
          setCloudError(cloudErrorMessage(err, 'Не удалось загрузить данные из облака.'))
          setCloudReady(true)
          skipSave.current = true
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [configured, user, applyStore, reloadKey, commitSyncedState])

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

  const flushSave = useCallback(async () => {
    if (!configured || !user || !cloudReady || skipSave.current) return
    if (saveInFlight.current) {
      pendingSave.current = true
      return
    }

    const local = storeRef.current
    const prepared = prepareCloudPayload(local)
    if (prepared.fingerprint === lastSavedFingerprint.current) {
      savedGeneration.current = editGeneration.current
      setIsDirty(false)
      return
    }

    const base = lastSyncedStore.current ?? local
    saveInFlight.current = true
    try {
      const { merged, revision } = await saveCloudStoreMerged(user.uid, base, local)
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
    } catch (err) {
      console.error('FST cloud save failed', err)
      setCloudError(cloudErrorMessage(err, 'Ошибка сохранения в облако.'))
    } finally {
      saveInFlight.current = false
      if (pendingSave.current) {
        pendingSave.current = false
        void flushSave()
      }
    }
  }, [applyStore, cloudReady, commitSyncedState, configured, user])

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
      void flushSave()
    }
    const onUnload = () => {
      void flushSave()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onUnload)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onUnload)
    }
  }, [cloudReady, configured, flushSave, user])

  function acceptRemote() {
    if (remoteStoreRef.current) {
      applyingRemote.current = true
      const seeded = commitSyncedState(remoteStoreRef.current)
      applyStore(seeded)
      applyingRemote.current = false
      return
    }
    schedulePullRemote(true)
  }

  if (!configured) return null
  if (!cloudReady) {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-stone-100">
        <p className="text-sm text-stone-600">FST — загрузка данных…</p>
      </div>
    )
  }

  return (
    <>
      {cloudError && (
        <div className="fixed bottom-4 right-4 z-[200] max-w-sm rounded-sm border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-sm max-lg:bottom-[calc(5.5rem+env(safe-area-inset-bottom))]">
          <p>{cloudError}</p>
          <button
            type="button"
            className="mt-2 rounded-sm bg-amber-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-900"
            onClick={retryLoad}
          >
            Повторить
          </button>
        </div>
      )}
      {remotePending && (
        <div className="fixed bottom-4 left-4 z-[200] max-w-md rounded-sm border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-950 shadow-sm max-lg:bottom-[calc(5.5rem+env(safe-area-inset-bottom))]">
          <p>
            {conflictCount > 0
              ? `Коллеги изменили те же данные (${conflictCount} конфликт${conflictCount > 4 ? 'ов' : conflictCount > 1 ? 'а' : ''}). Обновите, чтобы не потерять правки.`
              : 'Данные обновились в другой вкладке или на другом устройстве.'}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-sm bg-sky-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-900"
              onClick={acceptRemote}
            >
              Обновить сейчас
            </button>
            <button
              type="button"
              className="rounded-sm border border-sky-400 px-3 py-1.5 text-xs font-semibold text-sky-900 hover:bg-sky-100"
              onClick={() => {
                requestStoreTabsRefresh()
                schedulePullRemote(true)
              }}
            >
              Синхронизировать всё
            </button>
            <button
              type="button"
              className="text-xs text-sky-700 underline"
              onClick={() => setRemotePending(false)}
            >
              Позже
            </button>
          </div>
        </div>
      )}
      {isDirty && !remotePending && (
        <div
          className="fixed bottom-3 right-3 z-[50] rounded-sm border border-amber-200 bg-amber-50/95 px-2.5 py-1 text-[10px] text-amber-900 shadow-sm print:hidden max-lg:bottom-[calc(5.5rem+env(safe-area-inset-bottom))]"
          title="Изменения сохранятся в облако автоматически"
        >
          Облако · сохранение…
        </div>
      )}
    </>
  )
}
