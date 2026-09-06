/**
 * R2.9 P0-A / P0-G — own writes must not raise domain_conflict; mixTasks persist.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import type { AppStore } from '@/lib/types'
import { conservativeMergeForSave } from '@/lib/cloud/conservativeMerge'
import {
  buildCloudSavePayload,
  mergeStoreForCloudSave,
} from '@/lib/cloud/cloudSavePipeline'
import { diffStoreToOperations } from '@/lib/cloud/storeDiff'
import {
  noteCloudPullCompleted,
  resetSyncLifecycle,
  setSyncLifecyclePhase,
} from '@/lib/cloud/syncLifecycle'
import { STABLE_ID_COLLECTION_PATHS } from '@/lib/cloud/stableIdPaths'

function baseStore(): AppStore {
  return {
    version: 6,
    employees: [],
    months: {},
    brigades: [],
    access: { users: [], roles: [] },
    auditLog: [],
    settings: { signatures: {} },
    candidates: [],
    warehouse: {
      items: [{ id: 'w1', name: 'LL-145-50', unit: 'kg' }],
      documents: [],
      movements: [],
      categories: [],
      locations: [{ id: 'loc1', name: 'Main' }],
    },
    sales: { orders: [], reservations: [], allocations: [] },
    procurement: {
      orders: [
        {
          id: 'po1',
          orderNumber: 'ЗЗ-2026-0003',
          status: 'arrived',
          lines: [],
          milestones: [],
        } as AppStore['procurement']['orders'][number],
      ],
      categories: [],
      routePoints: [],
    },
    tasks: { tasks: [], attachments: [] },
    production: { requests: [], planner: { orders: [], nextOrderSeq: 1 } },
    finance: {},
    meals: {},
    protocols: {},
    orgChart: {},
    finishedProducts: { items: [] },
    packagingRecipes: { items: [], boxes: [] },
    formulations: {
      recipes: [{ id: 'r1', code: 'РП-0004', name: 'TEST160-BLUE' } as never],
      recipeVersions: [],
      batchRuns: [],
      mixTasks: [],
    },
  } as AppStore
}

describe('R2.9 sync self-conflict foundation', () => {
  beforeEach(() => {
    resetSyncLifecycle()
    setSyncLifecyclePhase('ready')
    noteCloudPullCompleted(1)
  })

  it('includes formulations.mixTasks in stable-id paths', () => {
    expect(STABLE_ID_COLLECTION_PATHS).toContain('formulations.mixTasks')
  })

  it('does not raise domain_conflict when only warehouse documents diverge and merge cleanly', () => {
    const baseline = baseStore()
    const remote = {
      ...baseline,
      warehouse: {
        ...baseline.warehouse,
        documents: [
          {
            id: 'doc-remote',
            type: 'receipt',
            status: 'posted',
            number: 'П-1',
            date: '2026-09-05',
            lines: [],
          } as never,
        ],
      },
    }
    const local = {
      ...baseline,
      warehouse: {
        ...baseline.warehouse,
        documents: [
          {
            id: 'doc-local',
            type: 'receipt',
            status: 'posted',
            number: 'П-2',
            date: '2026-09-05',
            lines: [],
            source: 'procurement',
          } as never,
        ],
      },
    }

    const { store, conflicts } = conservativeMergeForSave(baseline, remote, local, [])
    expect(conflicts.filter((c) => c.reason === 'domain_conflict')).toHaveLength(0)
    const ids = (store.warehouse.documents ?? []).map((d) => d.id).sort()
    expect(ids).toEqual(['doc-local', 'doc-remote'])
  })

  it('keeps local mix task when remote also changed formulations recipes', () => {
    const baseline = baseStore()
    const remote = {
      ...baseline,
      formulations: {
        ...baseline.formulations,
        recipes: [
          {
            ...(baseline.formulations.recipes[0] as object),
            id: 'r1',
            code: 'РП-0004',
            name: 'TEST160-BLUE-REMOTE',
          } as never,
        ],
      },
    }
    const local = {
      ...baseline,
      formulations: {
        ...baseline.formulations,
        mixTasks: [
          {
            id: 'mt1',
            taskNumber: 'ЗД-20260905-001',
            status: 'open',
            plannedDate: '2026-09-05',
            recipeId: 'r1',
          } as never,
        ],
      },
    }

    const { store, conflicts } = conservativeMergeForSave(baseline, remote, local, [])
    expect(conflicts.filter((c) => c.domain === 'formulations' && c.reason === 'domain_conflict')).toHaveLength(
      0,
    )
    expect(store.formulations.mixTasks?.some((t) => t.id === 'mt1')).toBe(true)
    expect(store.formulations.recipes.find((r) => r.id === 'r1')?.name).toBe('TEST160-BLUE-REMOTE')
  })

  it('acknowledges dirty ops for warehouse receipt when remote has unrelated warehouse change', () => {
    const baseline = baseStore()
    const local = {
      ...baseline,
      warehouse: {
        ...baseline.warehouse,
        documents: [
          {
            id: 'doc-po',
            type: 'receipt',
            status: 'posted',
            number: 'П-TEST',
            date: '2026-09-05',
            lines: [{ itemId: 'w1', quantity: 18 }],
            source: 'procurement',
            purchaseOrderId: 'po1',
          } as never,
        ],
        movements: [
          {
            id: 'mov1',
            itemId: 'w1',
            quantity: 18,
            documentId: 'doc-po',
            date: '2026-09-05',
          } as never,
        ],
      },
      procurement: {
        ...baseline.procurement,
        orders: [
          {
            ...baseline.procurement.orders[0],
            status: 'received',
          } as never,
        ],
      },
    }
    const remote = {
      ...baseline,
      warehouse: {
        ...baseline.warehouse,
        auditLog: [{ id: 'a1', at: '2026-09-05T10:00:00Z', action: 'view' } as never],
      },
    }

    const ops = diffStoreToOperations(baseline, local, 1, 'user')
    expect(ops.length).toBeGreaterThan(0)

    const merged = mergeStoreForCloudSave({
      remote,
      local,
      baseline,
      operations: ops,
    })
    expect(merged.conflicts.filter((c) => c.reason === 'domain_conflict')).toHaveLength(0)
    expect(merged.appliedOperationIds.length).toBeGreaterThan(0)
    expect(merged.store.warehouse.documents.some((d) => d.id === 'doc-po')).toBe(true)

    const build = buildCloudSavePayload({
      remote,
      remoteRevision: 1,
      local,
      baseline,
      operations: ops,
    })
    expect(build.allowed).toBe(true)
    expect(build.conflicts.filter((c) => c.reason === 'domain_conflict')).toHaveLength(0)
    expect(build.appliedOperationIds.length).toBeGreaterThan(0)
  })
})
