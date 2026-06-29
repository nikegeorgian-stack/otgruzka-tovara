import { formulationCategoryForGsm } from '@/lib/formulations/grammages'
import { emptyFormulationRecipe } from '@/lib/formulations/init'
import type { FormulationRecipe, FormulationStore } from '@/lib/formulations/types'
import type { ProductionOrder } from './types'

/** Черновик рецептуры из производственного заказа */
export function draftFormulationRecipeFromOrder(
  store: FormulationStore,
  order: ProductionOrder,
): FormulationRecipe {
  const base = emptyFormulationRecipe(store)
  const gsm = order.targetGsm
  const category = gsm && gsm > 0 ? formulationCategoryForGsm(gsm) : base.category

  const name = order.productName.trim()
    ? `${order.productName.trim()}${gsm ? ` ${gsm} г/м²` : ''}`
    : ''

  return {
    ...base,
    name,
    category,
    grammageGsm: gsm && gsm > 0 ? gsm : undefined,
    note:
      [order.labelNote, order.note].filter(Boolean).join(' · ') || undefined,
  }
}

/** Произв. заказы, ожидающие назначения рецептуры пропитки */
export function ordersNeedingFormulationRecipe(orders: ProductionOrder[]): ProductionOrder[] {
  return orders
    .filter(
      (o) =>
        o.status !== 'cancelled' &&
        o.status !== 'completed' &&
        o.formulationRecipeStatus === 'requested',
    )
    .sort((a, b) => {
      const da = a.startDate || a.createdAt
      const db = b.startDate || b.createdAt
      return da.localeCompare(db) || a.orderNumber.localeCompare(b.orderNumber, 'ru')
    })
}

export function countOpenRecipeRequests(orders: ProductionOrder[]): number {
  return ordersNeedingFormulationRecipe(orders).length
}

/** Рецепты, подходящие по граммовке (±10 г/м²) */
export function recipesMatchingGsm(
  recipes: FormulationRecipe[],
  targetGsm?: number,
): FormulationRecipe[] {
  const active = recipes.filter((r) => r.active)
  if (!targetGsm || targetGsm <= 0) return active
  const matched = active.filter(
    (r) => r.grammageGsm != null && Math.abs(r.grammageGsm - targetGsm) <= 10,
  )
  return matched.length ? matched : active
}
