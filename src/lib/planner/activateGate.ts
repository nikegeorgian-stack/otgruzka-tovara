import type { ProductionOrder } from './types'
import type { FormulationStore } from '@/lib/formulations/types'
import { getApprovedRecipeVersion } from '@/lib/formulations/recipeApproval'
import type { WarehouseItem } from '@/lib/warehouse/types'

export type ActivateGateResult = { ok: true } | { ok: false; messageKey: string }

export type ProductionOrderWipContext = {
  warehouseItems?: ReadonlyArray<Pick<WarehouseItem, 'id' | 'active' | 'unit'>>
  /** Finished-goods warehouse item resolved from the selected product, when available. */
  finishedGoodsItemId?: string
}

const AREA_UNIT_ALIASES = new Set(['m2', 'м2', 'м²', 'sqm'])

export function isAreaWarehouseUnit(unit: string | null | undefined): boolean {
  return AREA_UNIT_ALIASES.has(String(unit ?? '').trim().toLowerCase())
}

/** Fail-closed WIP readiness used by the form and the activation boundary. */
export function validateProductionOrderWip(
  order: Pick<ProductionOrder, 'semiFinishedItemId' | 'warehouseItemId'>,
  context?: ProductionOrderWipContext,
): ActivateGateResult {
  const semiFinishedItemId = order.semiFinishedItemId?.trim()
  if (!semiFinishedItemId) {
    return { ok: false, messageKey: 'planner.activate.wipMissing' }
  }

  const finishedGoodsItemId =
    context?.finishedGoodsItemId?.trim() || order.warehouseItemId?.trim()
  if (finishedGoodsItemId && semiFinishedItemId === finishedGoodsItemId) {
    return { ok: false, messageKey: 'planner.activate.wipSameAsFinishedGoods' }
  }

  if (context?.warehouseItems) {
    const item = context.warehouseItems.find((row) => row.id === semiFinishedItemId)
    if (!item || item.active === false) {
      return { ok: false, messageKey: 'planner.activate.wipUnavailable' }
    }
    if (!isAreaWarehouseUnit(item.unit)) {
      return { ok: false, messageKey: 'planner.activate.wipAreaUnitRequired' }
    }
  }

  return { ok: true }
}

/** Можно ли активировать произв. заказ (рецептура назначена + P1B approved version или snapshot) */
export function canActivateProductionOrder(
  order: ProductionOrder,
  formulations?: Pick<FormulationStore, 'recipes' | 'recipeVersions'>,
  wipContext?: ProductionOrderWipContext,
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
    if (!order.recipeNormSnapshot?.contentHash) {
      const approved = getApprovedRecipeVersion(formulations, order.formulationRecipeId)
      if (!approved) {
        return { ok: false, messageKey: 'planner.activate.recipeNotApproved' }
      }
    }
  }
  // Callers that have the authoritative catalogue must opt into the WIP gate.
  // Keeping the no-context form recipe-only preserves read/replay behavior for
  // historical orders that predate the versioned WIP contract.
  return wipContext ? validateProductionOrderWip(order, wipContext) : { ok: true }
}
