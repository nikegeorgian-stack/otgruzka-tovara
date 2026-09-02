import { describe, expect, it } from 'vitest'
import { createDefaultStore } from '@/lib/storage'
import {
  issueDraftFromReceipt,
  journalCommandsForEntry,
} from '@/lib/journals/commands'
import type { UnifiedJournalEntry } from '@/lib/journals/types'
import type { WarehouseDocument } from '@/lib/warehouse/types'

function entry(partial: Partial<UnifiedJournalEntry>): UnifiedJournalEntry {
  return {
    id: 'e1',
    category: 'procurement',
    at: '2026-08-18T10:00:00.000Z',
    title: 'Test',
    detail: 'Detail',
    ...partial,
  }
}

describe('journalCommandsForEntry', () => {
  it('offers receipt from posted procurement order', () => {
    const store = createDefaultStore()
    store.procurement.orders.push({
      id: 'po-1',
      number: 'ZZ-1',
      status: 'confirmed',
      createdAt: '2026-08-01',
      updatedAt: '2026-08-01',
      supplierId: '',
      supplierName: 'Sup',
      lines: [],
      currency: 'USD',
      incoterms: '',
      paymentTerms: '',
      deliveryAddress: '',
      notes: '',
      routePoints: [],
      milestones: [],
      statusHistory: [],
    })
    const cmds = journalCommandsForEntry(
      store,
      entry({
        link: { kind: 'procurement_order', orderId: 'po-1' },
      }),
    )
    expect(cmds.some((c) => c.id === 'basedOn' && c.basedOn === 'receipt_from_po')).toBe(true)
  })

  it('offers issue draft from posted receipt', () => {
    const store = createDefaultStore()
    const receipt: WarehouseDocument = {
      id: 'doc-r1',
      type: 'receipt',
      status: 'posted',
      number: 'П-1',
      date: '2026-08-10',
      warehouseId: store.warehouse.locations[0]?.id ?? 'wh1',
      lines: [{ itemId: 'item-1', quantity: 5, inputUnit: 'pcs' }],
      createdAt: '2026-08-10',
      updatedAt: '2026-08-10',
    }
    store.warehouse.documents.push(receipt)
    const draft = issueDraftFromReceipt(store.warehouse, receipt, 'На основании')
    expect(draft?.type).toBe('issue')
    expect(draft?.lines).toHaveLength(1)
    expect(draft?.lines[0].quantity).toBe(5)
  })
})
