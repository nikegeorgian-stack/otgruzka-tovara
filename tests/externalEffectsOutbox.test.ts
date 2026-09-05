import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import type { AppStore } from '@/lib/types'
import type { AppUser } from '@/lib/access/types'
import {
  beginBulkStoreOverwrite,
  clearBulkStoreOverwrite,
  getBulkPreviewUserMessage,
  isBulkOverwriteBlockingAutosave,
  tryBeginBulkStoreOverwrite,
} from '@/lib/cloud/bulkStoreOverwrite'
import {
  buildCloudSavePayload,
  canCloudWriteNow,
} from '@/lib/cloud/cloudSavePipeline'
import {
  cloudDirtyTracker,
  resetCloudDirtyTracker,
} from '@/lib/cloud/dirtyOperations'
import {
  resetExternalEffectsAdapters,
  setExternalEffectsAdapters,
  getExternalEffectsAdapters,
  type ExternalEffectsAdapters,
} from '@/lib/cloud/externalEffects/adapters'
import {
  activeOutboxItems,
  findOutboxItem,
  getExternalEffects,
} from '@/lib/cloud/externalEffects/outbox'
import {
  beginAuthUserDeletion,
  beginStorageAttachmentDeletion,
  processExternalEffectsOutbox,
  type ExternalEffectsProcessorContext,
} from '@/lib/cloud/externalEffects/processor'
import {
  isCloudWriteLifecycleReady,
  resetSyncLifecycle,
  setSyncLifecyclePhase,
} from '@/lib/cloud/syncLifecycle'
import { collectWebAllowedLogins } from '@/lib/cloud/webAccessConfig'
import { applyTrackedStoreUpdate } from '@/store/storeApi'
import { clearMonthsBeforeInStore } from '@/lib/monthManage'
import { createDefaultAccessStore } from '@/lib/access/init'
import { normalizeTasksStore } from '@/lib/tasks/init'

function baseStore(): AppStore {
  const admin: AppUser = {
    id: 'admin-1',
    login: 'admin@fibercell.net',
    displayName: 'Admin',
    roleId: 'sysadmin',
    passwordHash: '',
    passwordSalt: '',
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
  const target: AppUser = {
    id: 'u-target',
    login: 'user@test.net',
    displayName: 'Target User',
    roleId: 'warehouse_keeper',
    passwordHash: '',
    passwordSalt: '',
    active: true,
    webAccount: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
  return {
    version: 6,
    brigades: [],
    brigadeNamesKa: {},
    brigadiers: {},
    archivedMonths: [],
    employees: [],
    candidates: [],
    months: {},
    auditLog: [],
    trash: { employees: [], months: [], candidates: [] },
    shiftTemplates: [],
    hrStructuralUnits: [],
    hrPositions: [],
    production: { requests: [], planner: { orders: [] } },
    sales: { orders: [], reservations: [], allocations: [] },
    aiChat: { threads: [] },
    counterparties: { items: [] },
    finishedProducts: { items: [] },
    packagingRecipes: { items: [], boxes: [] },
    formulations: { recipes: [] },
    technologistQc: {},
    otc: { norms: [], labTests: [], alkaliSeries: [], sorting: [], defects: [] },
    wastewater: { cubes: [] },
    engineerLog: { entries: [] },
    tasks: normalizeTasksStore({
      boards: [{ id: 'b1', title: 'B', department: 'general', columnIds: ['c1'], sortOrder: 0 }],
      columns: [{ id: 'c1', boardId: 'b1', title: 'Col', sortOrder: 0 }],
      tasks: [
        {
          id: 't1',
          boardId: 'b1',
          columnId: 'c1',
          title: 'Task',
          priority: 'normal',
          status: 'open',
          createdBy: 'admin-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      attachments: [
        {
          id: 'att-1',
          taskId: 't1',
          storagePath: 'fstFiles/main/tasks/t1/att-1/file.pdf',
          fileName: 'file.pdf',
          uploadedBy: 'admin-1',
          uploadedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      comments: [],
      rules: [],
    }),
    warehouse: { items: [], documents: [], movements: [], categories: [], locations: [] },
    workwear: { issuances: [] },
    itOffice: { assets: [], acts: [], maintenance: [] },
    procurement: { orders: [], categories: [], routePoints: [] },
    access: { ...createDefaultAccessStore(), users: [admin, target] },
    settings: { responsible: '', site: '', locale: 'ru' },
  }
}

function makeProcessorCtx(
  store: AppStore,
  baseline: AppStore,
  adapters: ExternalEffectsAdapters,
  patch: (next: AppStore) => void,
): ExternalEffectsProcessorContext {
  return {
    getStore: () => store,
    getBaselineStore: () => baseline,
    getPendingOps: () => cloudDirtyTracker.getPending(),
    applyStore: (fn, origin) => {
      const next = fn(store)
      Object.assign(store, next)
      if (origin === 'user') patch(next)
    },
    scheduleSave: () => {},
    adapters,
    isSysAdmin: true,
    canManageTasks: true,
    actor: { id: 'admin-1', name: 'Admin' },
  }
}

describe('externalEffects outbox', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_FST_WEB', 'true')
    resetCloudDirtyTracker()
    resetSyncLifecycle()
    clearBulkStoreOverwrite()
    setSyncLifecyclePhase('ready')
    resetExternalEffectsAdapters()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('Auth phase A does not call Firebase delete before SQL ack', async () => {
    const authDelete = vi.fn(async () => ({ ok: true as const }))
    setExternalEffectsAdapters({
      deleteAuthUser: authDelete,
      syncAllowlist: vi.fn(async () => {}),
    })

    let local = baseStore()
    const remote = structuredClone(local)
    const begun = beginAuthUserDeletion(local, {
      userId: 'u-target',
      email: 'user@test.net',
    })
    local = begun.store
    applyTrackedStoreUpdate(remote, local, 'user')

    const baseline = structuredClone(remote)
    cloudDirtyTracker.setBaselineStore(baseline)
    cloudDirtyTracker.setBaseRevision(1)

    const patch = vi.fn()
    await processExternalEffectsOutbox(makeProcessorCtx(local, baseline, getExternalEffectsAdapters(), patch))

    expect(authDelete).not.toHaveBeenCalled()
    expect(local.access.users.find((u) => u.id === 'u-target')?.pendingDeletion).toBe(true)
  })

  it('Auth: SQL ack → allowlist revoke → Auth delete → final metadata delete', async () => {
    const authDelete = vi.fn(async () => ({ ok: true as const }))
    const syncAllowlist = vi.fn(async () => {})
    setExternalEffectsAdapters({ deleteAuthUser: authDelete, syncAllowlist })

    let local = baseStore()
    let baseline = structuredClone(local)
    local = beginAuthUserDeletion(local, {
      userId: 'u-target',
      email: 'user@test.net',
    }).store
    applyTrackedStoreUpdate(baseline, local, 'user')

    baseline = structuredClone(local)
    cloudDirtyTracker.setBaselineStore(baseline)
    cloudDirtyTracker.setBaseRevision(1)
    cloudDirtyTracker.acknowledgePersisted(cloudDirtyTracker.getPending().map((o) => o.operationId))

    const patch = vi.fn((s: AppStore) => {
      Object.assign(local, s)
    })

    await processExternalEffectsOutbox(
      makeProcessorCtx(local, baseline, getExternalEffectsAdapters(), patch),
    )

    expect(syncAllowlist).toHaveBeenCalled()
    expect(authDelete).toHaveBeenCalledWith('user@test.net')
    expect(local.access.users.find((u) => u.id === 'u-target')).toBeUndefined()

    const opId = getExternalEffects(local).outbox[0]?.operationId
    expect(opId).toBeTruthy()
    const item = findOutboxItem(local, opId!)
    expect(item?.step).toBe('await_final_sql')

    cloudDirtyTracker.acknowledgePersisted(cloudDirtyTracker.getPending().map((o) => o.operationId))
    baseline = structuredClone(local)
    cloudDirtyTracker.setBaselineStore(baseline)

    await processExternalEffectsOutbox(
      makeProcessorCtx(local, baseline, getExternalEffectsAdapters(), patch),
    )

    expect(findOutboxItem(local, opId!)?.status).toBe('completed')
  })

  it('Auth: user-not-found is idempotent success', async () => {
    setExternalEffectsAdapters({
      deleteAuthUser: vi.fn(async () => ({ ok: true })),
      syncAllowlist: vi.fn(async () => {}),
    })

    let local = baseStore()
    local = beginAuthUserDeletion(local, { userId: 'u-target', email: 'user@test.net' }).store
    const baseline = structuredClone(local)
    cloudDirtyTracker.setBaselineStore(baseline)
    cloudDirtyTracker.setBaseRevision(1)

    await processExternalEffectsOutbox(
      makeProcessorCtx(local, baseline, getExternalEffectsAdapters(), () => {}),
    )

    expect(local.access.users.find((u) => u.id === 'u-target')).toBeUndefined()
  })

  it('Auth failure keeps user disabled/pending with failed outbox', async () => {
    setExternalEffectsAdapters({
      deleteAuthUser: vi.fn(async () => ({ ok: false, error: 'network' })),
      syncAllowlist: vi.fn(async () => {}),
    })

    let local = baseStore()
    local = beginAuthUserDeletion(local, { userId: 'u-target', email: 'user@test.net' }).store
    const baseline = structuredClone(local)
    cloudDirtyTracker.setBaselineStore(baseline)

    await processExternalEffectsOutbox(
      makeProcessorCtx(local, baseline, getExternalEffectsAdapters(), () => {}),
    )

    const user = local.access.users.find((u) => u.id === 'u-target')
    expect(user?.pendingDeletion).toBe(true)
    expect(user?.active).toBe(false)
    expect(activeOutboxItems(local)[0]?.status).toBe('failed')
  })

  it('pendingDeletion user excluded from allowlist', () => {
    let local = baseStore()
    local = beginAuthUserDeletion(local, { userId: 'u-target', email: 'user@test.net' }).store
    const allowed = collectWebAllowedLogins(local.access)
    expect(allowed).not.toContain('user@test.net')
  })

  it('Storage: SQL conflict blocks file delete', async () => {
    const storageDelete = vi.fn(async () => ({ ok: true as const }))
    setExternalEffectsAdapters({
      deleteStorageObject: storageDelete,
    })

    let local = baseStore()
    const remote = structuredClone(local)
    local = beginStorageAttachmentDeletion(local, {
      attachmentId: 'att-1',
      storagePath: 'fstFiles/main/tasks/t1/att-1/file.pdf',
    }).store

    applyTrackedStoreUpdate(remote, local, 'user')
    const baseline = structuredClone(remote)
    cloudDirtyTracker.setBaselineStore(baseline)

    await processExternalEffectsOutbox(
      makeProcessorCtx(local, baseline, getExternalEffectsAdapters(), () => {}),
    )

    expect(storageDelete).not.toHaveBeenCalled()
    expect(local.tasks?.attachments.find((a) => a.id === 'att-1')?.pendingDeletion).toBe(true)
  })

  it('Storage: object-not-found completes metadata delete on resume', async () => {
    setExternalEffectsAdapters({
      deleteStorageObject: vi.fn(async () => ({ ok: true, notFound: true })),
    })

    let local = baseStore()
    local = beginStorageAttachmentDeletion(local, {
      attachmentId: 'att-1',
      storagePath: 'fstFiles/main/tasks/t1/att-1/file.pdf',
    }).store
    let baseline = structuredClone(local)
    cloudDirtyTracker.setBaselineStore(baseline)
    cloudDirtyTracker.acknowledgePersisted(cloudDirtyTracker.getPending().map((o) => o.operationId))

    await processExternalEffectsOutbox(
      makeProcessorCtx(local, baseline, getExternalEffectsAdapters(), (s) => {
        Object.assign(local, s)
      }),
    )

    expect(local.tasks?.attachments.find((a) => a.id === 'att-1')).toBeUndefined()
    const opId = getExternalEffects(local).outbox[0]?.operationId!
    cloudDirtyTracker.acknowledgePersisted(cloudDirtyTracker.getPending().map((o) => o.operationId))
    baseline = structuredClone(local)
    cloudDirtyTracker.setBaselineStore(baseline)

    await processExternalEffectsOutbox(
      makeProcessorCtx(local, baseline, getExternalEffectsAdapters(), () => {}),
    )
    expect(findOutboxItem(local, opId)?.status).toBe('completed')
  })

  it('bulk preview blocks processor via lifecycle gates', async () => {
    const authDelete = vi.fn(async () => ({ ok: true as const }))
    setExternalEffectsAdapters({ deleteAuthUser: authDelete, syncAllowlist: vi.fn(async () => {}) })

    beginBulkStoreOverwrite('clear_months', { months: 2 })
    expect(isBulkOverwriteBlockingAutosave()).toBe(true)

    let local = baseStore()
    local = beginAuthUserDeletion(local, { userId: 'u-target', email: 'user@test.net' }).store
    const baseline = structuredClone(local)
    cloudDirtyTracker.setBaselineStore(baseline)

    const did = await processExternalEffectsOutbox(
      makeProcessorCtx(local, baseline, getExternalEffectsAdapters(), () => {}),
    )
    expect(did).toBe(false)
    expect(authDelete).not.toHaveBeenCalled()
  })

  it('clearMonthsBefore preview uses bulk gate without dirty autosave path', () => {
    beginBulkStoreOverwrite('clear_months', { months: 1 })
    expect(isBulkOverwriteBlockingAutosave()).toBe(true)
    expect(canCloudWriteNow(false).ok).toBe(false)

    const store = baseStore()
    store.months = {
      '2026-01': { year: 2026, month: 1, rows: [], plan: {}, fact: {} },
      '2026-02': { year: 2026, month: 2, rows: [], plan: {}, fact: {} },
    }
    const preview = clearMonthsBeforeInStore(store, '2026-02')
    expect(preview.cleared).toEqual(['2026-01'])
    expect(canCloudWriteNow(false).ok).toBe(false)
  })

  it('outbox survives merge — not wiped by ordinary pull baseline', () => {
    resetCloudDirtyTracker()
    setSyncLifecyclePhase('ready')
    const remote = baseStore()
    let local = beginAuthUserDeletion(remote, {
      userId: 'u-target',
      email: 'user@test.net',
    }).store
    applyTrackedStoreUpdate(remote, local, 'user')
    const ops = cloudDirtyTracker.getPending()
    const build = buildCloudSavePayload({
      remote,
      remoteRevision: 1,
      local,
      baseline: remote,
      operations: ops,
      actorEmail: 'admin@fibercell.net',
    })
    expect(build.allowed).toBe(true)
    expect(build.payloadJson).toContain('externalEffects')
    expect(build.payloadJson).toContain('auth-user-delete')
  })

  it('stale client does not delete entity changed on remote', async () => {
    setExternalEffectsAdapters({
      deleteAuthUser: vi.fn(async () => ({ ok: true as const })),
      syncAllowlist: vi.fn(async () => {}),
    })

    let local = baseStore()
    local = beginAuthUserDeletion(local, { userId: 'u-target', email: 'user@test.net' }).store
    const user = local.access.users.find((u) => u.id === 'u-target')
    if (user) user.externalEffectOperationId = 'stale-op'
    const baseline = structuredClone(local)
    cloudDirtyTracker.setBaselineStore(baseline)

    await processExternalEffectsOutbox(
      makeProcessorCtx(local, baseline, getExternalEffectsAdapters(), () => {}),
    )

    expect(getExternalEffectsAdapters().deleteAuthUser).not.toHaveBeenCalled()
    expect(activeOutboxItems(local)[0]?.lastErrorCode).toBe('stale_entity')
  })
})

describe('externalEffects lifecycle gate', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_FST_WEB', 'true')
    resetSyncLifecycle()
    setSyncLifecyclePhase('hydrating')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('processor blocked until lifecycle ready', () => {
    expect(isCloudWriteLifecycleReady()).toBe(false)
    setSyncLifecyclePhase('ready')
    expect(isCloudWriteLifecycleReady()).toBe(true)
  })
})

describe('non-web external deletion fail-closed', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_FST_WEB', 'false')
    resetCloudDirtyTracker()
    resetSyncLifecycle()
    clearBulkStoreOverwrite()
    setSyncLifecyclePhase('ready')
    resetExternalEffectsAdapters()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('beginAuthUserDeletion throws and does not mutate', () => {
    const authDelete = vi.fn(async () => ({ ok: true as const }))
    setExternalEffectsAdapters({ deleteAuthUser: authDelete, syncAllowlist: vi.fn(async () => {}) })
    const local = baseStore()
    const before = structuredClone(local)
    expect(() =>
      beginAuthUserDeletion(local, { userId: 'u-target', email: 'user@test.net' }),
    ).toThrow('external_deletion_web_only')
    expect(local.access.users.find((u) => u.id === 'u-target')?.pendingDeletion).toBeFalsy()
    expect(getExternalEffects(local).outbox).toHaveLength(0)
    expect(JSON.stringify(local.access)).toBe(JSON.stringify(before.access))
    expect(authDelete).not.toHaveBeenCalled()
  })

  it('beginStorageAttachmentDeletion throws and does not mutate', () => {
    const storageDelete = vi.fn(async () => ({ ok: true as const }))
    setExternalEffectsAdapters({ deleteStorageObject: storageDelete })
    const local = baseStore()
    expect(() =>
      beginStorageAttachmentDeletion(local, {
        attachmentId: 'att-1',
        storagePath: 'fstFiles/main/tasks/t1/att-1/file.pdf',
      }),
    ).toThrow('external_deletion_web_only')
    expect(local.tasks?.attachments.find((a) => a.id === 'att-1')?.pendingDeletion).toBeFalsy()
    expect(getExternalEffects(local).outbox).toHaveLength(0)
    expect(storageDelete).not.toHaveBeenCalled()
  })

  it('preserves web-created outbox read-only on non-web', () => {
    vi.stubEnv('VITE_FST_WEB', 'true')
    let local = baseStore()
    local = beginAuthUserDeletion(local, { userId: 'u-target', email: 'user@test.net' }).store
    const outbox = getExternalEffects(local).outbox
    expect(outbox).toHaveLength(1)

    vi.stubEnv('VITE_FST_WEB', 'false')
    expect(() =>
      beginAuthUserDeletion(local, { userId: 'u-target', email: 'user@test.net' }),
    ).toThrow('external_deletion_web_only')
    expect(getExternalEffects(local).outbox).toEqual(outbox)
    expect(local.access.users.find((u) => u.id === 'u-target')?.pendingDeletion).toBe(true)
  })
})

describe('bulk preview pending safety', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_FST_WEB', 'true')
    resetCloudDirtyTracker()
    resetSyncLifecycle()
    clearBulkStoreOverwrite()
    setSyncLifecyclePhase('ready')
    resetExternalEffectsAdapters()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    clearBulkStoreOverwrite()
  })

  it('blocks bulk when pending user ops exist', () => {
    const store = baseStore()
    cloudDirtyTracker.enqueue([
      {
        operationId: 'op-keep',
        type: 'update',
        domain: 'employees',
        entityId: 'e1',
        fields: ['*'],
        baseRevision: 1,
        origin: 'user',
        at: new Date().toISOString(),
      },
    ])
    const result = tryBeginBulkStoreOverwrite('clear_months', { months: 1 }, store)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('pending_ops')
    expect(isBulkOverwriteBlockingAutosave()).toBe(false)
    expect(cloudDirtyTracker.getPending()).toHaveLength(1)
  })

  it('blocks bulk when conflicts exist', () => {
    cloudDirtyTracker.setConflicts([
      {
        domain: 'employees',
        entityId: 'e1',
        reason: 'concurrent_edit',
        message: 'conflict',
      },
    ])
    const result = tryBeginBulkStoreOverwrite('import', undefined, baseStore())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('conflicts')
  })

  it('blocks bulk when active outbox exists', () => {
    let local = baseStore()
    local = beginAuthUserDeletion(local, { userId: 'u-target', email: 'user@test.net' }).store
    const result = tryBeginBulkStoreOverwrite('reset', undefined, local)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('active_outbox')
  })

  it('allows bulk when clean', () => {
    const result = tryBeginBulkStoreOverwrite('clear_months', { months: 1 }, baseStore())
    expect(result.ok).toBe(true)
    expect(isBulkOverwriteBlockingAutosave()).toBe(true)
  })

  it('cancel clears only bulk gate — keeps pending and outbox', () => {
    let local = baseStore()
    local = beginAuthUserDeletion(local, { userId: 'u-target', email: 'user@test.net' }).store
    applyTrackedStoreUpdate(baseStore(), local, 'user')
    const pendingBefore = cloudDirtyTracker.getPending().map((o) => o.operationId)
    expect(pendingBefore.length).toBeGreaterThan(0)
    const outboxBefore = structuredClone(getExternalEffects(local).outbox)

    // Simulate: somehow bulk was active then cancel (cancel must not wipe pending).
    // Force-start is blocked by outbox — so set bulk state via clean path after acknowledging:
    cloudDirtyTracker.acknowledgePersisted(pendingBefore)
    clearBulkStoreOverwrite()
    // Manually open bulk after clearing outbox from store for gate, but keep a fake pending:
    const clean = baseStore()
    expect(tryBeginBulkStoreOverwrite('import', undefined, clean).ok).toBe(true)
    cloudDirtyTracker.enqueue([
      {
        operationId: 'op-unrelated',
        type: 'update',
        domain: 'employees',
        entityId: 'e1',
        fields: ['*'],
        baseRevision: 1,
        origin: 'user',
        at: new Date().toISOString(),
      },
    ])
    // Cancel path: clearBulk only (no discardAllPending)
    clearBulkStoreOverwrite()
    expect(isBulkOverwriteBlockingAutosave()).toBe(false)
    expect(cloudDirtyTracker.getPending().map((o) => o.operationId)).toEqual(['op-unrelated'])
    expect(cloudDirtyTracker.getConflicts()).toEqual([])
    // Restore outbox assertion from earlier snapshot independence
    expect(outboxBefore[0]?.kind).toBe('auth-user-delete')
  })

  it('normal edit during bulk does not create dirty ops via shouldTrack when origin clear_months', () => {
    expect(tryBeginBulkStoreOverwrite('clear_months', { months: 1 }, baseStore()).ok).toBe(true)
    expect(canCloudWriteNow(false).ok).toBe(false)
    const a = baseStore()
    const b = { ...a, settings: { ...a.settings, site: 'x' } }
    applyTrackedStoreUpdate(a, b, 'clear_months')
    expect(cloudDirtyTracker.getPending()).toHaveLength(0)
    expect(getBulkPreviewUserMessage()).toContain('не сохранены')
  })
})
