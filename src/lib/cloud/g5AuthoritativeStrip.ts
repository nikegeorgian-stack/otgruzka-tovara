import type { AppStore } from '@/lib/types'
import type { DirtyOperation } from './dirtyOperations'
import { g5FlagsFromStore } from '@/lib/planner/g5Activation'

/** Domains owned by G5 after activation — must not be forged via UpdateFstStore. */
const G5_SALES_DOMAINS = new Set(['sales', 'sales.orders', 'sales.reservations', 'sales.allocations'])
const G5_PROCUREMENT_DOMAINS = new Set([
  'procurement',
  'procurement.orders',
  'procurement.categories',
  'procurement.routePoints',
])
const G5_MASTER_DOMAINS = new Set([
  'finishedProducts',
  'finishedProducts.items',
  'counterparties',
  'counterparties.items',
])

export function isG5AuthoritativeDomain(
  domain: string,
  flags: ReturnType<typeof g5FlagsFromStore>,
): boolean {
  if (flags.salesPlanningActive && G5_SALES_DOMAINS.has(domain)) return true
  if (flags.procurementActive && G5_PROCUREMENT_DOMAINS.has(domain)) return true
  if (flags.masterDataActive && G5_MASTER_DOMAINS.has(domain)) return true
  return false
}

/** Drop dirty ops that would push forged G5 domain writes into UpdateFstStore. */
export function filterG5AuthoritativeDirtyOps(
  ops: DirtyOperation[],
  store: AppStore,
): DirtyOperation[] {
  const flags = g5FlagsFromStore(store)
  if (!flags.masterDataActive && !flags.salesPlanningActive && !flags.procurementActive) {
    return ops
  }
  return ops.filter((op) => !isG5AuthoritativeDomain(op.domain, flags))
}

/**
 * After merge, restore remote values for G5-owned domains so UpdateFstStore
 * cannot overwrite critical-store truth with client-forged sales/procurement/MD.
 */
export function restoreG5AuthoritativeDomains(remote: AppStore, merged: AppStore): AppStore {
  const flagsMerged = g5FlagsFromStore(merged)
  const flagsRemote = g5FlagsFromStore(remote)
  const active = {
    masterDataActive: flagsMerged.masterDataActive || flagsRemote.masterDataActive,
    salesPlanningActive: flagsMerged.salesPlanningActive || flagsRemote.salesPlanningActive,
    procurementActive: flagsMerged.procurementActive || flagsRemote.procurementActive,
  }
  if (!active.masterDataActive && !active.salesPlanningActive && !active.procurementActive) {
    return merged
  }
  let next = merged
  if (active.salesPlanningActive) {
    next = { ...next, sales: remote.sales }
  }
  if (active.procurementActive) {
    next = { ...next, procurement: remote.procurement }
  }
  if (active.masterDataActive) {
    next = {
      ...next,
      finishedProducts: remote.finishedProducts,
      counterparties: remote.counterparties,
    }
  }
  next = {
    ...next,
    production: {
      ...next.production,
      g5MasterDataActive: active.masterDataActive,
      g5SalesPlanningActive: active.salesPlanningActive,
      g5ProcurementActive: active.procurementActive,
      criticalDomainMeta:
        (merged.production as unknown as { criticalDomainMeta?: unknown })?.criticalDomainMeta ??
        (remote.production as unknown as { criticalDomainMeta?: unknown })?.criticalDomainMeta,
    } as typeof next.production,
  }
  return next
}
