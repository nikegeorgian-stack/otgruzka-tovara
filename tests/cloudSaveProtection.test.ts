import { describe, expect, it, beforeEach } from 'vitest'
import { startTransition } from 'react'
import type { AppStore } from '@/lib/types'
import {
  beginBulkStoreOverwrite,
  clearBulkStoreOverwrite,
  getBulkPreviewUserMessage,
  isBulkOverwriteBlockingAutosave,
} from '@/lib/cloud/bulkStoreOverwrite'
import {
  buildCloudSavePayload,
  canCloudWriteNow,
  needsPullBeforeWrite,
} from '@/lib/cloud/cloudSavePipeline'
import { conservativeMergeForSave } from '@/lib/cloud/conservativeMerge'
import {
  cloudDirtyTracker,
  nextOperationId,
  recordExplicitDelete,
  resetCloudDirtyTracker,
} from '@/lib/cloud/dirtyOperations'
import { APP_STORE_PERSISTENT_DOMAINS } from '@/lib/cloud/persistentDomains'
import {
  ensureMonthReadyChangesFingerprint,
  ensureMonthReadyIsAdditiveForRemote,
} from '@/lib/cloud/monthReadyFingerprint'
import { diffStoreToOperations } from '@/lib/cloud/storeDiff'
import {
  applyTrackedStoreUpdate,
} from '@/store/storeApi'
import {
  getStoreMutationOrigin,
  resetStoreMutationOrigin,
  runWithStoreOrigin,
  shouldTrackDirtyOps,
} from '@/lib/cloud/storeMutationOrigin'
import {
  isCloudWriteLifecycleReady,
  noteCloudPullCompleted,
  resetSyncLifecycle,
  setSyncLifecyclePhase,
} from '@/lib/cloud/syncLifecycle'
import { ensureMonthReady } from '@/lib/monthReady'

function baseStore(): AppStore {
  return {
    version: 6,
    employees: [
      { id: 'e1', fullName: 'Alice', active: true, schedule: '5/2 8ч', shiftMode: 'day' },
      { id: 'e2', fullName: 'Bob', active: true, schedule: '5/2 8ч', shiftMode: 'day' },
    ],
    months: {
      '2026-09': {
        year: 2026,
        month: 9,
        rows: [],
        plan: {},
        fact: {},
      },
    },
    brigades: ['A'],
    access: { users: [{ id: 'u1', login: 'admin', roleId: 'sysadmin' }], roles: [] },
    auditLog: [],
    settings: { signatures: {} },
    candidates: [],
    warehouse: {
      items: [{ id: 'w1', name: 'Resin', unit: 'kg' }],
      documents: [],
      movements: [],
      categories: [],
      locations: [],
    },
    sales: { orders: [{ id: 'so1', customer: 'C1', lines: [], history: [] }], reservations: [], allocations: [] },
    procurement: { orders: [{ id: 'po1', lines: [], milestones: [] }], categories: [], routePoints: [] },
    tasks: { tasks: [{ id: 't1', title: 'Task' }] },
    production: { requests: [], planner: { orders: [] } },
    finance: {},
    meals: {},
    protocols: {},
    orgChart: {},
    technologistQc: {},
    otc: {},
    workwear: {},
    itOffice: {},
    formulations: {},
    finishedProducts: { items: [] },
    packagingRecipes: {},
    counterparties: { items: [] },
    nightShifts: {},
    timesheetEntries: {},
    attendance: {},
    shiftTemplates: [],
    hrStructuralUnits: [],
    hrPositions: [],
  } as unknown as AppStore
}

beforeEach(() => {
  resetCloudDirtyTracker()
  resetSyncLifecycle()
  resetStoreMutationOrigin()
  clearBulkStoreOverwrite()
})

describe('hydration → ready → user edit → save allowed', () => {
  it('applyCloudStore path never opens bulk; user edit then save is allowed', () => {
    setSyncLifecyclePhase('hydrating')
    expect(isBulkOverwriteBlockingAutosave()).toBe(false)
    expect(canCloudWriteNow(true).ok).toBe(false)

    // Simulate applyCloudStore (hydration origin, no bulk)
    const remote = baseStore()
    applyTrackedStoreUpdate(baseStore(), remote, 'hydration')
    expect(cloudDirtyTracker.getPending()).toHaveLength(0)
    expect(isBulkOverwriteBlockingAutosave()).toBe(false)

    setSyncLifecyclePhase('ready')
    noteCloudPullCompleted(3)
    cloudDirtyTracker.setBaseRevision(3)

    const before = remote
    const after = {
      ...before,
      employees: before.employees.map((e) =>
        e.id === 'e1' ? { ...e, fullName: 'Alice Edited' } : e,
      ),
    }
    applyTrackedStoreUpdate(before, after, 'user')
    expect(cloudDirtyTracker.hasPendingUserOperations()).toBe(true)
    expect(canCloudWriteNow(true).ok).toBe(true)

    const build = buildCloudSavePayload({
      remote,
      remoteRevision: 3,
      local: after,
      baseline: remote,
      operations: cloudDirtyTracker.getPending(),
    })
    expect(build.allowed).toBe(true)
    expect(build.store?.employees.find((e) => e.id === 'e1')?.fullName).toBe('Alice Edited')
  })
})

describe('mutation origin (explicit, not ambient async)', () => {
  it('hydration mutation is not dirty', () => {
    const a = baseStore()
    const b = { ...a, settings: { ...a.settings, theme: 'dark' } }
    applyTrackedStoreUpdate(a, b, 'hydration')
    expect(cloudDirtyTracker.hasPendingUserOperations()).toBe(false)
  })

  it('system mutation is not dirty', () => {
    const a = baseStore()
    const b = ensureMonthReady(a, '2026-09')
    applyTrackedStoreUpdate(a, b, 'system')
    expect(cloudDirtyTracker.hasPendingUserOperations()).toBe(false)
  })

  it('user mutation is dirty', () => {
    const a = baseStore()
    const b = { ...a, settings: { ...a.settings, locale: 'ka' } }
    applyTrackedStoreUpdate(a, b, 'user')
    expect(cloudDirtyTracker.hasPendingUserOperations()).toBe(true)
  })

  it('startTransition does not leak ambient hydration as user', () => {
    let observedInside = 'unset'
    runWithStoreOrigin('hydration', () => {
      startTransition(() => {
        // Ambient stack already popped — must not trust this for dirty tracking.
        observedInside = getStoreMutationOrigin()
      })
    })
    // Explicit origin API is the contract; ambient may already be 'user' after transition scheduling.
    expect(shouldTrackDirtyOps('hydration')).toBe(false)
    expect(shouldTrackDirtyOps(observedInside as 'user')).toBe(
      observedInside === 'user' || observedInside === 'unset' ? observedInside === 'user' : false,
    )
    const a = baseStore()
    const b = { ...a, employees: [...a.employees] }
    // Correct pattern: pass origin explicitly even if called from transition.
    applyTrackedStoreUpdate(a, b, 'hydration')
    expect(cloudDirtyTracker.hasPendingUserOperations()).toBe(false)
  })
})

describe('pending ops survive pull / acknowledge', () => {
  it('pull-style acknowledge does not clearAll pending', () => {
    cloudDirtyTracker.setBaseRevision(2)
    cloudDirtyTracker.enqueue([
      {
        operationId: 'op-keep',
        type: 'update',
        domain: 'employees',
        entityId: 'e1',
        fields: ['*'],
        baseRevision: 2,
        origin: 'user',
        at: new Date().toISOString(),
      },
    ])
    // Simulate pull: only bump revision, do NOT discardAllPending
    cloudDirtyTracker.setBaseRevision(5)
    expect(cloudDirtyTracker.getPending()).toHaveLength(1)
    cloudDirtyTracker.acknowledgePersisted(['other'])
    expect(cloudDirtyTracker.getPending()).toHaveLength(1)
    cloudDirtyTracker.acknowledgePersisted(['op-keep'])
    expect(cloudDirtyTracker.getPending()).toHaveLength(0)
  })

  it('conflict keeps local pending edit and preserves cloud snapshot', () => {
    const baseline = baseStore()
    const remote = {
      ...baseline,
      employees: baseline.employees.map((e) =>
        e.id === 'e1' ? { ...e, fullName: 'Cloud Alice' } : e,
      ),
    }
    const local = {
      ...baseline,
      employees: baseline.employees.map((e) =>
        e.id === 'e1' ? { ...e, fullName: 'Local Alice' } : e,
      ),
    }
    const { store, conflicts } = conservativeMergeForSave(baseline, remote, local, [])
    expect(conflicts.length).toBeGreaterThan(0)
    expect(store.employees.find((e) => e.id === 'e1')?.fullName).toBe('Cloud Alice')
    expect(conflicts[0]?.pendingLocal).toBeTruthy()
    expect(conflicts[0]?.cloudSnapshot).toBeTruthy()
  })
})

describe('explicit delete vs absence', () => {
  it('absence in local does not delete remote entity', () => {
    const baseline = baseStore()
    const remote = baseline
    const local = { ...baseline, employees: baseline.employees.filter((e) => e.id !== 'e2') }
    const ops = diffStoreToOperations(baseline, local, 1, 'user')
    expect(ops.every((op) => op.type !== 'delete')).toBe(true)
    const { store } = conservativeMergeForSave(baseline, remote, local, [])
    expect(store.employees.some((e) => e.id === 'e2')).toBe(true)
  })

  it('explicit UI delete creates one targeted delete and removes entity', () => {
    const remote = baseStore()
    const e2 = remote.employees.find((e) => e.id === 'e2')
    cloudDirtyTracker.setBaselineStore(remote)
    recordExplicitDelete({
      domain: 'employees',
      entityId: 'e2',
      baseRevision: 2,
      baselineEntity: e2,
    })
    const pending = cloudDirtyTracker.getPending()
    expect(pending).toHaveLength(1)
    expect(pending[0]?.type).toBe('delete')
    expect(pending[0]?.explicit).toBe(true)
    expect(pending[0]?.entityId).toBe('e2')
    expect(pending[0]?.baselineEntity).toEqual(e2)

    const local = { ...remote, employees: remote.employees.filter((e) => e.id !== 'e2') }
    const { store, conflicts, completedDeleteOperationIds } = conservativeMergeForSave(
      remote,
      remote,
      local,
      pending,
    )
    expect(conflicts).toHaveLength(0)
    expect(completedDeleteOperationIds).toContain(pending[0]!.operationId)
    expect(store.employees.some((e) => e.id === 'e2')).toBe(false)
    expect(store.employees.some((e) => e.id === 'e1')).toBe(true)
  })

  it('remote field change blocks delete and preserves remote', () => {
    const baseline = baseStore()
    const e2 = baseline.employees.find((e) => e.id === 'e2')!
    const remote = {
      ...baseline,
      employees: baseline.employees.map((e) =>
        e.id === 'e2' ? { ...e, fullName: 'Bob Cloud Edited' } : e,
      ),
    }
    const local = { ...baseline, employees: baseline.employees.filter((e) => e.id !== 'e2') }
    const deleteOp = {
      operationId: 'op-del-e2',
      type: 'delete' as const,
      domain: 'employees',
      entityId: 'e2',
      fields: ['*'],
      baseRevision: 3,
      origin: 'user' as const,
      at: new Date().toISOString(),
      explicit: true,
      baselineEntity: e2,
      baselineFingerprint: JSON.stringify(e2),
    }
    const { store, conflicts, completedDeleteOperationIds } = conservativeMergeForSave(
      baseline,
      remote,
      local,
      [deleteOp],
    )
    expect(completedDeleteOperationIds).not.toContain('op-del-e2')
    expect(conflicts.some((c) => c.entityId === 'e2' && c.reason === 'concurrent_edit')).toBe(true)
    expect(store.employees.find((e) => e.id === 'e2')?.fullName).toBe('Bob Cloud Edited')
  })

  it('old tab cannot delete entity created later in cloud', () => {
    const baseline = baseStore()
    const remote = {
      ...baseline,
      employees: [
        ...baseline.employees,
        { id: 'e9', fullName: 'New Hire', active: true, schedule: '5/2 8ч', shiftMode: 'day' },
      ],
    }
    const local = baseStore()
    const deleteOp = {
      operationId: nextOperationId(),
      type: 'delete' as const,
      domain: 'employees',
      entityId: 'e9',
      fields: ['*'],
      baseRevision: 3,
      origin: 'user' as const,
      at: new Date().toISOString(),
      explicit: true,
    }
    const { store, conflicts } = conservativeMergeForSave(baseline, remote, local, [deleteOp])
    expect(conflicts.length).toBeGreaterThan(0)
    expect(store.employees.some((e) => e.id === 'e9')).toBe(true)
  })
})

describe('bulk preview fail-closed', () => {
  it('import preview blocks autosave and shows message; clear restores', () => {
    setSyncLifecyclePhase('ready')
    beginBulkStoreOverwrite('import', { employees: 2 })
    expect(isBulkOverwriteBlockingAutosave()).toBe(true)
    expect(getBulkPreviewUserMessage()).toMatch(/предварительном просмотре/)
    expect(canCloudWriteNow(true).ok).toBe(false)
    clearBulkStoreOverwrite()
    expect(isBulkOverwriteBlockingAutosave()).toBe(false)
    expect(canCloudWriteNow(true).ok).toBe(true)
  })

  it('bulk snapshot must not ride ordinary user save', () => {
    setSyncLifecyclePhase('ready')
    beginBulkStoreOverwrite('import')
    const build = buildCloudSavePayload({
      remote: baseStore(),
      remoteRevision: 1,
      local: baseStore(),
      baseline: baseStore(),
      operations: [
        {
          operationId: 'op1',
          type: 'update',
          domain: 'settings',
          entityId: 'settings',
          fields: ['*'],
          baseRevision: 1,
          origin: 'user',
          at: new Date().toISOString(),
        },
      ],
    })
    expect(build.allowed).toBe(false)
    expect(build.reason).toBe('bulk_overwrite_preview')
  })
})

describe('two clients', () => {
  it('different entities merge without conflict', () => {
    const baseline = baseStore()
    const remote = {
      ...baseline,
      employees: baseline.employees.map((e) =>
        e.id === 'e1' ? { ...e, fullName: 'Alice Remote' } : e,
      ),
    }
    const local = {
      ...baseline,
      employees: baseline.employees.map((e) =>
        e.id === 'e2' ? { ...e, fullName: 'Bob Local' } : e,
      ),
    }
    const { store, conflicts } = conservativeMergeForSave(baseline, remote, local, [])
    expect(conflicts).toHaveLength(0)
    expect(store.employees.find((e) => e.id === 'e1')?.fullName).toBe('Alice Remote')
    expect(store.employees.find((e) => e.id === 'e2')?.fullName).toBe('Bob Local')
  })

  it('same field concurrent edit conflicts and keeps cloud', () => {
    const baseline = baseStore()
    const remote = {
      ...baseline,
      employees: baseline.employees.map((e) =>
        e.id === 'e1' ? { ...e, fullName: 'Alice R' } : e,
      ),
    }
    const local = {
      ...baseline,
      employees: baseline.employees.map((e) =>
        e.id === 'e1' ? { ...e, fullName: 'Alice L' } : e,
      ),
    }
    const { store, conflicts } = conservativeMergeForSave(baseline, remote, local, [])
    expect(conflicts).toHaveLength(1)
    expect(store.employees.find((e) => e.id === 'e1')?.fullName).toBe('Alice R')
  })
})

describe('persistent domain coverage — never silent no-save', () => {
  const USER_EDITABLE = APP_STORE_PERSISTENT_DOMAINS.filter((d) => d !== 'version')

  it.each(USER_EDITABLE)('domain %s: fine-grained or conservative save or explicit conflict', (domain) => {
    setSyncLifecyclePhase('ready')
    noteCloudPullCompleted(1)
    const baseline = baseStore()
    const remote = baseline
    const local = structuredClone(baseline) as AppStore
    const bag = local as Record<string, unknown>

    // Mutate domain in a domain-specific way
    if (domain === 'employees') {
      bag.employees = [
        ...(local.employees ?? []),
        { id: 'e-new', fullName: 'New', active: true, schedule: '5/2 8ч', shiftMode: 'day' },
      ]
    } else if (domain === 'candidates') {
      bag.candidates = [...(local.candidates ?? []), { id: 'c-new', fullName: 'Cand' }]
    } else if (domain === 'shiftTemplates') {
      bag.shiftTemplates = [...(local.shiftTemplates ?? []), { id: 'st-new', name: 'T' }]
    } else if (domain === 'hrStructuralUnits') {
      bag.hrStructuralUnits = [...(local.hrStructuralUnits ?? []), { id: 'su-new', name: 'Unit' }]
    } else if (domain === 'hrPositions') {
      bag.hrPositions = [...(local.hrPositions ?? []), { id: 'hp-new', title: 'Pos' }]
    } else if (domain === 'settings') {
      bag.settings = { ...local.settings, _testMark: true }
    } else if (domain === 'months') {
      bag.months = {
        ...local.months,
        '2026-09': { ...local.months['2026-09'], note: 'edited' },
      }
    } else if (domain === 'brigades') {
      bag.brigades = [...(local.brigades ?? []), 'B']
    } else if (domain === 'externalEffects') {
      bag.externalEffects = {
        outbox: [
          {
            id: 'op-test',
            operationId: 'op-test',
            kind: 'auth-user-delete',
            targetId: 'x@test.net',
            relatedDomain: 'access.users',
            relatedEntityId: 'u1',
            status: 'pending',
            step: 'await_initial_sql',
            requestedAt: new Date().toISOString(),
            attempts: 0,
          },
        ],
      }
    } else if (Array.isArray(bag[domain])) {
      bag[domain] = [...(bag[domain] as unknown[]), { id: `${domain}-new`, __edited: true }]
    } else if (typeof bag[domain] === 'object' && bag[domain] !== null) {
      bag[domain] = { ...(bag[domain] as object), __edited: true }
    } else {
      bag[domain] = { __edited: true }
    }

    const ops = diffStoreToOperations(baseline, local, 1, 'user')
    expect(ops.length).toBeGreaterThan(0)
    expect(ops.every((op) => op.type !== 'delete')).toBe(true)

    const build = buildCloudSavePayload({
      remote,
      remoteRevision: 1,
      local,
      baseline,
      operations: ops,
    })
    expect(build.allowed).toBe(true)
    const outcome =
      build.conflicts.length > 0
        ? 'explicit conflict'
        : build.changedDomains.some((d) => d === domain || d.startsWith(`${domain}.`))
          ? 'fine-grained/conservative save'
          : build.changedDomains.length > 0
            ? 'conservative save'
            : 'silent no-save'
    expect(outcome).not.toBe('silent no-save')
  })
})

describe('gates: lifecycle, pagehide, first open', () => {
  it('blocks write until ready', () => {
    setSyncLifecyclePhase('hydrating')
    expect(isCloudWriteLifecycleReady()).toBe(false)
    expect(canCloudWriteNow(true).ok).toBe(false)
    setSyncLifecyclePhase('ready')
    expect(canCloudWriteNow(true).ok).toBe(true)
  })

  it('pagehide-style: no pending user ops => no save', () => {
    setSyncLifecyclePhase('ready')
    expect(canCloudWriteNow(false).ok).toBe(false)
  })

  it('first open after deploy without user action does not write', () => {
    setSyncLifecyclePhase('ready')
    const remote = baseStore()
    const after = ensureMonthReady(remote, '2026-09')
    applyTrackedStoreUpdate(remote, after, 'system')
    expect(cloudDirtyTracker.hasPendingUserOperations()).toBe(false)
    expect(
      buildCloudSavePayload({
        remote,
        remoteRevision: 7,
        local: after,
        baseline: remote,
        operations: [],
      }).allowed,
    ).toBe(false)
  })

  it('needs pull when stale', () => {
    expect(needsPullBeforeWrite()).toBe(true)
    noteCloudPullCompleted(1)
    expect(needsPullBeforeWrite()).toBe(false)
  })
})

describe('ensureMonthReady post-hydration safety', () => {
  it('additive for remote employees', () => {
    const remote = baseStore()
    const after = ensureMonthReady(remote, '2026-09')
    expect(ensureMonthReadyIsAdditiveForRemote(remote, after)).toBe(true)
    expect(typeof ensureMonthReadyChangesFingerprint(remote, after)).toBe('boolean')
  })
})
