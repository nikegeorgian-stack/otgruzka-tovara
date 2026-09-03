/**
 * PHASE W2 — journal query: search, filters, sort over WarehouseDocument[].
 * Movements are not journal rows.
 */
import type { WarehouseDocument, WarehouseDocumentPurpose, WarehouseStore } from './types'
import { buildDocumentJournalRows, type DocumentJournalRow } from './documentJournal'

export type JournalStatusFilter = 'all' | 'draft' | 'posted' | 'cancelled'
export type JournalTypeFilter = 'all' | 'receipt' | 'issue' | 'inventory' | 'reservation'
export type JournalSourceFilter =
  | 'all'
  | 'manual'
  | 'production'
  | 'batch'
  | 'transfer'
  | 'loading'
  | 'opening'
  | 'reversal'
  | 'procurement'

export type DocumentJournalQuery = {
  warehouseId?: string
  search?: string
  type?: JournalTypeFilter
  status?: JournalStatusFilter
  purpose?: WarehouseDocumentPurpose | 'all'
  source?: JournalSourceFilter
  counterpartyId?: string
  dateFrom?: string
  dateTo?: string
}

export function documentSortKey(doc: WarehouseDocument): string {
  return doc.documentDateTime || `${doc.date}T${doc.createdAt || '00:00:00.000Z'}`
}

export function documentSourceKind(doc: WarehouseDocument): Exclude<JournalSourceFilter, 'all'> {
  if (doc.docRole === 'reversal' || doc.reversesDocumentId) return 'reversal'
  if (doc.isOpeningInventory || doc.purpose === 'opening_inventory') return 'opening'
  // P1A handoff pairs have transferPairId but must stay source=production
  if (
    doc.docRole === 'production_issue' ||
    doc.docRole === 'production_receipt' ||
    doc.docRole === 'production_reservation' ||
    doc.docRole === 'production_reservation_release' ||
    doc.docRole === 'production_transfer_issue' ||
    doc.docRole === 'production_transfer_receipt' ||
    doc.docRole === 'production_return_issue' ||
    doc.docRole === 'production_return_receipt' ||
    doc.purpose === 'production_material_transfer' ||
    doc.purpose === 'production_material_return' ||
    doc.purpose === 'production_consumption' ||
    doc.purpose === 'production_wip_receipt' ||
    doc.purpose === 'production_waste_transfer' ||
    doc.purpose === 'production_reservation' ||
    doc.purpose === 'production_reservation_increase' ||
    doc.purpose === 'production_reservation_release' ||
    doc.purpose === 'production_reservation_reallocation' ||
    doc.docRole === 'production_consumption' ||
    doc.docRole === 'production_wip_receipt' ||
    doc.docRole === 'production_waste_issue' ||
    doc.docRole === 'production_waste_receipt' ||
    doc.productionRequestId ||
    doc.productionOrderId ||
    doc.shiftReportId ||
    doc.mixTaskId ||
    doc.type === 'reservation'
  ) {
    return 'production'
  }
  if (doc.docRole === 'transfer_issue' || doc.docRole === 'transfer_receipt' || doc.transferPairId) {
    return 'transfer'
  }
  if (doc.docRole === 'batch_issue' || doc.docRole === 'batch_receipt' || doc.batchRunId) {
    return 'batch'
  }
  if (doc.docRole === 'loading_issue' || doc.loadingShipmentId) return 'loading'
  if (doc.purchaseOrderId) return 'procurement'
  return 'manual'
}

export function isAutomaticDocument(doc: WarehouseDocument): boolean {
  return documentSourceKind(doc) !== 'manual'
}

function matchesSearch(
  store: WarehouseStore,
  doc: WarehouseDocument,
  raw: string,
): boolean {
  const q = raw.trim().toLowerCase()
  if (!q) return true
  const itemMap = new Map(store.items.map((i) => [i.id, i]))
  const hay: string[] = [
    doc.number,
    doc.comment ?? '',
    doc.counterparty ?? '',
    doc.counterpartyId ?? '',
    doc.basisNumber ?? '',
    doc.basisId ?? '',
    doc.invoiceKey ?? '',
    doc.keeperName ?? '',
    doc.responsibleEmployeeNameSnapshot ?? '',
    doc.productionRequestId ?? '',
    doc.batchRunId ?? '',
    doc.purchaseOrderId ?? '',
    doc.docRole ?? '',
  ]
  for (const line of doc.lines) {
    hay.push(line.itemNameSnapshot ?? '')
    hay.push(line.itemCodeSnapshot ?? '')
    hay.push(line.batchNo ?? '')
    const item = itemMap.get(line.itemId)
    if (item) {
      hay.push(item.name, item.internalCode, item.sku ?? '')
    }
  }
  return hay.some((s) => s.toLowerCase().includes(q))
}

export function filterWarehouseDocuments(
  store: WarehouseStore,
  query: DocumentJournalQuery = {},
): WarehouseDocument[] {
  const type = query.type ?? 'all'
  const status = query.status ?? 'all'
  const purpose = query.purpose ?? 'all'
  const source = query.source ?? 'all'
  let list = [...store.documents]

  if (query.warehouseId) {
    const wid = query.warehouseId
    list = list.filter(
      (d) =>
        d.warehouseId === wid ||
        d.targetWarehouseId === wid ||
        d.sourceWarehouseId === wid ||
        d.destinationWarehouseId === wid,
    )
  }
  if (type !== 'all') list = list.filter((d) => d.type === type)
  if (status !== 'all') list = list.filter((d) => (d.status ?? 'posted') === status)
  if (purpose !== 'all') list = list.filter((d) => d.purpose === purpose)
  if (source !== 'all') list = list.filter((d) => documentSourceKind(d) === source)
  if (query.counterpartyId) {
    list = list.filter((d) => d.counterpartyId === query.counterpartyId)
  }
  if (query.dateFrom) {
    list = list.filter((d) => d.date >= query.dateFrom!)
  }
  if (query.dateTo) {
    list = list.filter((d) => d.date <= query.dateTo!)
  }
  if (query.search?.trim()) {
    list = list.filter((d) => matchesSearch(store, d, query.search!))
  }

  return list.sort((a, b) => {
    const kb = documentSortKey(b)
    const ka = documentSortKey(a)
    if (kb !== ka) return kb.localeCompare(ka)
    return (b.createdAt || '').localeCompare(a.createdAt || '')
  })
}

export function queryDocumentJournal(
  store: WarehouseStore,
  query: DocumentJournalQuery = {},
): DocumentJournalRow[] {
  const docs = filterWarehouseDocuments(store, query)
  return buildDocumentJournalRows(store, docs)
}

export type DocumentCardMeta = {
  sourceKind: Exclude<JournalSourceFilter, 'all'>
  automatic: boolean
  sourceWarehouseName: string
  destinationWarehouseName: string
  responsibleName: string
  originalId?: string
  reversalId?: string
  cancellationReason?: string
  createdLabel: string
  updatedLabel: string
  postedLabel: string
  cancelledLabel: string
  revision: number
  technical: {
    idempotencyKey?: string
    productionRequestId?: string
    productionOrderId?: string
    mixTaskId?: string
    batchRunId?: string
    purchaseOrderId?: string
    loadingShipmentId?: string
    transferPairId?: string
  }
}

export function buildDocumentCardMeta(
  store: WarehouseStore,
  doc: WarehouseDocument,
): DocumentCardMeta {
  const loc = (id?: string) =>
    (id && store.locations.find((l) => l.id === id)?.name) || id || '—'
  const srcId = doc.sourceWarehouseId || doc.warehouseId
  const dstId =
    doc.destinationWarehouseId || doc.targetWarehouseId || undefined
  const fmt = (by?: string, name?: string, at?: string) => {
    if (!at && !name && !by) return '—'
    return [name || by || '—', at ? at.slice(0, 19).replace('T', ' ') : ''].filter(Boolean).join(' · ')
  }
  return {
    sourceKind: documentSourceKind(doc),
    automatic: isAutomaticDocument(doc),
    sourceWarehouseName: loc(srcId),
    destinationWarehouseName: dstId ? loc(dstId) : '—',
    responsibleName:
      doc.responsibleEmployeeNameSnapshot || doc.keeperName || '—',
    originalId: doc.reversesDocumentId,
    reversalId: doc.reversalDocumentId,
    cancellationReason: doc.cancellationReason,
    createdLabel: fmt(doc.createdBy, doc.createdByName, doc.createdAt),
    updatedLabel: fmt(doc.updatedBy, doc.updatedByName, doc.updatedAt),
    postedLabel: fmt(doc.postedBy, doc.postedByName, doc.postedAt),
    cancelledLabel: fmt(doc.cancelledBy, doc.cancelledByName, doc.cancelledAt),
    revision: doc.revision ?? 0,
    technical: {
      idempotencyKey: doc.idempotencyKey,
      productionRequestId: doc.productionRequestId,
      productionOrderId: doc.productionOrderId,
      mixTaskId: doc.mixTaskId,
      batchRunId: doc.batchRunId,
      purchaseOrderId: doc.purchaseOrderId,
      loadingShipmentId: doc.loadingShipmentId,
      transferPairId: doc.transferPairId,
    },
  }
}
