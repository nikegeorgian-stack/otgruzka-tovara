/**
 * Версионированный пакет выгрузки Otgruzka → бухгалтер / Balance.ge
 * (без overwrite облака — только скачивание файла).
 */

import type { AppStore, Locale } from '@/lib/types'
import { canHandoffExport } from '@/lib/finance/disbursementDocStatus'
import {
  advanceDocumentById,
  documentLineTotal,
} from '@/lib/finance/advanceDocuments'
import { payoutDocumentById } from '@/lib/finance/payoutDocuments'
import { advanceAccrualById, accrualLineTotal } from '@/lib/finance/advanceAccrual'
import { getFinance } from '@/lib/finance/calc'
import { resolveDocHeaderOrg } from '@/lib/print/docHeaderOptions'
import type { WarehouseDocument } from '@/lib/warehouse/types'

export const EXPORT_PACKAGE_VERSION = 1 as const

export type ExportPackageKind =
  | 'finance_av'
  | 'finance_zp'
  | 'finance_na'
  | 'warehouse_docs'
  | 'production_docs'
  | 'loading_docs'

export type ExportPackageLine = {
  employeeId?: string
  employeeName?: string
  itemId?: string
  itemName?: string
  sku?: string
  qty?: number
  unit?: string
  amount?: number
  note?: string
}

export type ExportPackageDocument = {
  id: string
  number: string
  date: string
  month?: string
  type: string
  status: string
  purpose?: string
  counterparty?: string
  warehouseId?: string
  productionRequestId?: string
  batchRunId?: string
  loadingShipmentId?: string
  invoiceKey?: string
  sellerTin?: string
  docRole?: string
  lines: ExportPackageLine[]
  totalAmount?: number
}

export type ExportPackage = {
  version: typeof EXPORT_PACKAGE_VERSION
  kind: ExportPackageKind
  locale: Locale
  exportedAt: string
  source: 'otgruzka'
  targetHint: 'balance.ge'
  org: {
    organization: string
    idCode: string
    structuralUnit: string
  }
  documents: ExportPackageDocument[]
}

function empName(store: AppStore, id: string, locale: Locale): string {
  const e = store.employees.find((x) => x.id === id)
  if (!e) return id
  if (locale === 'ka') return e.nameKa || e.fullName
  return e.fullName || e.nameKa || id
}

function itemMeta(store: AppStore, itemId: string) {
  const item = store.warehouse.items.find((i) => i.id === itemId)
  return {
    itemName: item?.name,
    sku: item?.sku,
    unit: item?.unit,
  }
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function basePackage(
  store: AppStore,
  locale: Locale,
  kind: ExportPackageKind,
  documents: ExportPackageDocument[],
): ExportPackage {
  const org = resolveDocHeaderOrg(store, locale)
  return {
    version: EXPORT_PACKAGE_VERSION,
    kind,
    locale,
    exportedAt: new Date().toISOString(),
    source: 'otgruzka',
    targetHint: 'balance.ge',
    org: {
      organization: org.organization,
      idCode: org.idCode,
      structuralUnit: org.structuralUnit,
    },
    documents,
  }
}

export function buildFinanceAdvancePackage(
  store: AppStore,
  documentId: string,
  locale: Locale,
): ExportPackage | null {
  const doc = advanceDocumentById(getFinance(store), documentId)
  if (!doc || !canHandoffExport(doc.status)) return null
  return basePackage(store, locale, 'finance_av', [
    {
      id: doc.id,
      number: doc.number,
      date: doc.date,
      month: doc.month,
      type: 'advance_disbursement',
      status: doc.status,
      lines: doc.lines.map((l) => ({
        employeeId: l.employeeId,
        employeeName: empName(store, l.employeeId, locale),
        amount: l.amount,
        note: l.note,
      })),
      totalAmount: documentLineTotal(doc.lines),
    },
  ])
}

export function buildFinancePayoutPackage(
  store: AppStore,
  documentId: string,
  locale: Locale,
): ExportPackage | null {
  const doc = payoutDocumentById(getFinance(store), documentId)
  if (!doc || !canHandoffExport(doc.status)) return null
  return basePackage(store, locale, 'finance_zp', [
    {
      id: doc.id,
      number: doc.number,
      date: doc.date,
      month: doc.month,
      type: 'payout_disbursement',
      status: doc.status,
      lines: doc.lines.map((l) => ({
        employeeId: l.employeeId,
        employeeName: empName(store, l.employeeId, locale),
        amount: l.amount,
        note: l.note,
      })),
      totalAmount: documentLineTotal(doc.lines),
    },
  ])
}

export function buildFinanceAccrualPackage(
  store: AppStore,
  documentId: string,
  locale: Locale,
): ExportPackage | null {
  const doc = advanceAccrualById(getFinance(store), documentId)
  if (!doc || (doc.status !== 'posted' && doc.status !== 'ready' && doc.status !== 'paid')) {
    return null
  }
  return basePackage(store, locale, 'finance_na', [
    {
      id: doc.id,
      number: doc.number,
      date: doc.month + '-01',
      month: doc.month,
      type: 'advance_accrual',
      status: doc.status,
      lines: doc.lines.map((l) => ({
        employeeId: l.employeeId,
        employeeName: empName(store, l.employeeId, locale),
        amount: l.amount,
        note: l.note,
      })),
      totalAmount: accrualLineTotal(doc.lines),
    },
  ])
}

function mapWhDoc(store: AppStore, d: WarehouseDocument): ExportPackageDocument {
  return {
    id: d.id,
    number: d.number,
    date: d.date,
    type: d.type,
    status: d.status ?? 'posted',
    purpose: d.purpose,
    counterparty: d.counterparty,
    warehouseId: d.warehouseId,
    productionRequestId: d.productionRequestId,
    batchRunId: d.batchRunId,
    loadingShipmentId: d.loadingShipmentId,
    invoiceKey: d.invoiceKey,
    sellerTin: d.sellerTin,
    docRole: d.docRole,
    lines: d.lines.map((l) => ({
      itemId: l.itemId,
      ...itemMeta(store, l.itemId),
      qty: l.quantity,
      amount: l.unitPrice != null ? l.unitPrice * l.quantity : undefined,
    })),
  }
}

/** Складские / производственные / отгрузочные документы за период. */
export function buildWarehouseDocsPackage(
  store: AppStore,
  locale: Locale,
  opts: {
    kind?: 'warehouse_docs' | 'production_docs' | 'loading_docs'
    fromDate?: string
    toDate?: string
    documentIds?: string[]
  } = {},
): ExportPackage {
  const kind = opts.kind ?? 'warehouse_docs'
  let docs = store.warehouse.documents.filter((d) => (d.status ?? 'posted') === 'posted')
  if (opts.documentIds?.length) {
    const set = new Set(opts.documentIds)
    docs = docs.filter((d) => set.has(d.id))
  }
  if (opts.fromDate) docs = docs.filter((d) => d.date >= opts.fromDate!)
  if (opts.toDate) docs = docs.filter((d) => d.date <= opts.toDate!)

  if (kind === 'production_docs') {
    docs = docs.filter(
      (d) =>
        d.productionRequestId ||
        d.batchRunId ||
        d.docRole === 'batch_issue' ||
        d.docRole === 'batch_receipt' ||
        d.docRole === 'production_issue' ||
        d.docRole === 'production_receipt',
    )
  } else if (kind === 'loading_docs') {
    docs = docs.filter((d) => d.loadingShipmentId || d.docRole === 'loading_issue')
  }

  return basePackage(store, locale, kind, docs.map((d) => mapWhDoc(store, d)))
}

export function downloadExportPackage(pkg: ExportPackage, filenameHint?: string) {
  const safe = (filenameHint || pkg.documents[0]?.number || pkg.kind).replace(/[^\w.-]+/g, '_')
  downloadJson(`${safe}_${pkg.kind}_v${pkg.version}.json`, pkg)
}

export async function exportFinanceAdvancePackage(
  store: AppStore,
  documentId: string,
  locale: Locale,
): Promise<ExportPackage | null> {
  const pkg = buildFinanceAdvancePackage(store, documentId, locale)
  if (!pkg) return null
  downloadExportPackage(pkg)
  return pkg
}

export async function exportFinancePayoutPackage(
  store: AppStore,
  documentId: string,
  locale: Locale,
): Promise<ExportPackage | null> {
  const pkg = buildFinancePayoutPackage(store, documentId, locale)
  if (!pkg) return null
  downloadExportPackage(pkg)
  return pkg
}
