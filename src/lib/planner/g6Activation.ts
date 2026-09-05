import type { AppStore } from '@/lib/types'

export type G6ActivationFlags = {
  capacityPlanningActive: boolean
}

type CapacityPlanningFeature = { active?: boolean; version?: number }
type CriticalDomainMeta = {
  production?: {
    active?: boolean
    features?: {
      capacityPlanning?: CapacityPlanningFeature
      [key: string]: unknown
    }
    [key: string]: unknown
  }
  capacityPlanning?: CapacityPlanningFeature
  [key: string]: unknown
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

function featureActive(meta: CriticalDomainMeta | null): boolean {
  if (!meta) return false
  if (meta.production?.features?.capacityPlanning?.active === true) return true
  if (meta.capacityPlanning?.active === true) return true
  return false
}

/** Read G6 capacity-planning activation from AppStore (flag or domainMeta). */
export function g6FlagsFromStore(store: AppStore | null | undefined): G6ActivationFlags {
  const production = store?.production as unknown as Record<string, unknown> | undefined
  const meta = readMeta(store)
  return {
    capacityPlanningActive:
      production?.g6CapacityPlanningActive === true || featureActive(meta),
  }
}

export function isG6CapacityPlanningActive(store: AppStore | null | undefined): boolean {
  return g6FlagsFromStore(store).capacityPlanningActive
}

/** Patch production (+ optional warehouse) with G6 activation flags from server. */
export function withG6ActivationOnStore(
  store: AppStore,
  flags: Partial<G6ActivationFlags> & { domainMeta?: unknown },
): AppStore {
  const prev = g6FlagsFromStore(store)
  const capacityPlanningActive = flags.capacityPlanningActive ?? prev.capacityPlanningActive

  const existingMetaRaw =
    flags.domainMeta ??
    (store.production as unknown as { criticalDomainMeta?: CriticalDomainMeta })?.criticalDomainMeta
  const existingMeta =
    existingMetaRaw && typeof existingMetaRaw === 'object'
      ? (existingMetaRaw as CriticalDomainMeta)
      : null

  let criticalDomainMeta: CriticalDomainMeta
  if (existingMeta) {
    const prodRaw = existingMeta.production
    const prod =
      prodRaw && typeof prodRaw === 'object' ? { ...(prodRaw as Record<string, unknown>) } : {}
    const featuresRaw = (prod as { features?: unknown }).features
    const features =
      featuresRaw && typeof featuresRaw === 'object'
        ? { ...(featuresRaw as Record<string, unknown>) }
        : {}
    const prevFeat = features.capacityPlanning
    features.capacityPlanning = {
      ...(prevFeat && typeof prevFeat === 'object' ? (prevFeat as object) : {}),
      active: capacityPlanningActive,
    }
    criticalDomainMeta = {
      ...existingMeta,
      production: {
        ...prod,
        features,
      },
    }
  } else {
    criticalDomainMeta = {
      production: {
        features: {
          capacityPlanning: { active: capacityPlanningActive },
        },
      },
    }
  }

  return {
    ...store,
    production: {
      ...store.production,
      g6CapacityPlanningActive: capacityPlanningActive,
      criticalDomainMeta,
    } as typeof store.production,
    warehouse: {
      ...store.warehouse,
      criticalDomainMeta,
    } as typeof store.warehouse,
  }
}
