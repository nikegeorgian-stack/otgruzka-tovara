import { describe, expect, it } from 'vitest'
import { filterFormulationComponentItems } from '@/lib/formulations/warehouseSync'
import type { WarehouseItem } from '@/lib/warehouse/types'

function item(partial: Partial<WarehouseItem> & Pick<WarehouseItem, 'id' | 'name'>): WarehouseItem {
  return {
    internalCode: '',
    categoryId: 'edu',
    warehouseId: 'wh',
    unit: 'кг',
    active: true,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  }
}

describe('R29H formulation picker includes EDU/CELLO components', () => {
  const cats = new Map([['edu', 'EDU'], ['chem', 'Химия']])

  it('keeps EDU-category CELLO cards selectable', () => {
    const items = [
      item({ id: '1', name: 'LL 106-50', sku: 'EDU-CELLO-LL106-50', internalCode: 'FC-000012' }),
      item({ id: '2', name: 'Кальцит', sku: 'EDU-CELLO-CALCITE', internalCode: 'FC-000014' }),
      item({ id: '3', name: 'Office chair', categoryId: 'other', sku: 'CHAIR' }),
    ]
    const cats2 = new Map([...cats, ['other', 'Прочее']])
    const out = filterFormulationComponentItems(items, cats2)
    expect(out.map((i) => i.id).sort()).toEqual(['1', '2'])
  })

  it('does not crash sort when name is undefined', () => {
    const items = [
      item({ id: 'a', name: undefined as unknown as string, sku: 'EDU-CELLO-X', internalCode: 'FC-000099' }),
      item({ id: 'b', name: 'Вода', sku: 'EDU-CELLO-WATER', internalCode: 'FC-000017' }),
    ]
    expect(() => filterFormulationComponentItems(items, cats)).not.toThrow()
    const out = filterFormulationComponentItems(items, cats)
    expect(out).toHaveLength(2)
  })
})
