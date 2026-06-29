import { calcPackagingPlan } from '@/lib/packaging/calc'
import type { PackagingRecipe } from '@/lib/packaging/types'
import type { ProductionOrder } from './types'

export function attachPackagingPlanToOrder(
  order: ProductionOrder,
  recipe: PackagingRecipe | undefined,
  locale: 'ru' | 'ka',
): ProductionOrder {
  const metersPerRoll = order.metersPerRoll ?? 0
  const packagingPlan =
    recipe && metersPerRoll > 0
      ? calcPackagingPlan(order.totalQtyMp, metersPerRoll, recipe, locale) ?? undefined
      : undefined

  return {
    ...order,
    palletItemId: order.palletItemId || recipe?.palletItemId,
    boxItemId: order.boxItemId || recipe?.boxItemId,
    packagingPlan,
    updatedAt: new Date().toISOString(),
  }
}

export function attachDayPackagingPlan(
  qtyMp: number,
  order: ProductionOrder,
  recipe: PackagingRecipe | undefined,
  locale: 'ru' | 'ka',
) {
  const metersPerRoll = order.metersPerRoll ?? 0
  if (!recipe || metersPerRoll <= 0 || qtyMp <= 0) return null
  return calcPackagingPlan(qtyMp, metersPerRoll, recipe, locale)
}
