/** Тип журнала / источник события */
export type JournalCategory =
  | 'timesheet'
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

export const ALL_JOURNAL_CATEGORIES: JournalCategory[] = [
  'timesheet',
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
]

export type UnifiedJournalEntry = {
  id: string
  category: JournalCategory
  /** ISO timestamp для сортировки */
  at: string
  title: string
  detail: string
  actor?: string
  refId?: string
}

export type JournalCategoryCounts = Partial<Record<JournalCategory, number>>
