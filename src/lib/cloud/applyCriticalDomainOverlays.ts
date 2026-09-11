/**
 * Apply G1–G6 critical-domain overlays onto a soft/local AppStore snapshot.
 * Warehouse documents/movements from soft must not survive when warehouse domain is active.
 */
import type { AppStore } from '@/lib/types'
import {
  G1_CRITICAL_SOURCE,
  resolveAuthoritativeWarehouseOverlay,
} from '@/lib/warehouse/g1ServerClient'
import { resolveAuthoritativeProductionOverlay } from '@/lib/production/g3ServerClient'

export type CriticalPullSnapshot = {
  warehouse?: AppStore['warehouse']
  production?: {
    recipeVersions?: unknown[]
    orders?: unknown[]
    shiftReports?: unknown[]
    wipBatches?: unknown[]
    wasteRecords?: unknown[]
    handoffs?: unknown[]
    auditLog?: unknown[]
    packagingReports?: unknown[]
    finishedGoodsLots?: unknown[]
    qcDecisions?: unknown[]
  }
  sales?: { orders?: unknown[] }
  procurement?: { orders?: unknown[] }
  capacity?: unknown
  domainMeta?: unknown
  revision: number
  warehouseActive?: boolean
  productionActive?: boolean
  packagingQcActive?: boolean
  masterDataActive?: boolean
  salesPlanningActive?: boolean
  procurementActive?: boolean
}

export async function applyCriticalDomainOverlays(
  local: AppStore,
  g1: CriticalPullSnapshot,
): Promise<AppStore> {
  let next = local
  const warehouseActive =
    g1.warehouseActive === true || (g1.warehouseActive !== false && g1.revision > 0)

  if (warehouseActive && g1.warehouse) {
    const overlay = resolveAuthoritativeWarehouseOverlay({
      legacyWarehouse: next.warehouse,
      criticalWarehouse: g1.warehouse,
      criticalRevision: g1.revision,
      warehouseActive: true,
    })
    if (overlay.source === G1_CRITICAL_SOURCE) {
      next = { ...next, warehouse: overlay.warehouse }
    }
  }

  const productionActive = g1.productionActive === true
  if (productionActive && g1.production) {
    const prodOverlay = resolveAuthoritativeProductionOverlay({
      legacyProduction: next.production as unknown as Record<string, unknown>,
      criticalProduction: g1.production,
      criticalRevision: g1.revision,
      productionActive: true,
    })
    if (prodOverlay.source === 'fst_critical_store') {
      next = {
        ...next,
        production: prodOverlay.production as typeof next.production,
      }
    } else if (prodOverlay.authoritativeBlocked) {
      console.warn('FST G3 production overlay blocked — not treating legacy as truth')
    }
  } else {
    next = {
      ...next,
      production: {
        ...next.production,
        g3ProductionDomainActive: false,
      } as typeof next.production,
    }
  }

  const packagingQcActive = g1.packagingQcActive === true
  if (packagingQcActive && g1.production) {
    const { resolveAuthoritativePackagingOverlay } = await import('@/lib/production/g4ServerClient')
    const g4Overlay = resolveAuthoritativePackagingOverlay({
      legacyProduction: next.production as unknown as Record<string, unknown>,
      criticalProduction: g1.production,
      criticalWarehouse: g1.warehouse,
      legacyWarehouse: next.warehouse,
      criticalRevision: g1.revision,
      packagingQcActive: true,
      productionActive,
    })
    if (g4Overlay.source === 'fst_critical_store') {
      next = {
        ...next,
        production: g4Overlay.production as typeof next.production,
        warehouse: g4Overlay.warehouse ?? next.warehouse,
      }
    } else if (g4Overlay.authoritativeBlocked) {
      console.warn('FST G4 packaging overlay blocked — not treating legacy as truth')
      next = {
        ...next,
        production: g4Overlay.production as typeof next.production,
      }
    }
  } else if (packagingQcActive) {
    next = {
      ...next,
      production: {
        ...next.production,
        packagingReports: [],
        finishedGoodsLots: [],
        qcDecisions: [],
        g4PackagingReports: [],
        g4FinishedGoodsLots: [],
        g4QcDecisions: [],
        g4PackagingQcActive: false,
        g4CriticalRevision: g1.revision,
        g4AuthoritativeBlocked: true,
      } as typeof next.production,
    }
  } else {
    next = {
      ...next,
      production: {
        ...next.production,
        g4PackagingQcActive: false,
      } as typeof next.production,
    }
  }

  {
    const { withG5ActivationOnStore, readG5Activation, mirrorG5Ack } = await import(
      '@/lib/planner/g5ServerClient'
    )
    const fromMeta = readG5Activation(g1.domainMeta)
    const salesPlanningActive = g1.salesPlanningActive === true || fromMeta.salesPlanningActive
    next = withG5ActivationOnStore(next, {
      masterDataActive: g1.masterDataActive === true || fromMeta.masterDataActive,
      salesPlanningActive,
      procurementActive: g1.procurementActive === true || fromMeta.procurementActive,
      domainMeta: g1.domainMeta,
    })
    if (salesPlanningActive && Array.isArray(g1.sales?.orders)) {
      next = mirrorG5Ack(next, {
        criticalRevision: g1.revision,
        salesPlanningActive: true,
        replaceSalesOrders: true,
        sales: g1.sales,
      })
    }
    const procurementActive =
      g1.procurementActive === true || fromMeta.procurementActive
    if (procurementActive && Array.isArray(g1.procurement?.orders)) {
      next = mirrorG5Ack(next, {
        criticalRevision: g1.revision,
        procurementActive: true,
        replaceProcurementOrders: true,
        procurement: g1.procurement,
      })
    }
  }

  {
    const { withG6ActivationOnStore, readG6Activation } = await import('@/lib/planner/g6ServerClient')
    const fromMeta = readG6Activation(g1.domainMeta)
    const capacityPlanningActive =
      (g1 as { capacityPlanningActive?: boolean }).capacityPlanningActive === true ||
      fromMeta.capacityPlanningActive
    next = withG6ActivationOnStore(next, {
      capacityPlanningActive,
      domainMeta: g1.domainMeta,
    })
    if (g1.capacity && typeof g1.capacity === 'object') {
      const { withCapacityOnStore } = await import('@/lib/cloud/g6AuthoritativeStrip')
      next = withCapacityOnStore(next, g1.capacity as Parameters<typeof withCapacityOnStore>[1])
    }
  }

  return next
}
