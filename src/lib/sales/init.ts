import type { PlannerOrderCategory } from '@/lib/planner/types'
import { emptyLineProgress, recalculateSalesOrderProgress } from './progress'
import {
  applyManualLegacyStatus,
  deriveLegacySalesStatus,
  splitLegacySalesStatus,
} from './statuses'
import type {
  SalesCommercialStatus,
  SalesFulfillmentStatus,
  SalesLabelType,
  SalesOrder,
  SalesOrderLine,
  SalesOrderPriority,
  SalesOrderStatus,
  SalesProductionAllocation,
  SalesStockReservation,
  SalesStore,
} from './types'

const VALID_STATUSES = new Set<SalesOrderStatus>([
  'draft',
  'confirmed',
  'in_production',
  'shipped',
  'completed',
  'cancelled',
])

const VALID_COMMERCIAL = new Set<SalesCommercialStatus>([
  'draft',
  'confirmed',
  'on_hold',
  'cancelled',
  'completed',
])

const VALID_FULFILLMENT = new Set<SalesFulfillmentStatus>([
  'unplanned',
  'partially_planned',
  'planned',
  'in_production',
  'partially_ready',
  'ready_to_ship',
  'partially_shipped',
  'shipped',
])

const VALID_CATEGORIES = new Set<PlannerOrderCategory>([
  'ratl1',
  'ratl2',
  'cat4',
  'cat31',
  'cat32',
])

const VALID_LABEL_TYPES = new Set<SalesLabelType>(['none', 'ours', 'customer'])

export function createDefaultSales(): SalesStore {
  return { orders: [], nextOrderSeq: 1, reservations: [], allocations: [] }
}

/** Номер заказа клиента: ЗК-YYYY-NNN */
export function formatSalesOrderNumber(year: number, seq: number): string {
  return `ЗК-${year}-${String(seq).padStart(3, '0')}`
}

function genId(): string {
  return crypto.randomUUID()
}

export function emptySalesLine(): SalesOrderLine {
  return {
    id: genId(),
    productName: '',
    category: 'ratl1',
    qtyMp: 0,
    productionOrderIds: [],
    progress: emptyLineProgress(0),
  }
}

export function emptySalesOrder(orderDate: string): SalesOrder {
  const now = new Date().toISOString()
  return {
    id: genId(),
    orderNumber: '',
    counterpartyId: undefined,
    customer: '',
    status: 'draft',
    commercialStatus: 'draft',
    fulfillmentStatus: 'unplanned',
    priority: 'normal',
    orderDate,
    dueDate: undefined,
    lines: [emptySalesLine()],
    note: undefined,
    history: [],
    createdAt: now,
    updatedAt: now,
  }
}

function normalizeLine(raw: SalesOrderLine): SalesOrderLine {
  const rollWidthM =
    raw.rollWidthM && raw.rollWidthM > 0 ? Number(raw.rollWidthM) : undefined
  const qtyAreaM2 = raw.qtyAreaM2 && raw.qtyAreaM2 > 0 ? Number(raw.qtyAreaM2) : undefined
  let qtyMp = Number(raw.qtyMp) || 0
  if (qtyAreaM2 && rollWidthM && !qtyMp) {
    qtyMp = Math.round(qtyAreaM2 / rollWidthM)
  }
  const cancelledQty = Math.max(0, Number(raw.cancelledQty) || 0)
  return {
    id: raw.id || genId(),
    finishedProductId: raw.finishedProductId,
    productName: raw.productName ?? '',
    category: VALID_CATEGORIES.has(raw.category) ? raw.category : 'ratl1',
    colorLogo: raw.colorLogo,
    productColor: raw.productColor,
    qtyMp,
    cancelledQty: cancelledQty > 0 ? cancelledQty : undefined,
    qtyAreaM2,
    rollWidthM,
    targetGsm: raw.targetGsm && raw.targetGsm > 0 ? Number(raw.targetGsm) : undefined,
    labelType:
      raw.labelType && VALID_LABEL_TYPES.has(raw.labelType) ? raw.labelType : undefined,
    labelNote: raw.labelNote?.trim() || undefined,
    preferredLineId: raw.preferredLineId,
    productionOrderIds: Array.isArray(raw.productionOrderIds)
      ? raw.productionOrderIds.filter(Boolean)
      : [],
    progress: raw.progress ?? emptyLineProgress(qtyMp),
    rolls: raw.rolls && raw.rolls > 0 ? Number(raw.rolls) : undefined,
    boxes: raw.boxes && raw.boxes > 0 ? Number(raw.boxes) : undefined,
    palletPlaces: raw.palletPlaces && raw.palletPlaces > 0 ? Number(raw.palletPlaces) : undefined,
    rollsPerBox: raw.rollsPerBox && raw.rollsPerBox > 0 ? Number(raw.rollsPerBox) : undefined,
    rollLengthM: raw.rollLengthM && raw.rollLengthM > 0 ? Number(raw.rollLengthM) : undefined,
    loadingShipmentId: raw.loadingShipmentId || undefined,
    note: raw.note,
  }
}

function normalizeReservation(raw: SalesStockReservation): SalesStockReservation | null {
  if (!raw?.id || !raw.salesOrderId || !raw.salesLineId || !raw.warehouseItemId) return null
  const reservationType =
    raw.reservationType === 'shipment' ? 'shipment' : 'sales_order'
  const status =
    raw.status === 'released' || raw.status === 'consumed' ? raw.status : 'active'
  return {
    id: raw.id,
    salesOrderId: raw.salesOrderId,
    salesLineId: raw.salesLineId,
    warehouseItemId: raw.warehouseItemId,
    quantity: Math.max(0, Number(raw.quantity) || 0),
    reservationType,
    status,
    warehouseMovementId: raw.warehouseMovementId,
    createdAt: raw.createdAt || new Date().toISOString(),
    note: raw.note,
  }
}

function normalizeAllocation(raw: SalesProductionAllocation): SalesProductionAllocation | null {
  if (!raw?.id || !raw.salesOrderId || !raw.salesLineId || !raw.productionOrderId) return null
  const status =
    raw.status === 'cancelled' || raw.status === 'completed' ? raw.status : 'active'
  return {
    id: raw.id,
    salesOrderId: raw.salesOrderId,
    salesLineId: raw.salesLineId,
    productionOrderId: raw.productionOrderId,
    plannedGoodQty: Math.max(0, Number(raw.plannedGoodQty) || 0),
    producedAllocatedQty: Math.max(0, Number(raw.producedAllocatedQty) || 0),
    readyAllocatedQty: Math.max(0, Number(raw.readyAllocatedQty) || 0),
    shippedQty: Math.max(0, Number(raw.shippedQty) || 0),
    status,
    createdAt: raw.createdAt || new Date().toISOString(),
  }
}

function normalizeOrder(
  raw: SalesOrder,
  allocations: SalesProductionAllocation[],
  reservations: SalesStockReservation[],
): SalesOrder {
  const now = new Date().toISOString()
  const legacyStatus: SalesOrderStatus =
    raw.status && VALID_STATUSES.has(raw.status) ? raw.status : 'draft'

  let commercialStatus: SalesCommercialStatus
  let fulfillmentStatus: SalesFulfillmentStatus
  if (raw.commercialStatus && VALID_COMMERCIAL.has(raw.commercialStatus)) {
    commercialStatus = raw.commercialStatus
    fulfillmentStatus =
      raw.fulfillmentStatus && VALID_FULFILLMENT.has(raw.fulfillmentStatus)
        ? raw.fulfillmentStatus
        : splitLegacySalesStatus(legacyStatus).fulfillmentStatus
  } else {
    const split = splitLegacySalesStatus(legacyStatus)
    commercialStatus = split.commercialStatus
    fulfillmentStatus = split.fulfillmentStatus
  }

  const priority: SalesOrderPriority = raw.priority === 'urgent' ? 'urgent' : 'normal'
  const base: SalesOrder = {
    id: raw.id || genId(),
    orderNumber: raw.orderNumber ?? '',
    counterpartyId: raw.counterpartyId,
    customer: raw.customer ?? '',
    status: legacyStatus,
    commercialStatus,
    fulfillmentStatus,
    priority,
    orderDate: raw.orderDate?.slice(0, 10) || now.slice(0, 10),
    dueDate: raw.dueDate?.slice(0, 10) || undefined,
    region: raw.region?.trim() || undefined,
    logistics: raw.logistics?.trim() || undefined,
    suggestedProductionStart: raw.suggestedProductionStart?.slice(0, 10) || undefined,
    loadingShipmentIds: Array.isArray(raw.loadingShipmentIds)
      ? raw.loadingShipmentIds.filter(Boolean)
      : [],
    combinedLoadingShipmentId: raw.combinedLoadingShipmentId || undefined,
    lines: Array.isArray(raw.lines) ? raw.lines.map(normalizeLine) : [],
    note: raw.note,
    history: Array.isArray(raw.history) ? raw.history : [],
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now,
  }

  const withProgress = recalculateSalesOrderProgress(base, allocations, reservations)
  return {
    ...withProgress,
    status: deriveLegacySalesStatus(
      withProgress.commercialStatus,
      withProgress.fulfillmentStatus,
    ),
  }
}

export function normalizeSalesStore(raw: SalesStore | undefined): SalesStore {
  if (!raw || !Array.isArray(raw.orders)) return createDefaultSales()
  const reservations = (Array.isArray(raw.reservations) ? raw.reservations : [])
    .map(normalizeReservation)
    .filter((r): r is SalesStockReservation => !!r)
  const allocations = (Array.isArray(raw.allocations) ? raw.allocations : [])
    .map(normalizeAllocation)
    .filter((a): a is SalesProductionAllocation => !!a)

  // Legacy: строка уже имеет productionOrderIds без allocations — создаём аллокации
  const knownAllocPo = new Set(allocations.map((a) => a.productionOrderId))
  const healedAllocs = [...allocations]
  for (const order of raw.orders) {
    for (const line of order.lines ?? []) {
      for (const poId of line.productionOrderIds ?? []) {
        if (!poId || knownAllocPo.has(poId)) continue
        knownAllocPo.add(poId)
        healedAllocs.push({
          id: genId(),
          salesOrderId: order.id,
          salesLineId: line.id,
          productionOrderId: poId,
          plannedGoodQty: Math.max(0, Number(line.qtyMp) || 0),
          producedAllocatedQty: 0,
          readyAllocatedQty: 0,
          shippedQty: 0,
          status: 'active',
          createdAt: order.createdAt || new Date().toISOString(),
        })
      }
    }
  }

  const orders = raw.orders.map((o) => normalizeOrder(o, healedAllocs, reservations))
  const maxSeq = orders.reduce((max, o) => {
    const m = /-(\d+)$/.exec(o.orderNumber || '')
    const n = m ? parseInt(m[1]!, 10) : 0
    return Number.isFinite(n) ? Math.max(max, n) : max
  }, 0)
  return {
    orders,
    nextOrderSeq: Math.max(raw.nextOrderSeq ?? 1, maxSeq + 1, 1),
    reservations,
    allocations: healedAllocs,
  }
}

/** Применить ручную смену legacy-статуса (канбан) */
export function applySalesLegacyStatusChange(
  _order: SalesOrder,
  status: SalesOrderStatus,
): Pick<SalesOrder, 'status' | 'commercialStatus' | 'fulfillmentStatus'> {
  const dual = applyManualLegacyStatus(status)
  return {
    status,
    commercialStatus: dual.commercialStatus,
    fulfillmentStatus: dual.fulfillmentStatus,
  }
}
