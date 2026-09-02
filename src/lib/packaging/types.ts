/** Тип суровья для планирования */
export type RawMaterialKind = 'mesh' | 'membrane' | 'ratl' | 'other'

export type PackagingStackLayer = 'pallet' | 'box'

/** Сколько изделий в одной коробке (сетка и др.) */
export type BoxRecipe = {
  id: string
  /** РК-000001 */
  code: string
  name: string
  productType?: string
  rollsPerBox: number
  boxItemId?: string
  meshCellSize?: string
  note?: string
  active: boolean
  createdAt: string
  updatedAt: string
}

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
  /** Рецепты коробок (аддитивно). */
  boxes?: BoxRecipe[]
  nextBoxCode?: number
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

import { labelRuKa } from '@/i18n/localeFormat'
import type { Locale } from '@/i18n/types'

export function rawMaterialKindLabel(kind: RawMaterialKind, locale: Locale): string {
  const row = RAW_MATERIAL_KINDS.find((k) => k.id === kind)
  if (!row) return kind
  return labelRuKa(locale, row.labelRu, row.labelKa)
}
