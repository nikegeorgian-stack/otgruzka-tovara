/**
 * PHASE G3 — web client for authoritative production commands.
 */
import { getFirebaseAuth, isFirebaseConfigured } from '@/lib/cloud/firebase'
import { fstApiUrl } from '@/lib/cloud/fstApiOrigin'
import { FST_SHARED_STORE_DOC_ID } from '@/lib/cloud/firestoreSchema'
import type { WarehouseStore } from '@/lib/warehouse/types'

export type G3CommandType =
  | 'production.domain.activate'
  | 'production.recipe.draft.save'
  | 'production.recipe.draft.delete'
  | 'production.recipe.version.approve'
  | 'production.order.draft.save'
  | 'production.order.draft.delete'
  | 'production.order.confirm'
  | 'production.order.change'
  | 'production.order.cancel'
  | 'production.reservation.reallocate'
  | 'production.material.issueToLine'
  | 'production.material.returnFromLine'
  | 'production.shift.draft.save'
  | 'production.shift.draft.delete'
  | 'production.shift.confirm'
  | 'production.shift.createCorrection'
  | 'production.shift.confirmCorrection'
  | 'production.request.post'
  | 'production.read'

export type G3ProductionDomain = {
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

export type G3ServerResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; message: string }

async function bearerToken(): Promise<string | null> {
  if (!isFirebaseConfigured()) return null
  const user = getFirebaseAuth().currentUser
  if (!user) return null
  try {
    return await user.getIdToken()
  } catch {
    return null
  }
}

async function g3Fetch<T>(body: Record<string, unknown>): Promise<G3ServerResult<T>> {
  if (!isFirebaseConfigured()) {
    return { ok: false, error: 'not_configured', message: 'G3 server not configured' }
  }
  const token = await bearerToken()
  if (!token) return { ok: false, error: 'unauthorized', message: 'Firebase login required' }
  try {
    const res = await fetch(fstApiUrl('/api/fst/g3-production-command'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    })
    const payload = (await res.json().catch(() => null)) as
      | ({ error?: string; message?: string } & T)
      | null
    if (res.ok && payload && payload.error === undefined) {
      return { ok: true, data: payload as T }
    }
    return {
      ok: false,
      error: payload?.error || String(res.status),
      message: payload?.message || payload?.error || 'G3 server error',
    }
  } catch {
    return { ok: false, error: 'network', message: 'G3 server unavailable' }
  }
}

export async function g3ProductionCommand(input: {
  storeId?: string
  idempotencyKey: string
  commandType: G3CommandType
  command: Record<string, unknown>
}) {
  return g3Fetch<{
    ok: true
    criticalRevision: number
    warehouse?: Partial<WarehouseStore>
    production?: G3ProductionDomain
    idempotent?: boolean
    orderId?: string
    reportId?: string
    versionId?: string
  }>({
    storeId: input.storeId ?? FST_SHARED_STORE_DOC_ID,
    idempotencyKey: input.idempotencyKey,
    commandType: input.commandType,
    command: input.command,
  })
}

/**
 * Overlay critical production ONLY when production domain is explicitly active.
 * Warehouse revision alone must NOT activate production (G3.1).
 */
export function resolveAuthoritativeProductionOverlay(input: {
  legacyProduction: Record<string, unknown>
  criticalProduction: G3ProductionDomain | null | undefined
  criticalRevision: number
  productionActive?: boolean
  fetchFailed?: boolean
}): {
  production: Record<string, unknown>
  source: 'fst_critical_store' | 'legacy_fst_store_not_authoritative' | 'fetch_error_block_legacy'
  authoritativeBlocked?: boolean
  productionActive: boolean
} {
  const productionActive = input.productionActive === true
  if (input.fetchFailed && productionActive) {
    return {
      production: input.legacyProduction,
      source: 'fetch_error_block_legacy',
      authoritativeBlocked: true,
      productionActive: true,
    }
  }
  if (productionActive && input.criticalProduction) {
    return {
      production: {
        ...input.legacyProduction,
        g3Orders: input.criticalProduction.orders ?? [],
        g3RecipeVersions: input.criticalProduction.recipeVersions ?? [],
        g3ShiftReports: input.criticalProduction.shiftReports ?? [],
        g3WipBatches: input.criticalProduction.wipBatches ?? [],
        g3WasteRecords: input.criticalProduction.wasteRecords ?? [],
        g3Handoffs: input.criticalProduction.handoffs ?? [],
        g3AuditLog: input.criticalProduction.auditLog ?? [],
        g3PackagingReports: input.criticalProduction.packagingReports ?? [],
        finishedGoodsLots: input.criticalProduction.finishedGoodsLots ?? [],
        g3QcDecisions: input.criticalProduction.qcDecisions ?? [],
        g3CriticalRevision: input.criticalRevision,
        g3ProductionDomainActive: true,
      },
      source: 'fst_critical_store',
      productionActive: true,
    }
  }
  return {
    production: {
      ...input.legacyProduction,
      g3ProductionDomainActive: false,
    },
    source: 'legacy_fst_store_not_authoritative',
    productionActive: false,
  }
}

export function isG3WebAuthoritativePath(): boolean {
  return import.meta.env.VITE_FST_WEB === 'true'
}

/** Web G3 gateway only when production domain was explicitly activated (bootstrap). */
export function isG3ProductionDomainActive(production: Record<string, unknown> | null | undefined): boolean {
  return production?.g3ProductionDomainActive === true
}

export function mirrorG3Ack(
  warehouse: WarehouseStore,
  production: Record<string, unknown>,
  server: {
    warehouse?: Partial<WarehouseStore>
    production?: G3ProductionDomain
    criticalRevision?: number
    productionActive?: boolean
  },
): { warehouse: WarehouseStore; production: Record<string, unknown> } {
  const nextWh = server.warehouse
    ? {
        ...warehouse,
        documents: server.warehouse.documents ?? warehouse.documents,
        movements: server.warehouse.movements ?? warehouse.movements,
        materialShortages: server.warehouse.materialShortages ?? warehouse.materialShortages,
        auditLog: server.warehouse.auditLog ?? warehouse.auditLog,
        closedMonths: server.warehouse.closedMonths ?? warehouse.closedMonths,
        productionLineBindings:
          server.warehouse.productionLineBindings ?? warehouse.productionLineBindings,
        scrapLocationId: server.warehouse.scrapLocationId ?? warehouse.scrapLocationId,
      }
    : warehouse
  // Successful G3 mutating ack implies production domain is (now) active
  const overlay = resolveAuthoritativeProductionOverlay({
    legacyProduction: production,
    criticalProduction: server.production,
    criticalRevision: Number(server.criticalRevision ?? 0),
    productionActive: server.productionActive !== false && Boolean(server.production),
  })
  return { warehouse: nextWh, production: overlay.production }
}
