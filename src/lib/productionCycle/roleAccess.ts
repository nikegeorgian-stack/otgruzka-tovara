import { canAccessView } from '@/lib/access/permissions'
import type { AccessRoleId, AccessStore, AppUser } from '@/lib/access/types'
import type { AdminCabinetId } from '@/lib/access/adminCabinet'
import type { ViewId } from '@/lib/types'
import { PRODUCTION_CYCLE_STAGE_META } from './stageCatalog'
import type { ProductionCycleStageId } from './types'

export function canNavigateProductionCycleView(
  access: AccessStore | null | undefined,
  user: AppUser | null | undefined,
  viewId: ViewId,
  adminCabinet?: AdminCabinetId | null,
): boolean {
  if (!access || !user) return false
  return canAccessView(access, user, viewId, adminCabinet ?? undefined)
}

export function primaryResponsibleRole(stageId: ProductionCycleStageId): AccessRoleId {
  return PRODUCTION_CYCLE_STAGE_META[stageId].responsibleRoleIds[0]
}

/** Есть ли у роли доступ к целевому View этапа (по умолчанию roleViews). */
export function roleCanReachStageView(
  access: AccessStore,
  roleId: AccessRoleId,
  stageId: ProductionCycleStageId,
): boolean {
  if (roleId === 'sysadmin') return true
  const viewId = PRODUCTION_CYCLE_STAGE_META[stageId].viewId
  const views = access.roleViews[roleId] ?? []
  return views.includes(viewId)
}
