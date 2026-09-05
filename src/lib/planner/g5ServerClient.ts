/**
 * PHASE G5 / G5.1 — web client for master-data / sales / MRP / procurement commands.
 */
import { getFirebaseAuth, isFirebaseConfigured } from '@/lib/cloud/firebase'
import { fstApiUrl } from '@/lib/cloud/fstApiOrigin'
import { FST_SHARED_STORE_DOC_ID } from '@/lib/cloud/firestoreSchema'
import type { AppStore } from '@/lib/types'
import type { WarehouseStore } from '@/lib/warehouse/types'
import {
  g5FlagsFromStore,
  withG5ActivationOnStore,
  type G5ActivationFlags,
} from './g5Activation'

export type G5CommandType =
  | 'masterdata.domain.activate'
  | 'masterdata.item.upsert'
  | 'masterdata.item.archive'
  | 'masterdata.product.upsert'
  | 'masterdata.product.archive'
  | 'masterdata.customer.upsert'
  | 'masterdata.customer.archive'
  | 'masterdata.supplier.upsert'
  | 'masterdata.supplier.archive'
  | 'masterdata.bom.upsert'
  | 'masterdata.bom.approve'
  | 'masterdata.bom.archive'
  | 'masterdata.bom.retire'
  | 'sales.domain.activate'
  | 'sales.order.draft.save'
  | 'sales.order.draft.delete'
  | 'sales.order.confirm'
  | 'sales.order.change'
  | 'sales.order.cancel'
  | 'sales.order.priority.set'
  | 'sales.fulfillment.syncFromShipments'
  | 'sales.shipment.post'
  | 'sales.shipment.cancel'
  | 'planning.mrp.run'
  | 'planning.mrp.acceptProductionDrafts'
  | 'planning.shortage.acknowledge'
  | 'planning.shortage.resolveManual'
  | 'planning.productionRecommendation.createManual'
  | 'procurement.domain.activate'
  | 'procurement.generateDraftsFromMrp'
  | 'procurement.draft.edit'
  | 'procurement.order.change'
  | 'procurement.order.submit'
  | 'procurement.order.approve'
  | 'procurement.order.markOrdered'
  | 'procurement.order.cancel'
  | 'procurement.receipt.post'
  | 'procurement.payment.record'

export type G5ServerResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; message: string }

export type G5AckPayload = {
  criticalRevision?: number
  masterDataActive?: boolean
  salesPlanningActive?: boolean
  procurementActive?: boolean
  packagingQcActive?: boolean
  productionActive?: boolean
  warehouseActive?: boolean
  masterData?: {
    items?: unknown[]
    finishedProducts?: unknown[]
    suppliers?: unknown[]
    customers?: unknown[]
    packagingBoms?: unknown[]
    auditLog?: unknown[]
  }
  sales?: {
    orders?: unknown[]
    auditLog?: unknown[]
  }
  planning?: Record<string, unknown>
  procurement?: {
    orders?: unknown[]
    payments?: unknown[]
    unassignedShortages?: unknown[]
    auditLog?: unknown[]
  }
  warehouse?: Partial<WarehouseStore>
  production?: Record<string, unknown>
  domainMeta?: unknown
  touchesWarehouse?: boolean
}

/** UI copy: capacity / м² per shift is G6 — not calculated yet. */
export const G5_CAPACITY_NOT_CALCULATED_NOTICE =
  'Capacity (м² per shift) is not calculated yet — planning horizon shows demand only (G6).'

/** Same pattern as G4: web path when Firebase is configured for the app. */
export function isG5WebPath(): boolean {
  return isFirebaseConfigured()
}

export function readG5Activation(domainMeta: unknown): G5ActivationFlags {
  const meta =
    domainMeta && typeof domainMeta === 'object'
      ? (domainMeta as {
          masterData?: { active?: boolean }
          salesPlanning?: { active?: boolean }
          procurement?: { active?: boolean }
        })
      : null
  return {
    masterDataActive: meta?.masterData?.active === true,
    salesPlanningActive: meta?.salesPlanning?.active === true,
    procurementActive: meta?.procurement?.active === true,
  }
}

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

async function g5Fetch<T>(body: Record<string, unknown>): Promise<G5ServerResult<T>> {
  if (!isFirebaseConfigured()) {
    return { ok: false, error: 'not_configured', message: 'G5 server not configured' }
  }
  const token = await bearerToken()
  if (!token) return { ok: false, error: 'unauthorized', message: 'Firebase login required' }
  try {
    const res = await fetch(fstApiUrl('/api/fst/g5-planning-command'), {
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
    const statusHint = !res.ok ? String(res.status) : ''
    return {
      ok: false,
      error: payload?.error || statusHint || 'g5_error',
      message: payload?.message || payload?.error || statusHint || 'G5 server error',
    }
  } catch (err) {
    return {
      ok: false,
      error: 'network_error',
      message: err instanceof Error ? err.message : 'G5 network error',
    }
  }
}

export async function executeG5Command<T = G5AckPayload>(args: {
  commandType: G5CommandType | string
  command?: Record<string, unknown>
  idempotencyKey: string
  storeId?: string
}): Promise<G5ServerResult<T>> {
  return g5Fetch<T>({
    storeId: args.storeId ?? FST_SHARED_STORE_DOC_ID,
    idempotencyKey: args.idempotencyKey,
    commandType: args.commandType,
    command: args.command ?? {},
  })
}

type G5CmdOpts = {
  idempotencyKey: string
  storeId?: string
  command?: Record<string, unknown>
}

export type G5NamedWrapper = ((
  opts: G5CmdOpts & Record<string, unknown>,
) => Promise<G5ServerResult<G5AckPayload>>) & {
  commandType: G5CommandType
}

function wrapG5Call<T = G5AckPayload>(
  commandType: G5CommandType,
  opts: G5CmdOpts & { command?: Record<string, unknown> },
): Promise<G5ServerResult<T>> {
  return executeG5Command<T>({
    commandType,
    idempotencyKey: opts.idempotencyKey,
    storeId: opts.storeId,
    command: opts.command ?? {},
  })
}

function namedG5(
  commandType: G5CommandType,
  impl: (opts: G5CmdOpts & Record<string, unknown>) => Promise<G5ServerResult<G5AckPayload>>,
): G5NamedWrapper {
  const fn = impl as G5NamedWrapper
  fn.commandType = commandType
  return fn
}

/**
 * Named UI wrappers — each maps 1:1 to a G5 commandType string.
 * Matrix (report G5.2) — see G5_UI_GATEWAY_MATRIX.
 */
export const g5MasterdataDomainActivate = namedG5('masterdata.domain.activate', (opts) =>
  wrapG5Call('masterdata.domain.activate', opts),
)
export const g5MasterdataItemUpsert = namedG5('masterdata.item.upsert', (opts) =>
  wrapG5Call('masterdata.item.upsert', opts),
)
export const g5MasterdataItemArchive = namedG5('masterdata.item.archive', (opts) =>
  wrapG5Call('masterdata.item.archive', opts),
)
/** @deprecated alias — prefer g5MasterdataItemArchive */
export const g5MasterdataArchive = g5MasterdataItemArchive
export const g5MasterdataProductUpsert = namedG5('masterdata.product.upsert', (opts) =>
  wrapG5Call('masterdata.product.upsert', opts),
)
export const g5MasterdataProductArchive = namedG5('masterdata.product.archive', (opts) =>
  wrapG5Call('masterdata.product.archive', opts),
)
export const g5MasterdataCustomerUpsert = namedG5('masterdata.customer.upsert', (opts) =>
  wrapG5Call('masterdata.customer.upsert', opts),
)
export const g5MasterdataCustomerArchive = namedG5('masterdata.customer.archive', (opts) =>
  wrapG5Call('masterdata.customer.archive', opts),
)
export const g5MasterdataSupplierUpsert = namedG5('masterdata.supplier.upsert', (opts) =>
  wrapG5Call('masterdata.supplier.upsert', opts),
)
export const g5MasterdataSupplierArchive = namedG5('masterdata.supplier.archive', (opts) =>
  wrapG5Call('masterdata.supplier.archive', opts),
)
export const g5MasterdataBomUpsert = namedG5('masterdata.bom.upsert', (opts) =>
  wrapG5Call('masterdata.bom.upsert', opts),
)
export const g5MasterdataBomApprove = namedG5('masterdata.bom.approve', (opts) =>
  wrapG5Call('masterdata.bom.approve', opts),
)
export const g5MasterdataBomArchive = namedG5('masterdata.bom.archive', (opts) =>
  wrapG5Call('masterdata.bom.archive', opts),
)

export const g5SalesDomainActivate = namedG5('sales.domain.activate', (opts) =>
  wrapG5Call('sales.domain.activate', opts),
)
export const g5SalesDraftSave = namedG5('sales.order.draft.save', (opts) =>
  wrapG5Call('sales.order.draft.save', opts),
)
export const g5SalesDraftDelete = namedG5('sales.order.draft.delete', (opts) =>
  wrapG5Call('sales.order.draft.delete', opts),
)
export const g5SalesConfirm = namedG5('sales.order.confirm', (opts) =>
  wrapG5Call('sales.order.confirm', opts),
)
export const g5SalesChange = namedG5('sales.order.change', (opts) =>
  wrapG5Call('sales.order.change', opts),
)
export const g5SalesCancel = namedG5('sales.order.cancel', (opts) =>
  wrapG5Call('sales.order.cancel', opts),
)
export const g5SalesPriority = namedG5('sales.order.priority.set', (opts) =>
  wrapG5Call('sales.order.priority.set', opts),
)
export const g5SalesFulfillmentSync = namedG5('sales.fulfillment.syncFromShipments', (opts) =>
  wrapG5Call('sales.fulfillment.syncFromShipments', opts),
)
export const g5SalesShipmentPost = namedG5('sales.shipment.post', (opts) =>
  wrapG5Call('sales.shipment.post', opts),
)
export const g5SalesShipmentCancel = namedG5('sales.shipment.cancel', (opts) =>
  wrapG5Call('sales.shipment.cancel', opts),
)

export const g5RunMrp = namedG5('planning.mrp.run', (opts) => {
  const command = {
    ...(opts.command ?? {}),
    ...(opts.asOfDate ? { asOfDate: opts.asOfDate } : {}),
  }
  return wrapG5Call('planning.mrp.run', { ...opts, command })
})
export const g5AcceptProductionDrafts = namedG5('planning.mrp.acceptProductionDrafts', (opts) => {
  const command = {
    ...(opts.command ?? {}),
    ...(opts.recommendationIds ? { recommendationIds: opts.recommendationIds } : {}),
  }
  return wrapG5Call('planning.mrp.acceptProductionDrafts', { ...opts, command })
})
export const g5AcknowledgeShortage = namedG5('planning.shortage.acknowledge', (opts) =>
  wrapG5Call('planning.shortage.acknowledge', {
    ...opts,
    command: {
      shortageId: opts.shortageId,
      ...(opts.note != null ? { note: opts.note } : {}),
      ...(opts.command ?? {}),
    },
  }),
)
export const g5ResolveShortageManual = namedG5('planning.shortage.resolveManual', (opts) =>
  wrapG5Call('planning.shortage.resolveManual', {
    ...opts,
    command: {
      shortageId: opts.shortageId,
      reason: opts.reason,
      note: opts.note ?? opts.reason,
      ...(opts.command ?? {}),
    },
  }),
)
export const g5ProductionRecommendationCreateManual = namedG5(
  'planning.productionRecommendation.createManual',
  (opts) => wrapG5Call('planning.productionRecommendation.createManual', opts),
)

export const g5ProcurementDomainActivate = namedG5('procurement.domain.activate', (opts) =>
  wrapG5Call('procurement.domain.activate', opts),
)
export const g5GenerateProcurementDrafts = namedG5('procurement.generateDraftsFromMrp', (opts) =>
  wrapG5Call('procurement.generateDraftsFromMrp', {
    ...opts,
    command: { planningRunId: opts.planningRunId, ...(opts.command ?? {}) },
  }),
)
export const g5ProcurementDraftEdit = namedG5('procurement.draft.edit', (opts) =>
  wrapG5Call('procurement.draft.edit', opts),
)
export const g5ProcurementOrderChange = namedG5('procurement.order.change', (opts) =>
  wrapG5Call('procurement.order.change', opts),
)
export const g5ProcurementSubmit = namedG5('procurement.order.submit', (opts) =>
  wrapG5Call('procurement.order.submit', opts),
)
export const g5ProcurementApprove = namedG5('procurement.order.approve', (opts) =>
  wrapG5Call('procurement.order.approve', opts),
)
export const g5ProcurementMarkOrdered = namedG5('procurement.order.markOrdered', (opts) =>
  wrapG5Call('procurement.order.markOrdered', opts),
)
export const g5ProcurementCancel = namedG5('procurement.order.cancel', (opts) =>
  wrapG5Call('procurement.order.cancel', opts),
)
export const g5ProcurementReceiptPost = namedG5('procurement.receipt.post', (opts) =>
  wrapG5Call('procurement.receipt.post', opts),
)
export const g5ProcurementPaymentRecord = namedG5('procurement.payment.record', (opts) =>
  wrapG5Call('procurement.payment.record', opts),
)

/** Fail-closed UI helper: never mirror server ack when executeG5Command failed. */
export function mirrorG5AckIfOk(
  store: AppStore,
  result: G5ServerResult<G5AckPayload>,
): AppStore | null {
  if (!result.ok) return null
  return mirrorG5Ack(store, result.data)
}

/**
 * Static matrix for coverage tests (wrapper export name → commandType).
 *   g5MasterdataDomainActivate → masterdata.domain.activate
 *   g5MasterdataItemUpsert → masterdata.item.upsert
 *   … (see rows below)
 */
export const G5_UI_GATEWAY_MATRIX: ReadonlyArray<{ wrapper: string; commandType: G5CommandType }> =
  [
    { wrapper: 'g5MasterdataDomainActivate', commandType: 'masterdata.domain.activate' },
    { wrapper: 'g5MasterdataItemUpsert', commandType: 'masterdata.item.upsert' },
    { wrapper: 'g5MasterdataItemArchive', commandType: 'masterdata.item.archive' },
    { wrapper: 'g5MasterdataProductUpsert', commandType: 'masterdata.product.upsert' },
    { wrapper: 'g5MasterdataProductArchive', commandType: 'masterdata.product.archive' },
    { wrapper: 'g5MasterdataCustomerUpsert', commandType: 'masterdata.customer.upsert' },
    { wrapper: 'g5MasterdataCustomerArchive', commandType: 'masterdata.customer.archive' },
    { wrapper: 'g5MasterdataSupplierUpsert', commandType: 'masterdata.supplier.upsert' },
    { wrapper: 'g5MasterdataSupplierArchive', commandType: 'masterdata.supplier.archive' },
    { wrapper: 'g5MasterdataBomUpsert', commandType: 'masterdata.bom.upsert' },
    { wrapper: 'g5MasterdataBomApprove', commandType: 'masterdata.bom.approve' },
    { wrapper: 'g5MasterdataBomArchive', commandType: 'masterdata.bom.archive' },
    { wrapper: 'g5SalesDomainActivate', commandType: 'sales.domain.activate' },
    { wrapper: 'g5SalesDraftSave', commandType: 'sales.order.draft.save' },
    { wrapper: 'g5SalesDraftDelete', commandType: 'sales.order.draft.delete' },
    { wrapper: 'g5SalesConfirm', commandType: 'sales.order.confirm' },
    { wrapper: 'g5SalesChange', commandType: 'sales.order.change' },
    { wrapper: 'g5SalesCancel', commandType: 'sales.order.cancel' },
    { wrapper: 'g5SalesPriority', commandType: 'sales.order.priority.set' },
    { wrapper: 'g5SalesFulfillmentSync', commandType: 'sales.fulfillment.syncFromShipments' },
    { wrapper: 'g5SalesShipmentPost', commandType: 'sales.shipment.post' },
    { wrapper: 'g5SalesShipmentCancel', commandType: 'sales.shipment.cancel' },
    { wrapper: 'g5RunMrp', commandType: 'planning.mrp.run' },
    { wrapper: 'g5AcceptProductionDrafts', commandType: 'planning.mrp.acceptProductionDrafts' },
    { wrapper: 'g5AcknowledgeShortage', commandType: 'planning.shortage.acknowledge' },
    { wrapper: 'g5ResolveShortageManual', commandType: 'planning.shortage.resolveManual' },
    {
      wrapper: 'g5ProductionRecommendationCreateManual',
      commandType: 'planning.productionRecommendation.createManual',
    },
    { wrapper: 'g5ProcurementDomainActivate', commandType: 'procurement.domain.activate' },
    { wrapper: 'g5GenerateProcurementDrafts', commandType: 'procurement.generateDraftsFromMrp' },
    { wrapper: 'g5ProcurementDraftEdit', commandType: 'procurement.draft.edit' },
    { wrapper: 'g5ProcurementOrderChange', commandType: 'procurement.order.change' },
    { wrapper: 'g5ProcurementSubmit', commandType: 'procurement.order.submit' },
    { wrapper: 'g5ProcurementApprove', commandType: 'procurement.order.approve' },
    { wrapper: 'g5ProcurementMarkOrdered', commandType: 'procurement.order.markOrdered' },
    { wrapper: 'g5ProcurementCancel', commandType: 'procurement.order.cancel' },
    { wrapper: 'g5ProcurementReceiptPost', commandType: 'procurement.receipt.post' },
    { wrapper: 'g5ProcurementPaymentRecord', commandType: 'procurement.payment.record' },
  ] as const

/**
 * Conservatively merge G5 server ack into AppStore shapes.
 * Prefer server sales/procurement/masterData when present; warehouse/production only when returned.
 */
export function mirrorG5Ack(store: AppStore, server: G5AckPayload): AppStore {
  let next = withG5ActivationOnStore(store, {
    masterDataActive: server.masterDataActive,
    salesPlanningActive: server.salesPlanningActive,
    procurementActive: server.procurementActive,
    domainMeta: server.domainMeta,
  })

  if (server.warehouse) {
    next = {
      ...next,
      warehouse: {
        ...next.warehouse,
        ...server.warehouse,
        documents: server.warehouse.documents ?? next.warehouse.documents,
        movements: server.warehouse.movements ?? next.warehouse.movements,
        loadingShipments: server.warehouse.loadingShipments ?? next.warehouse.loadingShipments,
        auditLog: server.warehouse.auditLog ?? next.warehouse.auditLog,
        closedMonths: server.warehouse.closedMonths ?? next.warehouse.closedMonths,
      },
    }
  }

  if (server.production) {
    next = {
      ...next,
      production: {
        ...next.production,
        ...(server.production as typeof next.production),
        g5MasterDataActive: g5FlagsFromStore(next).masterDataActive,
        g5SalesPlanningActive: g5FlagsFromStore(next).salesPlanningActive,
        g5ProcurementActive: g5FlagsFromStore(next).procurementActive,
        g5CriticalRevision: server.criticalRevision,
      } as typeof next.production,
    }
  } else if (server.criticalRevision != null) {
    next = {
      ...next,
      production: {
        ...next.production,
        g5CriticalRevision: server.criticalRevision,
      } as typeof next.production,
    }
  }

  // Mirror master-data customers/suppliers → counterparties (UI store) when provided.
  if (server.masterData) {
    const fps = Array.isArray(server.masterData.finishedProducts)
      ? server.masterData.finishedProducts
      : null
    if (fps) {
      const byId = new Map(
        next.finishedProducts.items.map((p) => [p.id, p] as const),
      )
      for (const raw of fps) {
        const row = raw as Record<string, unknown>
        const id = String(row.id ?? '')
        if (!id) continue
        const prev = byId.get(id)
        byId.set(id, {
          ...(prev ?? {
            id,
            code: String(row.code ?? id),
            name: String(row.name ?? ''),
            category: 'ratl1' as const,
            active: row.active !== false,
            createdAt: String(row.updatedAt ?? new Date().toISOString()),
            updatedAt: String(row.updatedAt ?? new Date().toISOString()),
          }),
          id,
          code: String(row.code ?? prev?.code ?? id),
          name: String(row.name ?? prev?.name ?? ''),
          active: row.archived === true ? false : row.active !== false,
          updatedAt: String(row.updatedAt ?? prev?.updatedAt ?? new Date().toISOString()),
        } as (typeof next.finishedProducts.items)[number])
      }
      next = {
        ...next,
        finishedProducts: {
          ...next.finishedProducts,
          items: [...byId.values()],
        },
      }
    }

    const customers = Array.isArray(server.masterData.customers)
      ? server.masterData.customers
      : []
    const suppliers = Array.isArray(server.masterData.suppliers)
      ? server.masterData.suppliers
      : []
    if (customers.length || suppliers.length) {
      const byId = new Map(next.counterparties.items.map((c) => [c.id, c] as const))
      for (const raw of customers) {
        const row = raw as Record<string, unknown>
        const id = String(row.id ?? '')
        if (!id) continue
        const prev = byId.get(id)
        byId.set(id, {
          ...(prev ?? {
            id,
            code: String(row.code ?? id),
            name: String(row.name ?? ''),
            role: 'customer' as const,
            bankAccounts: [],
            contracts: [],
            active: true,
            createdAt: String(row.updatedAt ?? new Date().toISOString()),
            updatedAt: String(row.updatedAt ?? new Date().toISOString()),
          }),
          id,
          code: String(row.code ?? prev?.code ?? id),
          name: String(row.name ?? prev?.name ?? ''),
          role:
            prev?.role === 'supplier' || prev?.role === 'both'
              ? 'both'
              : ('customer' as const),
          active: row.archived === true ? false : row.active !== false,
          updatedAt: String(row.updatedAt ?? prev?.updatedAt ?? new Date().toISOString()),
        })
      }
      for (const raw of suppliers) {
        const row = raw as Record<string, unknown>
        const id = String(row.id ?? '')
        if (!id) continue
        const prev = byId.get(id)
        byId.set(id, {
          ...(prev ?? {
            id,
            code: String(row.code ?? id),
            name: String(row.name ?? ''),
            role: 'supplier' as const,
            bankAccounts: [],
            contracts: [],
            active: true,
            createdAt: String(row.updatedAt ?? new Date().toISOString()),
            updatedAt: String(row.updatedAt ?? new Date().toISOString()),
          }),
          id,
          code: String(row.code ?? prev?.code ?? id),
          name: String(row.name ?? prev?.name ?? ''),
          role:
            prev?.role === 'customer' || prev?.role === 'both'
              ? 'both'
              : ('supplier' as const),
          active: row.archived === true ? false : row.active !== false,
          updatedAt: String(row.updatedAt ?? prev?.updatedAt ?? new Date().toISOString()),
        })
      }
      next = {
        ...next,
        counterparties: {
          ...next.counterparties,
          items: [...byId.values()],
        },
      }
    }
  }

  if (server.sales?.orders) {
    const serverOrders = server.sales.orders as Array<Record<string, unknown>>
    const byId = new Map(next.sales.orders.map((o) => [o.id, o] as const))
    for (const row of serverOrders) {
      const id = String(row.id ?? '')
      if (!id) continue
      const prev = byId.get(id)
      if (prev) {
        byId.set(id, {
          ...prev,
          ...row,
          id,
          lines: Array.isArray(row.lines) ? (row.lines as typeof prev.lines) : prev.lines,
          updatedAt: String(row.updatedAt ?? prev.updatedAt),
        } as typeof prev)
      }
    }
    next = {
      ...next,
      sales: {
        ...next.sales,
        orders: [...byId.values()],
      },
    }
  }

  if (server.procurement?.orders) {
    const serverOrders = server.procurement.orders as Array<Record<string, unknown>>
    const byId = new Map(next.procurement.orders.map((o) => [o.id, o] as const))
    for (const row of serverOrders) {
      const id = String(row.id ?? '')
      if (!id) continue
      const prev = byId.get(id)
      if (prev) {
        byId.set(id, {
          ...prev,
          ...row,
          id,
          lines: Array.isArray(row.lines) ? (row.lines as typeof prev.lines) : prev.lines,
          updatedAt: String(row.updatedAt ?? prev.updatedAt),
        } as typeof prev)
      }
    }
    next = {
      ...next,
      procurement: {
        ...next.procurement,
        orders: [...byId.values()],
      },
    }
  }

  return next
}

export { g5FlagsFromStore, withG5ActivationOnStore }
export type { G5ActivationFlags }
