import { describe, expect, it } from 'vitest'
import {
  collectItemIdsWithWarehouseEvidence,
  filterItemsForDocumentPicker,
  itemAllowedForDocumentWarehouse,
  resolveWarehouseIdForItem,
} from '@/lib/warehouse/locationKindFilter'
import { buildProductionConsumeLines } from '@/lib/production/consumeLines'
import { emptyProductionRequest } from '@/lib/production/init'
import { emptyProductionOrder } from '@/lib/planner/init'
import type { FinishedProduct } from '@/lib/finishedProducts/types'
import type { FormulationRecipe } from '@/lib/formulations/types'
import type { PackagingRecipeStore } from '@/lib/packaging/types'
import { resolveWarehouseLocationsForPicker } from '@/lib/warehouse/resolveWarehouseLocationsForPicker'
import { searchNomenclature } from '@/lib/warehouse/nomenclatureSearch'
import type { WarehouseItem, WarehouseLocation, WarehouseStore } from '@/lib/warehouse/types'

const WH = '1bc8f872-ded1-4ee9-8ed8-f70d3c54027c'
const OTHER = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

const loc: WarehouseLocation = {
  id: WH,
  name: '1bc8f872…',
  sortOrder: 0,
  kind: 'other',
}

function item(
  partial: Partial<WarehouseItem> & Pick<WarehouseItem, 'id' | 'name'>,
): WarehouseItem {
  return {
    active: true,
    categoryId: 'c1',
    unit: 'кг',
    ...partial,
  } as WarehouseItem
}

describe('R29L document picker: locations=[] + legacy warehouseId=null', () => {
  it('recovers location ids from documents when locations catalogue empty', () => {
    const locs = resolveWarehouseLocationsForPicker({
      locations: [],
      documents: [
        {
          id: 'd1',
          warehouseId: WH,
        } as WarehouseStore['documents'][number],
      ],
      movements: [],
      accountingByWarehouse: [],
      items: [],
    })
    expect(locs).toHaveLength(1)
    expect(locs[0].id).toBe(WH)
  })

  it('allows legacy null warehouseId only with G2 movement evidence on selected WH', () => {
    const mesh = item({ id: 'edu-cello-mesh-160-10-20260908', name: 'EDU сетка', warehouseId: undefined })
    const orphan = item({ id: 'orphan-null', name: 'Orphan null', warehouseId: undefined })
    const otherWh = item({ id: 'other-wh', name: 'Other WH', warehouseId: OTHER })
    const sameWh = item({ id: 'same-wh', name: 'Same WH', warehouseId: WH })
    const inactive = item({
      id: 'inactive-mesh',
      name: 'Inactive',
      warehouseId: undefined,
      active: false,
    })

    const evidence = {
      movements: [
        { itemId: mesh.id, warehouseId: WH },
        { itemId: inactive.id, warehouseId: WH },
      ],
      documents: [] as { warehouseId?: string; lines: { itemId: string }[] }[],
    }

    const activeOnly = [mesh, orphan, otherWh, sameWh].filter((i) => i.active)
    const list = filterItemsForDocumentPicker(activeOnly, [], WH, loc, evidence)

    expect(list.map((i) => i.id).sort()).toEqual(['edu-cello-mesh-160-10-20260908', 'same-wh'])
    expect(list.find((i) => i.id === 'orphan-null')).toBeUndefined()
    expect(list.find((i) => i.id === 'other-wh')).toBeUndefined()
  })

  it('allows legacy null via document line evidence without movements', () => {
    const impreg = item({
      id: '19344ded-ed41-4dd6-9494-db443ee8335f',
      name: 'Пропитка РП-0003',
      warehouseId: undefined,
    })
    const list = filterItemsForDocumentPicker([impreg], [], WH, loc, {
      movements: [],
      documents: [
        {
          warehouseId: WH,
          lines: [{ itemId: impreg.id }],
        },
      ],
    })
    expect(list.map((i) => i.id)).toEqual([impreg.id])
  })

  it('does not allow legacy null without evidence (filter stays warehouse-scoped)', () => {
    const orphan = item({ id: 'orphan', name: 'Orphan', warehouseId: undefined })
    expect(itemAllowedForDocumentWarehouse(orphan, WH, new Set())).toBe(false)
    const list = filterItemsForDocumentPicker([orphan], [], WH, loc, {
      movements: [],
      documents: [],
    })
    expect(list).toEqual([])
  })

  it('collectItemIdsWithWarehouseEvidence unions movements and doc lines', () => {
    const ids = collectItemIdsWithWarehouseEvidence(WH, {
      movements: [
        { itemId: 'a', warehouseId: WH },
        { itemId: 'b', warehouseId: OTHER },
      ],
      documents: [
        { warehouseId: WH, lines: [{ itemId: 'c' }] },
        { warehouseId: OTHER, lines: [{ itemId: 'd' }] },
      ],
    })
    expect([...ids].sort()).toEqual(['a', 'c'])
  })

  it('search on pre-filtered picker keeps legacy null and hides other WH', () => {
    const prefiltered = [
      item({ id: 'mesh', name: 'EDU сетка', warehouseId: undefined }),
      item({ id: 'same', name: 'Same', warehouseId: WH }),
    ]
    const list = searchNomenclature(prefiltered, '', { warehouseId: WH, limit: 50 })
    expect(list.map((i) => i.id).sort()).toEqual(['mesh', 'same'])

    const withOther = [
      ...prefiltered,
      item({ id: 'other', name: 'Other', warehouseId: OTHER }),
    ]
    const list2 = searchNomenclature(withOther, '', { warehouseId: WH, limit: 50 })
    expect(list2.map((i) => i.id).sort()).toEqual(['mesh', 'same'])
  })

  it('preserves item id identity (no rewrite of warehouseItemId)', () => {
    const mesh = item({
      id: 'edu-cello-mesh-160-10-20260908',
      name: 'EDU сетка',
      warehouseId: undefined,
      internalCode: 'FC-000027',
    })
    const list = filterItemsForDocumentPicker([mesh], [], WH, loc, {
      movements: [{ itemId: mesh.id, warehouseId: WH }],
      documents: [],
    })
    expect(list).toHaveLength(1)
    expect(list[0]).toBe(mesh)
    expect(list[0].id).toBe('edu-cello-mesh-160-10-20260908')
    expect(list[0].internalCode).toBe('FC-000027')
  })

  it('resolveWarehouseIdForItem uses card id or G2 evidence, never other WH alone', () => {
    expect(resolveWarehouseIdForItem('x', WH)).toBe(WH)
    expect(resolveWarehouseIdForItem('x', null)).toBeUndefined()
    expect(
      resolveWarehouseIdForItem('mesh', null, {
        movements: [{ itemId: 'mesh', warehouseId: WH }],
      }),
    ).toBe(WH)
    expect(
      resolveWarehouseIdForItem('mesh', '', {
        movements: [{ itemId: 'mesh', warehouseId: OTHER }],
        documents: [{ warehouseId: WH, lines: [{ itemId: 'mesh' }] }],
      }, WH),
    ).toBe(WH)
  })

  it('consume lines resolve legacy null warehouseId via G2 evidence (no crash key)', () => {
    const mesh = item({
      id: 'edu-cello-mesh-160-10-20260908',
      name: 'EDU сетка',
      warehouseId: undefined as unknown as string,
      unit: 'рул',
    })
    const impreg = item({
      id: '19344ded-ed41-4dd6-9494-db443ee8335f',
      name: 'РП-0003',
      warehouseId: undefined as unknown as string,
      unit: 'кг',
    })
    const fp = {
      id: 'fp1',
      name: 'EDU Celloplex',
      active: true,
      warehouseItemId: 'fg1',
      defaultRawMaterialItemId: mesh.id,
      metersPerRoll: 50,
      rollWidthM: 1.6,
    } as FinishedProduct
    const order = {
      ...emptyProductionOrder(),
      id: 'edu-cello-planner-order-20260908',
      finishedProductId: fp.id,
      rawMaterialItemId: mesh.id,
      metersPerRoll: 50,
    }
    const recipe = {
      id: 'r1',
      active: true,
      outputWarehouseItemId: impreg.id,
      finishedProductId: fp.id,
    } as FormulationRecipe
    const req = {
      ...emptyProductionRequest(),
      lineId: '1' as const,
      orderId: order.id,
      rawRollQty: 2,
      planSegments: [{ id: 's1', orderId: order.id, plannedQtyMp: 12.5 }],
      factRows: [
        {
          ...emptyProductionRequest().factRows[0],
          ratl1: { qtyMp: 12.5 },
        },
      ],
    }
    const pack: PackagingRecipeStore = { items: [], nextCode: 1, boxes: [], nextBoxCode: 1 }
    const evidence = {
      movements: [
        { itemId: mesh.id, warehouseId: WH },
        { itemId: impreg.id, warehouseId: WH },
      ],
      documents: [] as { warehouseId?: string; lines: { itemId: string }[] }[],
    }
    const lines = buildProductionConsumeLines(
      req,
      [order],
      [fp],
      [mesh, impreg],
      pack,
      [recipe],
      evidence,
    )
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(line.warehouseId).toBe(WH)
      expect(typeof line.warehouseId.slice(0, 4)).toBe('string')
    }
    // Without evidence: legacy null must not emit undefined warehouseId keys
    const noEvidence = buildProductionConsumeLines(
      req,
      [order],
      [fp],
      [mesh, impreg],
      pack,
      [recipe],
    )
    expect(noEvidence.every((l) => Boolean(l.warehouseId))).toBe(true)
    expect(noEvidence).toEqual([])
  })
})
