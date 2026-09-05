import { describe, expect, it } from 'vitest'
import { collectJournalEntries } from '@/lib/journals/collect'
import { createDefaultStore } from '@/lib/storage'
import { saveWarehouseDocumentDraft } from '@/lib/warehouse/documents'

function inventoryFixture() {
  const store = createDefaultStore()
  const item = { ...store.warehouse.items[0]!, name: 'Аптечка для глаз', unit: 'шт' }
  const warehouse = {
    ...store.warehouse,
    items: [item, ...store.warehouse.items.slice(1)],
  }
  const draft = {
    type: 'inventory' as const,
    number: 'ИНВ-20260817-001',
    date: '2026-08-17',
    warehouseId: warehouse.locations[0]!.id,
    purpose: 'other' as const,
    lines: [{ itemId: item.id, quantity: 10000, bookQty: 0 }],
    keeperId: 'keeper-alexandra',
    keeperName: 'Олександра',
  }
  return { store, warehouse, draft }
}

describe('warehouse inventory documents', () => {
  it('records the counted item and quantity in the warehouse audit journal', () => {
    const { warehouse, draft } = inventoryFixture()

    const result = saveWarehouseDocumentDraft(warehouse, draft, {
      actorId: draft.keeperId,
      actorName: draft.keeperName,
    })

    expect(result.result.ok).toBe(true)
    expect(result.store.auditLog.at(-1)?.detail).toContain('Аптечка для глаз: 10000 шт')
  })

  it('makes inventory item counts searchable in the unified document journal', () => {
    const { store, warehouse, draft } = inventoryFixture()
    const saved = saveWarehouseDocumentDraft(warehouse, draft)
    const appStore = { ...store, warehouse: saved.store }

    const entries = collectJournalEntries(appStore, ['warehouse_documents'])

    expect(entries).toHaveLength(1)
    expect(entries[0]?.detail).toContain('Аптечка для глаз: 10000 шт')
    expect(entries[0]?.actor).toBe('Олександра')
    expect(entries[0]?.link).toEqual({
      kind: 'warehouse_document',
      documentId: saved.result.ok ? saved.result.documentId : '',
    })
  })
})
