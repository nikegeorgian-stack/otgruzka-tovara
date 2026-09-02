import type { AccessRoleId } from '@/lib/access/types'
import type { WarehouseItem, WarehouseLocation, WarehouseLocationKind } from './types'

/** Производственная номенклатура: суровьё, химия пропитки/краска, НЗП, ГП. */
export const PRODUCTION_LOCATION_KINDS: ReadonlySet<WarehouseLocationKind> = new Set([
  'raw',
  'chemistry',
  'wip',
  'finished',
])

export function warehouseItemDisplayName(
  item: Pick<WarehouseItem, 'name' | 'technicalName'>,
): string {
  const tech = item.technicalName?.trim()
  return tech || item.name
}

export function isProductionNomenclature(
  item: Pick<WarehouseItem, 'warehouseId'>,
  locations: WarehouseLocation[],
): boolean {
  const kind = locations.find((l) => l.id === item.warehouseId)?.kind
  return kind != null && PRODUCTION_LOCATION_KINDS.has(kind)
}

export function canSetTechnicalName(
  roleId: AccessRoleId | string | null | undefined,
  item: Pick<WarehouseItem, 'warehouseId'>,
  locations: WarehouseLocation[],
): boolean {
  if (roleId !== 'technologist' && roleId !== 'sysadmin') return false
  return isProductionNomenclature(item, locations)
}

/** Кладовщик и чужие роли не могут затереть техназвание; офис/упаковка — поле не живёт. */
export function applyTechnicalNameOnUpsert(
  existing: WarehouseItem | undefined,
  incoming: WarehouseItem,
  locations: WarehouseLocation[],
  actorRole: AccessRoleId | string | null | undefined,
): WarehouseItem {
  if (!canSetTechnicalName(actorRole, incoming, locations)) {
    return { ...incoming, technicalName: existing?.technicalName }
  }
  const trimmed = incoming.technicalName?.trim()
  return { ...incoming, technicalName: trimmed || undefined }
}
