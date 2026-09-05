/** Тип журнала / источник события */
export type JournalCategory =
  | 'timesheet'
  | 'finance'
  | 'hr'
  | 'access'
  | 'sales'
  | 'directories'
  | 'production'
  | 'warehouse_audit'
  | 'warehouse_movements'
  | 'warehouse_documents'
  | 'warehouse_loading'
  | 'warehouse_nomenclature'
  | 'technologist_batch'
  | 'technologist_climate'
  | 'technologist_qc'
  | 'procurement'
  | 'workwear'
  | 'it_office'

export const ALL_JOURNAL_CATEGORIES: JournalCategory[] = [
  'timesheet',
  'finance',
  'hr',
  'access',
  'sales',
  'directories',
  'production',
  'warehouse_audit',
  'warehouse_movements',
  'warehouse_documents',
  'warehouse_loading',
  'warehouse_nomenclature',
  'technologist_batch',
  'technologist_climate',
  'technologist_qc',
  'procurement',
  'workwear',
  'it_office',
]

export type JournalLink =
  | { kind: 'warehouse_document'; documentId: string }
  | { kind: 'warehouse_item'; itemId: string }
  | { kind: 'warehouse_loading'; shipmentId: string }
  | { kind: 'month'; month: string }
  | { kind: 'production_request'; requestId: string }
  | { kind: 'procurement_order'; orderId: string }
  | { kind: 'sales_order'; orderId: string }
  | { kind: 'hr'; employeeId: string }
  | { kind: 'it' }
  | { kind: 'finance_advance_document'; documentId: string; month?: string }
  | { kind: 'finance_payout_document'; documentId: string; month?: string }
  | { kind: 'finance_accrual_document'; documentId: string; month?: string }
  | { kind: 'finance_month'; month: string }
  | { kind: 'meals' }
  | { kind: 'directories' }
  | { kind: 'timesheet_entry_document'; documentId: string; month?: string }

/** Документ (вечный) vs событие auditLog (кольцевой буфер). */
export type JournalEntryKind = 'document' | 'event'

export type UnifiedJournalEntry = {
  id: string
  category: JournalCategory
  /** ISO timestamp для сортировки */
  at: string
  title: string
  detail: string
  /** Имя исполнителя (кто сделал) */
  actor?: string
  /** Id учётки / сотрудника-исполнителя, если есть */
  actorId?: string
  /** document = ведомость/складской док; event = audit / движение */
  entryKind?: JournalEntryKind
  refId?: string
  /** Дата документа (если отличается от at) */
  docDate?: string
  /** Номер документа */
  docNumber?: string
  /** Ключ i18n типа документа */
  docTypeKey?: string
  /** Сырой тип / статус для фильтра */
  docStatus?: string
  /** Контрагент (для журнала документов как в 1С) */
  counterpartyName?: string
  /** Просмотр или редактирование */
  mode?: 'view' | 'edit'
  /** Переход к первоисточнику */
  link?: JournalLink
}

export type JournalCategoryCounts = Partial<Record<JournalCategory, number>>
