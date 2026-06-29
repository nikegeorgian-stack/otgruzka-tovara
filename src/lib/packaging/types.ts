/** Тип суровья для планирования */
export type RawMaterialKind = 'mesh' | 'membrane' | 'ratl' | 'other'

export type PackagingStackLayer = 'pallet' | 'box'

/** Рецепт укладки палеты: палета → коробка → … + рулоны сверху */
export type PackagingRecipe = {
  id: string
  /** РУ-000001 */
  code: string
  name: string
  /** Палета (E-палета или обычная) — из номенклатуры склада */
  palletItemId?: string
  /** Коробка — из номенклатуры склада */
  boxItemId?: string
  /** Схема укладки одной отгрузочной единицы */
  stack: PackagingStackLayer[]
  /** Рулонов в каждой коробке схемы */
  rollsPerBox: number
  /** Рулонов сверху (вне коробок) */
  topRolls?: number
  note?: string
  active: boolean
  createdAt: string
  updatedAt: string
}

export type PackagingRecipeStore = {
  items: PackagingRecipe[]
  nextCode: number
}

/** Расчёт потребности по заказу / дню */
export type PackagingPlan = {
  recipeId?: string
  recipeName: string
  stackDescription: string
  rollsPerPallet: number
  palletUnits: number
  palletsNeeded: number
  boxesNeeded: number
  topRolls: number
  rawRollsEstimated: number
  palletItemId?: string
  boxItemId?: string
}

export const RAW_MATERIAL_KINDS: {
  id: RawMaterialKind
  labelRu: string
  labelKa: string
}[] = [
  { id: 'mesh', labelRu: 'Сетка', labelKa: 'ბადე' },
  { id: 'membrane', labelRu: 'Мембрана', labelKa: 'მემბრანა' },
  { id: 'ratl', labelRu: 'РАТЛ (стеклоткань)', labelKa: 'RATL' },
  { id: 'other', labelRu: 'Другое', labelKa: 'სხვა' },
]

export function rawMaterialKindLabel(kind: RawMaterialKind, locale: 'ru' | 'ka'): string {
  const row = RAW_MATERIAL_KINDS.find((k) => k.id === kind)
  if (!row) return kind
  return locale === 'ka' ? row.labelKa : row.labelRu
}
