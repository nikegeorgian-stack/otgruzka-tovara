import { newId } from '@/lib/production/files'
import { allocateInternalCode } from '@/lib/warehouse/itemHistory'
import { suggestInternalBarcode } from '@/lib/warehouse/labelCodes'
import type {
  WarehouseCategory,
  WarehouseItem,
  WarehouseLocation,
  WarehouseStore,
} from '@/lib/warehouse/types'
import type { FormulationRecipe } from './types'
import { formulationCategoryLabel, formulationColorLabel } from './types'

export function formulationRecipeDisplayName(recipe: FormulationRecipe): string {
  const parts = ['Пропитка', recipe.code.trim()]
  if (recipe.variantCode?.trim()) parts.push(recipe.variantCode.trim())
  if (recipe.name.trim()) parts.push(recipe.name.trim())
  return parts.join(' · ')
}

function formulationWarehouseNote(recipe: FormulationRecipe): string {
  return `Рецептура пропитки · ${recipe.code} · id:${recipe.id}`
}

export function findFormulationCategoryId(categories: WarehouseCategory[]): string {
  const hit =
    categories.find((c) => /пропит|состав|хим/i.test(c.name)) ??
    categories.find((c) => c.name === 'Химия')
  return hit?.id ?? categories[0]?.id ?? newId()
}

export function findChemistryWarehouseId(locations: WarehouseLocation[]): string {
  const hit = locations.find((l) => /хим/i.test(l.name))
  return hit?.id ?? locations[0]?.id ?? newId()
}

/** Позиции склада для компонентов рецептуры (химия, пасты) */
export function filterFormulationComponentItems(
  items: WarehouseItem[],
  categoryNames: Map<string, string>,
): WarehouseItem[] {
  return items
    .filter((i) => i.active)
    .filter((i) => {
      const cat = categoryNames.get(i.categoryId) ?? ''
      if (/хим|паст|пигмент|пропит|кле/i.test(cat)) return true
      return /паст|пигмент|кле|дисперс|латекс|смола/i.test(i.name)
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
}

export function buildOutputWarehouseItem(
  recipe: FormulationRecipe,
  warehouse: WarehouseStore,
  locale: 'ru' | 'ka' = 'ru',
): WarehouseItem {
  const existing = recipe.outputWarehouseItemId
    ? warehouse.items.find((i) => i.id === recipe.outputWarehouseItemId)
    : undefined

  const categoryId = existing?.categoryId ?? findFormulationCategoryId(warehouse.categories)
  const warehouseId =
    existing?.warehouseId ?? findChemistryWarehouseId(warehouse.locations)
  const name = formulationRecipeDisplayName(recipe)
  const note = [
    formulationWarehouseNote(recipe),
    recipe.labelText?.trim() ? `Этикетка: ${recipe.labelText.trim()}` : '',
    formulationCategoryLabel(recipe.category, locale),
    recipe.colorVariant
      ? formulationColorLabel(recipe.colorVariant, locale)
      : '',
    recipe.grammageGsm ? `${recipe.grammageGsm} г/м²` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  if (existing) {
    return {
      ...existing,
      name,
      sku: recipe.code,
      note,
      unit: existing.unit || 'кг',
    }
  }

  const internalCode = allocateInternalCode(warehouse)
  return {
    id: newId(),
    internalCode,
    name,
    categoryId,
    warehouseId,
    unit: 'кг',
    sku: recipe.code,
    barcode: suggestInternalBarcode(internalCode),
    note,
    active: true,
    sortOrder: warehouse.items.length,
    createdAt: new Date().toISOString(),
  }
}

/** Сохранить рецептуру вместе с позицией готовой пропитки на складе */
export function syncFormulationRecipeWarehouse(
  recipe: FormulationRecipe,
  warehouse: WarehouseStore,
  locale: 'ru' | 'ka' = 'ru',
): { recipe: FormulationRecipe; outputItem: WarehouseItem } {
  const outputItem = buildOutputWarehouseItem(recipe, warehouse, locale)
  return {
    recipe: {
      ...recipe,
      outputWarehouseItemId: outputItem.id,
    },
    outputItem,
  }
}
