/**
 * PHASE G5 / G5.1 — web client for master-data / sales / MRP / procurement commands.
 */
import { getFirebaseAuth, isFirebaseConfigured } from '@/lib/cloud/firebase'
import { fstApiUrl } from '@/lib/cloud/fstApiOrigin'
import { FST_SHARED_STORE_DOC_ID } from '@/lib/cloud/firestoreSchema'
import type { AppStore } from '@/lib/types'
import type { WarehouseStore } from '@/lib/warehouse/types'
import type { PurchaseOrder, PurchaseOrderStatus } from '@/lib/procurement/types'
import {
  coerceG5SalesOrderRow,
  coerceG5SalesOrderRows,
} from '@/lib/sales/g5SalesOrderAuthority'
import { sha256Utf8 } from '@/lib/formulations/batchMixFingerprint.mjs'
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
  | 'procurement.draft.create'
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
  /** Present on many command acks; unused by mirror except optional replace hydrate. */
  ok?: boolean
  id?: string
  code?: string
  item?: unknown
  warehouseItemId?: string
  status?: string
  criticalRevision?: number
  masterDataActive?: boolean
  salesPlanningActive?: boolean
  procurementActive?: boolean
  packagingQcActive?: boolean
  productionActive?: boolean
  warehouseActive?: boolean
  /** When true with sales.orders, replace local sales.orders (G1 hydrate). */
  replaceSalesOrders?: boolean
  /** When true with procurement.orders, replace local procurement rows on authoritative pull. */
  replaceProcurementOrders?: boolean
  orderNumber?: string
  order?: unknown
  documentId?: string
  number?: string
  movementsCount?: number
  movementIds?: string[]
  document?: unknown
  movements?: unknown[]
  commandFingerprint?: string
  idempotent?: boolean
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

export function validateG5MasterdataItemUpsertAck(
  data: G5AckPayload,
  previousRevision: number,
  expected: {
    id: string
    code: string
    name: string
    baseUnit: string
    categoryId: string
    warehouseId: string
  },
): { ok: true; criticalRevision: number } | { ok: false; error: string } {
  const revision = Number(data.criticalRevision)
  const requestedCode = String(expected.code ?? '').trim()
  const acknowledgedCode = String(data.code ?? '').trim()
  const canonicalCode = requestedCode || acknowledgedCode
  if (
    !Number.isInteger(revision) ||
    revision <= Number(previousRevision || 0) ||
    String(data.id ?? '').trim() !== expected.id ||
    !canonicalCode ||
    acknowledgedCode !== canonicalCode ||
    (!requestedCode && !/^FC-\d{6}$/.test(canonicalCode))
  ) {
    return { ok: false, error: 'masterdata_item_ack_mismatch' }
  }
  const rows = Array.isArray(data.masterData?.items)
    ? (data.masterData.items as Array<Record<string, unknown>>).filter(
        (row) => String(row?.id ?? '').trim() === expected.id,
      )
    : []
  const resultItem =
    data.item && typeof data.item === 'object'
      ? (data.item as Record<string, unknown>)
      : undefined
  if (rows.length !== 1 || !resultItem) {
    return { ok: false, error: 'masterdata_item_ack_mismatch' }
  }
  const matches = (row: Record<string, unknown>) =>
    String(row.id ?? '').trim() === expected.id &&
    String(row.code ?? '').trim() === canonicalCode &&
    String(row.name ?? '').trim() === expected.name &&
    String(row.baseUnit ?? '').trim() === expected.baseUnit &&
    String(row.categoryId ?? '').trim() === expected.categoryId &&
    String(row.warehouseId ?? '').trim() === expected.warehouseId &&
    row.active === true &&
    row.archived !== true
  if (!matches(rows[0]) || !matches(resultItem)) {
    return { ok: false, error: 'masterdata_item_ack_mismatch' }
  }
  return { ok: true, criticalRevision: revision }
}
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
export const g5ProcurementDraftCreate = namedG5('procurement.draft.create', (opts) =>
  wrapG5Call('procurement.draft.create', opts),
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
    { wrapper: 'g5ProcurementDraftCreate', commandType: 'procurement.draft.create' },
    { wrapper: 'g5ProcurementDraftEdit', commandType: 'procurement.draft.edit' },
    { wrapper: 'g5ProcurementOrderChange', commandType: 'procurement.order.change' },
    { wrapper: 'g5ProcurementSubmit', commandType: 'procurement.order.submit' },
    { wrapper: 'g5ProcurementApprove', commandType: 'procurement.order.approve' },
    { wrapper: 'g5ProcurementMarkOrdered', commandType: 'procurement.order.markOrdered' },
    { wrapper: 'g5ProcurementCancel', commandType: 'procurement.order.cancel' },
    { wrapper: 'g5ProcurementReceiptPost', commandType: 'procurement.receipt.post' },
    { wrapper: 'g5ProcurementPaymentRecord', commandType: 'procurement.payment.record' },
  ] as const

const PROCUREMENT_ORDER_NUMBER_RE = /^ЗЗ-\d{4}-\d+$/
const PROCUREMENT_STATUSES = new Set([
  'draft',
  'submitted',
  'approved',
  'ordered',
  'production',
  'shipped',
  'in_transit',
  'customs',
  'arrived',
  'partially_received',
  'partial',
  'received',
  'cancelled',
])

function stableProcurementJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableProcurementJson).join(',')}]`
  const row = value as Record<string, unknown>
  return `{${Object.keys(row)
    .filter((key) => row[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableProcurementJson(row[key])}`)
    .join(',')}}`
}

function text(value: unknown): string {
  return String(value ?? '').trim()
}

function finitePositiveNumber(value: unknown): value is number {
  return Number.isFinite(Number(value)) && Number(value) > 0
}

function finiteNonNegativeNumber(value: unknown): value is number {
  return Number.isFinite(Number(value)) && Number(value) >= 0
}

function sameQuantity(left: unknown, right: unknown): boolean {
  return (
    Number.isFinite(Number(left)) &&
    Number.isFinite(Number(right)) &&
    Math.abs(Number(left) - Number(right)) <= 1e-6
  )
}

export function canonicalG5ProcurementCommand(
  commandType: 'procurement.draft.create' | 'procurement.receipt.post',
  command: Record<string, unknown>,
): Record<string, unknown> {
  if (commandType === 'procurement.draft.create') {
    const lines = (Array.isArray(command.lines)
      ? (command.lines as Array<Record<string, unknown>>)
      : []
    )
      .map((line) => ({
        itemId: text(line.itemId),
        requestedQty: Number(line.requestedQty ?? line.quantity),
        unit: text(line.unit),
        ...(line.requiredDate != null
          ? { requiredDate: text(line.requiredDate).slice(0, 10) }
          : {}),
        ...(line.unitPrice != null ? { unitPrice: Number(line.unitPrice) } : {}),
      }))
      .sort((left, right) =>
        stableProcurementJson(left).localeCompare(stableProcurementJson(right)),
      )
    return {
      id: text(command.id),
      supplierId: text(command.supplierId),
      destinationWarehouseId: text(
        command.destinationWarehouseId ?? command.warehouseId,
      ),
      orderDate: text(command.orderDate).slice(0, 10),
      ...(command.requestedDeliveryDate != null
        ? { requestedDeliveryDate: text(command.requestedDeliveryDate).slice(0, 10) }
        : {}),
      ...(command.scope != null ? { scope: text(command.scope) } : {}),
      ...(command.category != null ? { category: text(command.category) } : {}),
      ...(command.categoryId != null ? { categoryId: text(command.categoryId) } : {}),
      ...(command.currency != null ? { currency: text(command.currency) } : {}),
      lines,
    }
  }
  const lines = (Array.isArray(command.lines)
    ? (command.lines as Array<Record<string, unknown>>)
    : []
  )
    .map((line) => ({
      lineId: text(line.lineId),
      ...(line.itemId != null ? { itemId: text(line.itemId) } : {}),
      quantity: Number(line.quantity ?? line.receivedQty),
      ...(line.unit != null ? { unit: text(line.unit) } : {}),
      ...(line.locationId != null ? { locationId: text(line.locationId) } : {}),
      ...(line.batchNo != null ? { batchNo: text(line.batchNo) } : {}),
      ...(line.expiryDate != null
        ? { expiryDate: text(line.expiryDate).slice(0, 10) }
        : {}),
    }))
    .sort((left, right) => left.lineId.localeCompare(right.lineId))
  return {
    purchaseOrderId: text(command.purchaseOrderId ?? command.orderId ?? command.id),
    warehouseId: text(command.warehouseId),
    date: text(command.date).slice(0, 10),
    lines,
  }
}

export function g5ProcurementCommandFingerprint(
  commandType: 'procurement.draft.create' | 'procurement.receipt.post',
  command: Record<string, unknown>,
): string {
  return `procurement:${commandType}:v1:sha256:${sha256Utf8(
    stableProcurementJson(canonicalG5ProcurementCommand(commandType, command)),
  )}`
}

function normalizedProcurementStatus(value: unknown): string {
  const status = text(value)
  return status === 'partially_received' ? 'partial' : status
}

function assertUniqueNonEmptyIds(
  rows: Array<Record<string, unknown>>,
  key: string,
): boolean {
  const ids = rows.map((row) => text(row[key]))
  return ids.every(Boolean) && new Set(ids).size === ids.length
}

/**
 * Canonical G5 procurement row adapter. It never keeps client-side identity fields
 * when the authoritative row supplies a different schema.
 */
export function coerceG5ProcurementOrderRow(
  row: Record<string, unknown>,
  prev?: PurchaseOrder,
): PurchaseOrder {
  const id = text(row.id)
  const orderNumber = text(row.orderNumber)
  const supplierId = text(row.supplierId)
  const rawStatus = text(row.status)
  const orderDate = text(row.orderDate).slice(0, 10)
  const rawLines = Array.isArray(row.lines)
    ? (row.lines as Array<Record<string, unknown>>)
    : []
  if (
    !id ||
    !PROCUREMENT_ORDER_NUMBER_RE.test(orderNumber) ||
    !supplierId ||
    !PROCUREMENT_STATUSES.has(rawStatus) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(orderDate) ||
    rawLines.length === 0 ||
    !assertUniqueNonEmptyIds(rawLines, 'lineId')
  ) {
    throw new Error('procurement_order_schema_mismatch')
  }

  const lines = rawLines.map((line) => {
    const lineId = text(line.lineId)
    const itemId = text(line.itemId)
    const name = text(line.itemNameSnapshot)
    const unit = text(line.unit)
    const requestedQty = Number(line.requestedQty)
    const receivedQty = Number(line.receivedQty)
    if (
      !lineId ||
      !itemId ||
      !name ||
      !unit ||
      !finitePositiveNumber(requestedQty) ||
      !finiteNonNegativeNumber(receivedQty) ||
      receivedQty > requestedQty + 1e-6
    ) {
      throw new Error('procurement_order_schema_mismatch')
    }
    return {
      id: lineId,
      warehouseItemId: itemId,
      name,
      quantity: requestedQty,
      unit,
      receivedQty,
      unitPrice:
        line.unitPrice != null && finiteNonNegativeNumber(line.unitPrice)
          ? Number(line.unitPrice)
          : undefined,
    }
  })

  const scope = text(row.scope)
  const category = text(row.category)
  if (scope !== 'domestic' && scope !== 'international') {
    throw new Error('procurement_order_schema_mismatch')
  }
  if (!category) throw new Error('procurement_order_schema_mismatch')

  return {
    ...(prev ?? {
      id,
      orderNumber,
      counterpartyId: supplierId,
      scope: scope as PurchaseOrder['scope'],
      category: category as PurchaseOrder['category'],
      status: 'draft',
      orderDate,
      lines: [],
      legs: [],
      milestones: [],
      statusHistory: [],
      attachments: [],
      warehouseDocumentIds: [],
      createdAt: text(row.createdAt),
      updatedAt: text(row.updatedAt),
    }),
    id,
    orderNumber,
    counterpartyId: supplierId,
    scope: scope as PurchaseOrder['scope'],
    category: category as PurchaseOrder['category'],
    categoryId: text(row.categoryId) || undefined,
    status: normalizedProcurementStatus(rawStatus) as PurchaseOrderStatus,
    orderDate,
    requestedDeliveryDate: text(row.requestedDeliveryDate) || undefined,
    confirmedDeliveryDate: text(row.confirmedDeliveryDate) || undefined,
    destinationWarehouseId: text(row.destinationWarehouseId) || undefined,
    currency: text(row.currency) || undefined,
    lines,
    warehouseDocumentIds: Array.isArray(row.warehouseDocumentIds)
      ? [...new Set(row.warehouseDocumentIds.map(text).filter(Boolean))]
      : prev?.warehouseDocumentIds ?? [],
    createdAt: text(row.createdAt) || prev?.createdAt || '',
    updatedAt: text(row.updatedAt) || prev?.updatedAt || '',
    ...(Number.isInteger(Number(row.revision))
      ? { revision: Number(row.revision) }
      : {}),
  } as PurchaseOrder
}

export type ExpectedG5ProcurementOrderAck = {
  operation: 'create' | 'edit' | 'submit' | 'approve' | 'markOrdered' | 'cancel'
  orderId?: string
  status: string
  supplierId?: string
  destinationWarehouseId?: string
  commandFingerprint?: string
  lines: Array<{
    lineId?: string
    itemId: string
    requestedQty: number
    unit: string
  }>
}

export function validateG5ProcurementOrderAck(
  data: G5AckPayload,
  previousRevision: number,
  expected: ExpectedG5ProcurementOrderAck,
):
  | { ok: true; criticalRevision: number; order: PurchaseOrder }
  | { ok: false; error: string } {
  const revision = Number(data.criticalRevision)
  const replay = data.idempotent === true
  if (
    !Number.isInteger(revision) ||
    revision < Number(previousRevision || 0) ||
    (!replay && revision <= Number(previousRevision || 0)) ||
    !Array.isArray(data.procurement?.orders)
  ) {
    return { ok: false, error: 'procurement_order_ack_mismatch' }
  }
  const rawOrders = data.procurement.orders as Array<Record<string, unknown>>
  if (!assertUniqueNonEmptyIds(rawOrders, 'id')) {
    return { ok: false, error: 'procurement_order_ack_mismatch' }
  }
  const acknowledgedId = text(data.id)
  const targetId = text(expected.orderId) || acknowledgedId
  const matches = rawOrders.filter((row) => text(row.id) === targetId)
  if (!targetId || acknowledgedId !== targetId || matches.length !== 1) {
    return { ok: false, error: 'procurement_order_ack_mismatch' }
  }
  let order: PurchaseOrder
  try {
    order = coerceG5ProcurementOrderRow(matches[0])
  } catch {
    return { ok: false, error: 'procurement_order_ack_mismatch' }
  }
  if (
    normalizedProcurementStatus(data.status) !== normalizedProcurementStatus(expected.status) ||
    normalizedProcurementStatus(order.status) !== normalizedProcurementStatus(expected.status) ||
    text(data.orderNumber) !== order.orderNumber ||
    (expected.supplierId != null && order.counterpartyId !== text(expected.supplierId)) ||
    (expected.destinationWarehouseId != null &&
      order.destinationWarehouseId !== text(expected.destinationWarehouseId)) ||
    (expected.commandFingerprint != null &&
      text(data.commandFingerprint) !== expected.commandFingerprint)
  ) {
    return { ok: false, error: 'procurement_order_ack_mismatch' }
  }
  if (data.order == null) {
    return { ok: false, error: 'procurement_order_ack_mismatch' }
  }
  try {
    const resultOrder = coerceG5ProcurementOrderRow(
      data.order as Record<string, unknown>,
    )
    if (stableProcurementJson(resultOrder) !== stableProcurementJson(order)) {
      return { ok: false, error: 'procurement_order_ack_mismatch' }
    }
  } catch {
    return { ok: false, error: 'procurement_order_ack_mismatch' }
  }

  if (order.lines.length !== expected.lines.length) {
    return { ok: false, error: 'procurement_order_ack_mismatch' }
  }
  const remaining = [...order.lines]
  for (const expectedLine of expected.lines) {
    const index = remaining.findIndex(
      (line) =>
        (expected.operation === 'create' || line.id === text(expectedLine.lineId)) &&
        line.warehouseItemId === text(expectedLine.itemId) &&
        sameQuantity(line.quantity, expectedLine.requestedQty) &&
        line.unit === text(expectedLine.unit),
    )
    if (index < 0) return { ok: false, error: 'procurement_order_ack_mismatch' }
    remaining.splice(index, 1)
  }
  if (remaining.length > 0) {
    return { ok: false, error: 'procurement_order_ack_mismatch' }
  }
  return { ok: true, criticalRevision: revision, order }
}

export type ExpectedG5ProcurementReceiptAck = {
  purchaseOrderId: string
  warehouseId: string
  date: string
  commandFingerprint?: string
  lines: Array<{
    lineId: string
    itemId: string
    quantity: number
    unit?: string
    locationId?: string
    batchNo?: string
    expiryDate?: string
    expectedReceivedQty?: number
  }>
}

function movementBalance(
  rows: unknown[],
  tuple: { warehouseId: string; itemId: string; locationId?: string; batchNo?: string },
): number {
  return (rows as Array<Record<string, unknown>>).reduce((sum, movement) => {
    if (
      movement.cancelled === true ||
      text(movement.warehouseId) !== tuple.warehouseId ||
      text(movement.itemId) !== tuple.itemId ||
      text(movement.locationId) !== text(tuple.locationId) ||
      text(movement.batchNo) !== text(tuple.batchNo)
    ) {
      return sum
    }
    const qty = Number(movement.quantity)
    if (!Number.isFinite(qty)) return Number.NaN
    if (movement.type === 'receipt' || movement.type === 'in') return sum + qty
    if (movement.type === 'issue' || movement.type === 'out') return sum - qty
    return sum
  }, 0)
}

export function validateG5ProcurementReceiptAck(
  data: G5AckPayload,
  previousRevision: number,
  expected: ExpectedG5ProcurementReceiptAck,
  previousWarehouse?: Pick<WarehouseStore, 'movements'>,
):
  | { ok: true; criticalRevision: number; documentId: string; documentNumber: string }
  | { ok: false; error: string } {
  const mismatch = { ok: false as const, error: 'procurement_receipt_ack_mismatch' }
  const revision = Number(data.criticalRevision)
  const replay = data.idempotent === true
  const documentId = text(data.documentId)
  const documentNumber = text(data.number)
  if (
    !Number.isInteger(revision) ||
    revision < Number(previousRevision || 0) ||
    (!replay && revision <= Number(previousRevision || 0)) ||
    text((data as Record<string, unknown>).purchaseOrderId) !== expected.purchaseOrderId ||
    !documentId ||
    !documentNumber ||
    !Array.isArray(data.procurement?.orders) ||
    !Array.isArray(data.warehouse?.documents) ||
    !Array.isArray(data.warehouse?.movements) ||
    Number(data.movementsCount) !== expected.lines.length ||
    (expected.commandFingerprint != null &&
      text(data.commandFingerprint) !== expected.commandFingerprint)
  ) {
    return mismatch
  }

  const rawOrders = data.procurement.orders as Array<Record<string, unknown>>
  if (!assertUniqueNonEmptyIds(rawOrders, 'id')) return mismatch
  const orderRows = rawOrders.filter((row) => text(row.id) === expected.purchaseOrderId)
  if (orderRows.length !== 1) return mismatch
  let order: PurchaseOrder
  try {
    order = coerceG5ProcurementOrderRow(orderRows[0])
  } catch {
    return mismatch
  }

  const documents = data.warehouse.documents as Array<Record<string, unknown>>
  const documentRows = documents.filter((row) => text(row.id) === documentId)
  const poDocumentRows = documents.filter(
    (row) =>
      text(row.purchaseOrderId) === expected.purchaseOrderId &&
      (expected.commandFingerprint == null ||
        text(row.commandFingerprint) === expected.commandFingerprint),
  )
  if (documentRows.length !== 1 || poDocumentRows.length !== 1) return mismatch
  const document = documentRows[0]
  const documentLines = Array.isArray(document.lines)
    ? (document.lines as Array<Record<string, unknown>>)
    : []
  if (
    document.status !== 'posted' ||
    document.type !== 'receipt' ||
    document.purpose !== 'purchase' ||
    document.docRole !== 'procurement_receipt' ||
    text(document.purchaseOrderId) !== expected.purchaseOrderId ||
    text(document.warehouseId) !== expected.warehouseId ||
    text(document.date).slice(0, 10) !== expected.date ||
    text(document.number) !== documentNumber ||
    documentLines.length !== expected.lines.length ||
    !assertUniqueNonEmptyIds(documentLines, 'lineId')
  ) {
    return mismatch
  }

  const movements = (data.warehouse.movements as Array<Record<string, unknown>>).filter(
    (row) => text(row.documentId) === documentId,
  )
  if (
    movements.length !== expected.lines.length ||
    !assertUniqueNonEmptyIds(movements, 'id') ||
    movements.some((movement) => movement.cancelled === true)
  ) {
    return mismatch
  }

  for (const expectedLine of expected.lines) {
    const poLine = order.lines.find((line) => line.id === expectedLine.lineId)
    const matchingDocumentLines = documentLines.filter(
      (line) => text(line.purchaseOrderLineId) === expectedLine.lineId,
    )
    if (!poLine || matchingDocumentLines.length !== 1) return mismatch
    const documentLine = matchingDocumentLines[0]
    if (
      text(documentLine.itemId) !== expectedLine.itemId ||
      !finitePositiveNumber(documentLine.quantity) ||
      !sameQuantity(documentLine.quantity, expectedLine.quantity) ||
      (expectedLine.unit != null && text(documentLine.unitSnapshot) !== expectedLine.unit) ||
      text(documentLine.locationId) !== text(expectedLine.locationId) ||
      text(documentLine.batchNo) !== text(expectedLine.batchNo) ||
      text(documentLine.expiryDate) !== text(expectedLine.expiryDate) ||
      (expectedLine.expectedReceivedQty != null &&
        !sameQuantity(poLine.receivedQty, expectedLine.expectedReceivedQty))
    ) {
      return mismatch
    }
    const linkedMovements = movements.filter(
      (movement) => text(movement.documentLineId) === text(documentLine.lineId),
    )
    if (linkedMovements.length !== 1) return mismatch
    const movement = linkedMovements[0]
    if (
      movement.type !== 'receipt' ||
      text(movement.purchaseOrderId) !== expected.purchaseOrderId ||
      text(movement.purchaseOrderLineId) !== expectedLine.lineId ||
      text(movement.warehouseId) !== expected.warehouseId ||
      text(movement.itemId) !== expectedLine.itemId ||
      text(movement.locationId) !== text(expectedLine.locationId) ||
      text(movement.batchNo) !== text(expectedLine.batchNo) ||
      text(movement.expiryDate) !== text(expectedLine.expiryDate) ||
      (expectedLine.unit != null && text(movement.unitSnapshot) !== expectedLine.unit) ||
      text(movement.date).slice(0, 10) !== expected.date ||
      !finitePositiveNumber(movement.quantity) ||
      !sameQuantity(movement.quantity, expectedLine.quantity) ||
      (expected.commandFingerprint != null &&
        text(movement.commandFingerprint) !== expected.commandFingerprint)
    ) {
      return mismatch
    }

    if (previousWarehouse && replay !== true) {
      const tuple = {
        warehouseId: expected.warehouseId,
        itemId: expectedLine.itemId,
        locationId: expectedLine.locationId,
        batchNo: expectedLine.batchNo,
      }
      const before = movementBalance(previousWarehouse.movements, tuple)
      const after = movementBalance(data.warehouse.movements as unknown[], tuple)
      if (!sameQuantity(after - before, expectedLine.quantity)) return mismatch
    }
  }

  if (
    data.document == null ||
    stableProcurementJson(data.document) !== stableProcurementJson(document)
  ) {
    return mismatch
  }
  if (
    !Array.isArray(data.movements) ||
    data.movements.length !== movements.length ||
    !data.movements.every((row) =>
      movements.some(
        (movement) => stableProcurementJson(movement) === stableProcurementJson(row),
      ),
    )
  ) {
    return mismatch
  }
  return { ok: true, criticalRevision: revision, documentId, documentNumber }
}

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
    const loadingShipments = server.warehouse.loadingShipments
      ? server.warehouse.loadingShipments.map((authoritative) => {
          const local = next.warehouse.loadingShipments?.find(
            (shipment) => shipment.id === authoritative.id,
          )
          // Draft presentation fields (container/lines/human number) can live in the
          // soft UI store; authoritative G5 tuple/status always wins after ACK validation.
          return local ? { ...local, ...authoritative } : authoritative
        })
      : next.warehouse.loadingShipments
    next = {
      ...next,
      warehouse: {
        ...next.warehouse,
        ...server.warehouse,
        documents: server.warehouse.documents ?? next.warehouse.documents,
        movements: server.warehouse.movements ?? next.warehouse.movements,
        loadingShipments,
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
    const masterItems = Array.isArray(server.masterData.items) ? server.masterData.items : null
    if (masterItems) {
      const byId = new Map(next.warehouse.items.map((item) => [item.id, item] as const))
      for (const raw of masterItems) {
        const row = raw as Record<string, unknown>
        const id = String(row.id ?? '').trim()
        if (!id) continue
        const prev = byId.get(id)
        const unit = String(row.baseUnit ?? prev?.unit ?? '').trim()
        const internalCode = String(row.code ?? prev?.internalCode ?? '').trim()
        const name = String(row.name ?? prev?.name ?? '').trim()
        // G5 master-data may omit G2 placement fields. Never invent them from
        // the first local category/location: accept explicit authoritative
        // values or preserve the exact tuple of an already-known warehouse row.
        const categoryId =
          String(row.categoryId ?? '').trim() || String(prev?.categoryId ?? '').trim()
        const warehouseId =
          String(row.warehouseId ?? '').trim() || String(prev?.warehouseId ?? '').trim()
        if (!unit || !internalCode || !name || !categoryId || !warehouseId) continue
        byId.set(id, {
          ...(prev ?? {
            id,
            sortOrder: byId.size,
            createdAt: String(row.updatedAt ?? new Date().toISOString()),
          }),
          id,
          internalCode,
          name,
          categoryId,
          warehouseId,
          unit,
          active: row.archived === true ? false : row.active !== false,
        })
      }
      next = {
        ...next,
        warehouse: {
          ...next.warehouse,
          items: [...byId.values()],
        },
      }
    }

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
          warehouseItemId:
            String(row.warehouseItemId ?? prev?.warehouseItemId ?? '').trim() || undefined,
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
    const byId = new Map(
      server.replaceSalesOrders ? [] : next.sales.orders.map((o) => [o.id, o] as const),
    )
    const authoritative = coerceG5SalesOrderRows(serverOrders, [...byId.values()])
    for (const order of authoritative) {
      byId.set(order.id, order)
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
    const byId = new Map(
      server.replaceProcurementOrders
        ? []
        : next.procurement.orders.map((o) => [o.id, o] as const),
    )
    for (const row of serverOrders) {
      const id = String(row.id ?? '')
      if (!id) continue
      const prev = byId.get(id)
      try {
        byId.set(id, coerceG5ProcurementOrderRow(row, prev))
      } catch {
        // Quarantine incomplete authoritative rows instead of inventing IDs,
        // quantities, units or destination placement from local defaults.
      }
    }
    const orders = [...byId.values()]
    const nextOrderSeq = orders.reduce((max, order) => {
      const match = order.orderNumber.match(/^ЗЗ-\d{4}-(\d+)$/)
      return match ? Math.max(max, Number(match[1]) + 1) : max
    }, next.procurement.nextOrderSeq ?? 1)
    next = {
      ...next,
      procurement: {
        ...next.procurement,
        orders,
        nextOrderSeq,
      },
    }
  }

  return next
}

export { g5FlagsFromStore, withG5ActivationOnStore }
export { coerceG5SalesOrderRow }
export type { G5ActivationFlags }
