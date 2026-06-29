import type { PackagingPlan, PackagingRecipe } from './types'

export function recipeLayerCounts(recipe: PackagingRecipe) {
  const palletLayers = recipe.stack.filter((s) => s === 'pallet').length
  const boxLayers = recipe.stack.filter((s) => s === 'box').length
  const rollsInBoxes = boxLayers * (recipe.rollsPerBox || 0)
  const topRolls = recipe.topRolls ?? 0
  const rollsPerPallet = rollsInBoxes + topRolls
  return { palletLayers, boxLayers, rollsInBoxes, topRolls, rollsPerPallet }
}

export function formatStackDescription(recipe: PackagingRecipe, locale: 'ru' | 'ka'): string {
  const pallet = locale === 'ka' ? 'პალეტა' : 'Палета'
  const box = locale === 'ka' ? 'ყუთი' : 'Коробка'
  const parts = recipe.stack.map((l) => (l === 'pallet' ? pallet : box))
  let s = parts.join(' → ')
  if (recipe.topRolls && recipe.topRolls > 0) {
    s +=
      locale === 'ka'
        ? ` + ${recipe.topRolls} რულონი ზემოთ`
        : ` + ${recipe.topRolls} рул. сверху`
  }
  return s
}

/** Расчёт упаковки и рулонов суровья по объёму в п.м */
export function calcPackagingPlan(
  qtyMp: number,
  metersPerRoll: number,
  recipe: PackagingRecipe | undefined,
  locale: 'ru' | 'ka',
): PackagingPlan | null {
  if (!recipe || qtyMp <= 0 || metersPerRoll <= 0) return null
  const { palletLayers, boxLayers, rollsPerPallet, topRolls } = recipeLayerCounts(recipe)
  if (rollsPerPallet <= 0) return null

  const rawRollsEstimated = Math.ceil(qtyMp / metersPerRoll)
  const palletUnits = Math.ceil(rawRollsEstimated / rollsPerPallet)

  return {
    recipeId: recipe.id,
    recipeName: recipe.name,
    stackDescription: formatStackDescription(recipe, locale),
    rollsPerPallet,
    palletUnits,
    palletsNeeded: palletUnits * palletLayers,
    boxesNeeded: palletUnits * boxLayers,
    topRolls: palletUnits * topRolls,
    rawRollsEstimated,
    palletItemId: recipe.palletItemId,
    boxItemId: recipe.boxItemId,
  }
}
