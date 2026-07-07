import type { ViewId } from '@/lib/types'
import { canAccessView, isSysAdmin, resolveView, viewsForUser } from './permissions'
import type { AccessRoleId, AccessStore, AppUser } from './types'

/** Какой кабинет/интерфейс смотрит admin (роль остаётся sysadmin). */
export type AdminCabinetId = 'full' | AccessRoleId

export const ADMIN_CABINET_STORAGE_KEY = 'fibercell-admin-cabinet'

/** Кабинеты с отдельным web-UI (и типичные для предпросмотра). */
export const ADMIN_CABINET_OPTIONS: AdminCabinetId[] = [
  'full',
  'hr',
  'hr_inspector',
  'finance',
  'warehouse_keeper',
  'procurement_manager',
  'technologist',
  'workshop_master',
]

const VALID = new Set<string>(ADMIN_CABINET_OPTIONS)

export function readAdminCabinet(): AdminCabinetId {
  try {
    const raw = sessionStorage.getItem(ADMIN_CABINET_STORAGE_KEY)
    if (raw && VALID.has(raw)) return raw as AdminCabinetId
  } catch {
    /* ignore */
  }
  return 'full'
}

export function writeAdminCabinet(cabinet: AdminCabinetId): void {
  try {
    sessionStorage.setItem(ADMIN_CABINET_STORAGE_KEY, cabinet)
  } catch {
    /* ignore */
  }
}

export function firstViewForAdminCabinet(cabinet: AdminCabinetId): ViewId {
  switch (cabinet) {
    case 'hr':
      return 'hr'
    case 'hr_inspector':
      return 'hr_inspector'
    case 'finance':
      return 'finance'
    case 'warehouse_keeper':
      return 'warehouse'
    case 'procurement_manager':
      return 'procurement'
    case 'technologist':
      return 'technologist'
    case 'workshop_master':
      return 'month'
    default:
      return 'month'
  }
}

export function webModesFromAdminCabinet(cabinet: AdminCabinetId): {
  webHrMode: boolean
  webFinanceMode: boolean
  webWarehouseMode: boolean
  webProcurementMode: boolean
  webTechnologistMode: boolean
  webWorkshopMasterMode: boolean
  webHrInspectorMode: boolean
} {
  return {
    webHrMode: cabinet === 'hr',
    webHrInspectorMode: cabinet === 'hr_inspector',
    webFinanceMode: cabinet === 'finance',
    webWarehouseMode: cabinet === 'warehouse_keeper',
    webProcurementMode: cabinet === 'procurement_manager',
    webTechnologistMode: cabinet === 'technologist',
    webWorkshopMasterMode: cabinet === 'workshop_master',
  }
}

export function canShowNavItemForAdminPreview(
  access: AccessStore,
  user: AppUser | null | undefined,
  itemId: ViewId,
  adminCabinet: AdminCabinetId,
  isFstWeb: boolean,
): boolean {
  if (!user?.active) return false
  if (!isSysAdmin(user) || adminCabinet === 'full') {
    return canAccessView(access, user, itemId)
  }
  if (isFstWeb) {
    const previewUser: AppUser = {
      id: user.id,
      login: user.login,
      displayName: user.displayName,
      roleId: adminCabinet,
      passwordHash: '',
      passwordSalt: '',
      active: true,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    }
    return viewsForUser(access, previewUser).includes(resolveView(itemId))
  }
  const views = access.roleViews[adminCabinet] ?? []
  return views.includes(resolveView(itemId))
}
