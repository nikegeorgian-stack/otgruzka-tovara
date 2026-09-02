import type { AccessRoleId } from '@/lib/access/types'
import type { ProtocolAccessLevel } from './types'

/** Уровень доступа к разделу «Протоколы». */
export const DEFAULT_ROLE_PROTOCOL_ACCESS: Record<AccessRoleId, ProtocolAccessLevel> = {
  sysadmin: 'manage',
  secretary: 'manage',
  operations_director: 'my',
  hr: 'my',
  hr_inspector: 'none',
  workshop_master: 'my',
  warehouse_keeper: 'none',
  procurement_manager: 'none',
  chief_engineer: 'my',
  technologist: 'none',
  otc: 'none',
  mixer: 'none',
  finance: 'none',
  employee: 'my',
  it_specialist: 'none',
  sales_dispatcher: 'none',
  office_manager: 'my',
  timeclock: 'none',
  cook: 'none',
}

export function canEditProtocols(level: ProtocolAccessLevel | undefined): boolean {
  return level === 'edit' || level === 'manage'
}

export function canUseProtocolsSection(level: ProtocolAccessLevel | undefined): boolean {
  return level === 'my' || level === 'edit' || level === 'manage'
}
