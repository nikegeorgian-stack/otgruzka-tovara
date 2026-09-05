import type { FinishedProduct } from '@/lib/finishedProducts/types'
import type { FormulationRecipe } from '@/lib/formulations/types'
import type { ProductionOrder } from '@/lib/planner/types'

/** Источник количества расхода (ТЗ §9.4) */
export type ImpregnationMeasureSource = 'measured' | 'estimated'

/**
 * Оценка расхода готовой пропитки, кг, по годному выпуску, п.м.
 * Норма: площадь (м²) × граммовка (г/м²) / 1000.
 */
export function estimateImpregnationConsumeKg(args: {
  goodMp: number
  rollWidthM?: number
  grammageGsm?: number
}): number {
  const mp = Math.max(0, args.goodMp)
  if (mp <= 0) return 0
  const width = args.rollWidthM && args.rollWidthM > 0 ? args.rollWidthM : 0
  const gsm = args.grammageGsm && args.grammageGsm > 0 ? args.grammageGsm : 0
  if (width <= 0 || gsm <= 0) return 0
  const areaM2 = mp * width
  return Math.round(((areaM2 * gsm) / 1000) * 1000) / 1000
}

export function resolveFormulationRecipe(
  order: ProductionOrder | undefined,
  fp: FinishedProduct | undefined,
  recipes: FormulationRecipe[],
): FormulationRecipe | undefined {
  const id = order?.formulationRecipeId || fp?.defaultFormulationRecipeId
  if (!id) return undefined
  return recipes.find((r) => r.id === id && r.active)
}

export function resolveImpregnationGrammage(
  recipe: FormulationRecipe | undefined,
  fp: FinishedProduct | undefined,
): number | undefined {
  const gsm = recipe?.grammageGsm ?? fp?.grammageGsm
  return gsm && gsm > 0 ? gsm : undefined
}

export function resolveRollWidthM(
  fp: FinishedProduct | undefined,
): number | undefined {
  const w = fp?.rollWidthM
  return w && w > 0 ? w : undefined
}

/** Есть ли логотип на заказе / строке упаковки (для будущего списания краски). */
export function orderHasLogo(order: ProductionOrder | undefined): boolean {
  const v = order?.colorLogo?.trim()
  return Boolean(v && v !== '—' && v !== '-')
}
