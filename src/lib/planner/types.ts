import type { PackagingPlan } from '@/lib/packaging/types'
import type { RawMaterialKind } from '@/lib/packaging/types'
import type { ProductionCategoryKey, ProductionLineId } from '@/lib/production/types'

export type PlannerOrderStatus = 'draft' | 'active' | 'paused' | 'completed' | 'cancelled'
export type PlannerPriority = 'normal' | 'urgent'
export type PlannerPlanMode = 'even' | 'manual'
export type PlannerRecalcMode = 'auto' | 'manual'

/** Статус подбора рецептуры пропитки технологом */
export type FormulationRecipeStatus = 'pending' | 'requested' | 'assigned'

/** Основная категория заказа для учёта факта */
export type PlannerOrderCategory = Exclude<ProductionCategoryKey, 'defect'>

export type PlannerDayPlan = {
  id: string
  date: string
  /** Исходный план (не меняется после пересчёта) */
  basePlanMp: number
  /** Оперативный план на день */
  operationalPlanMp: number
  /** Ручная правка — приоритет над автопересчётом */
  manualPlanMp?: number
  lineId: ProductionLineId
  brigadeName?: string
  note?: string
  isWorkingDay: boolean
}

export type PlannerHistoryEntry = {
  id: string
  at: string
  type:
    | 'created'
    | 'activated'
    | 'paused'
    | 'completed'
    | 'cancelled'
    | 'plan_recalc'
    | 'manual_day'
    | 'note'
    | 'recipe_norm_snapshot'
    | 'legacy_norm_capture'
  message: string
}

export type ProductionOrder = {
  id: string
  orderNumber: string
  /** Справочник контрагентов */
  counterpartyId?: string
  customer: string
  /** Справочник готовой продукции */
  finishedProductId?: string
  productName: string
  /** @deprecated — используйте finishedProductId */
  warehouseItemId?: string
  category: PlannerOrderCategory
  totalQtyMp: number
  startDate: string
  endDate: string
  lineId: ProductionLineId
  priority: PlannerPriority
  status: PlannerOrderStatus
  planMode: PlannerPlanMode
  recalcMode: PlannerRecalcMode
  colorLogo?: string
  /** Цвет готовой продукции (#hex), можно переопределить в заказе */
  productColor?: string
  note?: string
  /** Суровье: тип и позиция со склада */
  rawMaterialKind?: RawMaterialKind
  rawMaterialItemId?: string
  /** Рецепт упаковки палеты */
  packagingRecipeId?: string
  /** Рецепт коробки */
  boxRecipeId?: string
  /** Рецептура пропиточного состава */
  formulationRecipeId?: string
  /** Запрос / назначение рецептуры технологом */
  formulationRecipeStatus?: FormulationRecipeStatus
  /** Целевая граммовка / плотность для подбора рецепта, г/м² */
  targetGsm?: number
  /** Размер ячейки сетки (4x4, 4x5, 5x5…) */
  meshCellSize?: string
  /** Сколько рулонов заказано (явно; иначе из п.м / п.м в рулоне) */
  orderedRolls?: number
  /** Рулонов в коробке (иначе из рецепта упаковки) */
  rollsPerBox?: number
  /** Примечание по этикетке из заказа клиента */
  labelNote?: string
  /** Связь с заказом клиента */
  salesOrderId?: string
  salesLineId?: string
  /** Линия будет определена мастером цеха */
  lineAssignmentPending?: boolean
  /** Переопределение палеты/коробки (иначе из рецепта) */
  palletItemId?: string
  boxItemId?: string
  /** Погонных метров в одном рулоне суровья (для расчёта) */
  metersPerRoll?: number
  /** PHASE P1B — immutable recipe norm snapshot after confirm/activate */
  recipeNormSnapshot?: import('@/lib/formulations/recipeApproval').RecipeNormSnapshot
  /** PHASE P1B — stable semi-finished warehouse item (m² ledger) */
  semiFinishedItemId?: string
  /** PHASE P1B — m² per roll conversion for shift report validation */
  m2PerRoll?: number
  /** Кэш расчёта по всему заказу */
  packagingPlan?: PackagingPlan
  dayPlans: PlannerDayPlan[]
  history: PlannerHistoryEntry[]
  createdAt: string
  updatedAt: string
}

export type PlannerStore = {
  orders: ProductionOrder[]
  nextOrderSeq: number
}

export const PLANNER_ORDER_CATEGORIES: {
  key: PlannerOrderCategory
  labelRu: string
  labelKa: string
}[] = [
  { key: 'ratl1', labelRu: 'РАТЛ 1 кат (75)', labelKa: '1 კატ (75)' },
  { key: 'ratl2', labelRu: 'РАТЛ 2 кат (145)', labelKa: '2 კატ (145)' },
  { key: 'cat4', labelRu: 'IV кат (160)', labelKa: 'IV კატ (160)' },
  { key: 'cat31', labelRu: '3,1 кат', labelKa: '3,1 კატ' },
  { key: 'cat32', labelRu: '3,2 кат', labelKa: '3,2 კატ' },
]

import { labelRuKa } from '@/i18n/localeFormat'
import type { Locale } from '@/i18n/types'

export function plannerCategoryLabel(
  key: PlannerOrderCategory,
  locale: Locale,
): string {
  const row = PLANNER_ORDER_CATEGORIES.find((c) => c.key === key)
  if (!row) return key
  return labelRuKa(locale, row.labelRu, row.labelKa)
}
