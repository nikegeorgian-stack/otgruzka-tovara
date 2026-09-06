/**
 * R2.9E-C1B — warehouse identifier uniqueness (create / SKU / merge reconcile).
 */
import { describe, expect, it } from 'vitest'
import { mergeCloudStores } from '@/lib/cloud/cloudMerge'
import { createDefaultStore } from '@/lib/storage'
import type { AppStore } from '@/lib/types'
import {
  allocateInternalCode,
  nextInternalCodeNumber,
  upsertWarehouseItemInStore,
} from '@/lib/warehouse/itemHistory'
import {
  WarehouseItemIdentityError,
  allocateUniqueInternalCode,
  mergeNextInternalCodeCounter,
  reconcileWarehouseItemCodesAfterMerge,
} from '@/lib/warehouse/itemIdentity'
import type { WarehouseItem, WarehouseStore } from '@/lib/warehouse/types'

function emptyWh(partial: Partial<WarehouseStore> = {}): WarehouseStore {
  const base = createDefaultStore().warehouse
  return {
    ...base,
    locations: [{ id: 'loc1', name: 'Main', sortOrder: 0 }],
    categories: [{ id: 'cat1', name: 'Химия', sortOrder: 0 }],
    items: [],
    movements: [],
    documents: [],
    auditLog: [],
    nextInternalCode: 1,
    ...partial,
  }
}

function item(
  partial: Partial<WarehouseItem> & Pick<WarehouseItem, 'id' | 'name'>,
): WarehouseItem {
  return {
    internalCode: '',
    categoryId: 'cat1',
    warehouseId: 'loc1',
    unit: 'кг',
    active: true,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  }
}

function miniStore(warehouse: WarehouseStore): AppStore {
  return { ...createDefaultStore(), warehouse }
}

describe('R2.9E-C1B warehouse identifier uniqueness', () => {
  it('A: blank create allocates the next free FC code', () => {
    const wh = emptyWh({
      items: [item({ id: 'a', name: 'A', internalCode: 'FC-000003' })],
      nextInternalCode: 2,
    })
    const next = upsertWarehouseItemInStore(wh, item({ id: 'b', name: 'B', internalCode: '' }))
    const created = next.items.find((i) => i.id === 'b')!
    expect(created.internalCode).toBe('FC-000004')
    expect(next.nextInternalCode).toBe(5)
  })

  it('B: stale counter cannot reuse an existing code', () => {
    const wh = emptyWh({
      items: [item({ id: 'a', name: 'A', internalCode: 'FC-000010' })],
      nextInternalCode: 3,
    })
    expect(nextInternalCodeNumber(wh)).toBeGreaterThanOrEqual(11)
    const next = upsertWarehouseItemInStore(wh, item({ id: 'b', name: 'B' }))
    expect(next.items.find((i) => i.id === 'b')!.internalCode).toBe('FC-000011')
    expect(next.items.filter((i) => i.internalCode === 'FC-000010')).toHaveLength(1)
  })

  it('C: explicit unused FC code is preserved and advances the counter', () => {
    const wh = emptyWh({ nextInternalCode: 2 })
    const next = upsertWarehouseItemInStore(
      wh,
      item({ id: 'x', name: 'X', internalCode: 'FC-000020' }),
    )
    expect(next.items.find((i) => i.id === 'x')!.internalCode).toBe('FC-000020')
    expect(next.nextInternalCode).toBeGreaterThanOrEqual(21)
  })

  it('D: explicit duplicate internalCode is rejected with zero mutation', () => {
    const wh = emptyWh({
      items: [item({ id: 'a', name: 'A', internalCode: 'FC-000005' })],
      nextInternalCode: 6,
    })
    const before = structuredClone(wh)
    expect(() =>
      upsertWarehouseItemInStore(
        wh,
        item({ id: 'b', name: 'B', internalCode: 'FC-000005' }),
      ),
    ).toThrow(WarehouseItemIdentityError)
    try {
      upsertWarehouseItemInStore(wh, item({ id: 'b', name: 'B', internalCode: 'FC-000005' }))
    } catch (e) {
      expect(e).toBeInstanceOf(WarehouseItemIdentityError)
      expect((e as WarehouseItemIdentityError).code).toBe('warehouse.err.duplicateInternalCode')
    }
    expect(wh).toEqual(before)
    expect(wh.items).toHaveLength(1)
  })

  it('E: internalCode remains immutable on update', () => {
    const wh = emptyWh({
      items: [item({ id: 'a', name: 'A', internalCode: 'FC-000001' })],
      nextInternalCode: 2,
    })
    const next = upsertWarehouseItemInStore(
      wh,
      item({ id: 'a', name: 'A renamed', internalCode: 'FC-000099' }),
    )
    expect(next.items.find((i) => i.id === 'a')!.internalCode).toBe('FC-000001')
    expect(next.items.find((i) => i.id === 'a')!.name).toBe('A renamed')
  })

  it('F: unrelated update on a legacy duplicate item remains possible', () => {
    const wh = emptyWh({
      items: [
        item({ id: 'a', name: 'A', internalCode: 'FC-000003', sku: 'S1' }),
        item({ id: 'b', name: 'B', internalCode: 'FC-000003', sku: 'S2' }),
      ],
      nextInternalCode: 4,
    })
    const next = upsertWarehouseItemInStore(
      wh,
      item({ id: 'b', name: 'B updated', internalCode: 'FC-000003', sku: 'S2', note: 'ok' }),
    )
    expect(next.items.find((i) => i.id === 'b')!.name).toBe('B updated')
    expect(next.items.find((i) => i.id === 'b')!.note).toBe('ok')
    expect(next.items.filter((i) => i.internalCode === 'FC-000003')).toHaveLength(2)
  })

  it('G: blank SKUs may repeat', () => {
    const wh = emptyWh({
      items: [item({ id: 'a', name: 'A', internalCode: 'FC-000001', sku: '' })],
      nextInternalCode: 2,
    })
    const next = upsertWarehouseItemInStore(
      wh,
      item({ id: 'b', name: 'B', internalCode: '', sku: '  ' }),
    )
    expect(next.items).toHaveLength(2)
  })

  it('H: duplicate non-empty SKU on create is rejected', () => {
    const wh = emptyWh({
      items: [item({ id: 'a', name: 'A', internalCode: 'FC-000001', sku: 'EDU-A' })],
      nextInternalCode: 2,
    })
    expect(() =>
      upsertWarehouseItemInStore(
        wh,
        item({ id: 'b', name: 'B', internalCode: '', sku: 'edu-a' }),
      ),
    ).toThrow(WarehouseItemIdentityError)
  })

  it('I: changing SKU to another item’s SKU is rejected', () => {
    const wh = emptyWh({
      items: [
        item({ id: 'a', name: 'A', internalCode: 'FC-000001', sku: 'AAA' }),
        item({ id: 'b', name: 'B', internalCode: 'FC-000002', sku: 'BBB' }),
      ],
      nextInternalCode: 3,
    })
    expect(() =>
      upsertWarehouseItemInStore(
        wh,
        item({ id: 'b', name: 'B', internalCode: 'FC-000002', sku: 'aaa' }),
      ),
    ).toThrow(WarehouseItemIdentityError)
  })

  it('J: changing a legacy duplicate SKU to a unique value succeeds', () => {
    const wh = emptyWh({
      items: [
        item({ id: 'a', name: 'A', internalCode: 'FC-000001', sku: 'DUP' }),
        item({ id: 'b', name: 'B', internalCode: 'FC-000002', sku: 'DUP' }),
      ],
      nextInternalCode: 3,
    })
    const next = upsertWarehouseItemInStore(
      wh,
      item({ id: 'b', name: 'B', internalCode: 'FC-000002', sku: 'UNIQUE-B' }),
    )
    expect(next.items.find((i) => i.id === 'b')!.sku).toBe('UNIQUE-B')
    expect(next.items.find((i) => i.id === 'a')!.sku).toBe('DUP')
  })

  it('K: concurrent local/remote same-code creates preserve both IDs and unique codes', () => {
    const baseWh = emptyWh({ items: [], nextInternalCode: 10 })
    const localWh = emptyWh({
      items: [item({ id: 'item-L', name: 'Local', internalCode: 'FC-000010' })],
      nextInternalCode: 11,
    })
    const remoteWh = emptyWh({
      items: [item({ id: 'item-R', name: 'Remote', internalCode: 'FC-000010' })],
      nextInternalCode: 11,
    })
    const { store } = mergeCloudStores(
      miniStore(baseWh),
      miniStore(remoteWh),
      miniStore(localWh),
    )
    const items = store.warehouse.items
    expect(items.map((i) => i.id).sort()).toEqual(['item-L', 'item-R'])
    const remote = items.find((i) => i.id === 'item-R')!
    const local = items.find((i) => i.id === 'item-L')!
    expect(remote.internalCode).toBe('FC-000010')
    expect(local.internalCode).not.toBe('FC-000010')
    expect(local.internalCode).toMatch(/^FC-\d{6}$/)
    expect(new Set(items.map((i) => i.internalCode)).size).toBe(2)
    expect(store.warehouse.nextInternalCode).toBeGreaterThan(
      Math.max(
        ...items.map((i) => Number(i.internalCode.replace(/\D/g, ''))),
      ),
    )
  })

  it('L: multiple concurrent collisions resolve deterministically', () => {
    const baseWh = emptyWh({ items: [], nextInternalCode: 5 })
    const remoteWh = emptyWh({
      items: [
        item({ id: 'r1', name: 'R1', internalCode: 'FC-000005' }),
        item({ id: 'r2', name: 'R2', internalCode: 'FC-000006' }),
      ],
      nextInternalCode: 7,
    })
    const localWh = emptyWh({
      items: [
        item({ id: 'z-local', name: 'ZL', internalCode: 'FC-000005' }),
        item({ id: 'a-local', name: 'AL', internalCode: 'FC-000006' }),
      ],
      nextInternalCode: 7,
    })
    const first = mergeCloudStores(miniStore(baseWh), miniStore(remoteWh), miniStore(localWh))
    const second = mergeCloudStores(miniStore(baseWh), miniStore(remoteWh), miniStore(localWh))
    const codes1 = Object.fromEntries(
      first.store.warehouse.items.map((i) => [i.id, i.internalCode]),
    )
    const codes2 = Object.fromEntries(
      second.store.warehouse.items.map((i) => [i.id, i.internalCode]),
    )
    expect(codes1).toEqual(codes2)
    expect(codes1['r1']).toBe('FC-000005')
    expect(codes1['r2']).toBe('FC-000006')
    expect(codes1['z-local']).not.toBe('FC-000005')
    expect(codes1['a-local']).not.toBe('FC-000006')
  })

  it('M: remote acknowledged item keeps its code', () => {
    const baseWh = emptyWh({ items: [], nextInternalCode: 1 })
    const remoteWh = emptyWh({
      items: [item({ id: 'remote-acked', name: 'R', internalCode: 'FC-000010' })],
      nextInternalCode: 11,
    })
    const localWh = emptyWh({
      items: [item({ id: 'local-new', name: 'L', internalCode: 'FC-000010' })],
      nextInternalCode: 11,
    })
    const { store } = mergeCloudStores(
      miniStore(baseWh),
      miniStore(remoteWh),
      miniStore(localWh),
    )
    expect(store.warehouse.items.find((i) => i.id === 'remote-acked')!.internalCode).toBe(
      'FC-000010',
    )
  })

  it('N: existing baseline items are never renumbered', () => {
    const baseWh = emptyWh({
      items: [item({ id: 'base1', name: 'Base', internalCode: 'FC-000003' })],
      nextInternalCode: 4,
    })
    const remoteWh = emptyWh({
      items: [
        item({ id: 'base1', name: 'Base', internalCode: 'FC-000003' }),
        item({ id: 'remote-new', name: 'R', internalCode: 'FC-000004' }),
      ],
      nextInternalCode: 5,
    })
    const localWh = emptyWh({
      items: [
        item({ id: 'base1', name: 'Base', internalCode: 'FC-000003' }),
        item({ id: 'local-new', name: 'L', internalCode: 'FC-000004' }),
      ],
      nextInternalCode: 5,
    })
    const { store } = mergeCloudStores(
      miniStore(baseWh),
      miniStore(remoteWh),
      miniStore(localWh),
    )
    expect(store.warehouse.items.find((i) => i.id === 'base1')!.internalCode).toBe('FC-000003')
  })

  it('O: nextInternalCode is greater than every used FC number', () => {
    const wh = emptyWh({
      items: [
        item({ id: 'a', name: 'A', internalCode: 'FC-000002' }),
        item({ id: 'b', name: 'B', internalCode: 'FC-000009' }),
      ],
      nextInternalCode: 3,
    })
    const next = upsertWarehouseItemInStore(wh, item({ id: 'c', name: 'C' }))
    const maxUsed = Math.max(
      ...next.items.map((i) => Number(i.internalCode.replace(/\D/g, ''))),
    )
    expect(next.nextInternalCode!).toBeGreaterThan(maxUsed)
  })

  it('P: repeated merge/retry is idempotent', () => {
    const baseWh = emptyWh({ items: [], nextInternalCode: 10 })
    const remoteWh = emptyWh({
      items: [item({ id: 'item-R', name: 'R', internalCode: 'FC-000010' })],
      nextInternalCode: 11,
    })
    const localWh = emptyWh({
      items: [item({ id: 'item-L', name: 'L', internalCode: 'FC-000010' })],
      nextInternalCode: 11,
    })
    const m1 = mergeCloudStores(miniStore(baseWh), miniStore(remoteWh), miniStore(localWh))
    const m2 = mergeCloudStores(miniStore(baseWh), miniStore(remoteWh), miniStore(localWh))
    const snap = (s: AppStore) =>
      Object.fromEntries(
        s.warehouse.items
          .map((i) => [i.id, i.internalCode] as const)
          .sort((a, b) => a[0].localeCompare(b[0])),
      )
    expect(snap(m1.store)).toEqual(snap(m2.store))
    expect(m1.store.warehouse.nextInternalCode).toBe(m2.store.warehouse.nextInternalCode)
  })

  it('Q: item-ID recipe/PO/document references remain unchanged', () => {
    const baseWh = emptyWh({ items: [], nextInternalCode: 10 })
    const localItem = item({ id: 'item-L', name: 'L', internalCode: 'FC-000010' })
    const remoteItem = item({ id: 'item-R', name: 'R', internalCode: 'FC-000010' })
    const localStore = miniStore(
      emptyWh({ items: [localItem], nextInternalCode: 11, documents: [] }),
    )
    localStore.formulations = {
      recipes: [
        {
          id: 'rec1',
          code: 'RP',
          name: 'R',
          components: [{ itemId: 'item-L', qty: 1 }],
          outputWarehouseItemId: 'item-L',
        },
      ],
      recipeVersions: [],
      pigmentPastes: [],
      batchRuns: [],
      mixTasks: [],
    } as AppStore['formulations']
    localStore.procurement = {
      orders: [
        {
          id: 'po1',
          lines: [{ id: 'ln1', warehouseItemId: 'item-L', name: 'L', quantity: 1, receivedQty: 0 }],
        },
      ],
    } as AppStore['procurement']

    const { store } = mergeCloudStores(
      miniStore(baseWh),
      miniStore(emptyWh({ items: [remoteItem], nextInternalCode: 11 })),
      localStore,
    )
    expect(store.formulations?.recipes?.[0]?.components?.[0]?.itemId).toBe('item-L')
    expect(store.formulations?.recipes?.[0]?.outputWarehouseItemId).toBe('item-L')
    expect(store.procurement?.orders?.[0]?.lines?.[0]?.warehouseItemId).toBe('item-L')
    expect(store.warehouse.items.find((i) => i.id === 'item-L')).toBeTruthy()
  })

  it('S: existing historical duplicates are not silently migrated by runtime merge', () => {
    const baseWh = emptyWh({
      items: [
        item({ id: 'h1', name: 'H1', internalCode: 'FC-000003' }),
        item({ id: 'h2', name: 'H2', internalCode: 'FC-000003' }),
      ],
      nextInternalCode: 4,
    })
    const { store } = mergeCloudStores(
      miniStore(baseWh),
      miniStore(baseWh),
      miniStore(baseWh),
    )
    const dups = store.warehouse.items.filter((i) => i.internalCode === 'FC-000003')
    expect(dups.map((i) => i.id).sort()).toEqual(['h1', 'h2'])
  })

  it('LWW stale nextInternalCode is raised to max used + 1', () => {
    expect(mergeNextInternalCodeCounter(5, 3, 4, [
      item({ id: 'a', name: 'A', internalCode: 'FC-000010' }),
    ])).toBe(11)
  })

  it('allocateInternalCode skips used codes when counter is stale', () => {
    const wh = emptyWh({
      items: [item({ id: 'a', name: 'A', internalCode: 'FC-000005' })],
      nextInternalCode: 5,
    })
    expect(allocateInternalCode(wh)).toBe('FC-000006')
    expect(allocateUniqueInternalCode(wh).code).toBe('FC-000006')
  })

  it('invalid explicit internalCode format is rejected', () => {
    const wh = emptyWh()
    expect(() =>
      upsertWarehouseItemInStore(wh, item({ id: 'x', name: 'X', internalCode: 'BAD' })),
    ).toThrow(WarehouseItemIdentityError)
  })

  it('reconcile helper: remote keeps code, local sorted by id', () => {
    const result = reconcileWarehouseItemCodesAfterMerge({
      baseItems: [],
      remoteItems: [item({ id: 'item-R', name: 'R', internalCode: 'FC-000010' })],
      localItems: [item({ id: 'item-L', name: 'L', internalCode: 'FC-000010' })],
      mergedItems: [
        item({ id: 'item-L', name: 'L', internalCode: 'FC-000010' }),
        item({ id: 'item-R', name: 'R', internalCode: 'FC-000010' }),
      ],
      nextInternalCode: 11,
    })
    expect(result.items.find((i) => i.id === 'item-R')!.internalCode).toBe('FC-000010')
    expect(result.items.find((i) => i.id === 'item-L')!.internalCode).toBe('FC-000011')
    expect(result.nextInternalCode).toBe(12)
  })
})
