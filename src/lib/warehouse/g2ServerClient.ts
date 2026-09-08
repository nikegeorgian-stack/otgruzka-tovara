/**
 * PHASE G2 — client helpers for warehouse lifecycle commands + authoritative overlay.
 */
import { getFirebaseAuth, isFirebaseConfigured } from '@/lib/cloud/firebase'
import { fstApiUrl } from '@/lib/cloud/fstApiOrigin'
import { fstCommandErrorMessage } from '@/lib/cloud/fstCommandErrors'
import { FST_SHARED_STORE_DOC_ID } from '@/lib/cloud/firestoreSchema'
import type { WarehouseStore } from '@/lib/warehouse/types'
import {
  G1_CRITICAL_SOURCE,
  G1_LEGACY_NOT_AUTHORITATIVE,
  mirrorAuthoritativeWarehousePost,
  resolveAuthoritativeWarehouseOverlay,
  isG1WebAuthoritativePath,
  g1GetAuthoritativeWarehouse,
  g1PostWarehouseDocument,
  unionWarehouseCatalogueItems,
} from '@/lib/warehouse/g1ServerClient'

export {
  G1_CRITICAL_SOURCE,
  G1_LEGACY_NOT_AUTHORITATIVE,
  mirrorAuthoritativeWarehousePost,
  resolveAuthoritativeWarehouseOverlay,
  isG1WebAuthoritativePath,
  g1GetAuthoritativeWarehouse,
  g1PostWarehouseDocument,
}

export type G2ServerResult<T> =
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

async function g2Fetch<T>(body: Record<string, unknown>): Promise<G2ServerResult<T>> {
  if (!isFirebaseConfigured()) {
    return { ok: false, error: 'not_configured', message: 'G2 server not configured' }
  }
  const token = await bearerToken()
  if (!token) return { ok: false, error: 'unauthorized', message: 'Firebase login required' }

  try {
    const res = await fetch(fstApiUrl('/api/fst/g2-warehouse-command'), {
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
    const err = payload?.error || String(res.status)
    return {
      ok: false,
      error: err,
      message: fstCommandErrorMessage(
        err,
        payload?.message || payload?.error || 'G2 server error',
      ),
    }
  } catch {
    return { ok: false, error: 'network', message: 'G2 server unavailable' }
  }
}

export type G2CommandType =
  | 'warehouse.draft.save'
  | 'warehouse.draft.delete'
  | 'warehouse.document.post'
  | 'warehouse.document.postExisting'
  | 'warehouse.transfer.post'
  | 'warehouse.inventory.post'
  | 'warehouse.opening.post'
  | 'warehouse.dailyIssue.post'
  | 'warehouse.excel.importDrafts'
  | 'warehouse.document.cancel'
  | 'warehouse.period.close'
  | 'warehouse.period.reopen'
  | 'warehouse.batchMix.confirm'

export async function g2WarehouseCommand<T = Record<string, unknown>>(input: {
  storeId?: string
  idempotencyKey: string
  commandType: G2CommandType
  command: Record<string, unknown>
}) {
  return g2Fetch<
    T & {
      ok: true
      criticalRevision?: number
      warehouse?: Partial<WarehouseStore>
      idempotent?: boolean
      documentId?: string
      documentIds?: string[]
    }
  >({
    storeId: input.storeId ?? FST_SHARED_STORE_DOC_ID,
    idempotencyKey: input.idempotencyKey,
    commandType: input.commandType,
    command: input.command,
  })
}

/** Prefer G2 overlay merge that preserves closedMonths / accounting. */
export function mirrorG2WarehouseAck(
  warehouse: WarehouseStore,
  serverWarehouse: Partial<WarehouseStore> | undefined,
): WarehouseStore {
  if (!serverWarehouse) return warehouse
  return {
    ...warehouse,
    documents: serverWarehouse.documents ?? warehouse.documents,
    movements: serverWarehouse.movements ?? warehouse.movements,
    items: unionWarehouseCatalogueItems(warehouse.items, serverWarehouse.items),
    locations: serverWarehouse.locations?.length ? serverWarehouse.locations : warehouse.locations,
    categories: serverWarehouse.categories?.length
      ? serverWarehouse.categories
      : warehouse.categories,
    productionLineBindings: serverWarehouse.productionLineBindings?.length
      ? serverWarehouse.productionLineBindings
      : warehouse.productionLineBindings,
    auditLog: serverWarehouse.auditLog ?? warehouse.auditLog,
    closedMonths: serverWarehouse.closedMonths ?? warehouse.closedMonths,
    periodHistory: serverWarehouse.periodHistory ?? warehouse.periodHistory,
    accountingByWarehouse:
      serverWarehouse.accountingByWarehouse ?? warehouse.accountingByWarehouse,
    dailyIssueSessions: serverWarehouse.dailyIssueSessions ?? warehouse.dailyIssueSessions,
  }
}

export function isG2WebAuthoritativePath(): boolean {
  return isG1WebAuthoritativePath()
}
