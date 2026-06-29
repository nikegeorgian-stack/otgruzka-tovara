import { backfillStatusHistory, normalizeStatusChange } from './statusHistory'
import type {
  ContainerTracking,
  ProcurementStore,
  PurchaseOrder,
  PurchaseOrderAttachment,
  PurchaseOrderLine,
  SeaCarrier,
  ShipmentLeg,
} from './types'

export function createDefaultProcurement(): ProcurementStore {
  return { orders: [], nextOrderSeq: 1 }
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

function normalizeLeg(raw: Partial<ShipmentLeg>): ShipmentLeg {
  return {
    id: raw.id ?? crypto.randomUUID(),
    sequence: Number(raw.sequence) || 1,
    transportMode: raw.transportMode ?? 'truck',
    carrier: raw.carrier,
    vesselOrTrain: raw.vesselOrTrain,
    origin: String(raw.origin ?? '').trim(),
    destination: String(raw.destination ?? '').trim(),
    plannedDepartureDate: raw.plannedDepartureDate,
    actualDepartureDate: raw.actualDepartureDate,
    etaDate: raw.etaDate,
    actualArrivalDate: raw.actualArrivalDate,
    trackingNumber: raw.trackingNumber,
    note: raw.note,
  }
}

function normalizeOrder(raw: Partial<PurchaseOrder>): PurchaseOrder {
  const now = new Date().toISOString()
  return {
    id: raw.id ?? crypto.randomUUID(),
    orderNumber: String(raw.orderNumber ?? '').trim() || `ЗЗ-${new Date().getFullYear()}-0001`,
    counterpartyId: raw.counterpartyId ?? '',
    contractId: raw.contractId,
    scope: raw.scope === 'international' ? 'international' : 'domestic',
    category: raw.category ?? 'raw_material',
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
  const orders = (raw.orders ?? []).map(normalizeOrder)
  let nextOrderSeq = Number(raw.nextOrderSeq) || 1
  for (const o of orders) {
    const m = o.orderNumber.match(/-(\d+)$/)
    if (m) nextOrderSeq = Math.max(nextOrderSeq, Number(m[1]) + 1)
  }
  return { orders, nextOrderSeq }
}
