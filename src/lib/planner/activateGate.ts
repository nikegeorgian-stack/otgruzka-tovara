import type { ProductionOrder } from './types'
import type { FormulationStore } from '@/lib/formulations/types'
import { getApprovedRecipeVersion } from '@/lib/formulations/recipeApproval'

export type ActivateGateResult = { ok: true } | { ok: false; messageKey: string }

/** Можно ли активировать произв. заказ (рецептура назначена + P1B approved version или snapshot) */
export function canActivateProductionOrder(
  order: ProductionOrder,
  formulations?: Pick<FormulationStore, 'recipes' | 'recipeVersions'>,
): ActivateGateResult {
  if (order.formulationRecipeStatus === 'requested') {
    return { ok: false, messageKey: 'planner.activate.recipePending' }
  }
  if (!order.formulationRecipeId) {
    const needsRecipe = !!(order.salesOrderId || order.targetGsm)
    if (needsRecipe) {
      return { ok: false, messageKey: 'planner.activate.recipePending' }
    }
  }
  // P1B: confirmed orders need approved recipe version or explicit legacy snapshot
  if (order.formulationRecipeId && formulations) {
    if (order.recipeNormSnapshot?.contentHash) return { ok: true }
    const approved = getApprovedRecipeVersion(formulations, order.formulationRecipeId)
    if (!approved) {
      return { ok: false, messageKey: 'planner.activate.recipeNotApproved' }
    }
  }
  return { ok: true }
}
