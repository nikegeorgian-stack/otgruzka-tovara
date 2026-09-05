import {
  buildDefaultProcurementCategories,
  buildDefaultRoutePoints,
  ensureProcurementCatalog,
  legacyFromCategoryId,
} from './catalog'
import { backfillStatusHistory, normalizeStatusChange } from './statusHistory'
import type {
  ContainerTracking,
  ProcurementCategoryNode,
  ProcurementStore,
  PurchaseOrder,
  PurchaseOrderAttachment,
  PurchaseOrderLine,
  RoutePoint,
  SeaCarrier,
  ShipmentLeg,
  TransportMode,
} from './types'

export function createDefaultProcurement(): ProcurementStore {
  return {
    orders: [],
    nextOrderSeq: 1,
    categories: buildDefaultProcurementCategories(),
    routePoints: buildDefaultRoutePoints(),
  }
}

function normalizeLine(raw: Partial<PurchaseOrderLine>): PurchaseOrderLine {
  return {
    id: raw.id ?? crypto.randomUUID(),
    warehouseItemId: raw.warehouseItemId,
    name: String(raw.name ?? '').trim() || '—',
    quantity: Number(raw.quantity) || 0,
    unit: raw.unit ?? 'шт',
    supplierSku: raw.supplierSku?.trim() || undefined,
    unitPrice: raw.unitPrice != null ? Number(raw.unitPrice) : undefined,
    currency: raw.currency,
    receivedQty: Number(raw.receivedQty) || 0,
    note: raw.note,
  }
}

function normalizeAttachment(raw: Partial<PurchaseOrderAttachment>): PurchaseOrderAttachment {
  return {
    id: raw.id ?? crypto.randomUUID(),
    name: String(raw.name ?? 'file').trim() || 'file',
    mimeType: raw.mimeType ?? 'application/octet-stream',
    kind: raw.kind ?? 'other',
    sizeBytes: Number(raw.sizeBytes) || 0,
    dataUrl: raw.dataUrl ?? '',
    uploadedAt: raw.uploadedAt ?? new Date().toISOString(),
    note: raw.note,
  }
}

function normalizeContainerTracking(
  raw: Partial<ContainerTracking> | undefined,
): ContainerTracking | undefined {
  if (!raw) return undefined
  const carrier = (['maersk', 'msc', 'cma-cgm'] as SeaCarrier[]).includes(
    raw.carrier as SeaCarrier,
  )
    ? (raw.carrier as SeaCarrier)
    : 'maersk'
  const referenceType =
    raw.referenceType === 'bl' || raw.referenceType === 'booking'
      ? raw.referenceType
      : 'container'
  if (!raw.enabled && !raw.reference?.trim()) return undefined
  return {
    enabled: Boolean(raw.enabled),
    carrier,
    reference: String(raw.reference ?? '').trim(),
    referenceType,
    lastSyncedAt: raw.lastSyncedAt,
    lastLocation: raw.lastLocation,
    lastEventLabel: raw.lastEventLabel,
    syncError: raw.syncError,
  }
}

const TRANSPORTS: TransportMode[] = ['truck', 'rail', 'sea', 'air', 'mixed']

function normalizeLeg(raw: Partial<ShipmentLeg>): ShipmentLeg {
  const mode = TRANSPORTS.includes(raw.transportMode as TransportMode)
    ? (raw.transportMode as TransportMode)
    : 'truck'
  return {
    id: raw.id ?? crypto.randomUUID(),
    sequence: Number(raw.sequence) || 1,
    transportMode: mode,
    carrier: raw.carrier,
    vesselOrTrain: raw.vesselOrTrain,
    origin: String(raw.origin ?? '').trim(),
    destination: String(raw.destination ?? '').trim(),
    originPointId: raw.originPointId,
    destinationPointId: raw.destinationPointId,
    plannedDepartureDate: raw.plannedDepartureDate,
    actualDepartureDate: raw.actualDepartureDate,
    etaDate: raw.etaDate,
    actualArrivalDate: raw.actualArrivalDate,
    trackingNumber: raw.trackingNumber,
    note: raw.note,
  }
}

function normalizeCategory(raw: Partial<ProcurementCategoryNode>, i: number): ProcurementCategoryNode {
  return {
    id: raw.id ?? crypto.randomUUID(),
    code: String(raw.code ?? '').trim() || String(i + 1).padStart(2, '0'),
    name: String(raw.name ?? '').trim() || '—',
    nameKa: raw.nameKa,
    parentId: raw.parentId,
    legacyKey: raw.legacyKey,
    active: raw.active !== false,
    sortOrder: raw.sortOrder ?? i,
  }
}

function normalizeRoutePoint(raw: Partial<RoutePoint>, i: number): RoutePoint {
  const modes = Array.isArray(raw.transportModes)
    ? raw.transportModes.filter((m): m is TransportMode => TRANSPORTS.includes(m))
    : (['truck'] as TransportMode[])
  return {
    id: raw.id ?? crypto.randomUUID(),
    code: String(raw.code ?? '').trim().toUpperCase() || `P${i + 1}`,
    name: String(raw.name ?? '').trim() || '—',
    kind: raw.kind ?? 'other',
    transportModes: modes.length ? modes : ['truck'],
    countryCode: raw.countryCode,
    active: raw.active !== false,
    sortOrder: raw.sortOrder ?? i,
    note: raw.note,
  }
}

function normalizeOrder(
  raw: Partial<PurchaseOrder>,
  categories: ProcurementCategoryNode[],
): PurchaseOrder {
  const now = new Date().toISOString()
  const categoryId = raw.categoryId
  const category =
    categoryId != null
      ? legacyFromCategoryId(categories, categoryId)
      : (raw.category ?? 'raw_material')
  return {
    id: raw.id ?? crypto.randomUUID(),
    orderNumber: String(raw.orderNumber ?? '').trim() || `ЗЗ-${new Date().getFullYear()}-0001`,
    counterpartyId: raw.counterpartyId ?? '',
    contractId: raw.contractId,
    scope: raw.scope === 'international' ? 'international' : 'domestic',
    category,
    categoryId:
      categoryId ??
      categories.find((c) => !c.parentId && c.legacyKey === category)?.id,
    status: raw.status ?? 'draft',
    orderDate: raw.orderDate ?? now.slice(0, 10),
    requestedDeliveryDate: raw.requestedDeliveryDate,
    confirmedDeliveryDate: raw.confirmedDeliveryDate,
    supplierReference: raw.supplierReference,
    incoterms: raw.incoterms,
    originCountry: raw.originCountry,
    portOfLoading: raw.portOfLoading,
    portOfDischarge: raw.portOfDischarge,
    destinationWarehouseId: raw.destinationWarehouseId,
    currency: raw.currency ?? 'USD',
    paymentTerms: raw.paymentTerms,
    exchangeRate: raw.exchangeRate != null ? Number(raw.exchangeRate) : undefined,
    exchangeRateDate: raw.exchangeRateDate,
    lines: (raw.lines ?? []).map(normalizeLine),
    legs: (raw.legs ?? []).map(normalizeLeg).sort((a, b) => a.sequence - b.sequence),
    milestones: (raw.milestones ?? []).map((m) => ({
      id: m.id ?? crypto.randomUUID(),
      at: m.at ?? now,
      status: m.status,
      location: m.location,
      note: m.note,
      externalId: m.externalId,
      source: m.source,
      carrier: m.carrier,
    })),
    containerTracking: normalizeContainerTracking(raw.containerTracking),
    statusHistory: backfillStatusHistory({
      ...(raw as PurchaseOrder),
      status: (raw.status ?? 'draft') as PurchaseOrder['status'],
      createdAt: raw.createdAt ?? now,
      statusHistory: (raw.statusHistory ?? []).map(normalizeStatusChange),
    } as PurchaseOrder),
    attachments: (raw.attachments ?? []).map(normalizeAttachment),
    warehouseDocumentIds: raw.warehouseDocumentIds ?? [],
    note: raw.note,
    createdAt: raw.createdAt ?? now,
    updatedAt: raw.updatedAt ?? now,
  }
}

export function normalizeProcurementStore(raw: Partial<ProcurementStore> | undefined): ProcurementStore {
  if (!raw) return createDefaultProcurement()
  const categories = (raw.categories ?? []).map(normalizeCategory)
  const routePoints = (raw.routePoints ?? []).map(normalizeRoutePoint)
  const base = ensureProcurementCatalog({
    orders: [],
    nextOrderSeq: 1,
    categories,
    routePoints,
  })
  const orders = (raw.orders ?? []).map((o) => normalizeOrder(o, base.categories))
  let nextOrderSeq = Number(raw.nextOrderSeq) || 1
  for (const o of orders) {
    const m = o.orderNumber.match(/-(\d+)$/)
    if (m) nextOrderSeq = Math.max(nextOrderSeq, Number(m[1]) + 1)
  }
  return { ...base, orders, nextOrderSeq }
}
