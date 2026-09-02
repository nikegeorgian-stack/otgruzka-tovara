import { describe, expect, it } from 'vitest'
import { createDefaultAccessStore, normalizeAccessStore } from '@/lib/access/init'
import { viewsForUser } from '@/lib/access/permissions'
import { DEFAULT_ROLE_VIEWS } from '@/lib/access/roles'
import type { AppUser } from '@/lib/access/types'
import { normalizeWarehouse } from '@/lib/warehouse/init'
import { upsertWarehouseItemInStore } from '@/lib/warehouse/itemHistory'
import {
  applyTechnicalNameOnUpsert,
  canSetTechnicalName,
  isProductionNomenclature,
  warehouseItemDisplayName,
} from '@/lib/warehouse/technicalName'
import type { WarehouseItem, WarehouseLocation, WarehouseStore } from '@/lib/warehouse/types'

function user(roleId: AppUser['roleId'], extra: Partial<AppUser> = {}): AppUser {
  return {
    id: `u-${roleId}`,
    login: `${roleId}@test`,
    displayName: roleId,
    roleId,
    passwordHash: 'x',
    passwordSalt: 'x',
    active: true,
    createdAt: '',
    updatedAt: '',
    ...extra,
  }
}

const locations: WarehouseLocation[] = [
  { id: 'raw', name: 'Суровьё', sortOrder: 0, kind: 'raw' },
  { id: 'office', name: 'Канцелярия', sortOrder: 1, kind: 'office' },
  { id: 'pack', name: 'Упаковка', sortOrder: 2, kind: 'packaging' },
]

function item(partial: Partial<WarehouseItem> & Pick<WarehouseItem, 'id' | 'name' | 'warehouseId'>): WarehouseItem {
  return {
    internalCode: 'FC-000001',
    categoryId: 'c1',
    unit: 'кг',
    active: true,
    sortOrder: 0,
    ...partial,
  }
}

describe('warehouseItemDisplayName', () => {
  it('prefers technical name over invoice name', () => {
    expect(
      warehouseItemDisplayName({ name: 'Накладная', technicalName: 'Тех. суровьё 300' }),
    ).toBe('Тех. суровьё 300')
  })

  it('falls back to invoice name when technical name is empty', () => {
    expect(warehouseItemDisplayName({ name: 'Накладная', technicalName: '  ' })).toBe('Накладная')
    expect(warehouseItemDisplayName({ name: 'Накладная' })).toBe('Накладная')
  })
})

describe('production nomenclature gate', () => {
  it('allows raw/chemistry/wip/finished and rejects office/packaging', () => {
    expect(isProductionNomenclature({ warehouseId: 'raw' }, locations)).toBe(true)
    expect(isProductionNomenclature({ warehouseId: 'office' }, locations)).toBe(false)
    expect(isProductionNomenclature({ warehouseId: 'pack' }, locations)).toBe(false)
  })

  it('lets only technologist and sysadmin set technical name on production items', () => {
    expect(canSetTechnicalName('technologist', { warehouseId: 'raw' }, locations)).toBe(true)
    expect(canSetTechnicalName('sysadmin', { warehouseId: 'raw' }, locations)).toBe(true)
    expect(canSetTechnicalName('warehouse_keeper', { warehouseId: 'raw' }, locations)).toBe(false)
    expect(canSetTechnicalName('technologist', { warehouseId: 'office' }, locations)).toBe(false)
  })
})

describe('applyTechnicalNameOnUpsert', () => {
  const existing = item({
    id: 'i1',
    name: 'Invoice',
    warehouseId: 'raw',
    technicalName: 'Keep me',
  })

  it('ignores keeper attempts to change technical name', () => {
    const next = applyTechnicalNameOnUpsert(
      existing,
      { ...existing, technicalName: 'Hacked' },
      locations,
      'warehouse_keeper',
    )
    expect(next.technicalName).toBe('Keep me')
    expect(next.name).toBe('Invoice')
  })

  it('lets technologist set technical name on production items', () => {
    const next = applyTechnicalNameOnUpsert(
      existing,
      { ...existing, technicalName: '  New tech  ' },
      locations,
      'technologist',
    )
    expect(next.technicalName).toBe('New tech')
  })

  it('does not persist technical name on office items even for technologist', () => {
    const office = item({ id: 'i2', name: 'Бумага', warehouseId: 'office' })
    const next = applyTechnicalNameOnUpsert(
      office,
      { ...office, technicalName: 'Should drop' },
      locations,
      'technologist',
    )
    expect(next.technicalName).toBeUndefined()
  })
})

describe('upsertWarehouseItemInStore technical name', () => {
  function storeWith(it: WarehouseItem): WarehouseStore {
    return {
      locations,
      categories: [{ id: 'c1', name: 'Химия', sortOrder: 0 }],
      items: [it],
      movements: [],
      documents: [],
      invoiceRegistry: [],
      auditLog: [],
      itemHistories: {},
    }
  }

  it('keeps invoice name and records technical name in item history', () => {
    const before = item({ id: 'i1', name: 'Invoice', warehouseId: 'raw' })
    const next = upsertWarehouseItemInStore(
      storeWith(before),
      { ...before, technicalName: 'Tech' },
      'technologist',
    )
    const saved = next.items[0]!
    expect(saved.name).toBe('Invoice')
    expect(saved.technicalName).toBe('Tech')
    expect(next.itemHistories?.i1?.some((h) => h.field === 'technicalName')).toBe(true)
  })

  it('strips unauthorized technical name on create', () => {
    const fresh = item({ id: 'i9', name: 'New', warehouseId: 'raw', technicalName: 'Nope' })
    const next = upsertWarehouseItemInStore(
      {
        ...storeWith(item({ id: 'other', name: 'x', warehouseId: 'raw' })),
        items: [],
      },
      fresh,
      'warehouse_keeper',
    )
    expect(next.items[0]!.technicalName).toBeUndefined()
  })
})

describe('normalizeWarehouse keeps technicalName', () => {
  it('does not drop additive name fields', () => {
    const n = normalizeWarehouse({
      locations: [{ id: 'raw', name: 'Суровьё', sortOrder: 0, kind: 'raw' }],
      categories: [{ id: 'c1', name: 'Химия', sortOrder: 0 }],
      items: [
        {
          id: 'i1',
          internalCode: 'FC-000001',
          name: 'Invoice',
          technicalName: 'Tech',
          nameKa: 'ka',
          nameEn: 'en',
          categoryId: 'c1',
          warehouseId: 'raw',
          unit: 'кг',
          active: true,
          sortOrder: 0,
        },
      ],
      movements: [],
      documents: [],
      auditLog: [],
    })
    expect(n.items[0]!.technicalName).toBe('Tech')
    expect(n.items[0]!.nameKa).toBe('ka')
    expect(n.items[0]!.nameEn).toBe('en')
    expect(n.items[0]!.name).toBe('Invoice')
  })
})

describe('technologist warehouse access', () => {
  it('includes warehouse in default technologist views', () => {
    expect(DEFAULT_ROLE_VIEWS.technologist).toContain('warehouse')
  })

  it('adds warehouse add-only when cloud roleViews omitted it', () => {
    const access = normalizeAccessStore({
      ...createDefaultAccessStore(),
      roleViews: {
        ...createDefaultAccessStore().roleViews,
        technologist: ['technologist', 'otc', 'mixer', 'directories', 'journals', 'meals', 'tasks'],
      },
    })
    expect(access.roleViews.technologist).toContain('warehouse')
    expect(viewsForUser(access, user('technologist'))).toContain('warehouse')
  })

  it('adds warehouse even if the account has a stale webViews list', () => {
    const access = createDefaultAccessStore()
    const views = viewsForUser(
      access,
      user('technologist', { webViews: ['technologist', 'otc', 'meals'] }),
    )
    expect(views).toContain('warehouse')
    expect(views).toContain('technologist')
  })
})
