import { describe, expect, it } from 'vitest'
import type { FinishedProduct } from '@/lib/finishedProducts/types'
import type { FormulationRecipe } from '@/lib/formulations/types'
import { emptyProductionOrder } from '@/lib/planner/init'
import { emptyProductionRequest } from '@/lib/production/init'
import { buildProductionConsumeLines } from '@/lib/production/consumeLines'
import type { PackagingRecipeStore } from '@/lib/packaging/types'
import type { WarehouseItem } from '@/lib/warehouse/types'

const now = '2026-08-30T00:00:00.000Z'

function item(id: string, warehouseId: string): WarehouseItem {
  return {
    id,
    internalCode: id,
    name: id,
    categoryId: 'c1',
    warehouseId,
    unit: 'шт',
    active: true,
    sortOrder: 1,
  }
}

const pack: PackagingRecipeStore = {
  items: [
    {
      id: 'pal1',
      code: 'РУ-000001',
      name: 'Палета',
      palletItemId: 'sku-pal',
      boxItemId: 'sku-old',
      stack: ['pallet', 'box'],
      rollsPerBox: 99,
      active: true,
      createdAt: now,
      updatedAt: now,
    },
  ],
  nextCode: 2,
  boxes: [
    {
      id: 'box1',
      code: 'РК-000001',
      name: 'Коробка 4',
      rollsPerBox: 4,
      boxItemId: 'sku-box',
      active: true,
      createdAt: now,
      updatedAt: now,
    },
  ],
  nextBoxCode: 2,
}

const items = [item('sku-raw', 'wh-raw'), item('sku-box', 'wh-pack'), item('sku-pal', 'wh-pack')]

const fp: FinishedProduct = {
  id: 'fp1',
  code: 'ГП-1',
  name: 'Сетка',
  category: 'ratl1',
  unit: 'mp',
  defaultRawMaterialItemId: 'sku-raw',
  defaultBoxRecipeId: 'box1',
  defaultPackagingRecipeId: 'pal1',
  metersPerRoll: 100,
  warehouseItemId: 'sku-fg',
  active: true,
  createdAt: now,
  updatedAt: now,
}

describe('production consume lines', () => {
  it('issues raw rolls from the impregnation request', () => {
    const req = {
      ...emptyProductionRequest('2026-08-30', '1'),
      rawMaterialItemId: 'sku-raw',
      rawRollQty: 6,
      factRows: [
        {
          ...emptyProductionRequest('2026-08-30').factRows[0],
          ratl1: { qtyMp: 500 },
        },
      ],
    }
    const lines = buildProductionConsumeLines(req, [], [fp], items, pack)
    expect(lines).toEqual([{ itemId: 'sku-raw', quantity: 6, warehouseId: 'wh-raw' }])
  })

  it('issues boxes and pallets from pack fact, preferring box recipe', () => {
    const order = {
      ...emptyProductionOrder('2026-08-30', '2026-08-31'),
      finishedProductId: 'fp1',
      boxRecipeId: 'box1',
      packagingRecipeId: 'pal1',
      metersPerRoll: 100,
    }
    const req = {
      ...emptyProductionRequest('2026-08-30', 'pack'),
      orderId: order.id,
      packaging: {
        thermoFilm: '',
        stretch: '',
        rolls: [{ id: 'r1', name: 'Сетка', colorLogo: '', factQty: 8 }],
        boxes: [{ id: 'b1', name: 'Кор', colorLogo: '', factQty: 0 }],
        pallets: [{ id: 'p1', name: 'Пал', colorLogo: '', factQty: 0 }],
      },
    }
    const lines = buildProductionConsumeLines(req, [order], [fp], items, pack)
    expect(lines.find((l) => l.itemId === 'sku-box')?.quantity).toBe(2)
    expect(lines.find((l) => l.itemId === 'sku-pal')?.quantity).toBe(1)
  })

  it('issues finished impregnation from recipe on impregnation line', () => {
    const order = {
      ...emptyProductionOrder('2026-09-01', '2026-09-30'),
      finishedProductId: 'fp1',
      formulationRecipeId: 'rec1',
    }
    const req = {
      ...emptyProductionRequest('2026-09-01', '1'),
      orderId: order.id,
      factRows: [
        {
          ...emptyProductionRequest('2026-09-01').factRows[0],
          ratl1: { qtyMp: 100 },
        },
      ],
    }
    const fpWide: FinishedProduct = { ...fp, rollWidthM: 2, grammageGsm: 145 }
    const recipes: FormulationRecipe[] = [
      {
        id: 'rec1',
        code: 'RP-1',
        name: '145',
        category: '145',
        currency: 'GEL',
        grammageGsm: 145,
        components: [],
        outputWarehouseItemId: 'sku-imp',
        active: true,
        createdAt: now,
        updatedAt: now,
      },
    ]
    const itemsWithImp = [...items, item('sku-imp', 'wh-chem')]
    const lines = buildProductionConsumeLines(
      req,
      [order],
      [fpWide],
      itemsWithImp,
      pack,
      recipes,
    )
    expect(lines.find((l) => l.itemId === 'sku-imp')?.quantity).toBe(29)
  })

  it('does not invent consume lines without nomenclature', () => {
    const req = emptyProductionRequest('2026-08-30', '1')
    expect(buildProductionConsumeLines(req, [], [], [], pack)).toEqual([])
  })
})
