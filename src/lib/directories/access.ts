import type { AccessRoleId, AccessStore, AppUser } from '@/lib/access/types'
import {
  DIRECTORY_SECTIONS,
  PROCUREMENT_WEB_DIRECTORY_SECTIONS,
  WAREHOUSE_WEB_DIRECTORY_SECTIONS,
  type DirectorySection,
} from '@/lib/directories/types'

const DIRECTORY_SECTION_IDS = new Set<DirectorySection>(
  DIRECTORY_SECTIONS.map((s) => s.id),
)

/**
 * Вкладки справочников по роли (дефолт).
 * Пустой список = раздел «Справочники» этой роли не нужен (в меню не показываем).
 */
export const DEFAULT_ROLE_DIRECTORY_SECTIONS: Record<AccessRoleId, DirectorySection[]> = {
  sysadmin: DIRECTORY_SECTIONS.map((s) => s.id),
  warehouse_keeper: [...WAREHOUSE_WEB_DIRECTORY_SECTIONS],
  procurement_manager: [...PROCUREMENT_WEB_DIRECTORY_SECTIONS],
  hr: ['employees', 'brigades', 'positions', 'codes', 'payAccrual', 'counterparties'],
  hr_inspector: [],
  /** Планировщик / заказы: клиенты, ГП, рецептуры, упаковка, номенклатура */
  operations_director: [
    'counterparties',
    'finishedProducts',
    'packagingRecipes',
    'formulations',
    'nomenclature',
  ],
  workshop_master: ['brigades'],
  chief_engineer: [
    'finishedProducts',
    'formulations',
    'packagingRecipes',
    'nomenclature',
    'codes',
  ],
  technologist: ['formulations', 'finishedProducts'],
  otc: ['finishedProducts'],
  mixer: [],
  finance: ['positions', 'codes', 'payAccrual'],
  employee: [],
  timeclock: [],
  it_specialist: [],
  sales_dispatcher: ['counterparties', 'finishedProducts'],
  office_manager: [],
  cook: [],
  secretary: ['employees', 'positions'],
}

export function sanitizeDirectorySections(
  raw: unknown,
): DirectorySection[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: DirectorySection[] = []
  const seen = new Set<DirectorySection>()
  for (const v of raw) {
    if (typeof v !== 'string') continue
    if (!DIRECTORY_SECTION_IDS.has(v as DirectorySection)) continue
    const id = v as DirectorySection
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

export function directorySectionsForRole(
  roleId: AccessRoleId | null | undefined,
  access?: Pick<AccessStore, 'roleDirectorySections'> | null,
): DirectorySection[] {
  if (!roleId) return []
  const override = access?.roleDirectorySections?.[roleId]
  if (Array.isArray(override)) {
    return sanitizeDirectorySections(override) ?? []
  }
  return DEFAULT_ROLE_DIRECTORY_SECTIONS[roleId] ?? []
}

export function roleNeedsDirectories(roleId: AccessRoleId | null | undefined): boolean {
  // Авто-добавление раздела «Справочники» в roleViews — по заводскому дефолту,
  // чтобы кастомная матрица вкладок не отключала сам раздел молча.
  if (!roleId) return false
  return (DEFAULT_ROLE_DIRECTORY_SECTIONS[roleId] ?? []).length > 0
}

export function canAccessDirectorySection(
  roleId: AccessRoleId | null | undefined,
  section: DirectorySection,
  access?: Pick<AccessStore, 'roleDirectorySections'> | null,
): boolean {
  const allowed = directorySectionsForRole(roleId, access)
  if (allowed.length === 0) return false
  return allowed.includes(section)
}

/** Первый доступный раздел (для редиректа с запрещённой вкладки). */
export function firstDirectorySectionForRole(
  roleId: AccessRoleId | null | undefined,
  preferred?: DirectorySection,
  access?: Pick<AccessStore, 'roleDirectorySections'> | null,
): DirectorySection | null {
  const allowed = directorySectionsForRole(roleId, access)
  if (allowed.length === 0) return null
  if (preferred && allowed.includes(preferred)) return preferred
  return allowed[0] ?? null
}

/**
 * Эффективные вкладки: персональный список учётки → матрица роли → web-режимы.
 */
export function resolveDirectoryTabs(opts: {
  roleId: AccessRoleId | null | undefined
  access?: Pick<AccessStore, 'roleDirectorySections'> | null
  /** Явный список учётки; undefined = наследовать роль */
  userDirectorySections?: DirectorySection[] | null
  user?: Pick<AppUser, 'directorySections'> | null
  webWarehouseMode?: boolean
  webProcurementMode?: boolean
}): DirectorySection[] {
  const personal = opts.userDirectorySections ?? opts.user?.directorySections
  let base =
    personal !== undefined && personal !== null
      ? (sanitizeDirectorySections(personal) ?? [])
      : directorySectionsForRole(opts.roleId, opts.access)

  if (opts.webWarehouseMode) {
    const wh = new Set(WAREHOUSE_WEB_DIRECTORY_SECTIONS)
    base = base.filter((s) => wh.has(s))
    if (base.length === 0) base = [...WAREHOUSE_WEB_DIRECTORY_SECTIONS]
  } else if (opts.webProcurementMode) {
    const pr = new Set(PROCUREMENT_WEB_DIRECTORY_SECTIONS)
    base = base.filter((s) => pr.has(s))
    if (base.length === 0) base = [...PROCUREMENT_WEB_DIRECTORY_SECTIONS]
  }
  return base
}
