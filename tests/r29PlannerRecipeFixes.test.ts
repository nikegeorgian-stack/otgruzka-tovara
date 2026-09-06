import { describe, expect, it } from 'vitest'
import { createDefaultStore } from '@/lib/storage'
import { createProductionSlice } from '@/store/slices/productionSlice'
import { emptyProductionOrder, normalizeProductionOrder } from '@/lib/planner/init'
import { generateEvenDayPlans } from '@/lib/planner/plan'
import { recipeDryBatchKg, recipeTotalBatchKg, recipeWaterBatchKg } from '@/lib/formulations/calc'
import {
  createDefaultFormulations,
  emptyFormulationComponent,
  emptyFormulationRecipe,
} from '@/lib/formulations/init'
import type { AppStore } from '@/lib/types'
import type { SetStore } from '@/store/storeApi'

describe('R2.9 P0-D production order numbers', () => {
  it('normalizeProductionOrder does not invent ЗП-…-001', () => {
    const o = normalizeProductionOrder({
      ...emptyProductionOrder('2026-09-05', '2026-09-12'),
      orderNumber: '',
      totalQtyMp: 100,
    })
    expect(o.orderNumber).toBe('')
  })

  it('20 sequential upserts get unique order numbers', () => {
    let store = createDefaultStore() as AppStore
    const setStore: SetStore = (updater) => {
      store = typeof updater === 'function' ? updater(store) : updater
    }
    const slice = createProductionSlice({
      setStore,
      getStore: () => store,
      getActor: () => ({ actorId: 'u1', actorName: 'Test' }),
    })

    const numbers = new Set<string>()
    for (let i = 0; i < 20; i++) {
      const draft = emptyProductionOrder('2026-09-05', '2026-09-12')
      draft.totalQtyMp = 100
      draft.productName = `Test ${i}`
      slice.upsertProductionOrder(draft)
      const saved = store.production.planner.orders.find((o) => o.id === draft.id)
      expect(saved?.orderNumber).toMatch(/^ЗП-\d{4}-\d+$/)
      numbers.add(saved!.orderNumber)
    }
    expect(numbers.size).toBe(20)
  })
})

describe('R2.9 P0-E day plan sums', () => {
  it('generateEvenDayPlans sums exactly to totalQtyMp', () => {
    const order = normalizeProductionOrder({
      ...emptyProductionOrder('2026-09-05', '2026-09-12'),
      orderNumber: 'ЗП-2026-099',
      totalQtyMp: 100,
      planMode: 'even',
    })
    const plans = generateEvenDayPlans(order)
    const sum = plans
      .filter((p) => p.isWorkingDay)
      .reduce((acc, p) => acc + p.basePlanMp, 0)
    expect(Math.round(sum * 10) / 10).toBe(100)
  })
})

describe('R2.9 P1-H recipe water split', () => {
  it('dry excludes water; water and total match 18+1+1+80', () => {
    const recipe = emptyFormulationRecipe(createDefaultFormulations())
    recipe.components = [
      { ...emptyFormulationComponent(), name: 'LL', weightKg: 18, batchKg: 18 },
      { ...emptyFormulationComponent(), name: 'Rheovis', weightKg: 1, batchKg: 1 },
      { ...emptyFormulationComponent(), name: 'Add', weightKg: 1, batchKg: 1 },
      { ...emptyFormulationComponent(), name: 'Вода', weightKg: 80, batchKg: 80, isWater: true },
    ]
    expect(recipeDryBatchKg(recipe)).toBe(20)
    expect(recipeWaterBatchKg(recipe)).toBe(80)
    expect(recipeTotalBatchKg(recipe)).toBe(100)
  })
})
