import type {
  FinanceAdvanceDocument,
  FinanceAdvanceDocumentStatus,
  FinanceDisbursementDocStatus,
  FinancePayoutDocument,
} from './types'

/** Статусы выдачи АВ/ЗП (не начисление НА). */
const DISBURSEMENT: ReadonlySet<string> = new Set(['draft', 'ready', 'paid', 'void'])

export function migrateDisbursementStatus(
  status: string | undefined,
): FinanceDisbursementDocStatus {
  if (status === 'posted') return 'paid'
  if (status === 'ready' || status === 'paid' || status === 'draft' || status === 'void') {
    return status
  }
  return 'draft'
}

export function migrateAdvanceOrPayoutDocument<
  T extends FinanceAdvanceDocument | FinancePayoutDocument,
>(doc: T): T {
  const status = migrateDisbursementStatus(doc.status)
  if (status === doc.status) return doc
  return { ...doc, status }
}

export function isDisbursementStatus(
  status: FinanceAdvanceDocumentStatus,
): status is FinanceDisbursementDocStatus {
  return DISBURSEMENT.has(status)
}

export function isDocEditable(status: FinanceAdvanceDocumentStatus): boolean {
  return migrateDisbursementStatus(status) === 'draft'
}

/** Печать / Excel / копирование счетов — с «К выплате» и после выплаты. */
export function canHandoffExport(status: FinanceAdvanceDocumentStatus): boolean {
  const s = migrateDisbursementStatus(status)
  return s === 'ready' || s === 'paid'
}

export function isMoneyRecorded(status: FinanceAdvanceDocumentStatus): boolean {
  return migrateDisbursementStatus(status) === 'paid'
}
