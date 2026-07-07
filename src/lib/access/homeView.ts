import type { ViewId } from '@/lib/types'
import type { AccessRoleId } from './types'

/** Стартовый раздел по роли (главная страница интерфейса). */
export const ROLE_HOME_VIEW: Record<AccessRoleId, ViewId> = {
  sysadmin: 'summary',
  hr: 'hr',
  hr_inspector: 'hr_inspector',
  finance: 'finance',
  warehouse_keeper: 'warehouse',
  technologist: 'technologist',
  mixer: 'mixer',
  procurement_manager: 'procurement',
  workshop_master: 'month',
  operations_director: 'director',
  chief_engineer: 'production',
}

export function defaultHomeViewForRole(roleId: AccessRoleId): ViewId {
  return ROLE_HOME_VIEW[roleId] ?? 'month'
}
