import type { AppStore } from '@/lib/types'
import type { DirtyOperation } from './dirtyOperations'
import { g6FlagsFromStore } from '@/lib/planner/g6Activation'

/** Domains owned by G6 after capacityPlanning activation — must not be forged via UpdateFstStore. */
const G6_CAPACITY_DOMAINS = new Set([
  'capacity',
  'capacity.norms',
  'capacity.calendars',
  'capacity.downtimes',
  'capacity.runs',
  'capacity.schedules',
  'capacity.auditLog',
])

/** Legacy day-plan capacity sources that must not overwrite critical capacity truth. */
const G6_DAYPLAN_CAPACITY_DOMAINS = new Set([
  'dayPlans',
  'production.dayPlans',
  'production.lineSchedules',
  'lineSchedules',
  'planning.legacyDayPlans',
])

export type G6CapacityDomain = {
  norms?: unknown[]
  calendars?: unknown[]
  downtimes?: unknown[]
  runs?: unknown[]
  schedules?: unknown[]
  auditLog?: unknown[]
  [key: string]: unknown
}

export function readCapacityFromStore(store: AppStore | null | undefined): G6CapacityDomain | null {
  if (!store) return null
  const top = (store as unknown as { capacity?: G6CapacityDomain }).capacity
  if (top && typeof top === 'object') return top
  const fromProduction = (store.production as unknown as { capacity?: G6CapacityDomain })?.capacity
  if (fromProduction && typeof fromProduction === 'object') return fromProduction
  return null
}

export function withCapacityOnStore(store: AppStore, capacity: G6CapacityDomain | null | undefined): AppStore {
  if (!capacity || typeof capacity !== 'object') return store
  return {
    ...store,
    capacity,
    production: {
      ...store.production,
      capacity,
    },
  } as AppStore
}

export function isG6AuthoritativeDomain(
  domain: string,
  flags: ReturnType<typeof g6FlagsFromStore>,
): boolean {
  if (!flags.capacityPlanningActive) return false
  if (G6_CAPACITY_DOMAINS.has(domain)) return true
  if (G6_DAYPLAN_CAPACITY_DOMAINS.has(domain)) return true
  if (domain.startsWith('capacity.')) return true
  return false
}

/** Drop dirty ops that would push forged G6 capacity / dayPlan capacity writes into UpdateFstStore. */
export function filterG6AuthoritativeDirtyOps(
  ops: DirtyOperation[],
  store: AppStore,
): DirtyOperation[] {
  const flags = g6FlagsFromStore(store)
  if (!flags.capacityPlanningActive) return ops
  return ops.filter((op) => !isG6AuthoritativeDomain(op.domain, flags))
}

/**
 * After merge, restore remote capacity domain (+ activation flags) so UpdateFstStore
 * cannot overwrite critical-store capacity truth with client-forged writes.
 */
export function restoreG6AuthoritativeDomains(remote: AppStore, merged: AppStore): AppStore {
  const flagsMerged = g6FlagsFromStore(merged)
  const flagsRemote = g6FlagsFromStore(remote)
  const capacityPlanningActive =
    flagsMerged.capacityPlanningActive || flagsRemote.capacityPlanningActive
  if (!capacityPlanningActive) return merged

  const remoteCapacity = readCapacityFromStore(remote)
  let next = merged
  if (remoteCapacity) {
    next = withCapacityOnStore(next, remoteCapacity)
  }

  const remoteProd = remote.production as unknown as Record<string, unknown>
  const mergedProd = next.production as unknown as Record<string, unknown>
  next = {
    ...next,
    production: {
      ...next.production,
      g6CapacityPlanningActive: true,
      criticalDomainMeta:
        mergedProd.criticalDomainMeta ?? remoteProd.criticalDomainMeta,
      capacity: remoteCapacity ?? (mergedProd.capacity as G6CapacityDomain | undefined),
    } as typeof next.production,
  }
  return next
}
