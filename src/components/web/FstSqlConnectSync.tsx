import { startTransition, useCallback, useEffect, useRef, useState } from 'react'
import { useFstAuth } from '@/context/FstAuthContext'
import { useI18n } from '@/context/I18nContext'
import {
  applyAppStoreSeeds,
  parseStorePayload,
  restoreLocalSecrets,
} from '@/lib/storage'
import { mergeCloudStores } from '@/lib/cloud/cloudMerge'
import { prepareCloudPayload } from '@/lib/cloud/cloudPayload'
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
import { cloudDirtyTracker } from '@/lib/cloud/dirtyOperations'
import {
  buildCloudSavePayload,
  canCloudWriteNow,
  needsPullBeforeWrite,
} from '@/lib/cloud/cloudSavePipeline'
import {
  clearBulkStoreOverwrite,
  getBulkPreviewUserMessage,
  isBulkOverwriteBlockingAutosave,
  subscribeBulkOverwrite,
} from '@/lib/cloud/bulkStoreOverwrite'
import {
  isCloudWriteLifecycleReady,
  noteCloudPullCompleted,
  noteCloudRevision,
  resetSyncLifecycle,
  setSyncLifecyclePhase,
} from '@/lib/cloud/syncLifecycle'
import {
  processExternalEffectsOutbox,
  type ExternalEffectsProcessorContext,
} from '@/lib/cloud/externalEffects/processor'
import { hasPendingOutboxWork } from '@/lib/cloud/externalEffects/outbox'
import { resolveRoleTaskAccessLevel } from '@/lib/tasks/access'
import type { AppStore } from '@/lib/types'
import type { FstCloudSyncProps } from './fstCloudTypes'

const SAVE_DEBOUNCE_MS = 2500
const LOAD_TIMEOUT_MS = 45_000
const SAVE_TIMEOUT_MS = 60_000
const REMOTE_PULL_DEBOUNCE_MS = 250
const IDLE_POLL_MS = 10_000
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

export function FstSqlConnectSync({ store, applyCloudStore, patchUserStore }: FstCloudSyncProps) {
  const { user, configured, profile } = useFstAuth()
  const { t, tf } = useI18n()
  const uid = user?.uid ?? null
  const storeId = FST_SHARED_STORE_DOC_ID

  const [ready, setReady] = useState(!configured)
  const [readOnly, setReadOnly] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [remotePending, setRemotePending] = useState(false)
  const [conflictCount, setConflictCount] = useState(0)
  const [conflictDetails, setConflictDetails] = useState<string[]>([])
  const [status, setStatus] = useState<SyncStatus>('idle')
  const [reloadKey, setReloadKey] = useState(0)
  const [bulkMessage, setBulkMessage] = useState<string | null>(null)

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
  const pullInFlight = useRef(false)
  const applyingRemote = useRef(false)
  const hasLoadedOnce = useRef(false)
  const remoteStoreRef = useRef<AppStore | null>(null)
  const tRef = useRef(t)
  const processorInFlight = useRef(false)
  const outboxTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleSaveRef = useRef<() => void>(() => {})
  const scheduleOutboxRef = useRef<() => void>(() => {})

  useEffect(() => {
    storeRef.current = store
  }, [store])
  useEffect(() => {
    tRef.current = t
  }, [t])

  useEffect(() => subscribeBulkOverwrite(() => setBulkMessage(getBulkPreviewUserMessage())), [])

  const flashStatus = useCallback((next: SyncStatus, ms?: number) => {
    setStatus(next)
    if (statusTimer.current) clearTimeout(statusTimer.current)
    if (ms && ms > 0) {
      statusTimer.current = setTimeout(() => {
        const dirty = cloudDirtyTracker.hasPendingUserOperations()
        setStatus(dirty ? 'dirty' : 'idle')
      }, ms)
    }
  }, [])

  const applyCloud = useCallback(
    (next: AppStore) => {
      // Explicit origin path: applyCloudStore always uses hydration meta (no ambient stack / startTransition race).
      applyingRemote.current = true
      try {
        startTransition(() => {
          applyCloudStore(next)
        })
      } finally {
        // Flag cleared after paint; save gated by lifecycle + dirty tracker, not only this flag.
        queueMicrotask(() => {
          applyingRemote.current = false
        })
      }
    },
    [applyCloudStore],
  )

  const commitSyncedBaseline = useCallback(
    (next: AppStore, revision?: number, fingerprint?: string) => {
      const seeded = applyAppStoreSeeds(next)
      lastSyncedStore.current = seeded
      lastFingerprint.current = fingerprint ?? prepareCloudPayload(seeded).fingerprint
      savedGen.current = editGen.current
      if (typeof revision === 'number' && revision > 0) {
        lastRevision.current = revision
        cloudDirtyTracker.setBaseRevision(revision)
        noteCloudRevision(revision)
      }
      cloudDirtyTracker.setBaselineStore(seeded)
      // Do NOT clearAll pending ops — only acknowledge after successful save.
      skipSave.current = false
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
      const localDirty = cloudDirtyTracker.hasPendingUserOperations()

      if (!force && !localDirty) {
        applyCloud(mergedSeeded)
        commitSyncedBaseline(mergedSeeded, opts?.revision)
        noteCloudPullCompleted(opts?.revision)
        const fpAfter = lastFingerprint.current
        if (opts?.silentHint !== false && fpBefore && fpAfter && fpBefore !== fpAfter) {
          flashStatus('updated', MERGED_HINT_MS)
        }
        return
      }

      if (!force && localDirty) {
        remoteStoreRef.current = remote
        // Rebase baseline revision upward but keep pending ops.
        if (typeof opts?.revision === 'number') {
          lastRevision.current = Math.max(lastRevision.current, opts.revision)
          cloudDirtyTracker.setBaseRevision(lastRevision.current)
          noteCloudPullCompleted(opts.revision)
        }
        setConflictCount(Math.max(conflicts, cloudDirtyTracker.getConflicts().length))
        if (conflicts > 0 || cloudDirtyTracker.getConflicts().length > 0) {
          setRemotePending(true)
        }
        return
      }

      applyCloud(mergedSeeded)
      commitSyncedBaseline(mergedSeeded, opts?.revision)
      noteCloudPullCompleted(opts?.revision)
    },
    [applyCloud, commitSyncedBaseline, flashStatus],
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
        if (force) {
          setError(sqlConnectErrorMessage(err, tRef.current('web.cloud.loadFailed')))
        }
      } finally {
        pullInFlight.current = false
        if (force && !cloudDirtyTracker.hasPendingUserOperations()) setStatus('idle')
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
    if (!isCloudWriteLifecycleReady()) return
    if (isBulkOverwriteBlockingAutosave()) return
    if (!cloudDirtyTracker.hasPendingUserOperations()) return
    if (saveInFlight.current) return

    saveInFlight.current = true
    flashStatus('saving')
    setError(null)

    try {
      if (needsPullBeforeWrite()) {
        await pullRemote(false, true)
      }

      const local = storeRef.current
      const baseline = lastSyncedStore.current ?? local
      const pendingOps = cloudDirtyTracker.getPending()
      const gate = canCloudWriteNow(pendingOps.length > 0)
      if (!gate.ok) {
        setStatus(gate.reason === 'bulk_overwrite_preview' ? 'idle' : 'dirty')
        return
      }

      const row = await withTimeout(sqlGetFstStore(storeId), SAVE_TIMEOUT_MS, 'sql_save_timeout')
      if (!row) throw new Error('sql_shared_store_missing')
      const expectedRevision = Number(row.revision)
      if (!Number.isFinite(expectedRevision) || expectedRevision < 1) throw new Error('invalid_revision')
      const remoteParsed = parsePayloadJson(row.payloadJson)
      if (!remoteParsed) throw new Error('invalid_payload')
      noteCloudPullCompleted(expectedRevision)

      const build = buildCloudSavePayload({
        remote: remoteParsed,
        remoteRevision: expectedRevision,
        local,
        baseline,
        operations: pendingOps,
        actorEmail: user?.email ?? null,
      })

      if (!build.allowed) {
        setStatus('idle')
        return
      }

      if (build.conflicts.length > 0) {
        cloudDirtyTracker.setConflicts(build.conflicts)
        setConflictCount(build.conflicts.length)
        setConflictDetails(
          build.conflicts.slice(0, 8).map((c) => `${c.domain}/${c.entityId}: ${c.message}`),
        )
        setRemotePending(true)
        // Keep pending ops — do not clear.
        flashStatus('dirty')
        return
      }

      if (!build.payloadJson || build.nextRevision == null) return

      try {
        await withTimeout(
          sqlUpdateFstStore(
            storeId,
            expectedRevision,
            build.nextRevision,
            build.payloadJson,
            build.fingerprint ?? '',
            uid,
          ),
          SAVE_TIMEOUT_MS,
          'sql_save_timeout',
        )
      } catch (err) {
        if (isSqlRevisionConflict(err)) {
          schedulePullRemote(true)
          setRemotePending(true)
          setConflictDetails(['revision_conflict: cloud changed; pending edits kept'])
          flashStatus('dirty')
          return
        }
        throw err
      }

      const finalStore = applyAppStoreSeeds(build.store ?? remoteParsed)
      commitSyncedBaseline(finalStore, build.nextRevision, build.fingerprint)
      cloudDirtyTracker.acknowledgePersisted(build.appliedOperationIds)
      cloudDirtyTracker.clearConflicts()
      applyCloud(finalStore)
      notifyStoreTabsSaved(build.nextRevision, build.fingerprint ?? '')
      noteCloudPullCompleted(build.nextRevision)
      setRemotePending(false)
      setConflictCount(0)
      setConflictDetails([])
      flashStatus('saved', SAVED_FLASH_MS)
      scheduleOutboxRef.current()
    } catch (err) {
      console.error('FST SQL save failed', err)
      const timedOut =
        err instanceof Error && (err.message === 'sql_save_timeout' || err.message === 'cloud_save_timeout')
      setError(
        timedOut
          ? tRef.current('web.cloud.saveTimeout')
          : sqlConnectErrorMessage(err, tRef.current('web.cloud.loadFailed')),
      )
      flashStatus('dirty')
    } finally {
      saveInFlight.current = false
    }
  }, [
    applyCloud,
    commitSyncedBaseline,
    flashStatus,
    pullRemote,
    ready,
    schedulePullRemote,
    storeId,
    uid,
    user?.email,
  ])

  const scheduleSaveFromDirtyOps = useCallback(() => {
    if (!configured || !uid || !ready || skipSave.current) return
    if (!isCloudWriteLifecycleReady()) return
    if (isBulkOverwriteBlockingAutosave()) return
    if (!cloudDirtyTracker.hasPendingUserOperations()) {
      if (hasPendingOutboxWork(storeRef.current)) {
        scheduleOutboxRef.current()
      } else {
        setStatus('idle')
      }
      return
    }
    editGen.current += 1
    setStatus('dirty')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void flushSave()
    }, SAVE_DEBOUNCE_MS)
  }, [configured, flushSave, ready, uid])

  const runOutboxProcessor = useCallback(async () => {
    if (!patchUserStore || processorInFlight.current) return
    if (!isCloudWriteLifecycleReady()) return
    if (isBulkOverwriteBlockingAutosave()) return
    if (saveInFlight.current) return
    if (!hasPendingOutboxWork(storeRef.current)) return

    processorInFlight.current = true
    try {
      const ctx: ExternalEffectsProcessorContext = {
        getStore: () => storeRef.current,
        getBaselineStore: () => lastSyncedStore.current,
        getPendingOps: () => cloudDirtyTracker.getPending(),
        applyStore: (fn, origin) => {
          if (origin === 'user') {
            patchUserStore(fn)
          } else {
            const next = fn(storeRef.current)
            storeRef.current = next
            applyingRemote.current = true
            try {
              startTransition(() => {
                applyCloudStore(next)
              })
            } finally {
              queueMicrotask(() => {
                applyingRemote.current = false
              })
            }
          }
        },
        scheduleSave: () => scheduleSaveRef.current(),
        isSysAdmin: profile?.roleId === 'sysadmin',
        canManageTasks:
          profile?.roleId === 'sysadmin' ||
          resolveRoleTaskAccessLevel(storeRef.current.access, profile?.roleId ?? 'employee') ===
            'manage',
        actor: profile
          ? { id: profile.uid, name: profile.displayName }
          : user?.email
            ? { id: user.uid, name: user.email }
            : undefined,
      }
      let loops = 0
      while (loops < 3) {
        loops += 1
        const did = await processExternalEffectsOutbox(ctx)
        if (!did) break
        if (cloudDirtyTracker.hasPendingUserOperations()) break
      }
    } finally {
      processorInFlight.current = false
    }
  }, [applyCloudStore, patchUserStore, profile, user?.email, user?.uid])

  const scheduleOutboxProcessor = useCallback(() => {
    if (!patchUserStore || !configured || !uid || !ready) return
    if (outboxTimer.current) clearTimeout(outboxTimer.current)
    outboxTimer.current = setTimeout(() => {
      void runOutboxProcessor()
    }, 400)
  }, [configured, patchUserStore, ready, runOutboxProcessor, uid])

  useEffect(() => {
    scheduleOutboxRef.current = scheduleOutboxProcessor
    scheduleSaveRef.current = scheduleSaveFromDirtyOps
  }, [scheduleOutboxProcessor, scheduleSaveFromDirtyOps])

  useEffect(() => {
    if (!configured || !uid || !ready) return
    if (!hasPendingOutboxWork(store)) return
    scheduleOutboxProcessor()
  }, [configured, ready, scheduleOutboxProcessor, store.externalEffects?.outbox, uid])

  const retryLoad = useCallback(() => {
    setError(null)
    setRemotePending(false)
    setConflictCount(0)
    setConflictDetails([])
    setReady(false)
    setReloadKey((k) => k + 1)
    resetSyncLifecycle()
  }, [])

  const cancelBulkAndReload = useCallback(() => {
    // Cancel preview only — never discard unrelated pending/conflicts/outbox.
    clearBulkStoreOverwrite()
    schedulePullRemote(true)
  }, [schedulePullRemote])

  useEffect(() => {
    if (!configured || !uid) {
      // Bootstrap gate for unconfigured/logged-out: sync ready flag with auth props.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional sync bootstrap
      setReady(!configured)
      return
    }

    let cancelled = false
    if (!hasLoadedOnce.current) setReady(false)
    setError(null)
    resetSyncLifecycle()
    setSyncLifecyclePhase('booting')

    void (async () => {
      setSyncLifecyclePhase('hydrating')
      try {
        const row = await Promise.race([
          sqlGetFstStore(storeId),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('cloud_load_timeout')), LOAD_TIMEOUT_MS)
          }),
        ])
        if (cancelled) return

        if (!row) {
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

        setSyncLifecyclePhase('stabilizing')
        const local = storeRef.current
        const seeded = applyAppStoreSeeds(restoreLocalSecrets(local, parsed))
        storeRef.current = seeded
        const committed = commitSyncedBaseline(seeded, Number(row.revision) || 1)
        applyCloud(committed)
        noteCloudPullCompleted(Number(row.revision) || 1)
        setReadOnly(false)
        hasLoadedOnce.current = true
        setReady(true)
        requestAnimationFrame(() => {
          if (!cancelled) setSyncLifecyclePhase('ready')
        })
      } catch (err) {
        console.error('FST SQL load failed', err)
        if (cancelled) return
        hasLoadedOnce.current = true
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
  }, [applyCloud, commitSyncedBaseline, configured, reloadKey, storeId, uid])

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
      if (msg.type === 'request-refresh') schedulePullRemote(true)
    })

    return () => {
      unsubMeta()
      unsubTabs()
      if (pullTimer.current) clearTimeout(pullTimer.current)
    }
  }, [configured, ready, schedulePullRemote, storeId, uid])

  useEffect(() => cloudDirtyTracker.subscribe(() => scheduleSaveFromDirtyOps()), [scheduleSaveFromDirtyOps])

  useEffect(() => {
    if (!configured || !uid || !ready) return
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (saveTimer.current) clearTimeout(saveTimer.current)
        if (!isCloudWriteLifecycleReady()) return
        if (!cloudDirtyTracker.hasPendingUserOperations()) return
        if (isBulkOverwriteBlockingAutosave()) return
        void flushSave()
      } else {
        schedulePullRemote(true)
      }
    }
    const onFocus = () => schedulePullRemote()
    const onUnload = () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (!isCloudWriteLifecycleReady()) return
      if (!cloudDirtyTracker.hasPendingUserOperations()) return
      if (isBulkOverwriteBlockingAutosave()) return
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
      if (cloudDirtyTracker.hasPendingUserOperations()) return
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
        const seeded = commitSyncedBaseline(
          applyAppStoreSeeds(restoreLocalSecrets(storeRef.current, remote)),
          row ? Number(row.revision) || undefined : undefined,
        )
        // Accept cloud: drop only conflicting pending deletes/ops; keep unrelated pending.
        cloudDirtyTracker.discardConflictingPending()
        applyCloud(seeded)
        setRemotePending(false)
        setConflictCount(0)
        setConflictDetails([])
        flashStatus('updated', MERGED_HINT_MS)
      } catch (err) {
        setError(sqlConnectErrorMessage(err, t('web.cloud.loadFailed')))
        schedulePullRemote(true)
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
      {bulkMessage && (
        <div className="fixed inset-x-0 top-0 z-[445] border-b border-rose-400 bg-rose-50 px-4 py-2.5 text-sm text-rose-950 shadow-sm print:hidden">
          <p className="font-semibold">{bulkMessage}</p>
          <p className="mt-0.5 text-xs">Обычный autosave заблокирован. Отмените предпросмотр, чтобы снова загрузить облако.</p>
          <button
            type="button"
            className="mt-2 rounded-sm bg-rose-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-900"
            onClick={cancelBulkAndReload}
          >
            Отменить предпросмотр и загрузить облако
          </button>
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
          {conflictDetails.length > 0 && (
            <ul className="mt-2 max-h-28 list-disc overflow-auto pl-4 text-xs text-sky-900/90">
              {conflictDetails.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-xs text-sky-800">
            Несохранённые правки удерживаются локально, пока вы не примете облако или не повторите сохранение.
          </p>
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
              className="rounded-sm border border-sky-400 px-3 py-1.5 text-xs font-semibold text-sky-900 hover:bg-sky-100"
              onClick={() => void flushSave()}
            >
              Повторить сохранение
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
      {status === 'dirty' && !bulkMessage && (
        <div className="pointer-events-none fixed bottom-3 right-3 z-[150] rounded-sm border border-amber-200 bg-amber-50/95 px-2 py-1 text-[10px] text-amber-900 print:hidden">
          Есть несохранённые изменения…
        </div>
      )}
    </>
  )
}
