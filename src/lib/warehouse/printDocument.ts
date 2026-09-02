import type { Locale, PrintSignatures } from '@/lib/types'
import { intlLocale } from '@/i18n/localeFormat'
import { BRAND } from '@/lib/brand'
import type { Counterparty } from '@/lib/counterparties/types'
import { resolveCounterpartyDisplayName } from '@/lib/warehouse/documentValidation'
import { itemStockValue, toBaseQty } from '@/lib/warehouse/stock'
import type { ProductionRequest } from '@/lib/production/types'
import type { WarehouseDocument, WarehouseDocumentPurpose, WarehouseStore } from '@/lib/warehouse/types'

export type WarehousePrintMeta = {
  site: string
  responsible?: string
  signatures?: PrintSignatures
  locale?: Locale
}

export type ReceiptPrintDoc = Pick<
  WarehouseDocument,
  | 'number'
  | 'date'
  | 'documentDateTime'
  | 'warehouseId'
  | 'sourceWarehouseId'
  | 'destinationWarehouseId'
  | 'targetWarehouseId'
  | 'counterparty'
  | 'counterpartyId'
  | 'comment'
  | 'lines'
  | 'purpose'
  | 'invoiceKey'
  | 'keeperName'
  | 'responsibleEmployeeNameSnapshot'
  | 'productionRequestId'
  | 'contractNumber'
  | 'basisType'
  | 'basisNumber'
  | 'docRole'
  | 'reversesDocumentId'
  | 'reversalDocumentId'
  | 'cancellationReason'
  | 'status'
>

export type IssuePrintDoc = Pick<
  WarehouseDocument,
  | 'number'
  | 'date'
  | 'documentDateTime'
  | 'warehouseId'
  | 'sourceWarehouseId'
  | 'destinationWarehouseId'
  | 'counterparty'
  | 'counterpartyId'
  | 'comment'
  | 'lines'
  | 'purpose'
  | 'brigade'
  | 'keeperName'
  | 'responsibleEmployeeNameSnapshot'
  | 'productionRequestId'
  | 'targetWarehouseId'
  | 'basisType'
  | 'basisNumber'
  | 'docRole'
  | 'reversesDocumentId'
  | 'reversalDocumentId'
  | 'cancellationReason'
  | 'status'
>

export type ReceiptPrintLine = {
  idx: number
  name: string
  sku?: string
  category: string
  unit: string
  qty: number
  price: number
  sum: number
  batchNo?: string
  comment?: string
  lineId?: string
}

export type ReceiptPrintModel = {
  locale: Locale
  number: string
  dateFormatted: string
  documentDateTime?: string
  warehouseName: string
  sourceWarehouseName?: string
  destinationWarehouseName?: string
  counterparty: string
  contractNumber?: string
  basisLabel?: string
  comment?: string
  purpose?: WarehouseDocumentPurpose
  invoiceKey?: string
  keeperName?: string
  responsibleName?: string
  productionRequestLabel?: string
  orgLine: string
  lines: ReceiptPrintLine[]
  lineCount: number
  totalQty: number
  totalSum: number
  receivedBy: string
  issuedBy?: string
  accountant: string
  generatedAt: string
  isStorno: boolean
  stornoLabel?: string
  originalDocumentNumber?: string
  reversalDocumentNumber?: string
  cancellationReason?: string
  status?: WarehouseDocument['status']
  brandMarkUrl: string
}

export type IssuePrintModel = {
  locale: Locale
  number: string
  dateFormatted: string
  documentDateTime?: string
  warehouseName: string
  targetWarehouseName?: string
  sourceWarehouseName?: string
  destinationWarehouseName?: string
  counterparty: string
  brigade?: string
  comment?: string
  purpose?: WarehouseDocumentPurpose
  basisLabel?: string
  keeperName?: string
  responsibleName?: string
  productionRequestLabel?: string
  orgLine: string
  lines: ReceiptPrintLine[]
  lineCount: number
  totalQty: number
  totalSum: number
  issuedBy: string
  receivedBy: string
  accountant: string
  generatedAt: string
  isStorno: boolean
  stornoLabel?: string
  originalDocumentNumber?: string
  reversalDocumentNumber?: string
  cancellationReason?: string
  status?: WarehouseDocument['status']
  brandMarkUrl: string
}

function formatPrintDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${d}.${m}.${y}`
}

export function formatReceiptMoney(n: number): string {
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function signatureName(
  signatures: PrintSignatures | undefined,
  role: 'master' | 'accountant' | 'director',
  locale: Locale,
): string {
  if (!signatures) return ''
  const ka = locale === 'ka'
  if (role === 'master') return (ka ? signatures.masterKa : signatures.masterRu) ?? ''
  if (role === 'accountant') return (ka ? signatures.accountantKa : signatures.accountantRu) ?? ''
  return (ka ? signatures.directorKa : signatures.directorRu) ?? ''
}

function productionRequestLabel(
  requestId: string | undefined,
  requests: ProductionRequest[] | undefined,
): string | undefined {
  if (!requestId || !requests?.length) return undefined
  const req = requests.find((r) => r.id === requestId)
  if (!req) return requestId.slice(0, 8)
  return `${req.date} · ${req.brigadeName} · ${req.lineId === 'pack' ? 'упаковка' : `линия ${req.lineId}`}`
}

function buildPrintLines(
  store: WarehouseStore,
  doc: { lines: WarehouseDocument['lines'] },
): { lines: ReceiptPrintLine[]; totalSum: number; totalQty: number } {
  const itemMap = new Map(store.items.map((i) => [i.id, i]))
  const catMap = new Map(store.categories.map((c) => [c.id, c.name]))
  const lines: ReceiptPrintLine[] = []
  let totalSum = 0
  let totalQty = 0

  doc.lines.forEach((line, idx) => {
    const item = itemMap.get(line.itemId)
    // Prefer snapshots so rename of nomenclature cannot rewrite historical print.
    const name = line.itemNameSnapshot ?? item?.name
    if (!name && !item) return
    const unit = line.unitSnapshot ?? line.inputUnit ?? item?.unit ?? ''
    const qty = item
      ? toBaseQty(item, line.quantity, line.inputUnit)
      : line.actualQty ?? line.quantity
    const price = line.unitPrice ?? item?.price ?? 0
    const sum = item ? itemStockValue(item, qty) : price * qty
    totalSum += sum
    totalQty += qty
    lines.push({
      idx: idx + 1,
      name: name ?? line.itemId,
      sku: line.itemCodeSnapshot ?? item?.sku ?? item?.internalCode,
      category: item ? catMap.get(item.categoryId) ?? '' : '',
      unit,
      qty,
      price,
      sum,
      batchNo: line.batchNo,
      comment: line.comment,
      lineId: line.lineId,
    })
  })

  return { lines, totalSum, totalQty }
}

function locName(store: WarehouseStore, id: string | undefined): string {
  if (!id) return '—'
  return store.locations.find((l) => l.id === id)?.name ?? id
}

type PrintBuildOpts = {
  productionRequests?: ProductionRequest[]
  counterparties?: Counterparty[]
}

function docCounterpartyLabel(
  doc: { counterparty?: string; counterpartyId?: string },
  opts?: PrintBuildOpts,
): string {
  const list = opts?.counterparties ?? []
  return resolveCounterpartyDisplayName(doc, list, '—')
}

function basisLabel(doc: { basisType?: string; basisNumber?: string }): string | undefined {
  if (!doc.basisType && !doc.basisNumber) return undefined
  return [doc.basisType, doc.basisNumber].filter(Boolean).join(' · ')
}

function stornoFlags(
  store: WarehouseStore,
  doc: {
    docRole?: WarehouseDocument['docRole']
    reversesDocumentId?: string
    reversalDocumentId?: string
    status?: WarehouseDocument['status']
    cancellationReason?: string
  },
): Pick<
  ReceiptPrintModel,
  | 'isStorno'
  | 'stornoLabel'
  | 'originalDocumentNumber'
  | 'reversalDocumentNumber'
  | 'cancellationReason'
  | 'status'
> {
  const isStorno =
    doc.docRole === 'reversal' ||
    Boolean(doc.reversesDocumentId) ||
    doc.status === 'cancelled'
  const original = doc.reversesDocumentId
    ? store.documents.find((d) => d.id === doc.reversesDocumentId)?.number
    : undefined
  const reversal = doc.reversalDocumentId
    ? store.documents.find((d) => d.id === doc.reversalDocumentId)?.number
    : undefined
  return {
    isStorno,
    stornoLabel: isStorno ? 'СТОРНО' : undefined,
    originalDocumentNumber: original,
    reversalDocumentNumber: reversal,
    cancellationReason: doc.cancellationReason,
    status: doc.status,
  }
}

export function buildReceiptPrintModel(
  store: WarehouseStore,
  doc: ReceiptPrintDoc,
  meta: WarehousePrintMeta,
  opts?: PrintBuildOpts,
): ReceiptPrintModel {
  const locale = meta.locale ?? 'ru'
  const { lines, totalSum, totalQty } = buildPrintLines(store, doc)
  const master = signatureName(meta.signatures, 'master', locale)
  const accountant = signatureName(meta.signatures, 'accountant', locale)
  const director = signatureName(meta.signatures, 'director', locale)
  const storno = stornoFlags(store, doc)
  const src = doc.sourceWarehouseId || doc.warehouseId
  const dst = doc.destinationWarehouseId || doc.targetWarehouseId

  return {
    locale,
    number: doc.number,
    dateFormatted: formatPrintDate(doc.date),
    documentDateTime: doc.documentDateTime,
    warehouseName: locName(store, doc.warehouseId),
    sourceWarehouseName: locName(store, src),
    destinationWarehouseName: dst ? locName(store, dst) : undefined,
    counterparty: docCounterpartyLabel(doc, opts),
    contractNumber: doc.contractNumber,
    basisLabel: basisLabel(doc),
    comment: doc.comment,
    purpose: doc.purpose,
    invoiceKey: doc.invoiceKey,
    keeperName: doc.keeperName,
    responsibleName: doc.responsibleEmployeeNameSnapshot || doc.keeperName,
    productionRequestLabel: productionRequestLabel(doc.productionRequestId, opts?.productionRequests),
    orgLine: [meta.site, meta.responsible].filter(Boolean).join(' · ') || '—',
    lines,
    lineCount: lines.length,
    totalQty,
    totalSum,
    receivedBy: master,
    accountant: accountant || director,
    generatedAt: new Date().toLocaleString(intlLocale(locale)),
    brandMarkUrl: BRAND.mark,
    ...storno,
  }
}

export function buildIssuePrintModel(
  store: WarehouseStore,
  doc: IssuePrintDoc,
  meta: WarehousePrintMeta,
  opts?: PrintBuildOpts,
): IssuePrintModel {
  const locale = meta.locale ?? 'ru'
  const { lines, totalSum, totalQty } = buildPrintLines(store, doc)
  const master = signatureName(meta.signatures, 'master', locale)
  const accountant = signatureName(meta.signatures, 'accountant', locale)
  const director = signatureName(meta.signatures, 'director', locale)
  const storno = stornoFlags(store, doc)
  const src = doc.sourceWarehouseId || doc.warehouseId
  const dst = doc.destinationWarehouseId || doc.targetWarehouseId

  return {
    locale,
    number: doc.number,
    dateFormatted: formatPrintDate(doc.date),
    documentDateTime: doc.documentDateTime,
    warehouseName: locName(store, doc.warehouseId),
    targetWarehouseName: doc.targetWarehouseId
      ? locName(store, doc.targetWarehouseId)
      : undefined,
    sourceWarehouseName: locName(store, src),
    destinationWarehouseName: dst ? locName(store, dst) : undefined,
    counterparty: docCounterpartyLabel(doc, opts),
    brigade: doc.brigade,
    comment: doc.comment,
    purpose: doc.purpose,
    basisLabel: basisLabel(doc),
    keeperName: doc.keeperName,
    responsibleName: doc.responsibleEmployeeNameSnapshot || doc.keeperName,
    productionRequestLabel: productionRequestLabel(doc.productionRequestId, opts?.productionRequests),
    orgLine: [meta.site, meta.responsible].filter(Boolean).join(' · ') || '—',
    lines,
    lineCount: lines.length,
    totalQty,
    totalSum,
    issuedBy: doc.keeperName || meta.responsible || '—',
    receivedBy: master,
    accountant: accountant || director,
    generatedAt: new Date().toLocaleString(intlLocale(locale)),
    brandMarkUrl: BRAND.mark,
    ...storno,
  }
}

export function buildReceiptPrintModelFromDocument(
  store: WarehouseStore,
  doc: WarehouseDocument,
  meta: WarehousePrintMeta,
  opts?: PrintBuildOpts,
): ReceiptPrintModel | null {
  if (doc.type !== 'receipt') return null
  return buildReceiptPrintModel(store, doc, meta, opts)
}

export function buildIssuePrintModelFromDocument(
  store: WarehouseStore,
  doc: WarehouseDocument,
  meta: WarehousePrintMeta,
  opts?: PrintBuildOpts,
): IssuePrintModel | null {
  if (doc.type !== 'issue') return null
  return buildIssuePrintModel(store, doc, meta, opts)
}
