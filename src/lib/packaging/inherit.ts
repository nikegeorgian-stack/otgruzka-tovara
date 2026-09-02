import type { FinishedProduct } from '@/lib/finishedProducts/types'
import type { BoxRecipe, PackagingRecipe, PackagingRecipeStore } from './types'

export function findActiveBoxRecipe(
  store: PackagingRecipeStore,
  id: string | undefined,
): BoxRecipe | undefined {
  if (!id) return undefined
  return (store.boxes ?? []).find((b) => b.id === id && b.active)
}

export function findActivePalletRecipe(
  store: PackagingRecipeStore,
  id: string | undefined,
): PackagingRecipe | undefined {
  if (!id) return undefined
  return store.items.find((r) => r.id === id && r.active)
}

/** Состав коробки и палеты с карточки ГП — не набирать в заказе заново. */
export function inheritPackagingFromProduct(
  fp: FinishedProduct | undefined,
  pack: PackagingRecipeStore,
) {
  const box = findActiveBoxRecipe(pack, fp?.defaultBoxRecipeId)
  const pallet = findActivePalletRecipe(pack, fp?.defaultPackagingRecipeId)
  return {
    boxRecipeId: box?.id,
    packagingRecipeId: pallet?.id,
    rollsPerBox: box?.rollsPerBox ?? pallet?.rollsPerBox,
    boxItemId: box?.boxItemId ?? pallet?.boxItemId,
    meshCellSize: box?.meshCellSize ?? fp?.meshCellSize,
  }
}
