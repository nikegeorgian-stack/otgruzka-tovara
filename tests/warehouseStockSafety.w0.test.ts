import { describe, expect, it } from 'vitest'
import { confirmBatchMix } from '@/lib/formulations/batch'
import type { FormulationStore } from '@/lib/formulations/types'
import { withActiveWarehouses } from '@/lib/warehouse/accountingStatus'
import {
  cancelWarehouseDocument,
  postExistingWarehouseDocument,
  postWarehouseDocument,
  postWarehouseDocumentsAtomic,
  postWarehouseTransfer,
  saveWarehouseDocumentDraft,
} from '@/lib/warehouse/documents'
import { INSUFFICIENT_STOCK_ERROR } from '@/lib/warehouse/stockSafety'
import type { StockMovement, WarehouseItem, WarehouseStore } from '@/lib/warehouse/types'

function emptyWarehouse(overrides?: Partial<WarehouseStore>): WarehouseStore {
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
  }
  const base: WarehouseStore = {
    locations: [loc, locB],
    categories: [{ id: 'cat-1', name: 'Сырьё', sortOrder: 1 }],
    items: [item, item2],
    movements: [],
    documents: [],
    auditLog: [],
    nextInternalCode: 10,
    invoiceRegistry: [],
    ...overrides,
  }
  // W0 stock-safety tests assume verified ledger (W0.5 active).
  return withActiveWarehouses(base, [loc.id, locB.id])
}

function receipt(
  store: WarehouseStore,
  qty: number,
  itemId = 'item-1',
  warehouseId = 'wh-a',
): WarehouseStore {
  const out = postWarehouseDocument(store, {
    type: 'receipt',
    number: `П-${store.documents.length + 1}`,
    date: '2026-09-01',
    warehouseId,
    lines: [{ itemId, quantity: qty }],
    skipFieldValidation: true,
  })
  expect(out.result.ok).toBe(true)
  return out.store
}

describe('W0 stock safety', () => {
  it('blocks ordinary issue when stock is insufficient and leaves ledger unchanged', () => {
    const base = receipt(emptyWarehouse(), 5)
    const before = structuredClone(base)
    const out = postWarehouseDocument(base, {
      type: 'issue',
      number: 'Р-1',
      date: '2026-09-02',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', quantity: 10 }],
      skipFieldValidation: true,
    })
    expect(out.result.ok).toBe(false)
    if (out.result.ok) return
    expect(out.result.error).toBe(INSUFFICIENT_STOCK_ERROR)
    expect(out.result.shortages?.[0]?.shortage).toBeGreaterThan(0)
    expect(out.store).toEqual(before)
  })

  it('does not let skipValidation bypass stock check', () => {
    const base = receipt(emptyWarehouse(), 1)
    const out = postWarehouseDocument(base, {
      type: 'issue',
      number: 'Р-2',
      date: '2026-09-02',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', quantity: 5 }],
      skipValidation: true,
    })
    expect(out.result.ok).toBe(false)
    if (!out.result.ok) expect(out.result.error).toBe(INSUFFICIENT_STOCK_ERROR)
  })

  it('aggregates duplicate lines before stock check', () => {
    const base = receipt(emptyWarehouse(), 10)
    const out = postWarehouseDocument(base, {
      type: 'issue',
      number: 'Р-3',
      date: '2026-09-02',
      warehouseId: 'wh-a',
      lines: [
        { itemId: 'item-1', quantity: 6 },
        { itemId: 'item-1', quantity: 6 },
      ],
      skipFieldValidation: true,
    })
    expect(out.result.ok).toBe(false)
    if (!out.result.ok) {
      expect(out.result.shortages?.[0]?.required).toBe(12)
    }
  })

  it('cannot use foreign reservation for issue', () => {
    let store = receipt(emptyWarehouse(), 10)
    const reserve: StockMovement = {
      id: 'res-foreign',
      itemId: 'item-1',
      warehouseId: 'wh-a',
      type: 'reserve',
      quantity: 8,
      date: '2026-09-01',
      productionOrderId: 'order-other',
      createdAt: new Date().toISOString(),
    }
    store = { ...store, movements: [...store.movements, reserve] }
    // available = 10-8 = 2; own reserved for order-A = 0
    const out = postWarehouseDocument(store, {
      type: 'issue',
      number: 'Р-4',
      date: '2026-09-02',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', quantity: 5 }],
      reservationSource: { productionOrderIds: ['order-A'] },
      skipFieldValidation: true,
    })
    expect(out.result.ok).toBe(false)
  })

  it('can consume own reservation and releases it after issue', () => {
    let store = receipt(emptyWarehouse(), 10)
    const reserve: StockMovement = {
      id: 'res-own',
      itemId: 'item-1',
      warehouseId: 'wh-a',
      type: 'reserve',
      quantity: 8,
      date: '2026-09-01',
      productionOrderId: 'order-A',
      createdAt: new Date().toISOString(),
    }
    store = { ...store, movements: [...store.movements, reserve] }
    // available=2, ownReserved=8, effective=10
    const out = postWarehouseDocument(store, {
      type: 'issue',
      number: 'Р-5',
      date: '2026-09-02',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', quantity: 9 }],
      productionOrderId: 'order-A',
      reservationSource: { productionOrderIds: ['order-A'] },
      skipFieldValidation: true,
    })
    expect(out.result.ok).toBe(true)
    const unreserves = out.store.movements.filter(
      (m) => m.type === 'unreserve' && m.productionOrderId === 'order-A',
    )
    expect(unreserves.length).toBe(1)
    expect(unreserves[0]!.quantity).toBe(8)
  })

  it('blocks issue when ledger balance is already negative', () => {
    const store = emptyWarehouse({
      movements: [
        {
          id: 'neg',
          itemId: 'item-1',
          warehouseId: 'wh-a',
          type: 'issue',
          quantity: 3,
          date: '2026-08-01',
          createdAt: new Date().toISOString(),
        },
      ],
    })
    const out = postWarehouseDocument(store, {
      type: 'issue',
      number: 'Р-6',
      date: '2026-09-02',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', quantity: 1 }],
      skipFieldValidation: true,
    })
    expect(out.result.ok).toBe(false)
  })

  it('allows receipt when balance is already negative', () => {
    const store = emptyWarehouse({
      movements: [
        {
          id: 'neg',
          itemId: 'item-1',
          warehouseId: 'wh-a',
          type: 'issue',
          quantity: 3,
          date: '2026-08-01',
          createdAt: new Date().toISOString(),
        },
      ],
    })
    const out = postWarehouseDocument(store, {
      type: 'receipt',
      number: 'П-heal',
      date: '2026-09-02',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', quantity: 5 }],
      skipFieldValidation: true,
    })
    expect(out.result.ok).toBe(true)
  })

  it('blocks cancel of receipt when reversal issue would go negative', () => {
    let store = receipt(emptyWarehouse(), 10)
    store = postWarehouseDocument(store, {
      type: 'issue',
      number: 'Р-spend',
      date: '2026-09-02',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', quantity: 10 }],
      skipFieldValidation: true,
    }).store
    const receiptDoc = store.documents.find((d) => d.type === 'receipt')!
    const before = structuredClone(store)
    const cancel = cancelWarehouseDocument(store, receiptDoc.id, {})
    expect(cancel.result.ok).toBe(false)
    expect(cancel.store.documents).toEqual(before.documents)
    expect(cancel.store.movements).toEqual(before.movements)
  })

  it('transfer creates both sides or neither', () => {
    const base = receipt(emptyWarehouse(), 2)
    const beforeDocs = base.documents.length
    const beforeMov = base.movements.length
    const out = postWarehouseTransfer(base, {
      number: 'ПЕР-1',
      date: '2026-09-02',
      warehouseId: 'wh-a',
      targetWarehouseId: 'wh-b',
      lines: [{ itemId: 'item-1', quantity: 99 }],
      purpose: 'transfer',
    })
    expect(out.result.ok).toBe(false)
    expect(out.store.documents.length).toBe(beforeDocs)
    expect(out.store.movements.length).toBe(beforeMov)
  })

  it('atomic multi-doc posts all or nothing', () => {
    const base = receipt(emptyWarehouse(), 5)
    const before = structuredClone(base)
    const out = postWarehouseDocumentsAtomic(base, [
      {
        type: 'issue',
        number: 'A-1',
        date: '2026-09-02',
        warehouseId: 'wh-a',
        lines: [{ itemId: 'item-1', quantity: 3 }],
        skipFieldValidation: true,
      },
      {
        type: 'issue',
        number: 'A-2',
        date: '2026-09-02',
        warehouseId: 'wh-a',
        lines: [{ itemId: 'item-1', quantity: 10 }],
        skipFieldValidation: true,
      },
    ])
    expect(out.result.ok).toBe(false)
    expect(out.store).toEqual(before)
  })

  it('idempotent replay returns same document without duplicate movements', () => {
    let store = receipt(emptyWarehouse(), 20)
    const key = 'dailyIssue::s1::issue::wh-a'
    const first = postWarehouseDocument(store, {
      type: 'issue',
      number: 'ДИ-1',
      date: '2026-09-02',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', quantity: 2 }],
      skipFieldValidation: true,
      idempotencyKey: key,
    })
    expect(first.result.ok).toBe(true)
    store = first.store
    const movCount = store.movements.length
    const second = postWarehouseDocument(store, {
      type: 'issue',
      number: 'ДИ-1',
      date: '2026-09-02',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', quantity: 2 }],
      skipFieldValidation: true,
      idempotencyKey: key,
    })
    expect(second.result.ok).toBe(true)
    if (second.result.ok) {
      expect(second.result.idempotent).toBe(true)
      expect(second.result.documentId).toBe(
        first.result.ok ? first.result.documentId : '',
      )
    }
    expect(second.store.movements.length).toBe(movCount)
  })

  it('same idempotency key with different payload conflicts', () => {
    let store = receipt(emptyWarehouse(), 20)
    const key = 'prod::req1::production_issue::wh-a'
    store = postWarehouseDocument(store, {
      type: 'issue',
      number: 'И-1',
      date: '2026-09-02',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', quantity: 2 }],
      skipFieldValidation: true,
      idempotencyKey: key,
    }).store
    const conflict = postWarehouseDocument(store, {
      type: 'issue',
      number: 'И-2',
      date: '2026-09-02',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', quantity: 3 }],
      skipFieldValidation: true,
      idempotencyKey: key,
    })
    expect(conflict.result.ok).toBe(false)
    if (!conflict.result.ok) {
      expect(conflict.result.error).toBe('warehouse.doc.errIdempotencyConflict')
    }
  })

  it('reads existing documents without optional W0 fields', () => {
    const store = emptyWarehouse({
      documents: [
        {
          id: 'legacy-1',
          type: 'receipt',
          number: 'LEG-1',
          date: '2026-01-01',
          warehouseId: 'wh-a',
          lines: [{ itemId: 'item-1', quantity: 1 }],
          createdAt: '2026-01-01T00:00:00.000Z',
          status: 'posted',
        },
      ],
    })
    expect(store.documents[0]?.idempotencyKey).toBeUndefined()
    const draft = saveWarehouseDocumentDraft(store, {
      type: 'issue',
      number: 'D-1',
      date: '2026-09-02',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', quantity: 1 }],
    })
    expect(draft.result.ok).toBe(true)
  })

  it('postExisting applies stock safety after removing prior movements', () => {
    let store = receipt(emptyWarehouse(), 5)
    const draft = saveWarehouseDocumentDraft(store, {
      type: 'issue',
      number: 'Ч-1',
      date: '2026-09-02',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', quantity: 2 }],
    })
    store = draft.store
    const id = draft.result.ok ? draft.result.documentId : ''
    const posted = postExistingWarehouseDocument(store, id)
    expect(posted.result.ok).toBe(true)
    store = posted.store
    // reopen as draft via unpost not used — try over-issue via new draft
    const over = saveWarehouseDocumentDraft(store, {
      type: 'issue',
      number: 'Ч-2',
      date: '2026-09-02',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', quantity: 10 }],
    })
    const overPost = postExistingWarehouseDocument(over.store, over.result.ok ? over.result.documentId : '')
    expect(overPost.result.ok).toBe(false)
  })
})

describe('W0 batch atomic confirm', () => {
  it('does not confirm batch or change warehouse when issue would fail', () => {
    const runId = 'run-pending-1'
    const formulations: FormulationStore = {
      recipes: [],
      nextInternalCode: 1,
      batchRuns: [
        {
          id: runId,
          documentNumber: 'ЗМ-20260902-001',
          status: 'pending',
          recipeId: 'rec-1',
          recipeCode: 'R1',
          recipeName: 'Test',
          targetVolumeL: 50,
          scaleFactor: 1,
          lines: [
            {
              componentId: 'c1',
              warehouseItemId: 'item-1',
              name: 'Сырьё 1',
              consumeKg: 40,
            },
          ],
          outputWarehouseItemId: 'item-2',
          outputKg: 40,
          warehouseId: 'wh-a',
          mixedAt: '2026-09-02',
          mixedBy: 'u1',
          mixedByName: 'User',
        },
      ],
    }
    const warehouse = emptyWarehouse()
    const beforeWh = structuredClone(warehouse)
    const confirm = confirmBatchMix(
      formulations,
      warehouse,
      { runId, keeperId: 'k1', keeperName: 'Keeper' },
      { allowNegativeStock: true },
    )
    expect(confirm.result.ok).toBe(false)
    expect(confirm.warehouse.movements).toEqual(beforeWh.movements)
    expect(confirm.warehouse.documents).toEqual(beforeWh.documents)
    expect(confirm.formulations.batchRuns?.[0]?.status).toBe('pending')
  })
})
