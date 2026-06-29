import type { ProductionOrder } from './types'

export type ActivateGateResult = { ok: true } | { ok: false; messageKey: string }

/** Можно ли активировать произв. заказ (рецептура назначена) */
export function canActivateProductionOrder(order: ProductionOrder): ActivateGateResult {
  if (order.formulationRecipeStatus === 'requested') {
    return { ok: false, messageKey: 'planner.activate.recipePending' }
  }
  if (!order.formulationRecipeId) {
    const needsRecipe = !!(order.salesOrderId || order.targetGsm)
    if (needsRecipe) {
      return { ok: false, messageKey: 'planner.activate.recipePending' }
    }
  }
  return { ok: true }
}
