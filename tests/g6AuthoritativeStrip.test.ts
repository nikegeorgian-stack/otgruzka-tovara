/**
 * PHASE G6 — client authoritative strip: when capacityPlanning is active,
 * forged capacity / dayPlan dirty ops must not push into UpdateFstStore.
 */
import { describe, expect, it } from 'vitest'
import type { AppStore } from '@/lib/types'
import type { DirtyOperation } from '@/lib/cloud/dirtyOperations'
import {
  filterG6AuthoritativeDirtyOps,
  isG6AuthoritativeDomain,
  readCapacityFromStore,
  restoreG6AuthoritativeDomains,
  withCapacityOnStore,
} from '@/lib/cloud/g6AuthoritativeStrip'
import { g6FlagsFromStore, withG6ActivationOnStore } from '@/lib/planner/g6Activation'

function baseStore(): AppStore {
  return {
    production: {
      orders: [],
      shiftReports: [],
    },
    warehouse: {},
  } as unknown as AppStore
}

function op(domain: string): DirtyOperation {
  return {
    operationId: `op-${domain}`,
    type: 'update',
    domain,
    entityId: 'x',
    fields: ['*'],
    baseRevision: 0,
    origin: 'user',
    at: '2026-09-04T00:00:00.000Z',
  }
}

describe('G6 authoritative strip', () => {
  it('inactive: capacity dirty ops pass through', () => {
    const store = baseStore()
    expect(g6FlagsFromStore(store).capacityPlanningActive).toBe(false)
    const ops: DirtyOperation[] = [op('capacity'), op('employees')]
    expect(filterG6AuthoritativeDirtyOps(ops, store)).toEqual(ops)
  })

  it('active: strips capacity + dayPlan domains; keeps sibling domains', () => {
    let store = withG6ActivationOnStore(baseStore(), { capacityPlanningActive: true })
    store = withCapacityOnStore(store, {
      norms: [{ normId: 'remote-n1', status: 'approved' }],
      calendars: [],
      downtimes: [],
      runs: [],
      schedules: [],
      auditLog: [],
    })
    expect(g6FlagsFromStore(store).capacityPlanningActive).toBe(true)
    expect(isG6AuthoritativeDomain('capacity', g6FlagsFromStore(store))).toBe(true)
    expect(isG6AuthoritativeDomain('capacity.norms', g6FlagsFromStore(store))).toBe(true)
    expect(isG6AuthoritativeDomain('production.dayPlans', g6FlagsFromStore(store))).toBe(true)
    expect(isG6AuthoritativeDomain('sales', g6FlagsFromStore(store))).toBe(false)

    const ops: DirtyOperation[] = [
      op('capacity'),
      op('capacity.norms'),
      op('dayPlans'),
      op('production.lineSchedules'),
      op('warehouse'),
      op('sales'),
    ]
    const filtered = filterG6AuthoritativeDirtyOps(ops, store)
    expect(filtered.map((o) => o.domain)).toEqual(['warehouse', 'sales'])
  })

  it('restoreG6AuthoritativeDomains prefers remote capacity over forged merge', () => {
    const remote = withCapacityOnStore(
      withG6ActivationOnStore(baseStore(), { capacityPlanningActive: true }),
      { norms: [{ normId: 'server' }], calendars: [{ id: 'c1' }], downtimes: [], runs: [], schedules: [], auditLog: [] },
    )
    const merged = withCapacityOnStore(
      withG6ActivationOnStore(baseStore(), { capacityPlanningActive: true }),
      { norms: [{ normId: 'client-forged' }], calendars: [], downtimes: [], runs: [], schedules: [], auditLog: [] },
    )
    const restored = restoreG6AuthoritativeDomains(remote, merged)
    const cap = readCapacityFromStore(restored)
    expect(cap?.norms?.[0]).toEqual({ normId: 'server' })
    expect((restored.production as unknown as { g6CapacityPlanningActive?: boolean }).g6CapacityPlanningActive).toBe(
      true,
    )
  })
})
