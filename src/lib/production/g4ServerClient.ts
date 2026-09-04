/**
 * PHASE G4 — web client for packaging / QC / shipment commands.
 */
import { getFirebaseAuth, isFirebaseConfigured } from '@/lib/cloud/firebase'
import { fstApiUrl } from '@/lib/cloud/fstApiOrigin'
import { FST_SHARED_STORE_DOC_ID } from '@/lib/cloud/firestoreSchema'
import type { WarehouseStore } from '@/lib/warehouse/types'

export type G4CommandType =
  | 'packaging.domain.activate'
  | 'packaging.report.draft.save'
  | 'packaging.report.draft.delete'
  | 'packaging.report.confirm'
  | 'packaging.report.createCorrection'
  | 'packaging.report.confirmCorrection'
  | 'packaging.read'
  | 'qc.review.start'
  | 'qc.release'
  | 'qc.regrade'
  | 'qc.reject'
  | 'qc.scrap.writeoff'
  | 'shipment.draft.save'
  | 'shipment.draft.delete'
  | 'shipment.post'
  | 'shipment.cancel'

export type G4ProductionDomain = {
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

export type G4ServerResult<T> =
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

async function g4Fetch<T>(body: Record<string, unknown>): Promise<G4ServerResult<T>> {
  if (!isFirebaseConfigured()) {
    return { ok: false, error: 'not_configured', message: 'G4 server not configured' }
  }
  const token = await bearerToken()
  if (!token) return { ok: false, error: 'unauthorized', message: 'Firebase login required' }
  try {
    const res = await fetch(fstApiUrl('/api/fst/g4-production-command'), {
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
      message: payload?.message || payload?.error || 'G4 server error',
    }
  } catch {
    return { ok: false, error: 'network', message: 'G4 server unavailable' }
  }
}

export async function g4ProductionCommand(input: {
  storeId?: string
  idempotencyKey: string
  commandType: G4CommandType
  command: Record<string, unknown>
}) {
  return g4Fetch<{
    ok: true
    criticalRevision: number
    warehouse?: Partial<WarehouseStore>
    production?: G4ProductionDomain
    packagingQcActive?: boolean
    productionActive?: boolean
    idempotent?: boolean
    finishedGoodsLotId?: string
    reportId?: string
    shipmentId?: string
    decisionId?: string
  }>({
    storeId: input.storeId ?? FST_SHARED_STORE_DOC_ID,
    idempotencyKey: input.idempotencyKey,
    commandType: input.commandType,
    command: input.command,
  })
}

/**
 * Overlay packaging/FG/QC only when packagingQc feature is explicitly active.
 * Production core active alone must NOT hide legacy packaging data.
 */
export function resolveAuthoritativePackagingOverlay(input: {
  legacyProduction: Record<string, unknown>
  criticalProduction: G4ProductionDomain | null | undefined
  criticalWarehouse?: Partial<WarehouseStore> | null
  legacyWarehouse?: WarehouseStore
  criticalRevision: number
  packagingQcActive?: boolean
  productionActive?: boolean
  fetchFailed?: boolean
}): {
  production: Record<string, unknown>
  warehouse?: WarehouseStore
  source: 'fst_critical_store' | 'legacy_fst_store_not_authoritative' | 'fetch_error_block_legacy'
  packagingQcActive: boolean
  authoritativeBlocked?: boolean
} {
  const packagingQcActive = input.packagingQcActive === true
  if (input.fetchFailed && packagingQcActive) {
    return {
      production: input.legacyProduction,
      warehouse: input.legacyWarehouse,
      source: 'fetch_error_block_legacy',
      packagingQcActive: true,
      authoritativeBlocked: true,
    }
  }
  if (packagingQcActive && input.criticalProduction) {
    const lots = (input.criticalProduction.finishedGoodsLots ?? []).map((raw) => {
      const lot = raw as Record<string, unknown>
      const decisionId = lot.currentDecisionId
      const decisions = (input.criticalProduction?.qcDecisions ?? []) as Record<string, unknown>[]
      const decision = decisions.find((d) => d.id === decisionId)
      return {
        ...lot,
        // Mirror for shipmentGate web path — sourced from critical decision, not client forge
        serverQcDecisionStatus:
          decision?.status === 'released' && lot.qcStatus === 'released' ? 'released' : lot.qcStatus,
      }
    })
    const nextProduction = {
      ...input.legacyProduction,
      packagingReports: input.criticalProduction.packagingReports ?? [],
      finishedGoodsLots: lots,
      qcDecisions: input.criticalProduction.qcDecisions ?? [],
      g4PackagingReports: input.criticalProduction.packagingReports ?? [],
      g4FinishedGoodsLots: lots,
      g4QcDecisions: input.criticalProduction.qcDecisions ?? [],
      g4CriticalRevision: input.criticalRevision,
      g4PackagingQcActive: true,
      g3ProductionDomainActive: input.productionActive === true,
    }
    let nextWarehouse = input.legacyWarehouse
    if (input.legacyWarehouse && input.criticalWarehouse) {
      const criticalLoading = (
        input.criticalWarehouse as Partial<WarehouseStore> & {
          loadingShipments?: WarehouseStore['loadingShipments']
        }
      ).loadingShipments
      nextWarehouse = {
        ...input.legacyWarehouse,
        ...input.criticalWarehouse,
        documents: input.criticalWarehouse.documents ?? input.legacyWarehouse.documents,
        movements: input.criticalWarehouse.movements ?? input.legacyWarehouse.movements,
        loadingShipments: criticalLoading ?? input.legacyWarehouse.loadingShipments,
        auditLog: input.criticalWarehouse.auditLog ?? input.legacyWarehouse.auditLog,
      }
    }
    return {
      production: nextProduction,
      warehouse: nextWarehouse,
      source: 'fst_critical_store',
      packagingQcActive: true,
    }
  }
  return {
    production: {
      ...input.legacyProduction,
      g4PackagingQcActive: false,
    },
    warehouse: input.legacyWarehouse,
    source: 'legacy_fst_store_not_authoritative',
    packagingQcActive: false,
  }
}

export function isG4WebAuthoritativePath(): boolean {
  return import.meta.env.VITE_FST_WEB === 'true'
}

export function isG4PackagingQcActive(production: Record<string, unknown> | null | undefined): boolean {
  return production?.g4PackagingQcActive === true
}

export function mirrorG4Ack(
  warehouse: WarehouseStore,
  production: Record<string, unknown>,
  server: {
    warehouse?: Partial<WarehouseStore>
    production?: G4ProductionDomain
    criticalRevision?: number
    packagingQcActive?: boolean
    productionActive?: boolean
  },
): { warehouse: WarehouseStore; production: Record<string, unknown> } {
  const overlay = resolveAuthoritativePackagingOverlay({
    legacyProduction: production,
    criticalProduction: server.production,
    criticalWarehouse: server.warehouse,
    legacyWarehouse: warehouse,
    criticalRevision: Number(server.criticalRevision ?? 0),
    packagingQcActive: server.packagingQcActive !== false && Boolean(server.production),
    productionActive: server.productionActive,
  })
  return {
    warehouse: overlay.warehouse ?? warehouse,
    production: overlay.production,
  }
}
