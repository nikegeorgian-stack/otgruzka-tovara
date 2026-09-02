import { describe, expect, it, beforeEach } from 'vitest'
import type { AppStore } from '@/lib/types'
import { buildCloudSavePayload } from '@/lib/cloud/cloudSavePipeline'
import { conservativeMergeForSave } from '@/lib/cloud/conservativeMerge'
import {
  cloudDirtyTracker,
  entityFingerprint,
  nextOperationId,
  resetCloudDirtyTracker,
  type DirtyOperation,
} from '@/lib/cloud/dirtyOperations'
import { STABLE_ID_COLLECTION_PATHS, getPathValue } from '@/lib/cloud/stableIdPaths'
import {
  isCloudWriteLifecycleReady,
  noteCloudPullCompleted,
  resetSyncLifecycle,
  setSyncLifecyclePhase,
} from '@/lib/cloud/syncLifecycle'
import { createHrSlice } from '@/store/slices/hrSlice'
import type { StoreSliceDeps } from '@/store/storeApi'

function emptyBase(): AppStore {
  return {
    version: 6,
    employees: [
      { id: 'e1', fullName: 'Alice', active: true, schedule: '5/2 8ч', shiftMode: 'day' },
      { id: 'e2', fullName: 'Bob', active: true, schedule: '5/2 8ч', shiftMode: 'day' },
    ],
    months: { '2026-09': { year: 2026, month: 9, rows: [], plan: {}, fact: {} } },
    brigades: [],
    access: {
      users: [{ id: 'u1', login: 'a@t.l', roleId: 'sysadmin', active: true, displayName: 'A' }],
      roles: [],
      userGroups: [{ id: 'g1', name: 'G', userIds: [] }],
    },
    auditLog: [],
    settings: { signatures: {} },
    candidates: [{ id: 'c1', fullName: 'Cand' }],
    warehouse: {
      items: [{ id: 'w1', name: 'Item', unit: 'kg' }],
      documents: [],
      movements: [],
      categories: [{ id: 'wc1', name: 'Cat' }],
      locations: [{ id: 'wl1', name: 'Loc' }],
      loadingShipments: [],
      auditLog: [],
    },
    sales: { orders: [{ id: 'so1', customer: 'C', lines: [], history: [] }], reservations: [], allocations: [] },
    procurement: {
      orders: [{ id: 'po1', lines: [], milestones: [], legs: [] }],
      categories: [{ id: 'pc1', name: 'PC' }],
      routePoints: [{ id: 'rp1', name: 'RP' }],
    },
    tasks: { boards: [], columns: [], tasks: [{ id: 't1', title: 'T', boardId: 'b', columnId: 'c' }], attachments: [{ id: 'ta1', taskId: 't1', fileName: 'f.pdf', uploadedAt: '2026-01-01' }] },
    production: {
      requests: [{ id: 'pr1', productName: 'P', qty: 1, status: 'draft', createdAt: '2026-01-01' }],
      planner: { orders: [{ id: 'po-pl1', productName: 'P', qty: 1, status: 'draft' }] },
    },
    finance: {
      advances: [{ id: 'fa1', employeeId: 'e1', month: '2026-09', date: '2026-09-01', amount: 100 }],
      adjustments: [{ id: 'fj1', employeeId: 'e1', month: '2026-09', date: '2026-09-01', kind: 'bonus', amount: 50, reason: 'r' }],
      payouts: [{ id: 'fp1', employeeId: 'e1', month: '2026-09', date: '2026-09-01', amount: 200, method: 'cash' }],
      advanceDocuments: [{ id: 'fad1', number: 'AV-1', month: '2026-09', date: '2026-09-01', method: 'cash', status: 'draft', lines: [] }],
      payoutDocuments: [{ id: 'fpd1', number: 'VP-1', month: '2026-09', date: '2026-09-01', method: 'cash', status: 'draft', lines: [] }],
      advanceAccruals: [{ id: 'faa1', number: 'NA-1', month: '2026-09', status: 'draft', lines: [] }],
    },
    otc: {
      norms: [{ id: 'on1', name: 'N' }],
      labTests: [{ id: 'ol1', name: 'L' }],
      alkaliSeries: [{ id: 'oa1', name: 'A' }],
      sorting: [{ id: 'os1', name: 'S' }],
      defects: [{ id: 'od1', name: 'D' }],
    },
    technologistQc: {
      eadCalculations: [{ id: 'te1', date: '2026-01-01' }],
      eadControls: [{ id: 'tc1', date: '2026-01-01' }],
      incomingControls: [{ id: 'ti1', date: '2026-01-01' }],
      impregnationQc: [{ id: 'tp1', date: '2026-01-01' }],
      roomClimateLog: [{ id: 'tr1', date: '2026-01-01' }],
      shiftHandoffs: [{ id: 'ts1', date: '2026-01-01' }],
    },
    workwear: { issuances: [{ id: 'wi1', employeeId: 'e1', itemId: 'x', qty: 1, issuedAt: '2026-01-01' }] },
    itOffice: {
      assets: [{ id: 'ia1', name: 'PC', category: 'hw', status: 'active' }],
      acts: [{ id: 'iact1', status: 'draft', lines: [], createdAt: '2026-01-01' }],
      maintenance: [{ id: 'im1', assetId: 'ia1', date: '2026-01-01', kind: 'repair' }],
    },
    engineerLog: { entries: [{ id: 'el1', date: '2026-01-01', text: 'x' }] },
    wastewater: { cubes: [{ id: 'ww1', number: 1, status: 'empty', createdAt: '2026-01-01' }] },
    orgChart: { nodes: [{ id: 'oc1', nameFull: 'CEO', nameShort: 'CEO', layoutX: 100, layoutY: 100 }] },
    counterparties: { items: [{ id: 'cp1', name: 'CP', kind: 'customer' }] },
    finishedProducts: { items: [{ id: 'fp-item1', name: 'FP' }] },
    packagingRecipes: { items: [{ id: 'pk1', name: 'PK' }], boxes: [{ id: 'bx1', name: 'BX' }] },
    formulations: { recipes: [{ id: 'fr1', name: 'FR', lines: [] }] },
    trash: {
      employees: [{ deletedAt: '2026-01-01T00:00:00.000Z', employee: { id: 'te', fullName: 'T', active: false, schedule: '5/2 8ч', shiftMode: 'day' } }],
      months: [],
      candidates: [{ deletedAt: '2026-01-02T00:00:00.000Z', candidate: { id: 'tc', fullName: 'TC' } }],
    },
    shiftTemplates: [{ id: 'st1', name: 'Tpl' }],
    hrStructuralUnits: [{ id: 'su1', name: 'Unit' }],
    hrPositions: [{ id: 'hp1', title: 'Pos' }],
    protocols: {},
    meals: {},
    nightShifts: {},
    timesheetEntries: {},
    attendance: {},
  } as unknown as AppStore
}

function entityIdAt(path: string, store: AppStore): string | null {
  const arr = getPathValue(store, path)
  if (!Array.isArray(arr) || !arr.length) return null
  const first = arr[0] as Record<string, unknown>
  if (path.startsWith('trash.')) return String(first.deletedAt ?? '')
  return typeof first.id === 'string' ? first.id : null
}

function mutateEntityField(entity: Record<string, unknown>, path: string): Record<string, unknown> {
  if (path.startsWith('trash.')) {
    return { ...entity, __cloudMark: true }
  }
  if ('fullName' in entity) return { ...entity, fullName: `${String(entity.fullName)} Cloud` }
  if ('name' in entity) return { ...entity, name: `${String(entity.name)} Cloud` }
  if ('title' in entity) return { ...entity, title: `${String(entity.title)} Cloud` }
  if ('customer' in entity) return { ...entity, customer: `${String(entity.customer)} Cloud` }
  return { ...entity, __cloudMark: true }
}

function setPathArray(store: AppStore, path: string, arr: unknown[]): AppStore {
  const next = structuredClone(store) as AppStore
  const parts = path.split('.')
  let cur: Record<string, unknown> = next as unknown as Record<string, unknown>
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!
    cur[p] = { ...(cur[p] as object) }
    cur = cur[p] as Record<string, unknown>
  }
  cur[parts[parts.length - 1]!] = arr
  return next
}

function makeDeleteOp(
  domain: string,
  entityId: string,
  baselineEntity: unknown,
): DirtyOperation {
  return {
    operationId: nextOperationId(),
    type: 'delete',
    domain,
    entityId,
    fields: ['*'],
    baseRevision: 5,
    origin: 'user',
    at: new Date().toISOString(),
    explicit: true,
    baselineEntity,
    baselineFingerprint: entityFingerprint(baselineEntity),
  }
}

const PATHS_WITH_ENTITY = STABLE_ID_COLLECTION_PATHS.filter((path) => {
  const id = entityIdAt(path, emptyBase())
  return !!id
})

beforeEach(() => {
  resetCloudDirtyTracker()
  resetSyncLifecycle()
  cloudDirtyTracker.setBaseRevision(5)
  setSyncLifecyclePhase('ready')
  noteCloudPullCompleted(5)
})

describe('parametrized explicit delete conflicts over stableIdPaths', () => {
  it('registry is non-empty and includes trash paths', () => {
    expect(STABLE_ID_COLLECTION_PATHS.length).toBeGreaterThan(10)
    expect(STABLE_ID_COLLECTION_PATHS).toContain('trash.employees')
    expect(PATHS_WITH_ENTITY.length).toBeGreaterThan(10)
  })

  it.each(PATHS_WITH_ENTITY)('%s: unchanged remote → delete success', (path) => {
    const baseline = emptyBase()
    const entityId = entityIdAt(path, baseline)!
    const arr = getPathValue(baseline, path) as Record<string, unknown>[]
    const entity = arr.find((x) =>
      path.startsWith('trash.') ? x.deletedAt === entityId : x.id === entityId,
    )!
    const localArr = arr.filter((x) =>
      path.startsWith('trash.') ? x.deletedAt !== entityId : x.id !== entityId,
    )
    const local = setPathArray(baseline, path, localArr)
    const op = makeDeleteOp(path, entityId, entity)
    const { store, conflicts, completedDeleteOperationIds } = conservativeMergeForSave(
      baseline,
      baseline,
      local,
      [op],
    )
    expect(conflicts.filter((c) => c.domain === path && c.entityId === entityId)).toHaveLength(0)
    expect(completedDeleteOperationIds).toContain(op.operationId)
    const out = getPathValue(store, path) as Record<string, unknown>[]
    expect(
      out.some((x) => (path.startsWith('trash.') ? x.deletedAt === entityId : x.id === entityId)),
    ).toBe(false)
  })

  it.each(PATHS_WITH_ENTITY)('%s: remote field changed → conflict, remote preserved', (path) => {
    const baseline = emptyBase()
    const entityId = entityIdAt(path, baseline)!
    const arr = getPathValue(baseline, path) as Record<string, unknown>[]
    const entity = arr.find((x) =>
      path.startsWith('trash.') ? x.deletedAt === entityId : x.id === entityId,
    )!
    const remoteArr = arr.map((x) => {
      const match = path.startsWith('trash.') ? x.deletedAt === entityId : x.id === entityId
      return match ? mutateEntityField(x, path) : x
    })
    const remote = setPathArray(baseline, path, remoteArr)
    const localArr = arr.filter((x) =>
      path.startsWith('trash.') ? x.deletedAt !== entityId : x.id !== entityId,
    )
    const local = setPathArray(baseline, path, localArr)
    const op = makeDeleteOp(path, entityId, entity)
    const { store, conflicts, completedDeleteOperationIds } = conservativeMergeForSave(
      baseline,
      remote,
      local,
      [op],
    )
    expect(completedDeleteOperationIds).not.toContain(op.operationId)
    expect(conflicts.some((c) => c.domain === path && c.entityId === entityId)).toBe(true)
    const out = getPathValue(store, path) as Record<string, unknown>[]
    const kept = out.find((x) =>
      path.startsWith('trash.') ? x.deletedAt === entityId : x.id === entityId,
    )
    expect(kept).toBeTruthy()
    expect(entityFingerprint(kept)).toBe(entityFingerprint(remoteArr.find((x) =>
      path.startsWith('trash.') ? x.deletedAt === entityId : x.id === entityId,
    )))
  })

  it.each(PATHS_WITH_ENTITY)('%s: remote already absent → idempotent success', (path) => {
    const baseline = emptyBase()
    const entityId = entityIdAt(path, baseline)!
    const arr = getPathValue(baseline, path) as Record<string, unknown>[]
    const entity = arr.find((x) =>
      path.startsWith('trash.') ? x.deletedAt === entityId : x.id === entityId,
    )!
    const without = arr.filter((x) =>
      path.startsWith('trash.') ? x.deletedAt !== entityId : x.id !== entityId,
    )
    const remote = setPathArray(baseline, path, without)
    const local = setPathArray(baseline, path, without)
    const op = makeDeleteOp(path, entityId, entity)
    const { conflicts, completedDeleteOperationIds } = conservativeMergeForSave(
      baseline,
      remote,
      local,
      [op],
    )
    expect(conflicts.filter((c) => c.entityId === entityId)).toHaveLength(0)
    expect(completedDeleteOperationIds).toContain(op.operationId)
  })

  it.each(PATHS_WITH_ENTITY)('%s: unrelated remote entity changed → targeted delete allowed', (path) => {
    const baseline = emptyBase()
    const arr = getPathValue(baseline, path) as Record<string, unknown>[]
    if (arr.length < 1) return
    const entityId = entityIdAt(path, baseline)!
    const entity = arr.find((x) =>
      path.startsWith('trash.') ? x.deletedAt === entityId : x.id === entityId,
    )!
    // Change a different domain
    const remote = {
      ...baseline,
      settings: { ...baseline.settings, __other: true },
    }
    const localArr = arr.filter((x) =>
      path.startsWith('trash.') ? x.deletedAt !== entityId : x.id !== entityId,
    )
    const local = setPathArray(baseline, path, localArr)
    const op = makeDeleteOp(path, entityId, entity)
    const { store, conflicts, completedDeleteOperationIds } = conservativeMergeForSave(
      baseline,
      remote,
      local,
      [op],
    )
    expect(conflicts.filter((c) => c.domain === path && c.entityId === entityId)).toHaveLength(0)
    expect(completedDeleteOperationIds).toContain(op.operationId)
    const out = getPathValue(store, path) as Record<string, unknown>[]
    expect(
      out.some((x) => (path.startsWith('trash.') ? x.deletedAt === entityId : x.id === entityId)),
    ).toBe(false)
  })

  it.each(PATHS_WITH_ENTITY)('%s: new remote entity is not deleted by stale delete', (path) => {
    const baseline = emptyBase()
    const newId = path.startsWith('trash.') ? '2099-01-01T00:00:00.000Z' : 'brand-new-id'
    const arr = getPathValue(baseline, path) as Record<string, unknown>[]
    const seed = arr[0] ? { ...arr[0] } : { id: newId }
    const newbie = path.startsWith('trash.')
      ? { ...seed, deletedAt: newId }
      : { ...seed, id: newId }
    const remote = setPathArray(baseline, path, [...arr, newbie])
    const op = makeDeleteOp(path, newId, undefined)
    const { store, conflicts, completedDeleteOperationIds } = conservativeMergeForSave(
      baseline,
      remote,
      baseline,
      [op],
    )
    expect(completedDeleteOperationIds).not.toContain(op.operationId)
    expect(conflicts.some((c) => c.entityId === newId)).toBe(true)
    const out = getPathValue(store, path) as Record<string, unknown>[]
    expect(
      out.some((x) => (path.startsWith('trash.') ? x.deletedAt === newId : x.id === newId)),
    ).toBe(true)
  })
})

describe('pending delete retention / accept / retry', () => {
  it('conflict keeps pending delete after pull-style revision bump', () => {
    const baseline = emptyBase()
    const e2 = baseline.employees.find((e) => e.id === 'e2')!
    const remote = {
      ...baseline,
      employees: baseline.employees.map((e) =>
        e.id === 'e2' ? { ...e, fullName: 'Bob Remote' } : e,
      ),
    }
    const local = { ...baseline, employees: baseline.employees.filter((e) => e.id !== 'e2') }
    const op = makeDeleteOp('employees', 'e2', e2)
    cloudDirtyTracker.enqueue([op])
    const { conflicts, completedDeleteOperationIds } = conservativeMergeForSave(
      baseline,
      remote,
      local,
      cloudDirtyTracker.getPending(),
    )
    expect(completedDeleteOperationIds).not.toContain(op.operationId)
    expect(conflicts.length).toBeGreaterThan(0)
    cloudDirtyTracker.setConflicts(conflicts)
    cloudDirtyTracker.setBaseRevision(9)
    expect(cloudDirtyTracker.getPending()).toHaveLength(1)
    expect(cloudDirtyTracker.getPending()[0]?.operationId).toBe(op.operationId)
  })

  it('accept remote cancels only conflicting pending delete', () => {
    const e2 = emptyBase().employees.find((e) => e.id === 'e2')!
    const delConflict = makeDeleteOp('employees', 'e2', e2)
    const delOther = makeDeleteOp('candidates', 'c1', emptyBase().candidates[0])
    cloudDirtyTracker.enqueue([delConflict, delOther])
    cloudDirtyTracker.setConflicts([
      {
        operationId: delConflict.operationId,
        domain: 'employees',
        entityId: 'e2',
        reason: 'concurrent_edit',
        message: 'conflict',
      },
    ])
    const dropped = cloudDirtyTracker.discardConflictingPending()
    expect(dropped).toContain(delConflict.operationId)
    expect(cloudDirtyTracker.getPending().map((p) => p.operationId)).toEqual([delOther.operationId])
  })

  it('retry without resolving conflict does not delete newer remote', () => {
    const baseline = emptyBase()
    const e2 = baseline.employees.find((e) => e.id === 'e2')!
    const remote = {
      ...baseline,
      employees: baseline.employees.map((e) =>
        e.id === 'e2' ? { ...e, fullName: 'Bob Newer' } : e,
      ),
    }
    const local = { ...baseline, employees: baseline.employees.filter((e) => e.id !== 'e2') }
    const op = makeDeleteOp('employees', 'e2', e2)
    cloudDirtyTracker.enqueue([op])
    const first = buildCloudSavePayload({
      remote,
      remoteRevision: 5,
      local,
      baseline,
      operations: cloudDirtyTracker.getPending(),
    })
    expect(first.store?.employees.find((e) => e.id === 'e2')?.fullName).toBe('Bob Newer')
    expect(first.appliedOperationIds).not.toContain(op.operationId)
    expect(first.conflicts.some((c) => c.entityId === 'e2')).toBe(true)

    const retry = buildCloudSavePayload({
      remote,
      remoteRevision: 5,
      local,
      baseline,
      operations: cloudDirtyTracker.getPending(),
    })
    expect(retry.store?.employees.find((e) => e.id === 'e2')?.fullName).toBe('Bob Newer')
    expect(retry.appliedOperationIds).not.toContain(op.operationId)
  })

  it('real slice removeEmployee + remote edit → conflict preserves remote', () => {
    let store = emptyBase()
    cloudDirtyTracker.setBaselineStore(store)
    const deps: StoreSliceDeps = {
      setStore: (fn) => {
        store = typeof fn === 'function' ? fn(store) : fn
      },
      getStore: () => store,
      getActor: () => ({ id: 'a1', name: 'A', roleId: 'sysadmin' }),
    }
    createHrSlice(deps).removeEmployee('e2')
    const pending = cloudDirtyTracker.getPending()
    expect(pending).toHaveLength(1)
    expect(pending[0]?.baselineEntity).toBeTruthy()

    const remote = {
      ...emptyBase(),
      employees: emptyBase().employees.map((e) =>
        e.id === 'e2' ? { ...e, fullName: 'Bob From Cloud' } : e,
      ),
    }
    const { store: merged, conflicts, completedDeleteOperationIds } = conservativeMergeForSave(
      emptyBase(),
      remote,
      store,
      pending,
    )
    expect(completedDeleteOperationIds).toHaveLength(0)
    expect(conflicts.some((c) => c.entityId === 'e2')).toBe(true)
    expect(merged.employees.find((e) => e.id === 'e2')?.fullName).toBe('Bob From Cloud')
  })
})

describe('lifecycle gate sanity', () => {
  it('ready lifecycle', () => {
    expect(isCloudWriteLifecycleReady()).toBe(true)
  })
})
