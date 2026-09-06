/**
 * R2.9E — sticky access/* domain_conflict + pending access.users survival after Accept.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import type { AppStore } from '@/lib/types'
import type { AccessStore } from '@/lib/access/types'
import { acceptCloudScopedMerge } from '@/lib/cloud/acceptCloudScoped'
import { conservativeMergeForSave } from '@/lib/cloud/conservativeMerge'
import {
  cloudDirtyTracker,
  nextOperationId,
  resetCloudDirtyTracker,
  type DirtyOperation,
  type EntityConflict,
} from '@/lib/cloud/dirtyOperations'
import { STABLE_ID_COLLECTION_PATHS } from '@/lib/cloud/stableIdPaths'

function accessBase(extra: Partial<AccessStore> = {}): AccessStore {
  return {
    users: [
      {
        id: 'u-admin',
        login: 'admin',
        displayName: 'Admin',
        roleId: 'sysadmin',
        passwordHash: 'x',
        passwordSalt: 'y',
        active: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    roleViews: {
      sysadmin: ['settings', 'warehouse'],
      technologist: ['formulations'],
    } as AccessStore['roleViews'],
    ...extra,
  }
}

function baseStore(access: AccessStore = accessBase()): AppStore {
  return {
    version: 6,
    employees: [],
    months: {},
    brigades: [],
    access,
    auditLog: [],
    settings: { signatures: {} },
    candidates: [],
    warehouse: {
      items: [],
      documents: [],
      movements: [],
      categories: [],
      locations: [],
    },
    sales: { orders: [], reservations: [], allocations: [] },
    procurement: { orders: [], categories: [], routePoints: [] },
    tasks: { tasks: [], attachments: [] },
    production: { requests: [], planner: { orders: [], nextOrderSeq: 1 } },
    finance: {},
    meals: {},
    protocols: {},
    orgChart: {},
    finishedProducts: { items: [] },
    packagingRecipes: { items: [], boxes: [] },
    formulations: { recipes: [], recipeVersions: [], batchRuns: [], mixTasks: [] },
  } as AppStore
}

function userOp(domain: string, entityId: string): DirtyOperation {
  return {
    operationId: nextOperationId(),
    type: 'update',
    domain,
    entityId,
    fields: ['*'],
    baseRevision: 1,
    origin: 'user',
    at: new Date().toISOString(),
  }
}

describe('R2.9E access/* pending-operation conflict', () => {
  beforeEach(() => {
    resetCloudDirtyTracker()
  })

  it('lists workshopMasterCoverages as a stable access path', () => {
    expect(STABLE_ID_COLLECTION_PATHS).toContain('access.workshopMasterCoverages')
  })

  it('discardConflictingPending drops access.users::* when accepting access/*', () => {
    cloudDirtyTracker.setBaselineStore(baseStore())
    cloudDirtyTracker.setBaseRevision(1)
    const userPending = userOp('access.users', 'u-admin')
    const groupPending = userOp('access.userGroups', 'g1')
    const poPending = userOp('procurement.orders', 'po1')
    cloudDirtyTracker.enqueue([userPending, groupPending, poPending])
    cloudDirtyTracker.setConflicts([
      {
        domain: 'access',
        entityId: '*',
        reason: 'domain_conflict',
        message: 'Domain access changed on both sides; cloud kept',
      },
    ])

    const dropped = cloudDirtyTracker.discardConflictingPending()
    expect(dropped).toContain(userPending.operationId)
    expect(dropped).toContain(groupPending.operationId)
    expect(dropped).not.toContain(poPending.operationId)
    expect(cloudDirtyTracker.getPending().map((o) => o.operationId)).toEqual([
      poPending.operationId,
    ])
    expect(cloudDirtyTracker.getConflicts()).toEqual([])
  })

  it('Accept access/* + discard does not leave sticky access.users pending', () => {
    const baseline = baseStore()
    const remote = baseStore(
      accessBase({
        roleViews: {
          sysadmin: ['settings'],
          technologist: ['formulations', 'warehouse'],
        } as AccessStore['roleViews'],
      }),
    )
    const local = baseStore(
      accessBase({
        users: [
          ...accessBase().users,
          {
            id: 'u-local',
            login: 'local',
            displayName: 'Local',
            roleId: 'technologist',
            passwordHash: '',
            passwordSalt: '',
            active: true,
            createdAt: '2026-01-02T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
          },
        ],
        roleViews: {
          sysadmin: ['settings', 'warehouse', 'finance'],
          technologist: ['formulations'],
        } as AccessStore['roleViews'],
      }),
    )

    const conflicts: EntityConflict[] = [
      {
        domain: 'access',
        entityId: '*',
        reason: 'domain_conflict',
        message: 'Domain access changed on both sides; cloud kept',
        pendingLocal: local.access,
        cloudSnapshot: remote.access,
      },
    ]

    const accepted = acceptCloudScopedMerge(local, remote, conflicts)
    expect(accepted.ok).toBe(true)
    if (!accepted.ok) return
    expect(accepted.store.access.users.some((u) => u.id === 'u-local')).toBe(false)
    expect(accepted.store.access.roleViews.technologist).toEqual(['formulations', 'warehouse'])

    const pendingUser = userOp('access.users', 'u-local')
    cloudDirtyTracker.enqueue([pendingUser])
    cloudDirtyTracker.setConflicts(conflicts)
    const dropped = cloudDirtyTracker.discardConflictingPending()
    expect(dropped).toContain(pendingUser.operationId)
    expect(cloudDirtyTracker.getPending()).toEqual([])
  })

  it('conservativeMerge field-merges access maps instead of access/* domain_conflict', () => {
    const baseline = baseStore(
      accessBase({
        roleViews: {
          sysadmin: ['settings'],
          technologist: ['formulations'],
        } as AccessStore['roleViews'],
        roleAllowRecipeApproval: { technologist: false },
      }),
    )
    const remote = baseStore(
      accessBase({
        roleViews: {
          sysadmin: ['settings'],
          technologist: ['formulations', 'warehouse'],
        } as AccessStore['roleViews'],
        roleAllowRecipeApproval: { technologist: false },
      }),
    )
    const local = baseStore(
      accessBase({
        roleViews: {
          sysadmin: ['settings', 'finance'],
          technologist: ['formulations'],
        } as AccessStore['roleViews'],
        roleAllowRecipeApproval: { technologist: true },
      }),
    )

    const merged = conservativeMergeForSave(baseline, remote, local, [])
    expect(merged.conflicts.filter((c) => c.domain === 'access')).toEqual([])
    // local-only sysadmin finance kept; remote-only technologist warehouse kept
    expect(merged.store.access.roleViews.sysadmin).toEqual(['settings', 'finance'])
    expect(merged.store.access.roleViews.technologist).toEqual(['formulations', 'warehouse'])
    expect(merged.store.access.roleAllowRecipeApproval?.technologist).toBe(true)
  })
})
