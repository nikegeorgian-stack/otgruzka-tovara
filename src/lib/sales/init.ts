import type { PlannerOrderCategory } from '@/lib/planner/types'
import type {
  SalesLabelType,
  SalesOrder,
  SalesOrderLine,
  SalesOrderPriority,
  SalesOrderStatus,
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

const VALID_CATEGORIES = new Set<PlannerOrderCategory>([
  'ratl1',
  'ratl2',
  'cat4',
  'cat31',
  'cat32',
])

const VALID_LABEL_TYPES = new Set<SalesLabelType>(['none', 'ours', 'customer'])

export function createDefaultSales(): SalesStore {
  return { orders: [], nextOrderSeq: 1 }
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
  return {
    id: raw.id || genId(),
    finishedProductId: raw.finishedProductId,
    productName: raw.productName ?? '',
    category: VALID_CATEGORIES.has(raw.category) ? raw.category : 'ratl1',
    colorLogo: raw.colorLogo,
    productColor: raw.productColor,
    qtyMp,
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
    rolls: raw.rolls && raw.rolls > 0 ? Number(raw.rolls) : undefined,
    boxes: raw.boxes && raw.boxes > 0 ? Number(raw.boxes) : undefined,
    palletPlaces: raw.palletPlaces && raw.palletPlaces > 0 ? Number(raw.palletPlaces) : undefined,
    rollsPerBox: raw.rollsPerBox && raw.rollsPerBox > 0 ? Number(raw.rollsPerBox) : undefined,
    rollLengthM: raw.rollLengthM && raw.rollLengthM > 0 ? Number(raw.rollLengthM) : undefined,
    loadingShipmentId: raw.loadingShipmentId || undefined,
    note: raw.note,
  }
}

function normalizeOrder(raw: SalesOrder): SalesOrder {
  const now = new Date().toISOString()
  const status: SalesOrderStatus =
    raw.status && VALID_STATUSES.has(raw.status) ? raw.status : 'draft'
  const priority: SalesOrderPriority = raw.priority === 'urgent' ? 'urgent' : 'normal'
  return {
    id: raw.id || genId(),
    orderNumber: raw.orderNumber ?? '',
    counterpartyId: raw.counterpartyId,
    customer: raw.customer ?? '',
    status,
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
}

export function normalizeSalesStore(raw: SalesStore | undefined): SalesStore {
  if (!raw || !Array.isArray(raw.orders)) return createDefaultSales()
  const orders = raw.orders.map(normalizeOrder)
  const maxSeq = orders.reduce((max, o) => {
    const m = /-(\d+)$/.exec(o.orderNumber || '')
    const n = m ? parseInt(m[1]!, 10) : 0
    return Number.isFinite(n) ? Math.max(max, n) : max
  }, 0)
  return {
    orders,
    nextOrderSeq: Math.max(raw.nextOrderSeq ?? 1, maxSeq + 1, 1),
  }
}
