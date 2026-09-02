import type { ViewId } from '@/lib/types'
import type { AccessRoleId } from './types'

/** Стартовый раздел по роли (главная страница интерфейса). */
export const ROLE_HOME_VIEW: Record<AccessRoleId, ViewId> = {
  sysadmin: 'settings',
  hr: 'hr',
  hr_inspector: 'hr_inspector',
  finance: 'finance',
  warehouse_keeper: 'warehouse',
  technologist: 'technologist',
  otc: 'otc',
  mixer: 'mixer',
  procurement_manager: 'procurement',
  workshop_master: 'month',
  operations_director: 'director',
  chief_engineer: 'engineer_log',
  employee: 'my',
  timeclock: 'timeclock',
  it_specialist: 'it',
  sales_dispatcher: 'director',
  office_manager: 'office',
  cook: 'meals',
  secretary: 'protocols',
}

export function defaultHomeViewForRole(roleId: AccessRoleId): ViewId {
  return ROLE_HOME_VIEW[roleId] ?? 'month'
}
