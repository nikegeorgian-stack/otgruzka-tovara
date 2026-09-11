/** R3.1C — strict G5 product-to-warehouse output mapping. */
import { describe, expect, it } from 'vitest'
import { applyProductUpsert } from '../server/fst/_g5SalesProcurementService.mjs'
import { createDefaultStore } from '@/lib/storage'
import { mirrorG5Ack } from '@/lib/planner/g5ServerClient'

const ACTOR = { uid: 'director-1', email: 'director@example.test' }
const NOW = '2026-09-10T12:00:00.000Z'

function masterData() {
  return {
    items: [
      { id: 'fg-area', code: 'FG-A', name: 'FG area', baseUnit: 'm2', active: true },
      { id: 'fg-mass', code: 'FG-K', name: 'FG mass', baseUnit: 'kg', active: true },
      { id: 'fg-inactive', code: 'FG-I', name: 'Inactive', baseUnit: 'm2', active: false },
    ],
    finishedProducts: [],
    suppliers: [],
    customers: [],
    packagingBoms: [],
    auditLog: [],
  }
}

function product(warehouseItemId?: string) {
  return {
    id: 'product-1',
    code: 'FP-1',
    name: 'Celloplex 160',
    warehouseItemId,
    active: true,
  }
}

function expectZeroWrite(command: Record<string, unknown>, error: string) {
  const source = masterData()
  const before = JSON.stringify(source)
  const result = applyProductUpsert(source, command, ACTOR, NOW, { strict: true })
  expect(result).toMatchObject({ ok: false, error })
  expect(JSON.stringify(source)).toBe(before)
}

describe('R3.1C finished-goods output mapping', () => {
  it('persists an exact active area item in the product and ack', () => {
    const result = applyProductUpsert(
      masterData(),
      product('fg-area'),
      ACTOR,
      NOW,
      { strict: true },
    )
    expect(result).toMatchObject({
      ok: true,
      result: { id: 'product-1', warehouseItemId: 'fg-area' },
      masterData: {
        finishedProducts: [
          expect.objectContaining({ id: 'product-1', warehouseItemId: 'fg-area' }),
        ],
      },
    })
  })

  it('rejects missing, unknown, inactive and non-area mappings with zero mutation', () => {
    expectZeroWrite(product(), 'finished_goods_mapping_required')
    expectZeroWrite(product('fg-missing'), 'finished_goods_item_unavailable')
    expectZeroWrite(product('fg-inactive'), 'finished_goods_item_unavailable')
    expectZeroWrite(product('fg-mass'), 'finished_goods_item_area_unit_required')
  })

  it('keeps missing mappings compatible outside strict staging', () => {
    const result = applyProductUpsert(masterData(), product(), ACTOR, NOW)
    expect(result.ok).toBe(true)
    expect(result.result.warehouseItemId).toBeUndefined()
  })

  it('does not invent a G2 category/location when mirroring an incomplete G5 item', () => {
    const store = createDefaultStore()
    const firstCategoryId = store.warehouse.categories[0]?.id
    const firstWarehouseId = store.warehouse.locations[0]?.id

    const next = mirrorG5Ack(store, {
      masterData: {
        items: [
          {
            id: 'g5-incomplete-area',
            code: 'G5-I',
            name: 'Incomplete area item',
            baseUnit: 'm2',
            active: true,
          },
        ],
      },
    })

    expect(next.warehouse.items.some((item) => item.id === 'g5-incomplete-area')).toBe(false)
    expect(firstCategoryId).toBeTruthy()
    expect(firstWarehouseId).toBeTruthy()
  })

  it('preserves an exact existing G2 tuple when G5 omits placement fields', () => {
    const store = createDefaultStore()
    const existing = store.warehouse.items[0]!

    const next = mirrorG5Ack(store, {
      masterData: {
        items: [
          {
            id: existing.id,
            code: 'UPDATED-CODE',
            name: 'Updated item',
            baseUnit: existing.unit,
            active: true,
          },
        ],
      },
    })

    expect(next.warehouse.items.find((item) => item.id === existing.id)).toMatchObject({
      categoryId: existing.categoryId,
      warehouseId: existing.warehouseId,
    })
  })
})
