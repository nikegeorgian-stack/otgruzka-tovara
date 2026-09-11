import { describe, expect, it } from 'vitest'
import {
  canActivateProductionOrder,
  isAreaWarehouseUnit,
  validateProductionOrderWip,
} from '@/lib/planner/activateGate'
import { normalizeProductionOrder } from '@/lib/planner/init'
import type { ProductionOrder } from '@/lib/planner/types'

function order(patch: Partial<ProductionOrder> = {}): ProductionOrder {
  return {
    id: 'po-celloplex',
    orderNumber: 'ЗП-2026-003',
    customer: 'EDU',
    finishedProductId: 'fp-celloplex-160',
    productName: 'Celloplex 160',
    warehouseItemId: 'item-celloplex-fg',
    category: 'ratl1',
    totalQtyMp: 100,
    startDate: '2026-09-10',
    endDate: '2026-09-10',
    lineId: '1',
    priority: 'normal',
    status: 'draft',
    planMode: 'even',
    recalcMode: 'auto',
    dayPlans: [],
    history: [],
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z',
    ...patch,
  }
}

const items = [
  { id: 'item-celloplex-wip', active: true, unit: 'м²' },
  { id: 'item-celloplex-wip-m2', active: true, unit: 'm2' },
  { id: 'item-impregnation', active: true, unit: 'кг' },
  { id: 'item-inactive-wip', active: false, unit: 'м²' },
]

describe('R3.1C order-level WIP mapping', () => {
  it('normalizes stable FG and WIP ids without inventing a fallback', () => {
    const normalized = normalizeProductionOrder(
      order({
        warehouseItemId: '  item-celloplex-fg  ',
        semiFinishedItemId: '  item-celloplex-wip  ',
        impregnationOutputItemId: '  item-impregnation  ',
      }),
    )
    expect(normalized.warehouseItemId).toBe('item-celloplex-fg')
    expect(normalized.semiFinishedItemId).toBe('item-celloplex-wip')
    expect(normalized.impregnationOutputItemId).toBe('item-impregnation')
    expect(
      normalizeProductionOrder(order({ semiFinishedItemId: '   ' })).semiFinishedItemId,
    ).toBeUndefined()
  })

  it('accepts explicit active area-unit aliases', () => {
    expect(isAreaWarehouseUnit('м²')).toBe(true)
    expect(isAreaWarehouseUnit('m2')).toBe(true)
    expect(isAreaWarehouseUnit('кг')).toBe(false)
    expect(
      canActivateProductionOrder(order({ semiFinishedItemId: 'item-celloplex-wip' }), undefined, {
        warehouseItems: items,
        finishedGoodsItemId: 'item-celloplex-fg',
      }),
    ).toEqual({ ok: true })
  })

  it('blocks a missing WIP mapping', () => {
    expect(canActivateProductionOrder(order(), undefined, { warehouseItems: items })).toEqual({
      ok: false,
      messageKey: 'planner.activate.wipMissing',
    })
  })

  it('blocks unknown or inactive WIP items', () => {
    expect(
      validateProductionOrderWip(order({ semiFinishedItemId: 'missing-item' }), {
        warehouseItems: items,
      }),
    ).toEqual({ ok: false, messageKey: 'planner.activate.wipUnavailable' })
    expect(
      validateProductionOrderWip(order({ semiFinishedItemId: 'item-inactive-wip' }), {
        warehouseItems: items,
      }),
    ).toEqual({ ok: false, messageKey: 'planner.activate.wipUnavailable' })
  })

  it('blocks impregnation or another non-area item', () => {
    expect(
      validateProductionOrderWip(order({ semiFinishedItemId: 'item-impregnation' }), {
        warehouseItems: items,
      }),
    ).toEqual({ ok: false, messageKey: 'planner.activate.wipAreaUnitRequired' })
  })

  it('blocks reuse of the finished-goods warehouse item', () => {
    expect(
      validateProductionOrderWip(
        order({ semiFinishedItemId: 'item-celloplex-fg' }),
        { warehouseItems: items, finishedGoodsItemId: 'item-celloplex-fg' },
      ),
    ).toEqual({ ok: false, messageKey: 'planner.activate.wipSameAsFinishedGoods' })
  })
})
