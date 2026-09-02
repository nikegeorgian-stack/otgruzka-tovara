import type { WarehouseLocationKind } from './types'

export const WAREHOUSE_LOCATION_KINDS: WarehouseLocationKind[] = [
  'raw',
  'chemistry',
  'packaging',
  'wip',
  'finished',
  'office',
  'other',
]

const VALID_KINDS = new Set<WarehouseLocationKind>(WAREHOUSE_LOCATION_KINDS)

export function inferLocationKind(name: string): WarehouseLocationKind {
  const n = name.trim().toLowerCase()
  if (n.includes('хим')) return 'chemistry'
  if (n.includes('офис') || n.includes('хоз')) return 'office'
  if (n.includes('выработ')) return 'wip'
  if (n.includes('упаков') && !n.includes('готов')) return 'packaging'
  if (n.includes('готов')) return 'finished'
  if (n.includes('сырь')) return 'raw'
  // «Основной» — общий склад по категориям, без жёсткого kind-фильтра.
  if (n === 'основной' || n.includes('основн')) return 'other'
  return 'other'
}

export function normalizeLocationKind(
  kind: WarehouseLocationKind | undefined,
  name: string,
): WarehouseLocationKind {
  if (kind && VALID_KINDS.has(kind)) return kind
  return inferLocationKind(name)
}
