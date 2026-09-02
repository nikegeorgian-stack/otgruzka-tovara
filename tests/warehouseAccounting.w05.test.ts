import { describe, expect, it } from 'vitest'
import {
  getWarehouseAccountingStatus,
  WAREHOUSE_NOT_INITIALIZED,
  withActiveWarehouses,
} from '@/lib/warehouse/accountingStatus'
import {
  postWarehouseDocument,
  saveWarehouseDocumentDraft,
} from '@/lib/warehouse/documents'
import {
  postOpeningInventory,
  saveOpeningInventoryDraft,
} from '@/lib/warehouse/openingInventory'
import {
  materialAvailabilityForOrder,
  orderHasMaterialShortage,
} from '@/lib/planner/materialStock'
import type { ProductionOrder } from '@/lib/planner/types'
import { computeItemBalance } from '@/lib/warehouse/stock'
import { INSUFFICIENT_STOCK_ERROR } from '@/lib/warehouse/stockSafety'
import type { WarehouseItem, WarehouseStore } from '@/lib/warehouse/types'

function baseStore(overrides?: Partial<WarehouseStore>): WarehouseStore {
  const loc = { id: 'wh-a', name: 'Склад A', sortOrder: 1 }
  const locB = { id: 'wh-b', name: 'Склад B', sortOrder: 2 }
  const item: WarehouseItem = {
    id: 'item-1',
    internalCode: 'RM-1',
    name: 'Сырьё 1',
    categoryId: 'cat-1',
    warehouseId: loc.id,
    unit: 'кг',
    active: true,
    sortOrder: 1,
  }
  const item2: WarehouseItem = {
    ...item,
    id: 'item-2',
    internalCode: 'RM-2',
    name: 'Сырьё 2',
    warehouseId: locB.id,
  }
  return {
    locations: [loc, locB],
    categories: [{ id: 'cat-1', name: 'Сырьё', sortOrder: 1 }],
    items: [item, item2],
    movements: [
      {
        id: 'legacy-mov-1',
        itemId: 'item-1',
        warehouseId: 'wh-a',
        type: 'receipt',
        quantity: 100,
        date: '2025-01-01',
        createdAt: '2025-01-01T00:00:00.000Z',
        comment: 'legacy history',
      },
    ],
    documents: [],
    auditLog: [],
    nextInternalCode: 10,
    invoiceRegistry: [],
    ...overrides,
  }
}

const openingInput = {
  number: 'НВИ-1',
  date: '2026-09-02',
  warehouseId: 'wh-a',
  comment: 'Пересчёт',
  lines: [{ itemId: 'item-1', countedQty: 40 }],
}

describe('W0.5 warehouse accounting status', () => {
  it('legacy warehouse without accounting field is uninitialized', () => {
    const store = baseStore()
    expect(store.accountingByWarehouse).toBeUndefined()
    expect(getWarehouseAccountingStatus(store, 'wh-a')).toBe('uninitialized')
    expect(getWarehouseAccountingStatus(store, 'wh-b')).toBe('uninitialized')
  })

  it('blocks auto issue before activation as warehouse_not_initialized (not insufficient_stock)', () => {
    const store = baseStore()
    const before = structuredClone(store)
    const out = postWarehouseDocument(store, {
      type: 'issue',
      number: 'Р-auto',
      date: '2026-09-02',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', quantity: 1 }],
      skipValidation: true,
    })
    expect(out.result.ok).toBe(false)
    if (!out.result.ok) {
      expect(out.result.error).toBe(WAREHOUSE_NOT_INITIALIZED)
      expect(out.result.error).not.toBe(INSUFFICIENT_STOCK_ERROR)
    }
    expect(out.store.movements).toEqual(before.movements)
    expect(out.store.accountingByWarehouse).toEqual(before.accountingByWarehouse)
  })

  it('opening inventory draft does not change stock', () => {
    const store = baseStore()
    const balBefore = computeItemBalance('item-1', store.movements, 'wh-a').balance
    const draft = saveOpeningInventoryDraft(store, openingInput, {
      actorId: 'u1',
      actorName: 'User',
    })
    expect(draft.result.ok).toBe(true)
    expect(getWarehouseAccountingStatus(draft.store, 'wh-a')).toBe('reconciling')
    expect(computeItemBalance('item-1', draft.store.movements, 'wh-a').balance).toBe(balBefore)
    expect(draft.store.movements).toEqual(store.movements)
  })

  it('posting creates only delta movements and keeps legacy history', () => {
    const store = baseStore()
    const legacyIds = store.movements.map((m) => m.id)
    const out = postOpeningInventory(store, openingInput, {
      actorId: 'u1',
      actorName: 'User',
    })
    expect(out.result.ok).toBe(true)
    expect(getWarehouseAccountingStatus(out.store, 'wh-a')).toBe('active')
    // book=100, counted=40 → delta -60
    const invMov = out.store.movements.filter(
      (m) => m.type === 'inventory' && !legacyIds.includes(m.id),
    )
    expect(invMov).toHaveLength(1)
    expect(invMov[0]!.quantity).toBe(-60)
    expect(out.store.movements.some((m) => m.id === 'legacy-mov-1')).toBe(true)
    expect(computeItemBalance('item-1', out.store.movements, 'wh-a').balance).toBe(40)
  })

  it('successful posting activates only selected warehouse', () => {
    const out = postOpeningInventory(baseStore(), openingInput)
    expect(out.result.ok).toBe(true)
    expect(getWarehouseAccountingStatus(out.store, 'wh-a')).toBe('active')
    expect(getWarehouseAccountingStatus(out.store, 'wh-b')).toBe('uninitialized')
  })

  it('warehouses activate independently', () => {
    let store = postOpeningInventory(baseStore(), openingInput).store
    store = postOpeningInventory(store, {
      number: 'НВИ-B',
      date: '2026-09-02',
      warehouseId: 'wh-b',
      lines: [{ itemId: 'item-2', countedQty: 5 }],
    }).store
    expect(getWarehouseAccountingStatus(store, 'wh-a')).toBe('active')
    expect(getWarehouseAccountingStatus(store, 'wh-b')).toBe('active')
  })

  it('repeat posting is idempotent and does not duplicate movements', () => {
    const store = postOpeningInventory(baseStore(), openingInput).store
    const movCount = store.movements.length
    const docCount = store.documents.length
    const again = postOpeningInventory(store, openingInput)
    expect(again.result.ok).toBe(true)
    if (again.result.ok) expect(again.result.idempotent).toBe(true)
    expect(again.store.movements.length).toBe(movCount)
    expect(again.store.documents.length).toBe(docCount)
  })

  it('failed posting does not activate warehouse or add movements', () => {
    const store = baseStore()
    const before = structuredClone(store)
    const out = postOpeningInventory(store, {
      ...openingInput,
      lines: [],
    })
    expect(out.result.ok).toBe(false)
    expect(getWarehouseAccountingStatus(out.store, 'wh-a')).toBe('uninitialized')
    expect(out.store.movements).toEqual(before.movements)
    expect(out.store.accountingByWarehouse ?? []).toEqual(before.accountingByWarehouse ?? [])
  })

  it('posting is atomic: failed postExisting leaves store unchanged', () => {
    const store = baseStore()
    const before = structuredClone(store)
    const out = postOpeningInventory(store, {
      ...openingInput,
      documentId: 'missing-draft-id',
      lines: [{ itemId: 'item-1', countedQty: 40 }],
    })
    expect(out.result.ok).toBe(false)
    expect(out.store).toEqual(before)
    expect(getWarehouseAccountingStatus(out.store, 'wh-a')).toBe('uninitialized')
  })

  it('after activation W0 negative protection works', () => {
    const store = postOpeningInventory(baseStore(), {
      ...openingInput,
      lines: [{ itemId: 'item-1', countedQty: 5 }],
    }).store
    const blocked = postWarehouseDocument(store, {
      type: 'issue',
      number: 'Р-neg',
      date: '2026-09-03',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', quantity: 10 }],
      skipFieldValidation: true,
    })
    expect(blocked.result.ok).toBe(false)
    if (!blocked.result.ok) {
      expect(blocked.result.error).toBe(INSUFFICIENT_STOCK_ERROR)
    }
  })

  it('ordinary inventory correction after activation does not wipe history', () => {
    const store = postOpeningInventory(baseStore(), openingInput).store
    const historyIds = new Set(store.movements.map((m) => m.id))
    const corr = postWarehouseDocument(store, {
      type: 'inventory',
      number: 'ИНВ-2',
      date: '2026-09-04',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', quantity: 42, bookQty: 40 }],
      skipFieldValidation: true,
    })
    expect(corr.result.ok).toBe(true)
    for (const id of historyIds) {
      expect(corr.store.movements.some((m) => m.id === id)).toBe(true)
    }
    expect(getWarehouseAccountingStatus(corr.store, 'wh-a')).toBe('active')
    expect(computeItemBalance('item-1', corr.store.movements, 'wh-a').balance).toBe(42)
  })

  it('planner does not treat uninitialized stock as zero shortage', () => {
    const store = baseStore()
    const order = {
      id: 'ord-1',
      orderNumber: 'ЗП-1',
      productName: 'Prod',
      status: 'planned',
      totalQtyMp: 10,
      rawMaterialItemId: 'item-1',
      packagingPlan: { rawRollsEstimated: 150 },
    } as unknown as ProductionOrder
    const rows = materialAvailabilityForOrder(
      order,
      {
        items: store.items,
        movements: store.movements,
        accountingByWarehouse: store.accountingByWarehouse,
      },
      store.items,
      'wh-a',
    )
    expect(rows[0]?.stockTrust).toBe('unverified')
    expect(rows[0]?.available).toBeNull()
    expect(rows[0]?.shortage).toBe(0)
    expect(orderHasMaterialShortage(order, store, store.items)).toBe(false)

    const active = withActiveWarehouses(store, ['wh-a'])
    const verified = materialAvailabilityForOrder(
      order,
      {
        items: active.items,
        movements: active.movements,
        accountingByWarehouse: active.accountingByWarehouse,
      },
      active.items,
      'wh-a',
    )
    expect(verified[0]?.stockTrust).toBe('verified')
    expect(verified[0]?.available).toBe(100)
    expect(verified[0]?.shortage).toBeGreaterThan(0)
  })

  it('skipValidation cannot bypass uninitialized gate', () => {
    const out = postWarehouseDocument(baseStore(), {
      type: 'issue',
      number: 'Р-skip',
      date: '2026-09-02',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', quantity: 1 }],
      skipValidation: true,
      skipFieldValidation: true,
    })
    expect(out.result.ok).toBe(false)
    if (!out.result.ok) expect(out.result.error).toBe(WAREHOUSE_NOT_INITIALIZED)
  })

  it('regular inventory before activation is blocked', () => {
    const draft = saveWarehouseDocumentDraft(baseStore(), {
      type: 'inventory',
      number: 'ИНВ-X',
      date: '2026-09-02',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', quantity: 1, bookQty: 0 }],
    })
    expect(draft.result.ok).toBe(true)
    // posting via opening path is separate; ordinary inventory post:
    const posted = postWarehouseDocument(baseStore(), {
      type: 'inventory',
      number: 'ИНВ-Y',
      date: '2026-09-02',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', quantity: 1, bookQty: 0 }],
      skipFieldValidation: true,
    })
    expect(posted.result.ok).toBe(false)
    if (!posted.result.ok) expect(posted.result.error).toBe(WAREHOUSE_NOT_INITIALIZED)
  })
})
