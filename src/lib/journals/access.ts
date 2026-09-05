import type { AccessRoleId } from '@/lib/access/types'
import { ALL_JOURNAL_CATEGORIES, type JournalCategory } from './types'

export type JournalScopeContext = {
  roleId?: AccessRoleId
  webHrMode?: boolean
  webFinanceMode?: boolean
  webWarehouseMode?: boolean
  webTechnologistMode?: boolean
  webProcurementMode?: boolean
  webWorkshopMasterMode?: boolean
  webHrInspectorMode?: boolean
}

const TECHNOLOGIST: JournalCategory[] = [
  'technologist_batch',
  'technologist_climate',
  'technologist_qc',
  'warehouse_nomenclature',
]

const WAREHOUSE: JournalCategory[] = [
  'warehouse_audit',
  'warehouse_movements',
  'warehouse_documents',
  'warehouse_loading',
  'warehouse_nomenclature',
  'workwear',
]

const PROCUREMENT: JournalCategory[] = ['procurement', 'warehouse_movements']

const PRODUCTION: JournalCategory[] = ['production', 'timesheet']

const HR_JOURNALS: JournalCategory[] = ['hr', 'timesheet']

const FINANCE_JOURNALS: JournalCategory[] = ['finance', 'timesheet']

const ROLE_CATEGORIES: Record<AccessRoleId, JournalCategory[] | 'all'> = {
  sysadmin: 'all',
  warehouse_keeper: [...WAREHOUSE, ...PROCUREMENT],
  hr: HR_JOURNALS,
  hr_inspector: HR_JOURNALS,
  operations_director: 'all',
  workshop_master: PRODUCTION,
  procurement_manager: [...PROCUREMENT, 'warehouse_audit', 'warehouse_nomenclature'],
  chief_engineer: [
    ...PRODUCTION,
    ...TECHNOLOGIST,
    'warehouse_audit',
    'warehouse_movements',
  ],
  technologist: TECHNOLOGIST,
  otc: [...TECHNOLOGIST, 'production'],
  mixer: TECHNOLOGIST,
  finance: FINANCE_JOURNALS,
  employee: [],
  timeclock: [],
  it_specialist: ['warehouse_nomenclature'],
  sales_dispatcher: ['warehouse_loading', 'warehouse_movements', 'warehouse_documents', 'production'],
  office_manager: ['hr', 'directories', 'timesheet'],
  cook: ['finance'],
  secretary: ['hr', 'directories'],
}

export function resolveJournalCategories(ctx: JournalScopeContext): JournalCategory[] {
  if (ctx.webTechnologistMode) return TECHNOLOGIST
  if (ctx.webWarehouseMode) return [...WAREHOUSE, ...PROCUREMENT]
  if (ctx.webProcurementMode) return [...PROCUREMENT, 'warehouse_nomenclature']
  if (ctx.webWorkshopMasterMode) return PRODUCTION
  if (ctx.webHrInspectorMode || ctx.webHrMode) return HR_JOURNALS
  if (ctx.webFinanceMode) return FINANCE_JOURNALS

  const role = ctx.roleId ?? 'warehouse_keeper'
  const mapped = ROLE_CATEGORIES[role] ?? 'all'
  if (mapped === 'all') return [...ALL_JOURNAL_CATEGORIES]
  return mapped
}

/** Категории склада/закупок/финансов/продаж — журнал документов удобнее ленты */
const DOCUMENTS_DEFAULT_CATEGORIES = new Set<JournalCategory>([
  ...WAREHOUSE,
  ...PROCUREMENT,
  'finance',
  'sales',
])

const DOCUMENTS_ONLY_CATEGORIES = new Set<JournalCategory>([
  'warehouse_documents',
  'warehouse_loading',
  'finance',
  'sales',
])

/** Склад / финансы / продажи — режим «Документы» по умолчанию */
export function prefersDocumentsJournalView(categories: JournalCategory[]): boolean {
  if (categories.length === 0) return false
  if (categories.length === 1 && DOCUMENTS_ONLY_CATEGORIES.has(categories[0]!)) return true
  // финансы: finance (+ timesheet) — всё равно документы
  if (categories.every((c) => c === 'finance' || c === 'timesheet') && categories.includes('finance')) {
    return true
  }
  return categories.every((c) => DOCUMENTS_DEFAULT_CATEGORIES.has(c))
}
