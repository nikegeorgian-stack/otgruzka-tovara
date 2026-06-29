import type { ProductionOrder } from '@/lib/planner/types'
import type { ProductionLineId } from '@/lib/production/types'
import { recipeTotalBatchKg } from './calc'
import { nextMixTaskNumber } from './init'
import type {
  FormulationColorVariant,
  FormulationMixTask,
  FormulationRecipe,
  FormulationStore,
} from './types'

/** Эффективный план дня (ручная правка приоритетнее) */
function dayPlanMp(p: { manualPlanMp?: number; operationalPlanMp: number }): number {
  return p.manualPlanMp ?? p.operationalPlanMp
}

export type MixTaskInput = {
  recipeId: string
  targetVolumeL: number
  warehouseId?: string
  plannedDate: string
  shift?: 'day' | 'night'
  lineId?: string
  brigade?: string
  priority?: number
  note?: string
  sourceOrderId?: string
  sourceDayPlanId?: string
  createdBy?: string
  createdByName?: string
}

/** Создать запись задания на замес (без проводки) */
export function createMixTaskRecord(
  store: FormulationStore,
  input: MixTaskInput,
): FormulationMixTask | null {
  const recipe = store.recipes.find((r) => r.id === input.recipeId)
  if (!recipe) return null
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    taskNumber: nextMixTaskNumber(store.mixTasks ?? [], input.plannedDate),
    recipeId: recipe.id,
    recipeCode: recipe.code,
    recipeName: recipe.name,
    colorVariant: recipe.colorVariant,
    grammageGsm: recipe.grammageGsm,
    targetVolumeL: Number(input.targetVolumeL) || 0,
    warehouseId: input.warehouseId,
    plannedDate: input.plannedDate.slice(0, 10),
    shift: input.shift,
    lineId: input.lineId,
    brigade: input.brigade,
    priority: input.priority,
    status: 'open',
    sourceOrderId: input.sourceOrderId,
    sourceDayPlanId: input.sourceDayPlanId,
    createdBy: input.createdBy,
    createdByName: input.createdByName,
    note: input.note,
    createdAt: now,
    updatedAt: now,
  }
}

export type MixTaskSuggestion = {
  key: string
  orderId: string
  dayPlanId: string
  date: string
  lineId: ProductionLineId
  recipeId: string
  recipeCode: string
  recipeName: string
  colorVariant?: FormulationColorVariant
  grammageGsm?: number
  plannedMp: number
  brigade?: string
  suggestedVolumeL: number
  productName: string
  customer: string
}

/**
 * Подсказки заданий на замес из планировщика: активные заказы с рецептурой
 * пропитки, по рабочим дням в окне [fromDate; fromDate+days], для которых ещё
 * нет открытого/выполненного задания.
 */
export function buildMixTaskSuggestions(
  orders: ProductionOrder[],
  recipes: FormulationRecipe[],
  existing: FormulationMixTask[],
  opts: { fromDate: string; days: number },
): MixTaskSuggestion[] {
  const from = opts.fromDate.slice(0, 10)
  const toDate = new Date(from + 'T00:00:00')
  toDate.setDate(toDate.getDate() + Math.max(0, opts.days))
  const to = toDate.toISOString().slice(0, 10)

  const taken = new Set(
    (existing ?? [])
      .filter((task) => task.status !== 'cancelled' && task.sourceOrderId && task.sourceDayPlanId)
      .map((task) => `${task.sourceOrderId}:${task.sourceDayPlanId}`),
  )

  const out: MixTaskSuggestion[] = []
  for (const order of orders) {
    if (order.status !== 'active') continue
    if (!order.formulationRecipeId) continue
    const recipe = recipes.find((r) => r.id === order.formulationRecipeId && r.active)
    if (!recipe) continue
    const baseVolume = Math.round(recipeTotalBatchKg(recipe)) || 1000

    for (const dp of order.dayPlans) {
      if (!dp.isWorkingDay) continue
      if (dp.date < from || dp.date >= to) continue
      const planned = dayPlanMp(dp)
      if (planned <= 0) continue
      const key = `${order.id}:${dp.id}`
      if (taken.has(key)) continue
      out.push({
        key,
        orderId: order.id,
        dayPlanId: dp.id,
        date: dp.date,
        lineId: dp.lineId,
        recipeId: recipe.id,
        recipeCode: recipe.code,
        recipeName: recipe.name,
        colorVariant: recipe.colorVariant,
        grammageGsm: recipe.grammageGsm,
        plannedMp: planned,
        brigade: dp.brigadeName,
        suggestedVolumeL: baseVolume,
        productName: order.productName,
        customer: order.customer,
      })
    }
  }

  return out.sort((a, b) => a.date.localeCompare(b.date) || a.lineId.localeCompare(b.lineId))
}
