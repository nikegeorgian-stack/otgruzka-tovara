/**
 * R2.9G — G1 overlay must not drop SQL FstStore catalogue items
 * that are missing from a shorter FstCriticalStore warehouse.items list.
 *
 * Proven staging skew: FstStore 15 items (incl. CELLO) → critical 9 → UI ~8.
 */
import { describe, expect, it } from 'vitest'
import {
  G1_CRITICAL_SOURCE,
  mirrorAuthoritativeWarehousePost,
  resolveAuthoritativeWarehouseOverlay,
} from '@/lib/warehouse/g1ServerClient'
import type { WarehouseItem, WarehouseStore } from '@/lib/warehouse/types'

function item(partial: Partial<WarehouseItem> & { id: string; name: string }): WarehouseItem {
  return {
    id: partial.id,
    name: partial.name,
    internalCode: partial.internalCode ?? `FC-${partial.id}`,
    unit: partial.unit ?? 'кг',
    active: partial.active !== false,
    warehouseId: partial.warehouseId ?? 'w-main',
    categoryId: partial.categoryId,
    sku: partial.sku,
  } as WarehouseItem
}

function wh(items: WarehouseItem[], extra?: Partial<WarehouseStore>): WarehouseStore {
  return {
    items,
    locations: [{ id: 'w-main', name: 'Основной' } as never],
    categories: [],
    documents: extra?.documents ?? [],
    movements: extra?.movements ?? [],
    auditLog: [],
    ...extra,
  } as WarehouseStore
}

describe('R2.9G G1 overlay catalogue union (SQL 15 vs critical 9)', () => {
  const legacyOnlyCello = [
    item({ id: 'cello-106', name: 'LL 106-50', internalCode: 'FC-000012', sku: 'EDU-CELLO-LL106-50' }),
    item({ id: 'cello-145', name: 'LL 145-50', internalCode: 'FC-000013', sku: 'EDU-CELLO-LL145-50' }),
    item({ id: 'cello-cal', name: 'Кальцит', internalCode: 'FC-000014', sku: 'EDU-CELLO-CALCITE' }),
    item({ id: 'cello-dis', name: 'Dispex AA 4140', internalCode: 'FC-000015', sku: 'EDU-CELLO-DISPEX' }),
    item({ id: 'cello-rhe', name: 'Rheovis HS 1212', internalCode: 'FC-000016', sku: 'EDU-CELLO-RHEOVIS' }),
    item({ id: 'cello-wat', name: 'Вода', internalCode: 'FC-000017', sku: 'EDU-CELLO-WATER' }),
  ]

  const sharedBase = [
    item({ id: 'i2', name: 'ghost-or-edu-2', internalCode: 'FC-000002' }),
    item({ id: 'i3', name: 'EDU Latex', internalCode: 'FC-000003' }),
    item({ id: 'i4', name: 'EDU Resin', internalCode: 'FC-000004' }),
    item({ id: 'i5', name: 'EDU Paste', internalCode: 'FC-000006' }),
    item({ id: 'i6', name: 'Impregnation', internalCode: 'FC-000005' }),
    item({ id: 'i7', name: 'EDU-A', internalCode: 'FC-000007' }),
    item({ id: 'i8', name: 'EDU-B', internalCode: 'FC-000008' }),
    item({ id: 'i9', name: 'EDU-latex-A', internalCode: 'FC-000009' }),
    item({ id: 'ghost', name: 'ghost', internalCode: undefined as unknown as string, active: false }),
  ]

  it('keeps SQL-only catalogue rows when critical.items is shorter but non-empty', () => {
    const legacy = wh([...sharedBase, ...legacyOnlyCello], {
      documents: [{ id: 'leg-doc' } as never],
      movements: [{ id: 'leg-mov', quantity: 99 } as never],
    })
    const critical = wh(sharedBase, {
      documents: [{ id: 'crit-doc' } as never],
      movements: [{ id: 'crit-mov', quantity: 1 } as never],
    })

    const out = resolveAuthoritativeWarehouseOverlay({
      legacyWarehouse: legacy,
      criticalWarehouse: critical,
      criticalRevision: 4,
      warehouseActive: true,
    })

    expect(out.source).toBe(G1_CRITICAL_SOURCE)
    expect(out.warehouse.items).toHaveLength(15)
    expect(out.warehouse.items.map((i) => i.internalCode).filter(Boolean)).toEqual(
      expect.arrayContaining([
        'FC-000012',
        'FC-000013',
        'FC-000014',
        'FC-000015',
        'FC-000016',
        'FC-000017',
      ]),
    )
    // Stock truth still from critical
    expect(out.warehouse.documents.map((d) => d.id)).toEqual(['crit-doc'])
    expect(out.warehouse.movements.map((m) => m.id)).toEqual(['crit-mov'])
    expect(out.warehouse.movements[0]).toMatchObject({ quantity: 1 })
  })

  it('critical wins on same item id when critical identity is not degraded', () => {
    const legacy = wh([
      item({ id: 'shared', name: 'Legacy name', internalCode: 'FC-000003', sku: 'LEGACY' }),
      item({ id: 'only-leg', name: 'Only legacy', internalCode: 'FC-000012' }),
    ])
    const critical = wh([
      item({ id: 'shared', name: 'Critical name', internalCode: 'FC-000003', sku: 'CRIT' }),
    ])
    const out = resolveAuthoritativeWarehouseOverlay({
      legacyWarehouse: legacy,
      criticalWarehouse: critical,
      criticalRevision: 2,
      warehouseActive: true,
    })
    const shared = out.warehouse.items.find((i) => i.id === 'shared')
    expect(shared?.name).toBe('Critical name')
    expect(shared?.sku).toBe('CRIT')
    expect(out.warehouse.items.some((i) => i.id === 'only-leg')).toBe(true)
  })

  it('degraded critical stub does not overwrite richer legacy identity (R2.9H)', () => {
    const legacy = wh([
      item({ id: 'cello', name: 'LL 106-50', internalCode: 'FC-000012', sku: 'EDU-CELLO-LL106-50' }),
    ])
    const critical = wh([
      item({ id: 'cello', name: 'cello', internalCode: '', sku: undefined as unknown as string }),
    ])
    // name===id is degraded
    critical.items[0].name = critical.items[0].id
    const out = resolveAuthoritativeWarehouseOverlay({
      legacyWarehouse: legacy,
      criticalWarehouse: critical,
      criticalRevision: 5,
      warehouseActive: true,
    })
    expect(out.warehouse.items[0]).toMatchObject({
      id: 'cello',
      name: 'LL 106-50',
      internalCode: 'FC-000012',
      sku: 'EDU-CELLO-LL106-50',
    })
  })

  it('empty critical items keeps full legacy catalogue', () => {
    const legacy = wh([...sharedBase, ...legacyOnlyCello])
    const critical = wh([])
    const out = resolveAuthoritativeWarehouseOverlay({
      legacyWarehouse: legacy,
      criticalWarehouse: critical,
      criticalRevision: 1,
      warehouseActive: true,
    })
    expect(out.warehouse.items).toHaveLength(15)
  })

  it('mirrorAuthoritativeWarehousePost also unions catalogue items', () => {
    const local = wh([...sharedBase, ...legacyOnlyCello])
    const server = {
      items: sharedBase,
      documents: [{ id: 'posted' } as never],
      movements: [{ id: 'm1' } as never],
    }
    const merged = mirrorAuthoritativeWarehousePost(local, server)
    expect(merged.items).toHaveLength(15)
    expect(merged.documents[0].id).toBe('posted')
  })

  it('WH and PRC see the same unioned catalogue length (selector-agnostic helper)', () => {
    const legacy = wh([...sharedBase, ...legacyOnlyCello])
    const critical = wh(sharedBase)
    const overlay = resolveAuthoritativeWarehouseOverlay({
      legacyWarehouse: legacy,
      criticalWarehouse: critical,
      criticalRevision: 4,
      warehouseActive: true,
    })
    // Simulate both interfaces reading the same store.warehouse.items
    const forWh = overlay.warehouse.items.filter((i) => i.active !== false)
    const forPrc = overlay.warehouse.items.filter((i) => i.active !== false)
    expect(forWh).toHaveLength(forPrc.length)
    expect(forWh.length).toBeGreaterThanOrEqual(14)
  })

  it('empty critical productionLineBindings preserve soft bindings (R2.9L pack)', () => {
    const softBindings = [
      {
        id: 'pack',
        lineId: 'pack',
        productionWarehouseId: 'w-main',
        productionLocationId: 'edu-loc-pack',
      },
    ]
    const legacy = wh(sharedBase, { productionLineBindings: softBindings })
    const critical = wh(sharedBase, { productionLineBindings: [] })
    const overlay = resolveAuthoritativeWarehouseOverlay({
      legacyWarehouse: legacy,
      criticalWarehouse: critical,
      criticalRevision: 19,
      warehouseActive: true,
    })
    expect(overlay.warehouse.productionLineBindings).toEqual(softBindings)
  })
})
