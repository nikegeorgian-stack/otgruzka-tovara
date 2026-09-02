import { describe, expect, it } from 'vitest'
import { withActiveWarehouses } from '@/lib/warehouse/accountingStatus'
import {
  applyImportPendingAsDraftReceipts,
} from '@/lib/warehouse/importExport'
import { createInventoryAdjustmentDraft } from '@/lib/warehouse/inventoryAdjustmentDraft'
import {
  filterWarehouseDocuments,
  queryDocumentJournal,
} from '@/lib/warehouse/documentJournalQuery'
import {
  cancelWarehouseDocument,
  postExistingWarehouseDocument,
  postWarehouseDocument,
  postWarehouseTransfer,
  saveWarehouseDocumentDraft,
} from '@/lib/warehouse/documents'
import { buildReceiptPrintModelFromDocument } from '@/lib/warehouse/printDocument'
import { computeItemBalance } from '@/lib/warehouse/stock'
import { INSUFFICIENT_STOCK_ERROR } from '@/lib/warehouse/stockSafety'
import type { WarehouseItem, WarehouseStore } from '@/lib/warehouse/types'
import {
  classifyAtomicGroupAgainstRemote,
  stampOpsWithTransactionGroup,
  warehouseTransactionGroupId,
} from '@/lib/cloud/transactionGroups'
import type { DirtyOperation } from '@/lib/cloud/dirtyOperations'
import type { AppStore } from '@/lib/types'

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
    price: 10,
  }
  const base: WarehouseStore = {
    locations: [loc, locB],
    categories: [{ id: 'cat-1', name: 'Сырьё', sortOrder: 1 }],
    items: [item],
    movements: [],
    documents: [],
    auditLog: [],
    nextInternalCode: 10,
    invoiceRegistry: [],
    ...overrides,
  }
  return withActiveWarehouses(base, [loc.id, locB.id])
}

describe('W2 warehouse documents journal / card / print / import', () => {
  it('draft edits without changing stock; revision increments', () => {
    let store = emptyWarehouse()
    const d1 = saveWarehouseDocumentDraft(store, {
      type: 'receipt',
      number: 'П-W2-1',
      date: '2026-09-01',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', quantity: 5 }],
    })
    expect(d1.result.ok).toBe(true)
    if (!d1.result.ok) return
    store = d1.store
    expect(computeItemBalance('item-1', store.movements, 'wh-a').balance).toBe(0)
    const id = d1.result.documentId
    const rev1 = store.documents.find((d) => d.id === id)!.revision ?? 0

    const d2 = saveWarehouseDocumentDraft(store, {
      id,
      type: 'receipt',
      number: 'П-W2-1',
      date: '2026-09-01',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', quantity: 7 }],
    })
    expect(d2.result.ok).toBe(true)
    store = d2.store
    expect(computeItemBalance('item-1', store.movements, 'wh-a').balance).toBe(0)
    expect(store.documents.find((d) => d.id === id)!.revision).toBe(rev1 + 1)
  })

  it('posted and cancelled are immutable; post creates movements once', () => {
    let store = emptyWarehouse()
    const draft = saveWarehouseDocumentDraft(store, {
      type: 'receipt',
      number: 'П-W2-2',
      date: '2026-09-01',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', quantity: 4 }],
    })
    store = draft.store
    const id = draft.result.ok ? draft.result.documentId : ''
    const posted = postExistingWarehouseDocument(store, id, { actorId: 'u1' })
    expect(posted.result.ok).toBe(true)
    store = posted.store
    expect(computeItemBalance('item-1', store.movements, 'wh-a').balance).toBe(4)
    const movOnce = store.movements.filter((m) => m.documentId === id).length

    expect(postExistingWarehouseDocument(store, id).result.ok).toBe(false)
    expect(
      saveWarehouseDocumentDraft(store, {
        id,
        type: 'receipt',
        number: 'П-W2-2',
        date: '2026-09-01',
        warehouseId: 'wh-a',
        lines: [{ itemId: 'item-1', quantity: 99 }],
      }).result.ok,
    ).toBe(false)
    expect(store.movements.filter((m) => m.documentId === id).length).toBe(movOnce)

    const cancel = cancelWarehouseDocument(store, id, { reason: 'fix' })
    expect(cancel.result.ok).toBe(true)
    store = cancel.store
    const cancelledId = id
    expect(
      saveWarehouseDocumentDraft(store, {
        id: cancelledId,
        type: 'receipt',
        number: 'П-W2-2',
        date: '2026-09-01',
        warehouseId: 'wh-a',
        lines: [{ itemId: 'item-1', quantity: 1 }],
      }).result.ok,
    ).toBe(false)
  })

  it('issue stock shortage leaves no partial changes; transfer is atomic', () => {
    let store = emptyWarehouse()
    store = postWarehouseDocument(store, {
      type: 'receipt',
      number: 'П-W2-3',
      date: '2026-09-01',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', quantity: 2 }],
      skipFieldValidation: true,
    }).store
    const before = structuredClone(store)
    const bad = postWarehouseDocument(store, {
      type: 'issue',
      number: 'Р-W2-3',
      date: '2026-09-02',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', quantity: 9 }],
      skipFieldValidation: true,
    })
    expect(bad.result.ok).toBe(false)
    if (!bad.result.ok) expect(bad.result.error).toBe(INSUFFICIENT_STOCK_ERROR)
    expect(bad.store.documents).toEqual(before.documents)
    expect(bad.store.movements).toEqual(before.movements)

    const xferBad = postWarehouseTransfer(store, {
      number: 'ПЕР-W2',
      date: '2026-09-02',
      warehouseId: 'wh-a',
      targetWarehouseId: 'wh-b',
      lines: [{ itemId: 'item-1', quantity: 99 }],
      purpose: 'transfer',
    })
    expect(xferBad.result.ok).toBe(false)
    expect(xferBad.store.documents.length).toBe(store.documents.length)
  })

  it('storno requires reason, creates reversal + reverse movements with links', () => {
    let store = emptyWarehouse()
    store = postWarehouseDocument(store, {
      type: 'receipt',
      number: 'П-W2-4',
      date: '2026-09-01',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', quantity: 6 }],
      skipFieldValidation: true,
    }).store
    const orig = store.documents[0]!
    expect(cancelWarehouseDocument(store, orig.id, {}).result.ok).toBe(false)

    const cancel = cancelWarehouseDocument(store, orig.id, { reason: 'ошибка' })
    expect(cancel.result.ok).toBe(true)
    store = cancel.store
    const cancelled = store.documents.find((d) => d.id === orig.id)!
    const reversal = store.documents.find((d) => d.id === cancelled.reversalDocumentId)!
    expect(cancelled.status).toBe('cancelled')
    expect(reversal.reversesDocumentId).toBe(orig.id)
    expect(store.movements.some((m) => m.documentId === reversal.id && m.type === 'issue')).toBe(
      true,
    )
  })

  it('inventory draft does not change balance until post', () => {
    let store = emptyWarehouse()
    store = postWarehouseDocument(store, {
      type: 'receipt',
      number: 'П-W2-5',
      date: '2026-09-01',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', quantity: 10 }],
      skipFieldValidation: true,
    }).store
    const draft = createInventoryAdjustmentDraft(store, {
      warehouseId: 'wh-a',
      date: '2026-09-03',
      lines: [{ itemId: 'item-1', counted: 8 }],
    })
    expect(draft.result.ok).toBe(true)
    store = draft.store
    expect(computeItemBalance('item-1', store.movements, 'wh-a').balance).toBe(10)
    const id = draft.result.ok ? draft.result.documentId : ''
    store = postExistingWarehouseDocument(store, id).store
    expect(computeItemBalance('item-1', store.movements, 'wh-a').balance).toBe(8)
  })

  it('import creates drafts without movements; idempotent on repeat', () => {
    let store = emptyWarehouse()
    const pending = [
      {
        itemId: 'item-1',
        warehouseId: 'wh-a',
        type: 'receipt' as const,
        quantity: 3,
        date: '2026-09-01',
        comment: 'import',
      },
    ]
    const first = applyImportPendingAsDraftReceipts(store, {
      warehouseId: 'wh-a',
      pending,
    })
    expect(first.result.draftsCreated).toBe(1)
    expect(first.result.movementsAdded).toBe(0)
    store = first.store
    expect(store.movements.length).toBe(0)
    expect(store.documents[0]?.status).toBe('draft')

    const second = applyImportPendingAsDraftReceipts(store, {
      warehouseId: 'wh-a',
      pending,
    })
    expect(second.result.draftsCreated).toBe(0)
    expect(second.result.duplicates).toBe(1)
    expect(second.store.documents.length).toBe(1)
  })

  it('journal search, filters and sort work; production docs visible', () => {
    let store = emptyWarehouse()
    store = postWarehouseDocument(store, {
      type: 'receipt',
      number: 'AUTO-1',
      date: '2026-09-01',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', quantity: 1 }],
      productionRequestId: 'pr-1',
      docRole: 'production_receipt',
      skipFieldValidation: true,
      documentDateTime: '2026-09-01T10:00:00.000Z',
    }).store
    store = postWarehouseDocument(store, {
      type: 'issue',
      number: 'MAN-1',
      date: '2026-09-02',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', quantity: 1 }],
      skipFieldValidation: true,
      documentDateTime: '2026-09-02T12:00:00.000Z',
    }).store

    const bySearch = filterWarehouseDocuments(store, { search: 'AUTO' })
    expect(bySearch.map((d) => d.number)).toEqual(['AUTO-1'])
    const bySource = filterWarehouseDocuments(store, { source: 'production' })
    expect(bySource).toHaveLength(1)
    expect(bySource[0]?.productionRequestId).toBe('pr-1')
    const sorted = filterWarehouseDocuments(store, {})
    expect(sorted[0]?.number).toBe('MAN-1')
    expect(queryDocumentJournal(store, { type: 'receipt' })).toHaveLength(1)
  })

  it('print model uses snapshots; rename does not change print; legacy opens', () => {
    let store = emptyWarehouse()
    const draft = saveWarehouseDocumentDraft(store, {
      type: 'receipt',
      number: 'П-W2-PRINT',
      date: '2026-09-01',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', quantity: 2 }],
    })
    store = draft.store
    const id = draft.result.ok ? draft.result.documentId : ''
    store = postExistingWarehouseDocument(store, id).store
    const doc = store.documents.find((d) => d.id === id)!
    expect(doc.lines[0]?.itemNameSnapshot).toBe('Сырьё 1')

    store = {
      ...store,
      items: store.items.map((i) => (i.id === 'item-1' ? { ...i, name: 'NEW NAME' } : i)),
    }
    const model = buildReceiptPrintModelFromDocument(
      store,
      store.documents.find((d) => d.id === id)!,
      { site: 'Test', locale: 'ru' },
    )
    expect(model?.lines[0]?.name).toBe('Сырьё 1')
    expect(model?.brandMarkUrl).toBeTruthy()

    const legacy: WarehouseStore = {
      ...emptyWarehouse(),
      documents: [
        {
          id: 'leg',
          type: 'receipt',
          number: 'LEG',
          date: '2025-01-01',
          warehouseId: 'wh-a',
          lines: [{ itemId: 'item-1', quantity: 1 }],
          createdAt: '2025-01-01T00:00:00.000Z',
          status: 'posted',
        },
      ],
    }
    const legacyModel = buildReceiptPrintModelFromDocument(legacy, legacy.documents[0]!, {
      site: 'x',
      locale: 'ru',
    })
    expect(legacyModel?.number).toBe('LEG')
  })

  it('cloud document_cancel group partial remote stays blocked', () => {
    const groupId = warehouseTransactionGroupId({
      kind: 'document_cancel',
      sourceId: 'd1',
      revision: 'cancel',
    })
    const baselineWh = emptyWarehouse({
      documents: [
        {
          id: 'd1',
          type: 'receipt',
          number: 'X',
          date: '2026-09-01',
          warehouseId: 'wh-a',
          lines: [{ itemId: 'item-1', quantity: 1 }],
          createdAt: '2026-09-01T00:00:00.000Z',
          status: 'posted',
        },
      ],
    })
    const localWh = {
      ...baselineWh,
      documents: [
        { ...baselineWh.documents[0]!, status: 'cancelled' as const, reversalDocumentId: 'r1' },
        {
          id: 'r1',
          type: 'issue' as const,
          number: 'X-С',
          date: '2026-09-02',
          warehouseId: 'wh-a',
          lines: [{ itemId: 'item-1', quantity: 1 }],
          createdAt: '2026-09-02T00:00:00.000Z',
          status: 'posted' as const,
          reversesDocumentId: 'd1',
          docRole: 'reversal' as const,
        },
      ],
    }
    const baseline = { warehouse: baselineWh } as unknown as AppStore
    const local = { warehouse: localWh } as unknown as AppStore
    const partial = {
      warehouse: {
        ...baselineWh,
        documents: [{ ...baselineWh.documents[0]!, status: 'cancelled', reversalDocumentId: 'r1' }],
      },
    } as unknown as AppStore
    const ops = stampOpsWithTransactionGroup(
      [
        {
          type: 'update',
          domain: 'warehouse.documents',
          entityId: 'd1',
          operationId: 'a',
        } as DirtyOperation,
        {
          type: 'create',
          domain: 'warehouse.documents',
          entityId: 'r1',
          operationId: 'b',
        } as DirtyOperation,
      ],
      {
        transactionGroupId: groupId,
        transactionGroupKind: 'document_cancel',
        atomic: true,
      },
      local,
      baseline,
    )
    expect(classifyAtomicGroupAgainstRemote(ops, partial)).toBe('partial_remote_group')
  })
})
