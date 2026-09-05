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
import { formatTimesheetConflictDetail } from '@/lib/cloud/timesheetCellOps'
import { formatAtomicGroupConflictDetail } from '@/lib/cloud/transactionGroups'
import {
  createIndexedDbDurableJournalAdapter,
  getDurableJournalController,
  shouldWarnBeforeUnloadT2,
  shouldAttemptBlindUnloadSqlWrite,
} from '@/lib/cloud/durableJournal'
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
import {
  G1_CRITICAL_SOURCE,
  g1GetAuthoritativeWarehouse,
  resolveAuthoritativeWarehouseOverlay,
} from '@/lib/warehouse/g1ServerClient'
import { resolveAuthoritativeProductionOverlay } from '@/lib/production/g3ServerClient'

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

function formatCloudConflictDetail(
  c: import('@/lib/cloud/dirtyOperations').EntityConflict,
): string {
  if (c.reason === 'atomic_group_conflict' || c.transactionGroupId) {
    return formatAtomicGroupConflictDetail(c)
  }
  return formatTimesheetConflictDetail(c)
}

type SyncStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'pulling' | 'updated' | 'error' | 'conflict'

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
  const [pendingCount, setPendingCount] = useState(0)
  const [reloadKey, setReloadKey] = useState(0)
  const [bulkMessage, setBulkMessage] = useState<string | null>(null)
  const [recoveryBanner, setRecoveryBanner] = useState<{
    count: number
    showDetails: boolean
    unsupported: boolean
  } | null>(null)
  const [journalDegraded, setJournalDegraded] = useState(false)
  const [journalUnconfirmed, setJournalUnconfirmed] = useState(0)
  const [recoveryHold, setRecoveryHold] = useState(false)

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

  useEffect(() => {
    return cloudDirtyTracker.subscribe(() => {
      setPendingCount(cloudDirtyTracker.getPending().filter((op) => op.origin === 'user').length)
      const n = cloudDirtyTracker.getConflicts().length
      setConflictCount(n)
    })
  }, [])

  useEffect(() => {
    const journal = getDurableJournalController()
    return journal.subscribe(() => {
      const st = journal.getStatus()
      setJournalDegraded(st.degraded)
      setJournalUnconfirmed(st.unconfirmedWrites)
      setRecoveryHold(st.recoveryHold)
    })
  }, [])

  /** PHASE T1/T2: warn before close — no blind unload SQL write. */
  useEffect(() => {
    const shouldWarn = shouldWarnBeforeUnloadT2({
      pendingUserOps: pendingCount,
      saving: status === 'saving',
      unresolvedConflicts: conflictCount,
      unconfirmedJournalWrites: journalUnconfirmed,
      recoveryHold,
    })
    if (!shouldWarn) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [pendingCount, status, conflictCount, journalUnconfirmed, recoveryHold])

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
            // PHASE G1 — overlay warehouse when warehouse domain active (or soft-upgrade rev>0).
            try {
          const g1 = await g1GetAuthoritativeWarehouse(storeId)
          if (g1.ok && g1.data.warehouse) {
            const warehouseActive =
              g1.data.warehouseActive === true ||
              (g1.data.warehouseActive !== false && g1.data.revision > 0)
            const local = storeRef.current
            let next = local
            if (warehouseActive) {
              const overlay = resolveAuthoritativeWarehouseOverlay({
                legacyWarehouse: local.warehouse,
                criticalWarehouse: g1.data.warehouse,
                criticalRevision: g1.data.revision,
                warehouseActive: true,
              })
              if (overlay.source === G1_CRITICAL_SOURCE) {
                next = { ...next, warehouse: overlay.warehouse }
              }
            }
            // PHASE G3.1 — production overlay ONLY when production domain explicitly active
            const productionActive = g1.data.productionActive === true
            if (productionActive && g1.data.production) {
              const prodOverlay = resolveAuthoritativeProductionOverlay({
                legacyProduction: next.production as unknown as Record<string, unknown>,
                criticalProduction: g1.data.production,
                criticalRevision: g1.data.revision,
                productionActive: true,
              })
              if (prodOverlay.source === 'fst_critical_store') {
                next = {
                  ...next,
                  production: prodOverlay.production as typeof next.production,
                }
              } else if (prodOverlay.authoritativeBlocked) {
                console.warn('FST G3 production overlay blocked — not treating legacy as truth')
              }
            } else {
              // Ensure flag stays false so legacy production remains visible
              next = {
                ...next,
                production: {
                  ...next.production,
                  g3ProductionDomainActive: false,
                } as typeof next.production,
              }
            }
            // PHASE G4 — packaging/QC/FG overlay ONLY when packagingQc feature explicitly active.
            // Production core active alone must NOT hide legacy packaging/FG data.
            const packagingQcActive = g1.data.packagingQcActive === true
            if (packagingQcActive && g1.data.production) {
              const { resolveAuthoritativePackagingOverlay } = await import(
                '@/lib/production/g4ServerClient'
              )
              const g4Overlay = resolveAuthoritativePackagingOverlay({
                legacyProduction: next.production as unknown as Record<string, unknown>,
                criticalProduction: g1.data.production,
                criticalWarehouse: g1.data.warehouse,
                legacyWarehouse: next.warehouse,
                criticalRevision: g1.data.revision,
                packagingQcActive: true,
                productionActive,
              })
              if (g4Overlay.source === 'fst_critical_store') {
                next = {
                  ...next,
                  production: g4Overlay.production as typeof next.production,
                  warehouse: g4Overlay.warehouse ?? next.warehouse,
                }
              } else if (g4Overlay.authoritativeBlocked) {
                console.warn('FST G4 packaging overlay blocked — not treating legacy as truth')
              }
            } else {
              next = {
                ...next,
                production: {
                  ...next.production,
                  g4PackagingQcActive: false,
                } as typeof next.production,
              }
            }
            // PHASE G5.1 — persist activation flags from critical domainMeta (fail-closed gates).
            {
              const { withG5ActivationOnStore, readG5Activation } = await import(
                '@/lib/planner/g5ServerClient'
              )
              const fromMeta = readG5Activation(g1.data.domainMeta)
              next = withG5ActivationOnStore(next, {
                masterDataActive: g1.data.masterDataActive === true || fromMeta.masterDataActive,
                salesPlanningActive:
                  g1.data.salesPlanningActive === true || fromMeta.salesPlanningActive,
                procurementActive: g1.data.procurementActive === true || fromMeta.procurementActive,
                domainMeta: g1.data.domainMeta,
              })
            }
            // PHASE G6 — capacity planning feature flag from domainMeta.production.features.
            {
              const { withG6ActivationOnStore, readG6Activation } = await import(
                '@/lib/planner/g6ServerClient'
              )
              const fromMeta = readG6Activation(g1.data.domainMeta)
              const capacityPlanningActive =
                (g1.data as { capacityPlanningActive?: boolean }).capacityPlanningActive ===
                  true || fromMeta.capacityPlanningActive
              next = withG6ActivationOnStore(next, {
                capacityPlanningActive,
                domainMeta: g1.data.domainMeta,
              })
              const capacity = (g1.data as { capacity?: unknown }).capacity
              if (capacity && typeof capacity === 'object') {
                const { withCapacityOnStore } = await import('@/lib/cloud/g6AuthoritativeStrip')
                next = withCapacityOnStore(next, capacity as Parameters<typeof withCapacityOnStore>[1])
              }
            }
            if (next !== local) {
              applyCloud(next)
              if (!cloudDirtyTracker.hasPendingUserOperations()) {
                commitSyncedBaseline(next, row.revision)
              }
            }
          }
        } catch (g1Err) {
          console.warn('FST G1/G3 critical overlay skipped', g1Err)
        }
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
    [applyCloud, applyRemoteStore, commitSyncedBaseline, flashStatus, storeId],
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
    if (getDurableJournalController().isRecoveryHoldActive()) return
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
          build.conflicts.slice(0, 8).map((c) => formatCloudConflictDetail(c)),
        )
        setRemotePending(true)
        // Partial apply: still persist successfully merged ops; keep conflicted pending.
        if (build.appliedOperationIds.length === 0 || !build.payloadJson || build.nextRevision == null) {
          flashStatus('conflict')
          return
        }
      } else {
        setConflictCount(0)
        setConflictDetails([])
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
          flashStatus('conflict')
          return
        }
        throw err
      }

      const finalStore = applyAppStoreSeeds(build.store ?? remoteParsed)
      commitSyncedBaseline(finalStore, build.nextRevision, build.fingerprint)
      cloudDirtyTracker.acknowledgePersisted(build.appliedOperationIds)
      if (build.conflicts.length > 0) {
        cloudDirtyTracker.setConflicts(build.conflicts)
        setConflictCount(build.conflicts.length)
        setRemotePending(true)
        applyCloud(finalStore)
        notifyStoreTabsSaved(build.nextRevision, build.fingerprint ?? '')
        noteCloudPullCompleted(build.nextRevision)
        flashStatus('conflict')
        scheduleOutboxRef.current()
        return
      }
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
      flashStatus('error')
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
    if (getDurableJournalController().isRecoveryHoldActive()) return
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
      getDurableJournalController().clearScopeMemory()
      cloudDirtyTracker.setJournalHooks({})
      return
    }

    let cancelled = false
    if (!hasLoadedOnce.current) setReady(false)
    setError(null)
    setRecoveryBanner(null)
    resetSyncLifecycle()
    setSyncLifecyclePhase('booting')

    void (async () => {
      setSyncLifecyclePhase('hydrating')
      const journal = getDurableJournalController()
      try {
        // Prefer IndexedDB; fall back to degraded in-memory without false "protected" claim.
        if (journal.getAdapter().kind !== 'memory') {
          journal.setAdapter(createIndexedDbDurableJournalAdapter())
        } else if (typeof indexedDB !== 'undefined') {
          journal.setAdapter(createIndexedDbDurableJournalAdapter())
        }

        await journal.bindScope({
          projectId: String(import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'local-dev'),
          uid,
          storeDocId: storeId,
          appStoreVersion: 6,
        })
        cloudDirtyTracker.setJournalHooks({
          persist: async (ops) => {
            for (const op of ops) {
              await journal.persistOperation(op, 'pending')
            }
          },
          acknowledge: async (ids) => {
            await journal.acknowledge(ids)
          },
          discard: async (ids) => {
            await journal.discardOperationIds(ids)
          },
        })

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
        // Pure cloud first — journal recovery must not auto SQL-write.
        applyCloud(committed)
        noteCloudPullCompleted(Number(row.revision) || 1)

        const restored = await journal.restoreAfterCloudLoad(committed)
        if (cancelled) return
        // sqlWriteCount is always 0 by contract of restoreAfterCloudLoad

        if (restored.unsupported.length > 0) {
          setRecoveryBanner({
            count: restored.unsupported.length,
            showDetails: false,
            unsupported: true,
          })
        } else if (restored.recoverableOps.length > 0 || restored.conflictOps.length > 0) {
          cloudDirtyTracker.hydratePendingFromRecovery([
            ...restored.recoverableOps,
            ...restored.conflictOps,
          ])
          if (restored.conflicts.length) {
            cloudDirtyTracker.setConflicts(restored.conflicts)
            setConflictCount(restored.conflicts.length)
            setConflictDetails(
              restored.conflicts.slice(0, 8).map((c) => formatCloudConflictDetail(c)),
            )
            setRemotePending(true)
          }
          if (restored.recoverableOps.length > 0) {
            applyCloud({ ...committed, months: restored.previewMonths })
          }
          setRecoveryBanner({
            count: restored.recoverableOps.length + restored.conflictOps.length,
            showDetails: false,
            unsupported: false,
          })
        }

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
        // PHASE T2: no blind SQL write on hide — durable journal holds timesheet ops.
        if (saveTimer.current) clearTimeout(saveTimer.current)
      } else {
        schedulePullRemote(true)
      }
    }
    const onFocus = () => schedulePullRemote()
    const onUnload = () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      // No void flushSave / sendBeacon — beforeunload warns only.
      if (shouldAttemptBlindUnloadSqlWrite()) {
        // unreachable by T2 contract
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    window.addEventListener('pagehide', onUnload)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pagehide', onUnload)
    }
  }, [configured, ready, schedulePullRemote, uid])

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

  function continueRecoveredSave() {
    const journal = getDurableJournalController()
    journal.releaseRecoveryHold()
    setRecoveryBanner(null)
    setStatus('dirty')
    void flushSave()
  }

  function keepCloudDiscardRestored() {
    const journal = getDurableJournalController()
    if (recoveryBanner?.unsupported) {
      // Fail-closed: do not delete unsupported journal records.
      journal.releaseRecoveryHold()
      setRecoveryBanner(null)
      return
    }
    const ids = journal.getRestoredOperationIds()
    cloudDirtyTracker.discardPendingByIds(ids)
    void journal.discardOperationIds(ids)
    journal.releaseRecoveryHold()
    const cloud = lastSyncedStore.current
    if (cloud) applyCloud(cloud)
    setRecoveryBanner(null)
    setRemotePending(false)
    setConflictCount(0)
    setConflictDetails([])
    flashStatus('updated', MERGED_HINT_MS)
  }

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
      {journalDegraded && (
        <div className="fixed inset-x-0 top-0 z-[446] border-b border-amber-500 bg-amber-100 px-4 py-2 text-sm text-amber-950 shadow-sm print:hidden">
          <p className="font-semibold">{t('web.cloud.journalDegraded')}</p>
          <p className="mt-0.5 text-xs">{t('web.cloud.journalDegradedHint')}</p>
        </div>
      )}
      {recoveryBanner && (
        <div className="fixed bottom-4 left-4 z-[210] max-w-md rounded-sm border border-violet-300 bg-violet-50 px-4 py-3 text-sm text-violet-950 shadow-sm max-lg:bottom-[calc(5.5rem+env(safe-area-inset-bottom))] lg:left-[calc(var(--app-sidebar-w,3.5rem)+1rem)] lg:bottom-16">
          <p className="font-semibold">
            {recoveryBanner.unsupported
              ? t('web.cloud.journalUnsupported')
              : tf('web.cloud.journalRecovered', { count: String(recoveryBanner.count) })}
          </p>
          {recoveryBanner.showDetails && conflictDetails.length > 0 && (
            <ul className="mt-2 max-h-28 list-disc overflow-auto pl-4 text-xs">
              {conflictDetails.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-xs text-violet-800">{t('web.cloud.journalRecoveredHint')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-sm border border-violet-400 px-3 py-1.5 text-xs font-semibold text-violet-900 hover:bg-violet-100"
              onClick={() =>
                setRecoveryBanner((b) => (b ? { ...b, showDetails: !b.showDetails } : b))
              }
            >
              {t('web.cloud.journalReview')}
            </button>
            {!recoveryBanner.unsupported && (
              <button
                type="button"
                className="rounded-sm bg-violet-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-900"
                onClick={continueRecoveredSave}
              >
                {t('web.cloud.journalContinueSave')}
              </button>
            )}
            <button
              type="button"
              className="rounded-sm border border-violet-400 px-3 py-1.5 text-xs font-semibold text-violet-900 hover:bg-violet-100"
              onClick={keepCloudDiscardRestored}
            >
              {t('web.cloud.journalKeepCloud')}
            </button>
          </div>
        </div>
      )}
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
              {t('web.cloud.retrySave')}
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
      {(status === 'dirty' || status === 'saving' || status === 'saved' || status === 'error' || status === 'conflict') &&
        !bulkMessage && (
        <div
          className={`pointer-events-none fixed bottom-3 right-3 z-[150] rounded-sm border px-2 py-1 text-[10px] print:hidden ${
            status === 'saved'
              ? 'border-emerald-200 bg-emerald-50/95 text-emerald-900'
              : status === 'error'
                ? 'border-rose-200 bg-rose-50/95 text-rose-900'
                : status === 'conflict'
                  ? 'border-sky-200 bg-sky-50/95 text-sky-900'
                  : status === 'saving'
                    ? 'border-stone-200 bg-stone-50/95 text-stone-800'
                    : 'border-amber-200 bg-amber-50/95 text-amber-900'
          }`}
        >
          {status === 'dirty' && tf('web.cloud.dirtyCount', { count: String(Math.max(pendingCount, 1)) })}
          {status === 'saving' && t('web.cloud.savingShort')}
          {status === 'saved' && t('web.cloud.savedShort')}
          {status === 'error' && t('web.cloud.saveErrorShort')}
          {status === 'conflict' && tf('web.cloud.conflictShort', { count: String(Math.max(conflictCount, 1)) })}
        </div>
      )}
    </>
  )
}
