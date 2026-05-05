import { doc, type Firestore, type Transaction } from 'firebase/firestore'

export type DocKind = 'incoming' | 'movement' | 'customer_order' | 'shipment_out'

/** Подбор разделов журнала (как в ТЗ модуль 36) */
export type DocJournalCategory =
  | 'all'
  | 'purchasing'
  | 'warehouse'
  | 'production'
  | 'sales'
  | 'finance'
  | 'maintenance'
  | 'archive'

export type DocStatus =
  | 'draft'
  | 'on_review'
  | 'awaiting_approval'
  | 'approved'
  | 'posted'
  | 'partial'
  | 'cancelled'
  | 'archived'

export type ErpDocLine = {
  productId?: string
  productName: string
  qty: number
  uom: string
  /** Для перемещения — Firestore id партии */
  lotId?: string
  note?: string
}

export type ErpDocumentBase = {
  id?: string
  kind: DocKind
  /** Раздел меню журнала */
  journalCategory: DocJournalCategory
  number: string
  status: DocStatus
  docDate: string // YYYY-MM-DD
  organization?: string
  warehouse?: string
  warehouseFrom?: string
  warehouseTo?: string
  contractorName?: string
  contractorId?: string
  basis?: string
  basisDocIds?: string[]
  amount?: number
  currency?: string
  comment?: string
  lines: ErpDocLine[]
  relatedDocIds?: string[]
  authorUid: string
  authorName: string
  responsibleUid?: string
  responsibleName?: string
  postedByUid?: string
  postedByName?: string
  shipmentRollIds?: string[]
  postingError?: string
  linkedShipmentId?: string
  linkedReceiptIds?: string[]
  linkedLotIds?: string[]
  linkedOrderId?: string
  createdAt?: unknown
  updatedAt?: unknown
  postedAt?: unknown
}

const COUNTER_ascii: Record<DocKind, string> = {
  incoming: 'PN',
  movement: 'PM',
  customer_order: 'ZK',
  shipment_out: 'OTG',
}

const PREFIX_human: Record<DocKind, string> = {
  incoming: 'ПН',
  movement: 'ПМ',
  customer_order: 'ЗК',
  shipment_out: 'ОТГ',
}

export function defaultJournalCategory(kind: DocKind): DocJournalCategory {
  switch (kind) {
    case 'incoming':
      return 'purchasing'
    case 'movement':
      return 'warehouse'
    case 'customer_order':
    case 'shipment_out':
      return 'sales'
    default:
      return 'warehouse'
  }
}

export function docKindRu(kind: DocKind): string {
  switch (kind) {
    case 'incoming':
      return 'Приходная накладная'
    case 'movement':
      return 'Перемещение между складами'
    case 'customer_order':
      return 'Заказ клиента'
    case 'shipment_out':
      return 'Отгрузка (накладная)'
    default:
      return kind
  }
}

export function statusRu(status: DocStatus): string {
  const m: Record<DocStatus, string> = {
    draft: 'Черновик',
    on_review: 'На проверке',
    awaiting_approval: 'На согласовании',
    approved: 'Согласован',
    posted: 'Проведен',
    partial: 'Частично выполнен',
    cancelled: 'Отменен',
    archived: 'Архив',
  }
  return m[status] || status
}

export function categoryRu(c: DocJournalCategory): string {
  const m: Record<DocJournalCategory, string> = {
    all: 'Все документы',
    purchasing: 'Закупки',
    warehouse: 'Склад',
    production: 'Производство',
    sales: 'Продажи / отгрузки',
    finance: 'Финансы',
    maintenance: 'Ремонты',
    archive: 'Архив / отмененные',
  }
  return m[c] || c
}

/** Ключ счётчика в коллекции counters (латиница) */
export function counterDocId(kind: DocKind, year: number): string {
  return `seq_${COUNTER_ascii[kind]}_${year}`
}

/**
 * Выделяет следующий номер вида ПН-2026-000001 внутри транзакции.
 */
export async function allocateDocumentNumber(tx: Transaction, db: Firestore, kind: DocKind, year: number): Promise<string> {
  const id = counterDocId(kind, year)
  const ref = doc(db, 'counters', id)
  const snap = await tx.get(ref)
  const next = ((snap.data() as { n?: number } | undefined)?.n ?? 0) + 1
  tx.set(ref, { n: next, kind, year, updatedKind: kind }, { merge: true })
  const num = `${PREFIX_human[kind]}-${year}-${String(next).padStart(6, '0')}`
  return num
}
