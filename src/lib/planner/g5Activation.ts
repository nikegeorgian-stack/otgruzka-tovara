import type { AppStore } from '@/lib/types'

export type G5ActivationFlags = {
  masterDataActive: boolean
  salesPlanningActive: boolean
  procurementActive: boolean
}

type CriticalDomainMeta = {
  masterData?: { active?: boolean }
  salesPlanning?: { active?: boolean }
  procurement?: { active?: boolean }
}

function readMeta(store: AppStore | null | undefined): CriticalDomainMeta | null {
  if (!store) return null
  const production = store.production as unknown as Record<string, unknown> | undefined
  const warehouse = store.warehouse as unknown as Record<string, unknown> | undefined
  const fromProduction = production?.criticalDomainMeta as CriticalDomainMeta | undefined
  const fromWarehouse = warehouse?.criticalDomainMeta as CriticalDomainMeta | undefined
  const fromStore = (store as unknown as { criticalDomainMeta?: CriticalDomainMeta }).criticalDomainMeta
  return fromProduction ?? fromWarehouse ?? fromStore ?? null
}

/** Read G5.1 activation flags persisted from G1 get / G5 ack onto the AppStore. */
export function g5FlagsFromStore(store: AppStore | null | undefined): G5ActivationFlags {
  const production = store?.production as unknown as Record<string, unknown> | undefined
  const meta = readMeta(store)
  return {
    masterDataActive:
      production?.g5MasterDataActive === true || meta?.masterData?.active === true,
    salesPlanningActive:
      production?.g5SalesPlanningActive === true || meta?.salesPlanning?.active === true,
    procurementActive:
      production?.g5ProcurementActive === true || meta?.procurement?.active === true,
  }
}

export function isG5MasterDataActive(store: AppStore | null | undefined): boolean {
  return g5FlagsFromStore(store).masterDataActive
}

export function isG5SalesPlanningActive(store: AppStore | null | undefined): boolean {
  return g5FlagsFromStore(store).salesPlanningActive
}

export function isG5ProcurementActive(store: AppStore | null | undefined): boolean {
  return g5FlagsFromStore(store).procurementActive
}

/** Patch production (+ optional warehouse) with G5 activation flags from server. */
export function withG5ActivationOnStore(
  store: AppStore,
  flags: Partial<G5ActivationFlags> & { domainMeta?: unknown },
): AppStore {
  const prev = g5FlagsFromStore(store)
  const masterDataActive = flags.masterDataActive ?? prev.masterDataActive
  const salesPlanningActive = flags.salesPlanningActive ?? prev.salesPlanningActive
  const procurementActive = flags.procurementActive ?? prev.procurementActive
  const criticalDomainMeta =
    flags.domainMeta ??
    (store.production as unknown as { criticalDomainMeta?: unknown })?.criticalDomainMeta ?? {
      masterData: { active: masterDataActive },
      salesPlanning: { active: salesPlanningActive },
      procurement: { active: procurementActive },
    }

  return {
    ...store,
    production: {
      ...store.production,
      g5MasterDataActive: masterDataActive,
      g5SalesPlanningActive: salesPlanningActive,
      g5ProcurementActive: procurementActive,
      criticalDomainMeta,
    } as typeof store.production,
    warehouse: {
      ...store.warehouse,
      criticalDomainMeta,
    } as typeof store.warehouse,
  }
}
