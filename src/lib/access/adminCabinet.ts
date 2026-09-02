import type { ViewId } from '@/lib/types'
import { defaultHomeViewForRole } from './homeView'
import type { AccessRoleId, AccessStore } from './types'

/** Какой кабинет/интерфейс смотрит admin (роль в сторе остаётся sysadmin). */
export type AdminCabinetId = 'full' | AccessRoleId

export const ADMIN_CABINET_STORAGE_KEY = 'fibercell-admin-cabinet'

/** Кабинеты с отдельным web-UI / предпросмотр для sysadmin. */
export const ADMIN_CABINET_OPTIONS: AdminCabinetId[] = [
  'full',
  'hr',
  'hr_inspector',
  'finance',
  'warehouse_keeper',
  'procurement_manager',
  'technologist',
  'otc',
  'mixer',
  'chief_engineer',
  'workshop_master',
  'operations_director',
  'employee',
  'timeclock',
  'it_specialist',
  'sales_dispatcher',
  'office_manager',
  'cook',
  'secretary',
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

/**
 * Стартовый раздел при смене кабинета (без импорта permissions — нет цикла модулей).
 * Полная проверка — canAccessView + accessPersona в useAppStore.
 */
export function firstViewForAdminCabinet(
  cabinet: AdminCabinetId,
  access?: AccessStore | null,
): ViewId {
  if (cabinet === 'full') return defaultHomeViewForRole('sysadmin')
  if (cabinet === 'employee') return 'my'
  const home = defaultHomeViewForRole(cabinet)
  if (!access) return home
  const views = [...(access.roleViews?.[cabinet] ?? [])]
  const ts = access.roleTimesheetAccess?.[cabinet]
  if (ts && ts !== 'none' && !views.includes('month')) {
    views.push('month')
  }
  if (views.includes(home)) return home
  return (views[0] as ViewId | undefined) ?? home
}

/** Веб-режимы (урезанный UI) по выбранному кабинету — для превью админа. */
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
