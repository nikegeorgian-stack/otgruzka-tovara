import type { WarehouseItem } from '@/lib/warehouse/types'
import type { RawMaterialKind } from './types'

const SUROV_RE = /суров|сур\s|сур$/i
const MESH_RE = /сетк/i
const MEMBRANE_RE = /мембран|membrane/i
const RATL_RE = /стеклоткан|ратл|ratl/i
const PALLET_RE = /паллет|палет|euro|e-палет|e палет/i
const BOX_RE = /коробк|box/i

export function guessRawMaterialKind(item: WarehouseItem): RawMaterialKind {
  const n = item.name
  if (MEMBRANE_RE.test(n)) return 'membrane'
  if (RATL_RE.test(n)) return 'ratl'
  if (MESH_RE.test(n)) return 'mesh'
  return 'other'
}

export function isRawMaterialItem(
  item: WarehouseItem,
  categoryNames: Map<string, string>,
): boolean {
  if (!item.active) return false
  const cat = categoryNames.get(item.categoryId) ?? ''
  if (/сетк|стеклоткан|ткань/i.test(cat)) return true
  return SUROV_RE.test(item.name)
}

export function isPalletItem(
  item: WarehouseItem,
  categoryNames: Map<string, string>,
): boolean {
  if (!item.active) return false
  const cat = categoryNames.get(item.categoryId) ?? ''
  if (/упаковк/i.test(cat) && PALLET_RE.test(item.name)) return true
  return PALLET_RE.test(item.name)
}

export function isBoxItem(
  item: WarehouseItem,
  categoryNames: Map<string, string>,
): boolean {
  if (!item.active) return false
  const cat = categoryNames.get(item.categoryId) ?? ''
  if (/упаковк/i.test(cat) && BOX_RE.test(item.name)) return true
  return BOX_RE.test(item.name)
}

export function filterRawMaterials(
  items: WarehouseItem[],
  categoryNames: Map<string, string>,
  kind?: RawMaterialKind,
): WarehouseItem[] {
  return items
    .filter((i) => isRawMaterialItem(i, categoryNames))
    .filter((i) => !kind || kind === 'other' || guessRawMaterialKind(i) === kind)
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
}
