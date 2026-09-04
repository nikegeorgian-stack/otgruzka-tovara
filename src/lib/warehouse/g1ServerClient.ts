/**
 * PHASE G1 — client helpers for authoritative warehouse overlay + server commands.
 * Legacy UpdateFstStore warehouse is NOT treated as proof on web once critical store exists.
 */
import { getFirebaseAuth, isFirebaseConfigured } from '@/lib/cloud/firebase'
import { fstApiUrl } from '@/lib/cloud/fstApiOrigin'
import { FST_SHARED_STORE_DOC_ID } from '@/lib/cloud/firestoreSchema'
import type { WarehouseStore } from '@/lib/warehouse/types'

export const G1_LEGACY_NOT_AUTHORITATIVE = 'legacy_fst_store_not_authoritative' as const
export const G1_CRITICAL_SOURCE = 'fst_critical_store' as const

export type G1WarehouseSource = typeof G1_CRITICAL_SOURCE | typeof G1_LEGACY_NOT_AUTHORITATIVE

export type G1ServerResult<T> =
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

async function g1Fetch<T>(path: string, body: Record<string, unknown>): Promise<G1ServerResult<T>> {
  if (!isFirebaseConfigured()) {
    return { ok: false, error: 'not_configured', message: 'G1 server not configured' }
  }
  const token = await bearerToken()
  if (!token) return { ok: false, error: 'unauthorized', message: 'Firebase login required' }

  try {
    const res = await fetch(fstApiUrl(path), {
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
      message: payload?.message || payload?.error || 'G1 server error',
    }
  } catch {
    return { ok: false, error: 'network', message: 'G1 server unavailable' }
  }
}

export function resolveAuthoritativeWarehouseOverlay(input: {
  legacyWarehouse: WarehouseStore
  criticalWarehouse?: WarehouseStore | null
  criticalRevision?: number
  warehouseActive?: boolean
}): { warehouse: WarehouseStore; source: G1WarehouseSource; criticalRevision: number } {
  const rev = Number(input.criticalRevision ?? 0)
  const active = input.warehouseActive === true || (input.warehouseActive !== false && rev > 0)
  if (active && input.criticalWarehouse) {
    return {
      warehouse: {
        ...input.legacyWarehouse,
        ...input.criticalWarehouse,
        // Prefer authoritative stock truth fields from critical store:
        documents: input.criticalWarehouse.documents ?? [],
        movements: input.criticalWarehouse.movements ?? [],
        items: input.criticalWarehouse.items?.length
          ? input.criticalWarehouse.items
          : input.legacyWarehouse.items,
        locations: input.criticalWarehouse.locations?.length
          ? input.criticalWarehouse.locations
          : input.legacyWarehouse.locations,
        categories: input.criticalWarehouse.categories?.length
          ? input.criticalWarehouse.categories
          : input.legacyWarehouse.categories,
        auditLog: input.criticalWarehouse.auditLog ?? input.legacyWarehouse.auditLog,
        closedMonths:
          input.criticalWarehouse.closedMonths ?? input.legacyWarehouse.closedMonths,
        accountingByWarehouse:
          input.criticalWarehouse.accountingByWarehouse ??
          input.legacyWarehouse.accountingByWarehouse,
        dailyIssueSessions:
          input.criticalWarehouse.dailyIssueSessions ??
          input.legacyWarehouse.dailyIssueSessions,
      },
      source: G1_CRITICAL_SOURCE,
      criticalRevision: rev,
    }
  }
  return {
    warehouse: input.legacyWarehouse,
    source: G1_LEGACY_NOT_AUTHORITATIVE,
    criticalRevision: rev,
  }
}

/** Apply server post ack into local mirror (UI only; authoritative remains critical store). */
export function mirrorAuthoritativeWarehousePost(
  warehouse: WarehouseStore,
  serverWarehouse: Partial<WarehouseStore> | undefined,
): WarehouseStore {
  if (!serverWarehouse) return warehouse
  return {
    ...warehouse,
    documents: serverWarehouse.documents ?? warehouse.documents,
    movements: serverWarehouse.movements ?? warehouse.movements,
    items: serverWarehouse.items?.length ? serverWarehouse.items : warehouse.items,
    auditLog: serverWarehouse.auditLog ?? warehouse.auditLog,
  }
}

export async function g1GetAuthoritativeWarehouse(storeId = FST_SHARED_STORE_DOC_ID) {
  return g1Fetch<{
    ok: true
    revision: number
    warehouse: WarehouseStore
    production?: {
      recipeVersions?: unknown[]
      orders?: unknown[]
      shiftReports?: unknown[]
      wipBatches?: unknown[]
      wasteRecords?: unknown[]
      handoffs?: unknown[]
      auditLog?: unknown[]
    }
    domainMeta?: unknown
    warehouseActive?: boolean
    productionActive?: boolean
    source: string
    authoritative: boolean
  }>('/api/fst/g1-warehouse-get', { storeId })
}

export async function g1PostWarehouseDocument(input: {
  storeId?: string
  idempotencyKey: string
  command: {
    type: 'receipt' | 'issue'
    warehouseId: string
    date?: string
    number?: string
    lines: Array<{
      itemId: string
      quantity: number
      lineId?: string
      itemNameSnapshot?: string
      itemCodeSnapshot?: string
      unitSnapshot?: string
      inputUnit?: string
    }>
    purpose?: string
    docRole?: string
    documentId?: string
  }
}) {
  return g1Fetch<{
    ok: true
    documentId: string
    criticalRevision: number
    warehouse?: Partial<WarehouseStore>
    idempotent?: boolean
  }>('/api/fst/g1-warehouse-post-document', {
    storeId: input.storeId ?? FST_SHARED_STORE_DOC_ID,
    idempotencyKey: input.idempotencyKey,
    command: input.command,
  })
}

export function isG1WebAuthoritativePath(): boolean {
  return (
    typeof import.meta !== 'undefined' &&
    Boolean((import.meta as ImportMeta & { env?: { VITE_FST_WEB?: string } }).env?.VITE_FST_WEB === 'true')
  )
}
