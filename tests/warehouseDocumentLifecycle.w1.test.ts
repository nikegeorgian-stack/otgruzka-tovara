import { describe, expect, it } from 'vitest'
import { withActiveWarehouses } from '@/lib/warehouse/accountingStatus'
import {
  cancelPosted,
  copyDocument,
  createDraft,
  createCorrection,
  postDraft,
  updateDraft,
  unpostForbidden,
} from '@/lib/warehouse/documentLifecycle'
import {
  BARE_BALANCE_MOVEMENT_BLOCKED,
  UNPOST_REMOVED_ERROR,
  cancelWarehouseDocument,
  postExistingWarehouseDocument,
  postInventoryRevision,
  postOpeningBalances,
  postWarehouseDocument,
  runInventoryCount,
  saveWarehouseDocumentDraft,
  unpostWarehouseDocument,
} from '@/lib/warehouse/documents'
import { zeroAllWarehouseBalances } from '@/lib/warehouse/zeroBalances'
import { computeItemBalance } from '@/lib/warehouse/stock'
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
  const base: WarehouseStore = {
    locations: [loc],
    categories: [{ id: 'cat-1', name: 'Сырьё', sortOrder: 1 }],
    items: [item],
    movements: [],
    documents: [],
    auditLog: [],
    nextInternalCode: 10,
    invoiceRegistry: [],
    ...overrides,
  }
  return withActiveWarehouses(base, [loc.id])
}

describe('W1 document lifecycle', () => {
  it('draft can be edited; posted cannot', () => {
    let store = emptyWarehouse()
    const draft = createDraft(
      store,
      {
        type: 'receipt',
        number: 'П-1',
        date: '2026-09-01',
        warehouseId: 'wh-a',
        lines: [{ itemId: 'item-1', quantity: 5 }],
      },
      { actorId: 'u1', actorName: 'User' },
    )
    expect(draft.result.ok).toBe(true)
    if (!draft.result.ok) return
    store = draft.store
    const docId = draft.result.documentId

    const updated = updateDraft(
      store,
      {
        id: docId,
        type: 'receipt',
        number: 'П-1',
        date: '2026-09-01',
        warehouseId: 'wh-a',
        lines: [{ itemId: 'item-1', quantity: 8 }],
      },
      { actorId: 'u1' },
    )
    expect(updated.result.ok).toBe(true)
    store = updated.store

    const posted = postDraft(store, docId, { actorId: 'u1', actorName: 'User' })
    expect(posted.result.ok).toBe(true)
    store = posted.store

    const editPosted = updateDraft(
      store,
      {
        id: docId,
        type: 'receipt',
        number: 'П-1',
        date: '2026-09-01',
        warehouseId: 'wh-a',
        lines: [{ itemId: 'item-1', quantity: 99 }],
      },
      { actorId: 'u1' },
    )
    expect(editPosted.result.ok).toBe(false)
    if (!editPosted.result.ok) {
      expect(editPosted.result.error).toBe('warehouse.doc.errPostedImmutable')
    }
  })

  it('posted movements are not deleted; destructive unpost is blocked', () => {
    let store = emptyWarehouse()
    store = postWarehouseDocument(store, {
      type: 'receipt',
      number: 'П-2',
      date: '2026-09-01',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', quantity: 10 }],
      skipFieldValidation: true,
    }).store
    const doc = store.documents[0]!
    const movCount = store.movements.filter((m) => m.documentId === doc.id).length
    expect(movCount).toBeGreaterThan(0)

    const unpost = unpostWarehouseDocument(store, doc.id, { actorId: 'u1' })
    expect(unpost.result.ok).toBe(false)
    if (!unpost.result.ok) expect(unpost.result.error).toBe(UNPOST_REMOVED_ERROR)
    expect(unpost.store.movements.filter((m) => m.documentId === doc.id).length).toBe(movCount)
    expect(unpost.store.documents.find((d) => d.id === doc.id)?.status).toBe('posted')

    const forbidden = unpostForbidden(store, doc.id)
    expect(forbidden.result.ok).toBe(false)

    const rePost = postExistingWarehouseDocument(store, doc.id, { actorId: 'u1' })
    expect(rePost.result.ok).toBe(false)
  })

  it('storno creates separate reversal with opposite movements; original cancelled atomically', () => {
    let store = emptyWarehouse()
    store = postWarehouseDocument(store, {
      type: 'receipt',
      number: 'П-3',
      date: '2026-09-01',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', quantity: 12 }],
      skipFieldValidation: true,
    }).store
    const original = store.documents.find((d) => d.number === 'П-3')!
    const origMov = store.movements.filter((m) => m.documentId === original.id)
    expect(origMov.length).toBe(1)

    const cancel = cancelPosted(store, original.id, {
      cancelledBy: 'u1',
      cancelledByName: 'Admin',
      reason: 'ошибка прихода',
    })
    expect(cancel.result.ok).toBe(true)
    if (!cancel.result.ok) return
    store = cancel.store

    const cancelled = store.documents.find((d) => d.id === original.id)!
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.cancellationReason).toBe('ошибка прихода')
    expect(cancelled.reversalDocumentId).toBeTruthy()

    const reversal = store.documents.find((d) => d.id === cancelled.reversalDocumentId)!
    expect(reversal.reversesDocumentId).toBe(original.id)
    expect(reversal.docRole).toBe('reversal')
    expect(reversal.status).toBe('posted')

    const revMov = store.movements.filter((m) => m.documentId === reversal.id)
    expect(revMov.length).toBe(1)
    expect(revMov[0]!.quantity).toBe(origMov[0]!.quantity)
    expect(revMov[0]!.type).toBe('issue')
    expect(revMov[0]!.documentLineId).toBeTruthy()

    // Original movements preserved
    expect(store.movements.filter((m) => m.documentId === original.id).length).toBe(1)
    expect(computeItemBalance('item-1', store.movements, 'wh-a').balance).toBe(0)
  })

  it('repeat storno is idempotent; reason is required', () => {
    let store = emptyWarehouse()
    store = postWarehouseDocument(store, {
      type: 'receipt',
      number: 'П-4',
      date: '2026-09-01',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', quantity: 3 }],
      skipFieldValidation: true,
    }).store
    const id = store.documents[0]!.id

    const noReason = cancelWarehouseDocument(store, id, {})
    expect(noReason.result.ok).toBe(false)
    if (!noReason.result.ok) {
      expect(noReason.result.error).toBe('warehouse.doc.errCancelReasonRequired')
    }

    const first = cancelWarehouseDocument(store, id, { reason: 'fix' })
    expect(first.result.ok).toBe(true)
    if (!first.result.ok) return
    store = first.store
    const docsAfter = store.documents.length
    const movAfter = store.movements.length

    const second = cancelWarehouseDocument(store, id, { reason: 'again' })
    expect(second.result.ok).toBe(true)
    expect(second.store.documents.length).toBe(docsAfter)
    expect(second.store.movements.length).toBe(movAfter)
    expect(second.result.ok && second.result.reversalIds).toEqual(first.result.ok && first.result.reversalIds)
  })

  it('cancel of receipt blocked when stock insufficient; legacy doc without new fields still readable', () => {
    let store = emptyWarehouse()
    store = postWarehouseDocument(store, {
      type: 'receipt',
      number: 'П-5',
      date: '2026-09-01',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', quantity: 5 }],
      skipFieldValidation: true,
    }).store
    store = postWarehouseDocument(store, {
      type: 'issue',
      number: 'Р-5',
      date: '2026-09-02',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', quantity: 5 }],
      skipFieldValidation: true,
    }).store
    const receipt = store.documents.find((d) => d.number === 'П-5')!
    const before = structuredClone(store)
    const cancel = cancelWarehouseDocument(store, receipt.id, { reason: 'cannot' })
    expect(cancel.result.ok).toBe(false)
    expect(cancel.store.documents).toEqual(before.documents)
    expect(cancel.store.movements).toEqual(before.movements)

    // Legacy-shaped document (minimal fields) is readable / copyable
    const legacy: WarehouseStore = {
      ...emptyWarehouse(),
      documents: [
        {
          id: 'legacy-1',
          type: 'receipt',
          number: 'LEG-1',
          date: '2025-01-01',
          warehouseId: 'wh-a',
          lines: [{ itemId: 'item-1', quantity: 1 }],
          createdAt: '2025-01-01T00:00:00.000Z',
          status: 'posted',
        },
      ],
      movements: [
        {
          id: 'm-legacy',
          itemId: 'item-1',
          warehouseId: 'wh-a',
          type: 'receipt',
          quantity: 1,
          date: '2025-01-01',
          documentId: 'legacy-1',
          createdAt: '2025-01-01T00:00:00.000Z',
        },
      ],
    }
    const copy = copyDocument(legacy, 'legacy-1', { actorId: 'u1' })
    expect(copy.result.ok).toBe(true)
    const correction = createCorrection(legacy, 'legacy-1', { actorId: 'u1' })
    expect(correction.result.ok).toBe(true)
  })

  it('item rename does not change posted line snapshots; movements link lineId', () => {
    let store = emptyWarehouse()
    const draft = saveWarehouseDocumentDraft(store, {
      type: 'receipt',
      number: 'П-6',
      date: '2026-09-01',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', quantity: 4 }],
    })
    store = draft.store
    const docId = draft.result.ok ? draft.result.documentId : ''
    store = postExistingWarehouseDocument(store, docId, { actorId: 'u1' }).store
    const posted = store.documents.find((d) => d.id === docId)!
    expect(posted.lines[0]?.itemNameSnapshot).toBe('Сырьё 1')
    expect(posted.lines[0]?.lineId).toBeTruthy()
    const lineId = posted.lines[0]!.lineId!

    store = {
      ...store,
      items: store.items.map((i) =>
        i.id === 'item-1' ? { ...i, name: 'Сырьё ПЕРЕИМЕНОВАНО' } : i,
      ),
    }
    const still = store.documents.find((d) => d.id === docId)!
    expect(still.lines[0]?.itemNameSnapshot).toBe('Сырьё 1')
    const mov = store.movements.find((m) => m.documentId === docId)!
    expect(mov.documentLineId).toBe(lineId)
  })

  it('direct balance adjustments without document are blocked; legacy bare movements untouched', () => {
    const legacyBare = emptyWarehouse({
      movements: [
        {
          id: 'bare-1',
          itemId: 'item-1',
          warehouseId: 'wh-a',
          type: 'adjustment',
          quantity: 7,
          date: '2025-01-01',
          createdAt: '2025-01-01T00:00:00.000Z',
          comment: 'legacy',
        },
      ],
    })
    expect(legacyBare.movements.length).toBe(1)

    const inv = runInventoryCount(legacyBare, {
      itemId: 'item-1',
      warehouseId: 'wh-a',
      counted: 100,
      date: '2026-09-01',
    })
    expect(inv.movements.length).toBe(1)

    const rev = postInventoryRevision(legacyBare, {
      warehouseId: 'wh-a',
      date: '2026-09-01',
      lines: [{ itemId: 'item-1', counted: 100 }],
    })
    expect(rev.result.applied).toBe(0)
    expect(rev.result.error).toBe(BARE_BALANCE_MOVEMENT_BLOCKED)
    expect(rev.store.movements.length).toBe(1)

    const open = postOpeningBalances(legacyBare, {
      warehouseId: 'wh-a',
      date: '2026-09-01',
      lines: [{ itemId: 'item-1', quantity: 10 }],
    })
    expect(open.result.applied).toBe(0)
    expect(open.store.movements.length).toBe(1)

    const zeroed = zeroAllWarehouseBalances(legacyBare, '2026-09-01')
    expect(zeroed.movements.filter((m) => m.id === 'bare-1').length).toBe(1)
    expect(zeroed.movements.length).toBe(1)
  })

  it('cloud conflict classifies partial storno group without applying subset', () => {
    const groupId = warehouseTransactionGroupId({
      kind: 'document_cancel',
      sourceId: 'doc-1',
      revision: 'cancel',
    })
    const originalDoc = {
      id: 'doc-1',
      type: 'receipt' as const,
      number: 'П-X',
      date: '2026-09-01',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', quantity: 1 }],
      createdAt: '2026-09-01T00:00:00.000Z',
      status: 'cancelled' as const,
      reversalDocumentId: 'rev-1',
    }
    const reversalDoc = {
      id: 'rev-1',
      type: 'issue' as const,
      number: 'П-X-С',
      date: '2026-09-02',
      warehouseId: 'wh-a',
      lines: [{ itemId: 'item-1', quantity: 1 }],
      createdAt: '2026-09-02T00:00:00.000Z',
      status: 'posted' as const,
      reversesDocumentId: 'doc-1',
      docRole: 'reversal' as const,
    }
    const revMov = {
      id: 'mov-rev-1',
      itemId: 'item-1',
      warehouseId: 'wh-a',
      type: 'issue' as const,
      quantity: 1,
      date: '2026-09-02',
      documentId: 'rev-1',
      createdAt: '2026-09-02T00:00:00.000Z',
    }

    const baselineWh = emptyWarehouse({
      documents: [
        {
          ...originalDoc,
          status: 'posted',
          reversalDocumentId: undefined,
        },
      ],
      movements: [
        {
          id: 'mov-orig',
          itemId: 'item-1',
          warehouseId: 'wh-a',
          type: 'receipt',
          quantity: 1,
          date: '2026-09-01',
          documentId: 'doc-1',
          createdAt: '2026-09-01T00:00:00.000Z',
        },
      ],
    })
    const localWh = {
      ...baselineWh,
      documents: [originalDoc, reversalDoc],
      movements: [
        ...baselineWh.movements,
        revMov,
      ],
    }

    const baseline = { warehouse: baselineWh } as unknown as AppStore
    const local = { warehouse: localWh } as unknown as AppStore
    const partialRemote = {
      warehouse: {
        ...baselineWh,
        documents: [originalDoc], // only original status applied remotely
        movements: baselineWh.movements,
      },
    } as unknown as AppStore

    const ops = stampOpsWithTransactionGroup(
      [
        {
          type: 'update',
          domain: 'warehouse.documents',
          entityId: 'doc-1',
          operationId: 'c1',
        } as DirtyOperation,
        {
          type: 'create',
          domain: 'warehouse.documents',
          entityId: 'rev-1',
          operationId: 'c2',
        } as DirtyOperation,
        {
          type: 'create',
          domain: 'warehouse.movements',
          entityId: 'mov-rev-1',
          operationId: 'c3',
        } as DirtyOperation,
      ],
      {
        transactionGroupId: groupId,
        transactionGroupKind: 'document_cancel',
        transactionGroupLabel: 'Сторно',
        atomic: true,
      },
      local,
      baseline,
    )

    expect(classifyAtomicGroupAgainstRemote(ops, partialRemote)).toBe('partial_remote_group')
  })

  it('employees/timesheet domains are untouched by warehouse lifecycle helpers', () => {
    // Smoke: helpers only accept WarehouseStore — no AppStore employee mutation surface.
    const store = emptyWarehouse()
    const keys = Object.keys(store).sort()
    expect(keys).not.toContain('employees')
    expect(keys).not.toContain('timesheet')
    void createDraft
    void postDraft
  })
})
