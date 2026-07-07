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
  mixer: TECHNOLOGIST,
  finance: FINANCE_JOURNALS,
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
