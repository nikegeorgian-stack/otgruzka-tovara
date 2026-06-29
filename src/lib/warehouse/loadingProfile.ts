import type { FinishedProduct } from '@/lib/finishedProducts/types'
import { formatStackDescription, recipeLayerCounts } from '@/lib/packaging/calc'
import type { PackagingRecipe as PackagingRecipeType } from '@/lib/packaging/types'
import { categoryMatchesLocationKind } from './locationKindFilter'
import type { WarehouseStore } from './types'

export type MissingWeightKind = 'product' | 'box' | 'pallet'

/** Типовые ширины рулона, м */
export const ROLL_WIDTH_PRESETS_M: readonly number[] = [0.75, 1.45, 1.6, 1.3]

export type MissingWeight = {
  kind: MissingWeightKind
  itemId: string
  itemName: string
  finishedProductId?: string
}

export type RollMetricsSource = 'manual' | 'nomenclature' | 'calculated'

/** Параметры одного рулона для расчёта нетто */
export type RollMetricsInput = {
  rollLengthM: number
  rollWidthM: number
  grammageGsm: number
  /** Вес из карточки номенклатуры */
  weightFromNomenclatureKg: number
  /** Явно введённый вес рулона (приоритет) */
  manualWeightKg?: number
}

export type RollMetrics = {
  weightPerRollKg: number
  areaPerRollM2: number
  source: RollMetricsSource
}

export type PackagingCounts = {
  rollsPerBox: number
  topRolls: number
  palletLayers: number
  boxLayers: number
  rollsPerPallet: number
  stackNote: string
  palletUnits: number
  physicalPallets: number
  boxes: number
  palletPlaces: number
}

export type LoadingLineProfile = {
  finishedProductId?: string
  productItemId?: string
  packagingRecipeId?: string
  packagingRecipeName?: string
  stackNote: string
  rollLengthM: number
  grammageGsm: number
  rollWidthM: number
  rollsPerPallet: number
  rollsPerBox: number
  topRolls: number
  palletLayers: number
  boxLayers: number
  palletTareKg: number
  boxTareKg: number
  weightPerRollKg: number
  areaPerRollM2: number
  weightSource: RollMetricsSource
  palletItemId?: string
  boxItemId?: string
  missingWeights: MissingWeight[]
}

function itemWeight(store: WarehouseStore, itemId?: string): number | undefined {
  if (!itemId) return undefined
  const w = store.items.find((i) => i.id === itemId)?.weightKg
  return w && w > 0 ? w : undefined
}

function itemName(store: WarehouseStore, itemId?: string): string {
  if (!itemId) return '—'
  return store.items.find((i) => i.id === itemId)?.name ?? itemId.slice(0, 8)
}

function pickPackagingRecipe(
  fp: FinishedProduct | undefined,
  recipes: PackagingRecipeType[],
  overrideId?: string,
): PackagingRecipeType | undefined {
  if (overrideId) {
    const forced = recipes.find((x) => x.id === overrideId && x.active)
    if (forced) return forced
  }
  if (!fp) return undefined
  if (fp.defaultPackagingRecipeId) {
    const r = recipes.find((x) => x.id === fp.defaultPackagingRecipeId && x.active)
    if (r) return r
  }
  return recipes.find((r) => r.active)
}

/** Ширина рулона по категории выработки (м): 75 → 0,75 м и т.п. */
export function inferRollWidthM(category?: string, grammageGsm?: number): number {
  const cat = String(category ?? '').trim()
  if (/^75$|75\s*см|0\.75/i.test(cat)) return 0.75
  if (/^145$|145\s*см|1\.45/i.test(cat)) return 1.45
  if (/^160$|160\s*см|1\.6/i.test(cat)) return 1.6
  if (/^130$|130\s*см|1\.3/i.test(cat)) return 1.3
  if (grammageGsm === 75) return 0.75
  if (grammageGsm === 145) return 1.45
  if (grammageGsm === 160) return 1.6
  if (grammageGsm === 130) return 1.3
  return 0
}

/** Вес рулона: L × W × г/м² / 1000 */
export function calcRollWeightFromDimensions(
  rollLengthM: number,
  rollWidthM: number,
  grammageGsm: number,
): number {
  if (rollLengthM <= 0 || rollWidthM <= 0 || grammageGsm <= 0) return 0
  const area = rollLengthM * rollWidthM
  return Math.round(((area * grammageGsm) / 1000) * 1000) / 1000
}

/** Площадь рулона из веса и г/м² */
export function calcRollAreaFromWeight(weightKg: number, grammageGsm: number): number {
  if (weightKg <= 0 || grammageGsm <= 0) return 0
  return Math.round(((weightKg * 1000) / grammageGsm) * 100) / 100
}

/** Площадь рулона из длины и ширины */
export function calcRollAreaFromDimensions(rollLengthM: number, rollWidthM: number): number {
  if (rollLengthM <= 0 || rollWidthM <= 0) return 0
  return Math.round(rollLengthM * rollWidthM * 100) / 100
}

/** Нетто одного рулона: номенклатура → ручной ввод → L×W×г/м² */
export function resolveRollMetrics(input: RollMetricsInput): RollMetrics {
  const manual = input.manualWeightKg ?? 0
  if (manual > 0) {
    const area =
      input.grammageGsm > 0
        ? calcRollAreaFromWeight(manual, input.grammageGsm)
        : calcRollAreaFromDimensions(input.rollLengthM, input.rollWidthM)
    return { weightPerRollKg: manual, areaPerRollM2: area, source: 'manual' }
  }

  const fromNom = input.weightFromNomenclatureKg
  if (fromNom > 0) {
    let area = calcRollAreaFromDimensions(input.rollLengthM, input.rollWidthM)
    if (area <= 0 && input.grammageGsm > 0) {
      area = calcRollAreaFromWeight(fromNom, input.grammageGsm)
    }
    return { weightPerRollKg: fromNom, areaPerRollM2: area, source: 'nomenclature' }
  }

  const calculated = calcRollWeightFromDimensions(
    input.rollLengthM,
    input.rollWidthM,
    input.grammageGsm,
  )
  if (calculated > 0) {
    return {
      weightPerRollKg: calculated,
      areaPerRollM2: calcRollAreaFromDimensions(input.rollLengthM, input.rollWidthM),
      source: 'calculated',
    }
  }

  return { weightPerRollKg: 0, areaPerRollM2: 0, source: 'calculated' }
}

export function computeRollsPerPallet(
  boxLayers: number,
  rollsPerBox: number,
  topRolls: number,
): number {
  return boxLayers * Math.max(0, rollsPerBox) + Math.max(0, topRolls)
}

export function packagingLayersFromRecipe(recipe: PackagingRecipeType | undefined): {
  palletLayers: number
  boxLayers: number
  rollsPerBox: number
  topRolls: number
  rollsPerPallet: number
} {
  if (!recipe) {
    return { palletLayers: 0, boxLayers: 0, rollsPerBox: 0, topRolls: 0, rollsPerPallet: 0 }
  }
  const { palletLayers, boxLayers, topRolls, rollsPerPallet } = recipeLayerCounts(recipe)
  return {
    palletLayers,
    boxLayers,
    rollsPerBox: recipe.rollsPerBox ?? 0,
    topRolls,
    rollsPerPallet,
  }
}

/** Коробки, поддоны и палет-места по числу рулонов и схеме укладки */
export function resolvePackagingCounts(
  rolls: number,
  recipe: PackagingRecipeType | undefined,
  overrides?: Partial<{
    rollsPerBox: number
    topRolls: number
    palletLayers: number
    boxLayers: number
  }>,
  locale: 'ru' | 'ka' = 'ru',
): PackagingCounts {
  const base = packagingLayersFromRecipe(recipe)
  const rollsPerBox = overrides?.rollsPerBox ?? base.rollsPerBox
  const topRolls = overrides?.topRolls ?? base.topRolls
  const palletLayers = overrides?.palletLayers ?? base.palletLayers
  const boxLayers = overrides?.boxLayers ?? base.boxLayers
  const rollsPerPallet = computeRollsPerPallet(boxLayers, rollsPerBox, topRolls)
  const stackNote = recipe ? formatStackDescription(recipe, locale) : ''

  if (rolls <= 0 || rollsPerPallet <= 0) {
    return {
      rollsPerBox,
      topRolls,
      palletLayers,
      boxLayers,
      rollsPerPallet,
      stackNote,
      palletUnits: 0,
      physicalPallets: 0,
      boxes: 0,
      palletPlaces: 0,
    }
  }

  const palletUnits = Math.ceil(rolls / rollsPerPallet)
  const physicalPallets = palletUnits * Math.max(1, palletLayers)
  const boxes = palletUnits * boxLayers

  return {
    rollsPerBox,
    topRolls,
    palletLayers,
    boxLayers,
    rollsPerPallet,
    stackNote,
    palletUnits,
    physicalPallets,
    boxes,
    palletPlaces: physicalPallets,
  }
}

/** @deprecated используйте resolvePackagingCounts */
export function suggestLoadingPackaging(
  rolls: number,
  recipe: PackagingRecipeType | undefined,
): { boxes: number; palletPlaces: number } {
  const c = resolvePackagingCounts(rolls, recipe)
  return { boxes: c.boxes, palletPlaces: c.palletPlaces }
}

export function resolveLoadingLineProfile(
  store: WarehouseStore,
  opts: {
    finishedProduct?: FinishedProduct
    warehouseItemId?: string
    packagingRecipes: PackagingRecipeType[]
    packagingRecipeId?: string
    locale: 'ru' | 'ka'
    /** Переопределения с формы */
    rollLengthM?: number
    grammageGsm?: number
    rollWidthM?: number
    manualWeightKg?: number
    rollsPerBox?: number
    topRolls?: number
  },
): LoadingLineProfile {
  const { finishedProduct: fp, packagingRecipes, packagingRecipeId, locale } = opts
  const missing: MissingWeight[] = []
  const recipe = pickPackagingRecipe(fp, packagingRecipes, packagingRecipeId)
  const layers = packagingLayersFromRecipe(recipe)

  const rollLengthM = opts.rollLengthM ?? fp?.metersPerRoll ?? 0
  const grammageGsm = opts.grammageGsm ?? fp?.grammageGsm ?? 0
  const rollWidthM =
    opts.rollWidthM && opts.rollWidthM > 0
      ? opts.rollWidthM
      : fp?.rollWidthM && fp.rollWidthM > 0
        ? fp.rollWidthM
        : inferRollWidthM(fp?.category, grammageGsm)

  const rollsPerBox = opts.rollsPerBox ?? layers.rollsPerBox
  const topRolls = opts.topRolls ?? layers.topRolls
  const rollsPerPallet = computeRollsPerPallet(layers.boxLayers, rollsPerBox, topRolls)

  const productItemId = fp?.warehouseItemId ?? opts.warehouseItemId
  const weightFromNom = itemWeight(store, productItemId) ?? 0

  if (productItemId && weightFromNom <= 0 && !opts.manualWeightKg) {
    missing.push({
      kind: 'product',
      itemId: productItemId,
      itemName: itemName(store, productItemId),
      finishedProductId: fp?.id,
    })
  } else if (fp && !productItemId) {
    missing.push({
      kind: 'product',
      itemId: '',
      itemName: fp.name,
      finishedProductId: fp.id,
    })
  }

  const palletItemId = recipe?.palletItemId
  const boxItemId = recipe?.boxItemId
  const palletTareKg = itemWeight(store, palletItemId) ?? 0
  const boxTareKg = itemWeight(store, boxItemId) ?? 0

  if (palletItemId && palletTareKg <= 0) {
    missing.push({
      kind: 'pallet',
      itemId: palletItemId,
      itemName: itemName(store, palletItemId),
    })
  }
  if (boxItemId && boxTareKg <= 0) {
    missing.push({
      kind: 'box',
      itemId: boxItemId,
      itemName: itemName(store, boxItemId),
    })
  }

  const metrics = resolveRollMetrics({
    rollLengthM,
    rollWidthM,
    grammageGsm,
    weightFromNomenclatureKg: weightFromNom,
    manualWeightKg: opts.manualWeightKg,
  })

  return {
    finishedProductId: fp?.id,
    productItemId,
    packagingRecipeId: recipe?.id,
    packagingRecipeName: recipe?.name,
    stackNote: recipe ? formatStackDescription(recipe, locale) : '',
    rollLengthM,
    grammageGsm,
    rollWidthM,
    rollsPerPallet,
    rollsPerBox,
    topRolls,
    palletLayers: layers.palletLayers,
    boxLayers: layers.boxLayers,
    palletTareKg,
    boxTareKg,
    weightPerRollKg: metrics.weightPerRollKg,
    areaPerRollM2: metrics.areaPerRollM2,
    weightSource: metrics.source,
    palletItemId,
    boxItemId,
    missingWeights: missing,
  }
}

export function findFinishedProductForItem(
  finishedProducts: FinishedProduct[],
  itemId?: string,
): FinishedProduct | undefined {
  if (!itemId) return undefined
  return finishedProducts.find((p) => p.warehouseItemId === itemId)
}

export function finishedWarehouseLocationId(store: WarehouseStore): string {
  const loc = store.locations.find((l) => l.kind === 'finished')
  return loc?.id ?? store.locations[0]?.id ?? ''
}

export function finishedCategoryId(store: WarehouseStore): string {
  const cat = store.categories.find((c) => categoryMatchesLocationKind(c.name, 'finished'))
  return cat?.id ?? store.categories[0]?.id ?? ''
}
