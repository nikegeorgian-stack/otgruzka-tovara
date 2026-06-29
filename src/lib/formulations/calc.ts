import type { ItemBalance } from '@/lib/warehouse/types'
import type { WarehouseItem } from '@/lib/warehouse/types'
import type { FormulationComponent, FormulationRecipe } from './types'

export function sumComponentWeights(components: FormulationComponent[]): number {
  let total = 0
  for (const c of components) {
    total += c.weightKg || 0
  }
  return Math.round(total * 1000) / 1000
}

export function sumComponentCosts(components: FormulationComponent[]): number {
  let total = 0
  for (const c of components) {
    if (c.costPerBatch != null) total += c.costPerBatch
  }
  return Math.round(total * 100) / 100
}

export function recipeDryBatchKg(recipe: FormulationRecipe): number {
  return recipe.dryBatchKg ?? sumComponentWeights(recipe.components)
}

export function recipeTotalCost(recipe: FormulationRecipe): number {
  return recipe.totalCost ?? sumComponentCosts(recipe.components)
}

export function recipeTotalBatchKg(recipe: FormulationRecipe): number {
  const fromComponents = recipe.components.reduce(
    (sum, c) => sum + (c.batchKg ?? c.weightKg ?? 0),
    0,
  )
  const total = recipe.totalBatchKg ?? fromComponents
  return Math.round(total * 1000) / 1000
}

/** Расход компонента на одну партию, кг */
export function componentConsumeKg(c: FormulationComponent): number {
  return c.batchKg ?? c.weightKg ?? 0
}

/** Вода в рецепте — технологический компонент без учёта на складе */
export function isFormulationWaterComponent(c: FormulationComponent): boolean {
  return c.isWater === true || c.name?.trim().toLowerCase() === 'вода'
}

/** Списание со склада (вода не списывается) */
export function componentWarehouseConsumeKg(c: FormulationComponent): number {
  if (isFormulationWaterComponent(c)) return 0
  return componentConsumeKg(c)
}

export type RecipeStockLine = {
  componentId: string
  name: string
  warehouseItemId?: string
  itemName?: string
  unit: string
  consumeKg: number
  available: number | null
  afterOneBatch: number | null
  sufficient: boolean | null
}

export function recipeStockLines(
  recipe: FormulationRecipe,
  balances: Map<string, ItemBalance>,
  itemsById: Map<string, WarehouseItem>,
): RecipeStockLine[] {
  return recipe.components.map((c) => {
    const consumeKg = componentConsumeKg(c)
    const whId = isFormulationWaterComponent(c) ? undefined : c.warehouseItemId
    if (!whId || consumeKg <= 0 || isFormulationWaterComponent(c)) {
      return {
        componentId: c.id,
        name: c.name,
        warehouseItemId: whId,
        unit: 'кг',
        consumeKg,
        available: null,
        afterOneBatch: null,
        sufficient: null,
      }
    }
    const item = itemsById.get(whId)
    const available = balances.get(whId)?.available ?? 0
    const afterOneBatch = Math.round((available - consumeKg) * 1000) / 1000
    return {
      componentId: c.id,
      name: c.name,
      warehouseItemId: whId,
      itemName: item?.name,
      unit: item?.unit ?? 'кг',
      consumeKg,
      available: Math.round(available * 1000) / 1000,
      afterOneBatch,
      sufficient: available >= consumeKg,
    }
  })
}

/** Сколько полных партий можно сварить из текущих остатков (только привязанные к складу) */
export function maxBatchesFromStock(
  recipe: FormulationRecipe,
  balances: Map<string, ItemBalance>,
): number | null {
  let min: number | null = null
  for (const c of recipe.components) {
    if (isFormulationWaterComponent(c)) continue
    const whId = c.warehouseItemId
    const consume = componentConsumeKg(c)
    if (!whId || consume <= 0) continue
    const available = balances.get(whId)?.available ?? 0
    const n = Math.floor(available / consume)
    min = min == null ? n : Math.min(min, n)
  }
  return min
}

/** Рецепт полностью привязан к складу (можно проводить замес) */
export function recipeFullyLinkedToWarehouse(recipe: FormulationRecipe): boolean {
  if (!recipe.outputWarehouseItemId) return false
  const hasConsume = recipe.components.some(
    (c) => !isFormulationWaterComponent(c) && componentConsumeKg(c) > 0,
  )
  if (!hasConsume) return false
  return recipe.components.every(
    (c) =>
      isFormulationWaterComponent(c) ||
      componentConsumeKg(c) <= 0 ||
      Boolean(c.warehouseItemId),
  )
}

export function extractSolidsPct(note: string | undefined): string | undefined {
  if (!note) return undefined
  const m = note.match(/сухой\s+остаток[:\s-]*([\d.,]+)\s*%/i)
  return m ? `${m[1].replace(',', '.')}%` : undefined
}

export function suggestFormulationForProduct(
  grammageGsm: number | undefined,
  productType: string | undefined,
  colorVariant: string | undefined,
  recipes: FormulationRecipe[],
): FormulationRecipe | undefined {
  const active = recipes.filter((r) => r.active)
  if (!active.length) return undefined

  let category: string | undefined
  if (grammageGsm === 75) category = '75'
  else if (grammageGsm === 130) category = '130'
  else if (grammageGsm === 145) category = '145'
  else if (grammageGsm === 160) category = '160'
  else if (productType === 'membrane') category = 'membrane'
  else if (productType === 'ratl') category = 'ratl'

  let pool = category ? active.filter((r) => r.category === category) : active
  if (colorVariant) {
    const colored = pool.filter((r) => r.colorVariant === colorVariant)
    if (colored.length) pool = colored
  }
  const base = pool.filter((r) => !r.colorVariant || r.name.toLowerCase().includes('базов'))
  if (base.length) return base[0]
  return pool[0]
}
