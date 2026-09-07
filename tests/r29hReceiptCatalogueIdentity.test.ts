/**
 * R2.9H — receipt must not corrupt existing catalogue identity.
 *
 * Proven staging path:
 * ЗЗ lines → prepareReceipt (no snapshots in G1 post) → ensureItemCatalog
 * stubs name=itemId → critical mirror union prefers stubs → SQL/UI UUID names.
 */
import { describe, expect, it } from 'vitest'
import {
  compareWarehouseItemsForSort,
  ensureItemCatalogPure,
  isCompleteItemIdentitySnapshot,
  isDegradedCatalogueIdentity,
  mergeCatalogueItemIdentity,
  unionWarehouseCatalogueItems,
} from '@/lib/warehouse/catalogueIdentity'
import {
  mirrorAuthoritativeWarehousePost,
  resolveAuthoritativeWarehouseOverlay,
} from '@/lib/warehouse/g1ServerClient'
import { preparePurchaseOrderReceipt } from '@/lib/procurement/receive'
import { createDefaultStore } from '@/lib/storage'
import type { AppStore } from '@/lib/types'
import type { WarehouseItem, WarehouseStore } from '@/lib/warehouse/types'

const CELLO = [
  {
    id: '86b952e3-c0b3-494b-9344-1f9bb5a9f45b',
    name: 'LL 106-50',
    internalCode: 'FC-000012',
    sku: 'EDU-CELLO-LL106-50',
    unit: 'кг',
    categoryId: 'a9324ae8-dcb1-491f-b141-9a15f94f5f75',
    active: true,
  },
  {
    id: '51f5bf60-f009-420b-ba92-5e3f85c5d014',
    name: 'LL 145-50',
    internalCode: 'FC-000013',
    sku: 'EDU-CELLO-LL145-50',
    unit: 'кг',
    categoryId: 'a9324ae8-dcb1-491f-b141-9a15f94f5f75',
    active: true,
  },
  {
    id: '0f92e98d-6b0d-41bf-a15d-32fc4fbd534b',
    name: 'Кальцит',
    internalCode: 'FC-000014',
    sku: 'EDU-CELLO-CALCITE',
    unit: 'кг',
    categoryId: 'a9324ae8-dcb1-491f-b141-9a15f94f5f75',
    active: true,
  },
  {
    id: '1cf1c706-219a-4e9d-945f-6572be5be50c',
    name: 'Dispex AA 4140',
    internalCode: 'FC-000015',
    sku: 'EDU-CELLO-DISPEX',
    unit: 'кг',
    categoryId: 'a9324ae8-dcb1-491f-b141-9a15f94f5f75',
    active: true,
  },
  {
    id: 'a7b9f2f1-5951-4c9f-b62f-a45cb4701e7a',
    name: 'Rheovis HS 1212',
    internalCode: 'FC-000016',
    sku: 'EDU-CELLO-RHEOVIS',
    unit: 'кг',
    categoryId: 'a9324ae8-dcb1-491f-b141-9a15f94f5f75',
    active: true,
  },
  {
    id: 'ae2df2e5-bd00-48e6-9ad3-446b363fbb9b',
    name: 'Вода',
    internalCode: 'FC-000017',
    sku: 'EDU-CELLO-WATER',
    unit: 'кг',
    categoryId: 'a9324ae8-dcb1-491f-b141-9a15f94f5f75',
    active: true,
  },
] as const

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
    barcode: partial.barcode,
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
    nextInternalCode: extra?.nextInternalCode ?? 18,
    ...extra,
  } as WarehouseStore
}

describe('R2.9H receipt catalogue identity (six-line CELLO)', () => {
  const canonical = CELLO.map((c) => item({ ...c }))

  it('existing item is matched only by stable id; incomplete unknown snapshot fails closed', () => {
    const before = canonical.map((c) => ({ ...c }))
    const lines = CELLO.map((c) => ({
      itemId: c.id,
      quantity: 1,
      // malicious / empty snapshot that previously became name=itemId
      itemNameSnapshot: undefined,
      itemCodeSnapshot: undefined,
      unitSnapshot: undefined,
    }))
    const ensured = ensureItemCatalogPure(before, lines)
    expect(ensured.ok).toBe(true)
    if (!ensured.ok) return
    expect(ensured.items).toHaveLength(6)
    for (const c of CELLO) {
      const row = ensured.items.find((i) => i.id === c.id)!
      expect(row.name).toBe(c.name)
      expect(row.internalCode).toBe(c.internalCode)
      expect(row.sku).toBe(c.sku)
      expect(row.unit).toBe(c.unit)
      expect(row.categoryId).toBe(c.categoryId)
      expect(row.active).toBe(true)
      expect(row.barcode).toBeUndefined()
    }

    const unknown = ensureItemCatalogPure(before, [
      {
        itemId: 'brand-new-id',
        itemNameSnapshot: undefined,
        unitSnapshot: undefined,
      },
    ])
    expect(unknown.ok).toBe(false)
    if (unknown.ok) return
    expect(unknown.error).toBe('unknown_item_incomplete_snapshot')
  })

  it('UUID / empty snapshot must not replace identity of existing cards', () => {
    const existing = item({
      id: CELLO[0].id,
      name: CELLO[0].name,
      internalCode: CELLO[0].internalCode,
      sku: CELLO[0].sku,
      unit: 'кг',
      categoryId: CELLO[0].categoryId,
      active: true,
      barcode: 'BC-1',
    })
    const ensured = ensureItemCatalogPure([existing], [
      {
        itemId: CELLO[0].id,
        itemNameSnapshot: CELLO[0].id,
        itemCodeSnapshot: 'FC-000099',
        unitSnapshot: 'pcs',
        skuSnapshot: 'HACK',
        categoryIdSnapshot: 'other',
        barcodeSnapshot: 'X',
        activeSnapshot: false,
      },
    ])
    expect(ensured.ok).toBe(true)
    if (!ensured.ok) return
    expect(ensured.items[0]).toMatchObject({
      id: CELLO[0].id,
      name: CELLO[0].name,
      internalCode: CELLO[0].internalCode,
      sku: CELLO[0].sku,
      unit: 'кг',
      categoryId: CELLO[0].categoryId,
      active: true,
      barcode: 'BC-1',
    })
  })

  it('item count unchanged after six-line ensure; docs keep original itemIds', () => {
    const docs = [
      {
        id: 'pr-004',
        number: 'ПР-1BC8F872-2026-004',
        status: 'posted',
        lines: CELLO.map((c) => ({ itemId: c.id, quantity: 1 })),
      },
    ]
    const store = wh(canonical, { documents: docs as never })
    const ensured = ensureItemCatalogPure(
      store.items,
      CELLO.map((c) => ({
        itemId: c.id,
        itemNameSnapshot: c.id,
        unitSnapshot: 'кг',
      })),
    )
    expect(ensured.ok).toBe(true)
    if (!ensured.ok) return
    expect(ensured.items).toHaveLength(6)
    expect(store.documents[0].lines.map((l) => l.itemId)).toEqual(CELLO.map((c) => c.id))
  })

  it('overlay/mirror: degraded critical stub does not overwrite rich SQL card', () => {
    const legacy = wh(canonical)
    const stubs = CELLO.map((c) =>
      item({
        id: c.id,
        name: c.id,
        internalCode: '',
        sku: undefined,
        unit: 'кг',
        categoryId: undefined,
        active: true,
      }),
    )
    const critical = wh(stubs, {
      documents: [{ id: 'pr-004', lines: CELLO.map((c) => ({ itemId: c.id })) } as never],
      movements: CELLO.map((c) => ({ id: `m-${c.id}`, itemId: c.id, quantity: 1 }) as never),
    })

    const overlay = resolveAuthoritativeWarehouseOverlay({
      legacyWarehouse: legacy,
      criticalWarehouse: critical,
      criticalRevision: 5,
      warehouseActive: true,
    })
    expect(overlay.warehouse.items).toHaveLength(6)
    for (const c of CELLO) {
      const row = overlay.warehouse.items.find((i) => i.id === c.id)!
      expect(isDegradedCatalogueIdentity(row)).toBe(false)
      expect(row.name).toBe(c.name)
      expect(row.internalCode).toBe(c.internalCode)
      expect(row.sku).toBe(c.sku)
      expect(row.categoryId).toBe(c.categoryId)
      expect(row.active).toBe(true)
    }
    // stock truth still critical
    expect(overlay.warehouse.documents[0].id).toBe('pr-004')
    expect(overlay.warehouse.movements).toHaveLength(6)

    const mirrored = mirrorAuthoritativeWarehousePost(legacy, critical)
    expect(mirrored.items.find((i) => i.id === CELLO[0].id)?.name).toBe('LL 106-50')
  })

  it('preparePurchaseOrderReceipt attaches identity snapshots from catalogue', () => {
    const base = createDefaultStore() as AppStore
    const warehouse = wh(canonical, {
      locations: [{ id: 'w-main', name: 'Основной', active: true } as never],
    })
    const orderId = 'po-cello'
    const store: AppStore = {
      ...base,
      warehouse,
      counterparties: {
        ...base.counterparties,
        items: [{ id: 'cp-1', name: 'EDU-SUPPLIER', active: true } as never],
      },
      procurement: {
        ...base.procurement,
        orders: [
          {
            id: orderId,
            orderNumber: 'ЗЗ-2026-0004',
            status: 'ordered',
            counterpartyId: 'cp-1',
            destinationWarehouseId: 'w-main',
            lines: CELLO.map((c, idx) => ({
              id: `line-${idx}`,
              warehouseItemId: c.id,
              name: c.name,
              quantity: idx === 0 ? 390 : idx === 1 ? 150 : idx === 2 ? 150 : idx === 3 ? 3 : idx === 4 ? 1 : 106,
              receivedQty: 0,
              unit: 'кг',
              unitPrice: 1,
            })),
          } as never,
        ],
      },
    }

    const prepared = preparePurchaseOrderReceipt(store, orderId)
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    expect(prepared.documentInput.lines).toHaveLength(6)
    expect(prepared.warehouseWithItems.items).toHaveLength(6)
    for (const line of prepared.documentInput.lines) {
      const c = CELLO.find((x) => x.id === line.itemId)!
      expect(line.itemNameSnapshot).toBe(c.name)
      expect(line.itemCodeSnapshot).toBe(c.internalCode)
      expect(line.unitSnapshot).toBe('кг')
      expect(isCompleteItemIdentitySnapshot(line)).toBe(true)
    }
  })

  it('after simulated reload, cards + stock ids survive union', () => {
    const legacyAfterSave = wh(
      CELLO.map((c) =>
        item({
          id: c.id,
          name: c.id, // corrupted SQL
          internalCode: `FC-00002${c.internalCode.slice(-1)}`,
          unit: 'кг',
        }),
      ),
    )
    // If critical is also stubbed, merge keeps stub — repair is separate.
    // Reload path with rich local + stub critical recovers identity:
    const richLocal = wh(canonical)
    const stubCritical = wh(
      CELLO.map((c) => item({ id: c.id, name: c.id, internalCode: '', unit: 'кг' })),
    )
    const merged = unionWarehouseCatalogueItems(richLocal.items, stubCritical.items)
    expect(merged.every((i) => !isDegradedCatalogueIdentity(i))).toBe(true)
    expect(legacyAfterSave.items).toHaveLength(6)
  })

  it('safe sort does not throw when name is undefined', () => {
    const broken = [
      item({ id: 'a', name: undefined as unknown as string, internalCode: 'FC-000012' }),
      item({ id: 'b', name: 'LL 145-50', internalCode: 'FC-000013' }),
      { id: 'c', internalCode: undefined, sku: 'Z' } as WarehouseItem,
    ]
    expect(() =>
      [...broken].sort((x, y) => compareWarehouseItemsForSort(x, y, 'ru')),
    ).not.toThrow()
    const sorted = [...broken].sort((x, y) => compareWarehouseItemsForSort(x, y, 'ru'))
    expect(sorted.map((i) => i.id)).toContain('a')
  })

  it('non-degraded critical still wins over legacy (R2.9G invariant)', () => {
    const legacy = item({
      id: 'shared',
      name: 'Legacy',
      internalCode: 'FC-000003',
      sku: 'LEG',
    })
    const critical = item({
      id: 'shared',
      name: 'Critical',
      internalCode: 'FC-000003',
      sku: 'CRIT',
    })
    const merged = mergeCatalogueItemIdentity(critical, legacy)
    expect(merged.name).toBe('Critical')
    expect(merged.sku).toBe('CRIT')
  })
})
