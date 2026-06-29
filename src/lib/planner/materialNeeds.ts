import type { PackagingPlan } from '@/lib/packaging/types'
import type { WarehouseItem } from '@/lib/warehouse/types'
import type { ProductionOrder } from './types'

export type MaterialRole = 'raw' | 'pallet' | 'box'

export type OrderMaterialLine = {
  role: MaterialRole
  itemId: string
  itemName: string
  unit: string
  quantity: number
}

const ROLE_LABEL_KEYS: Record<MaterialRole, string> = {
  raw: 'planner.material.raw',
  pallet: 'planner.material.pallet',
  box: 'planner.material.box',
}

export function materialRoleLabelKey(role: MaterialRole): string {
  return ROLE_LABEL_KEYS[role]
}

function itemLine(
  role: MaterialRole,
  itemId: string | undefined,
  quantity: number,
  items: WarehouseItem[],
): OrderMaterialLine | null {
  if (!itemId || quantity <= 0) return null
  const item = items.find((i) => i.id === itemId)
  if (!item) return null
  return {
    role,
    itemId,
    itemName: item.name,
    unit: item.unit,
    quantity,
  }
}

function linesFromPlan(
  order: ProductionOrder,
  plan: PackagingPlan | undefined,
  items: WarehouseItem[],
): OrderMaterialLine[] {
  const lines: OrderMaterialLine[] = []
  const raw = itemLine(
    'raw',
    order.rawMaterialItemId,
    plan?.rawRollsEstimated ?? 0,
    items,
  )
  if (raw) lines.push(raw)
  const pallet = itemLine('pallet', plan?.palletItemId ?? order.palletItemId, plan?.palletsNeeded ?? 0, items)
  if (pallet) lines.push(pallet)
  const box = itemLine('box', plan?.boxItemId ?? order.boxItemId, plan?.boxesNeeded ?? 0, items)
  if (box) lines.push(box)
  return lines
}

/** Потребность в материалах по заказу (суровьё, палеты, коробки). */
export function materialLinesForOrder(
  order: ProductionOrder,
  items: WarehouseItem[],
): OrderMaterialLine[] {
  return linesFromPlan(order, order.packagingPlan, items)
}

export function orderNeedsMaterialPlanning(order: ProductionOrder): boolean {
  return !!(
    order.rawMaterialItemId ||
    order.packagingRecipeId ||
    order.packagingPlan
  )
}

export const PLANNER_MATERIAL_STATUSES: ProductionOrder['status'][] = [
  'draft',
  'active',
  'paused',
]
