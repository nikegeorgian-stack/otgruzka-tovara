import { emptyLineProgress } from './progress'
import { sha256Utf8 } from '@/lib/formulations/batchMixFingerprint.mjs'
import type {
  SalesFulfillmentStatus,
  SalesOrder,
  SalesOrderLine,
  SalesOrderStatus,
} from './types'

export const G5_SALES_ORDER_CONTRACT_VERSION = 'g5-sales-order-v1' as const

const SALES_ORDER_NUMBER_RE = /^ЗК-\d{4}-\d{3,}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const SERVER_STATUSES = new Set([
  'draft',
  'confirmed',
  'in_production',
  'partially_ready',
  'ready',
  'partially_shipped',
  'shipped',
  'fulfilled',
  'cancelled',
])

type ServerRow = Record<string, unknown>

function text(value: unknown): string {
  return String(value ?? '').trim()
}

function finiteNonNegative(value: unknown): boolean {
  return Number.isFinite(Number(value)) && Number(value) >= 0
}

function finitePositive(value: unknown): boolean {
  return Number.isFinite(Number(value)) && Number(value) > 0
}

function sameQty(left: unknown, right: unknown): boolean {
  return (
    Number.isFinite(Number(left)) &&
    Number.isFinite(Number(right)) &&
    Math.abs(Number(left) - Number(right)) <= 1e-6
  )
}

function validDate(value: unknown): boolean {
  const raw = text(value)
  if (!DATE_RE.test(raw)) return false
  const [year, month, day] = raw.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function uniqueNonEmpty(values: unknown[]): boolean {
  const ids = values.map(text)
  return ids.every(Boolean) && new Set(ids).size === ids.length
}

function sameIds(left: unknown, right: unknown): boolean {
  if (!Array.isArray(left) || !Array.isArray(right)) return false
  const a = left.map(text)
  const b = right.map(text)
  return uniqueNonEmpty(a) && uniqueNonEmpty(b) && stableJson(a) === stableJson(b)
}

function normalizedStatus(rawStatus: string): {
  status: SalesOrderStatus
  commercialStatus: SalesOrder['commercialStatus']
  fulfillmentStatus: SalesFulfillmentStatus
} {
  const status = (
    rawStatus === 'fulfilled'
      ? 'completed'
      : rawStatus === 'partially_shipped'
        ? 'shipped'
        : rawStatus === 'ready' || rawStatus === 'partially_ready'
          ? 'in_production'
          : rawStatus
  ) as SalesOrderStatus
  const commercialStatus =
    status === 'confirmed' || status === 'in_production' || status === 'shipped'
      ? 'confirmed'
      : status === 'completed'
        ? 'completed'
        : status === 'cancelled'
          ? 'cancelled'
          : 'draft'
  const fulfillmentStatus: SalesFulfillmentStatus =
    rawStatus === 'partially_shipped'
      ? 'partially_shipped'
      : rawStatus === 'ready'
        ? 'ready_to_ship'
        : rawStatus === 'partially_ready'
          ? 'partially_ready'
          : status === 'shipped' || status === 'completed'
            ? 'shipped'
            : status === 'in_production'
              ? 'in_production'
              : 'unplanned'
  return { status, commercialStatus, fulfillmentStatus }
}

function deriveDueDate(lines: ServerRow[], prev?: SalesOrder): string | undefined {
  const dates = [...new Set(lines.map((line) => text(line.requestedShipDate)).filter(Boolean))]
  if (dates.length === 1 && validDate(dates[0])) return dates[0]
  return dates.length === 0 ? prev?.dueDate : undefined
}

function mapLine(
  row: ServerRow,
  prev: SalesOrderLine | undefined,
  { strict }: { strict: boolean },
): SalesOrderLine {
  const id = text(row.lineId)
  const finishedProductId = text(row.finishedProductId)
  const quantity = Number(row.quantity)
  const unit = text(row.unit)
  const requestedShipDate = text(row.requestedShipDate)
  if (
    !id ||
    !finishedProductId ||
    !finitePositive(quantity) ||
    !unit ||
    (requestedShipDate && !validDate(requestedShipDate))
  ) {
    throw new Error('sales_order_schema_mismatch')
  }

  const linked = Array.isArray(row.linkedProductionOrderIds)
    ? row.linkedProductionOrderIds.map(text)
    : []
  if ((strict && !Array.isArray(row.linkedProductionOrderIds)) ||
      (!uniqueNonEmpty(linked) && linked.length > 0)) {
    throw new Error('sales_order_schema_mismatch')
  }

  const producedQty = Number(row.producedQty ?? 0)
  const releasedQty = Number(row.releasedQty ?? 0)
  const shippedQty = Number(row.shippedQty ?? 0)
  const remainingQty = Number(row.remainingQty ?? quantity - shippedQty)
  if (
    (strict &&
      (row.producedQty == null ||
        row.releasedQty == null ||
        row.shippedQty == null ||
        row.remainingQty == null)) ||
    !finiteNonNegative(producedQty) ||
    !finiteNonNegative(releasedQty) ||
    !finiteNonNegative(shippedQty) ||
    !finiteNonNegative(remainingQty) ||
    producedQty > quantity + 1e-6 ||
    releasedQty > quantity + 1e-6 ||
    shippedQty > quantity + 1e-6 ||
    !sameQty(remainingQty, Math.max(0, quantity - shippedQty))
  ) {
    throw new Error('sales_order_schema_mismatch')
  }

  const productName = text(row.productNameSnapshot ?? row.productName) || prev?.productName || ''
  if (strict && !productName) throw new Error('sales_order_schema_mismatch')
  const previousProgress = prev?.progress ?? emptyLineProgress(quantity)
  return {
    id,
    finishedProductId,
    productName,
    category: prev?.category ?? 'ratl1',
    qtyMp: quantity,
    unit,
    productionOrderIds: linked,
    progress: {
      ...previousProgress,
      orderedQty: quantity,
      productionStartedQty: producedQty,
      producedGoodQty: producedQty,
      qcApprovedQty: releasedQty,
      readyToShipQty: Math.max(releasedQty - shippedQty, 0),
      shippedQty,
      remainingToShipQty: remainingQty,
    },
    qtyAreaM2: prev?.qtyAreaM2,
    rollWidthM: prev?.rollWidthM,
    targetGsm: prev?.targetGsm,
    labelType: prev?.labelType,
    preferredLineId: prev?.preferredLineId,
    note: prev?.note,
  }
}

/**
 * Strict, version-aware projection of an authoritative G5 sales row.
 * Unversioned rows are a known legacy-v0 shape and remain visible, but an
 * unknown version or malformed identity/quantity graph is quarantined.
 */
export function coerceG5SalesOrderRow(row: ServerRow, prev?: SalesOrder): SalesOrder {
  const version = text(row.salesOrderContractVersion)
  if (version && version !== G5_SALES_ORDER_CONTRACT_VERSION) {
    throw new Error('sales_order_schema_version_unknown')
  }
  const strict = version === G5_SALES_ORDER_CONTRACT_VERSION
  const id = text(row.id)
  const rawStatus = text(row.status)
  const customerId = text(row.customerId)
  const orderNumber = text(row.orderNumber)
  const orderDate = text(row.orderDate)
  const rawLines = Array.isArray(row.lines) ? (row.lines as ServerRow[]) : []
  if (
    !id ||
    !SERVER_STATUSES.has(rawStatus) ||
    !customerId ||
    rawLines.length === 0 ||
    !uniqueNonEmpty(rawLines.map((line) => line.lineId)) ||
    (orderNumber && !SALES_ORDER_NUMBER_RE.test(orderNumber)) ||
    (orderDate && !validDate(orderDate))
  ) {
    throw new Error('sales_order_schema_mismatch')
  }
  if (strict && (!SALES_ORDER_NUMBER_RE.test(orderNumber) || !validDate(orderDate))) {
    throw new Error('sales_order_schema_mismatch')
  }

  const priorityRaw = Number(row.priority ?? 1)
  if (!Number.isFinite(priorityRaw) || (priorityRaw !== 1 && priorityRaw !== 10)) {
    throw new Error('sales_order_schema_mismatch')
  }
  const lines = rawLines.map((line) => {
    const lineId = text(line.lineId)
    return mapLine(line, prev?.lines.find((candidate) => candidate.id === lineId), { strict })
  })
  const customer = text(row.customerNameSnapshot ?? row.customer) || prev?.customer || ''
  if (strict && !customer) throw new Error('sales_order_schema_mismatch')
  const statuses = normalizedStatus(rawStatus)
  return {
    ...(prev ?? {
      id,
      orderNumber,
      customer,
      history: [],
      createdAt: text(row.createdAt),
    }),
    id,
    orderNumber,
    counterpartyId: customerId,
    customer,
    ...statuses,
    priority: priorityRaw === 10 ? 'urgent' : 'normal',
    orderDate,
    dueDate: deriveDueDate(rawLines, prev),
    lines,
    note: row.note != null ? text(row.note) || undefined : prev?.note,
    history: prev?.history ?? [],
    createdAt: text(row.createdAt) || prev?.createdAt || '',
    updatedAt: text(row.updatedAt) || prev?.updatedAt || '',
  }
}

export function coerceG5SalesOrderRows(
  rows: unknown[],
  previous: SalesOrder[] = [],
): SalesOrder[] {
  if (!Array.isArray(rows)) throw new Error('sales_order_schema_mismatch')
  const rawRows = rows.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error('sales_order_schema_mismatch')
    }
    return row as ServerRow
  })
  if (!uniqueNonEmpty(rawRows.map((row) => row.id))) {
    throw new Error('sales_order_schema_mismatch')
  }
  const previousById = new Map(previous.map((order) => [order.id, order] as const))
  return rawRows.map((row) => coerceG5SalesOrderRow(row, previousById.get(text(row.id))))
}

export type ExpectedG5SalesDraftAck = {
  orderId: string
  customerId: string
  priority: 1 | 10
  orderDate: string
  commandFingerprint?: string
  existingLineIds?: string[]
  lines: Array<{
    lineId?: string
    finishedProductId: string
    quantity: number
    unit: string
    requestedShipDate?: string
    productionOrderIds?: string[]
  }>
}

type SalesAck = {
  id?: unknown
  status?: unknown
  orderNumber?: unknown
  criticalRevision?: unknown
  idempotent?: unknown
  commandFingerprint?: unknown
  salesPlanningActive?: unknown
  order?: unknown
  sales?: { orders?: unknown[] }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const row = value as Record<string, unknown>
  return `{${Object.keys(row)
    .filter((key) => row[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(row[key])}`)
    .join(',')}}`
}

export function g5CommandFingerprint(
  commandType: string,
  command: Record<string, unknown>,
): string {
  const wireCommand = JSON.parse(JSON.stringify(command)) as Record<string, unknown>
  return `g5:${commandType}:v1:sha256:${sha256Utf8(stableJson(wireCommand))}`
}

export function g5SalesDraftCommandFingerprint(command: Record<string, unknown>): string {
  return g5CommandFingerprint('sales.order.draft.save', command)
}

export function validateG5SalesDraftSaveAck(
  data: SalesAck,
  previousCriticalRevision: number,
  expected: ExpectedG5SalesDraftAck,
):
  | { ok: true; criticalRevision: number; order: SalesOrder }
  | { ok: false; error: string } {
  const mismatch = { ok: false as const, error: 'sales_order_draft_ack_mismatch' }
  const revision = Number(data.criticalRevision)
  const replay = data.idempotent === true
  if (
    !Number.isInteger(revision) ||
    revision < Number(previousCriticalRevision || 0) ||
    (!replay && revision <= Number(previousCriticalRevision || 0)) ||
    data.salesPlanningActive !== true ||
    text(data.id) !== expected.orderId ||
    text(data.status) !== 'draft' ||
    !Array.isArray(data.sales?.orders)
  ) {
    return mismatch
  }
  let orders: SalesOrder[]
  try {
    orders = coerceG5SalesOrderRows(data.sales.orders)
  } catch {
    return mismatch
  }
  const matches = orders.filter((order) => order.id === expected.orderId)
  if (matches.length !== 1) return mismatch
  const order = matches[0]
  if (
    order.status !== 'draft' ||
    order.counterpartyId !== expected.customerId ||
    order.priority !== (expected.priority === 10 ? 'urgent' : 'normal') ||
    order.orderDate !== expected.orderDate ||
    order.orderNumber !== text(data.orderNumber) ||
    (expected.commandFingerprint != null &&
      text(data.commandFingerprint) !== expected.commandFingerprint)
  ) {
    return mismatch
  }
  if (!data.order || typeof data.order !== 'object' || Array.isArray(data.order)) return mismatch
  try {
    const resultOrder = coerceG5SalesOrderRow(data.order as ServerRow)
    if (stableJson(resultOrder) !== stableJson(order)) return mismatch
  } catch {
    return mismatch
  }

  if (order.lines.length !== expected.lines.length) return mismatch
  const existingIds = new Set((expected.existingLineIds ?? []).map(text).filter(Boolean))
  const remaining = [...order.lines]
  for (const line of expected.lines) {
    const requestedId = text(line.lineId)
    const index = remaining.findIndex(
      (candidate) =>
        (!existingIds.has(requestedId) || candidate.id === requestedId) &&
        candidate.finishedProductId === text(line.finishedProductId) &&
        sameQty(candidate.qtyMp, line.quantity) &&
        text(candidate.unit) === text(line.unit) &&
        sameIds(candidate.productionOrderIds, line.productionOrderIds ?? []),
    )
    if (index < 0) return mismatch
    const candidate = remaining[index]
    const raw = (data.sales?.orders as ServerRow[])
      .find((row) => text(row.id) === order.id)
      ?.lines as ServerRow[] | undefined
    const authoritative = raw?.find((row) => text(row.lineId) === candidate.id)
    if (
      !authoritative ||
      text(authoritative.requestedShipDate) !== text(line.requestedShipDate) ||
      Number(authoritative.producedQty ?? 0) !== 0 ||
      Number(authoritative.releasedQty ?? 0) !== 0 ||
      Number(authoritative.shippedQty ?? 0) !== 0 ||
      !sameQty(authoritative.remainingQty, line.quantity) ||
      !sameIds(
        authoritative.linkedProductionOrderIds,
        line.productionOrderIds ?? [],
      )
    ) {
      return mismatch
    }
    remaining.splice(index, 1)
  }
  if (remaining.length > 0) return mismatch
  return { ok: true, criticalRevision: revision, order }
}

export function validateG5SalesConfirmAck(
  data: SalesAck,
  previousCriticalRevision: number,
  expected: {
    commandFingerprint: string
    previousOrder: SalesOrder
  },
):
  | { ok: true; criticalRevision: number; order: SalesOrder }
  | { ok: false; error: string } {
  const mismatch = { ok: false as const, error: 'sales_order_confirm_ack_mismatch' }
  const revision = Number(data.criticalRevision)
  const replay = data.idempotent === true
  const previous = expected.previousOrder
  if (
    !Number.isInteger(revision) ||
    revision < Number(previousCriticalRevision || 0) ||
    (!replay && revision <= Number(previousCriticalRevision || 0)) ||
    data.salesPlanningActive !== true ||
    text(data.id) !== previous.id ||
    text(data.status) !== 'confirmed' ||
    text(data.commandFingerprint) !== expected.commandFingerprint ||
    !Array.isArray(data.sales?.orders)
  ) {
    return mismatch
  }
  let rows: SalesOrder[]
  try {
    rows = coerceG5SalesOrderRows(data.sales.orders, [previous])
  } catch {
    return mismatch
  }
  const matches = rows.filter((order) => order.id === previous.id)
  if (matches.length !== 1) return mismatch
  const order = matches[0]
  if (
    order.status !== 'confirmed' ||
    order.orderNumber !== previous.orderNumber ||
    order.counterpartyId !== previous.counterpartyId ||
    order.orderDate !== previous.orderDate ||
    order.priority !== previous.priority ||
    order.lines.length !== previous.lines.length
  ) {
    return mismatch
  }
  for (const previousLine of previous.lines) {
    const line = order.lines.find((candidate) => candidate.id === previousLine.id)
    if (
      !line ||
      line.finishedProductId !== previousLine.finishedProductId ||
      !sameQty(line.qtyMp, previousLine.qtyMp) ||
      text(line.unit) !== text(previousLine.unit ?? 'm2') ||
      !sameIds(line.productionOrderIds, previousLine.productionOrderIds ?? [])
    ) {
      return mismatch
    }
  }
  if (!data.order || typeof data.order !== 'object' || Array.isArray(data.order)) return mismatch
  try {
    const resultOrder = coerceG5SalesOrderRow(data.order as ServerRow, previous)
    if (stableJson(resultOrder) !== stableJson(order)) return mismatch
  } catch {
    return mismatch
  }
  return { ok: true, criticalRevision: revision, order }
}
