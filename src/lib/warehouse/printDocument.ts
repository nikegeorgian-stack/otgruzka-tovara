import type { Locale, PrintSignatures } from '@/lib/types'
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
  | 'warehouseId'
  | 'counterparty'
  | 'comment'
  | 'lines'
  | 'purpose'
  | 'invoiceKey'
  | 'keeperName'
  | 'productionRequestId'
  | 'contractNumber'
>

export type IssuePrintDoc = Pick<
  WarehouseDocument,
  | 'number'
  | 'date'
  | 'warehouseId'
  | 'counterparty'
  | 'comment'
  | 'lines'
  | 'purpose'
  | 'brigade'
  | 'keeperName'
  | 'productionRequestId'
  | 'targetWarehouseId'
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
}

export type ReceiptPrintModel = {
  locale: Locale
  number: string
  dateFormatted: string
  warehouseName: string
  counterparty: string
  contractNumber?: string
  comment?: string
  purpose?: WarehouseDocumentPurpose
  invoiceKey?: string
  keeperName?: string
  productionRequestLabel?: string
  orgLine: string
  lines: ReceiptPrintLine[]
  lineCount: number
  totalQty: number
  totalSum: number
  receivedBy: string
  accountant: string
  generatedAt: string
}

export type IssuePrintModel = {
  locale: Locale
  number: string
  dateFormatted: string
  warehouseName: string
  targetWarehouseName?: string
  counterparty: string
  brigade?: string
  comment?: string
  purpose?: WarehouseDocumentPurpose
  keeperName?: string
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
    if (!item) return
    const qty = toBaseQty(item, line.quantity, line.inputUnit)
    const price = item.price ?? 0
    const sum = itemStockValue(item, qty)
    totalSum += sum
    totalQty += qty
    lines.push({
      idx: idx + 1,
      name: item.name,
      sku: item.sku,
      category: catMap.get(item.categoryId) ?? '',
      unit: item.unit,
      qty,
      price,
      sum,
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

  return {
    locale,
    number: doc.number,
    dateFormatted: formatPrintDate(doc.date),
    warehouseName: locName(store, doc.warehouseId),
    counterparty: docCounterpartyLabel(doc, opts),
    contractNumber: doc.contractNumber,
    comment: doc.comment,
    purpose: doc.purpose,
    invoiceKey: doc.invoiceKey,
    keeperName: doc.keeperName,
    productionRequestLabel: productionRequestLabel(doc.productionRequestId, opts?.productionRequests),
    orgLine: [meta.site, meta.responsible].filter(Boolean).join(' · ') || '—',
    lines,
    lineCount: lines.length,
    totalQty,
    totalSum,
    receivedBy: master,
    accountant: accountant || director,
    generatedAt: new Date().toLocaleString(locale === 'ka' ? 'ka-GE' : 'ru-RU'),
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

  return {
    locale,
    number: doc.number,
    dateFormatted: formatPrintDate(doc.date),
    warehouseName: locName(store, doc.warehouseId),
    targetWarehouseName: doc.targetWarehouseId
      ? locName(store, doc.targetWarehouseId)
      : undefined,
    counterparty: docCounterpartyLabel(doc, opts),
    brigade: doc.brigade,
    comment: doc.comment,
    purpose: doc.purpose,
    keeperName: doc.keeperName,
    productionRequestLabel: productionRequestLabel(doc.productionRequestId, opts?.productionRequests),
    orgLine: [meta.site, meta.responsible].filter(Boolean).join(' · ') || '—',
    lines,
    lineCount: lines.length,
    totalQty,
    totalSum,
    issuedBy: doc.keeperName || meta.responsible || '—',
    receivedBy: master,
    accountant: accountant || director,
    generatedAt: new Date().toLocaleString(locale === 'ka' ? 'ka-GE' : 'ru-RU'),
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
