import { nextDocumentNumber } from '@/lib/warehouse/docNumbering'
import type { SaveDraftInput } from '@/lib/warehouse/documents'
import type { WarehouseDocument, WarehouseStore } from '@/lib/warehouse/types'
import { buildCombinedLoadingShipmentInputFromSales } from '@/lib/sales/loadingLink'
import type { AppStore } from '@/lib/types'
import type { UpsertLoadingShipmentInput } from '@/lib/warehouse/loadingShipments'
import type { UnifiedJournalEntry } from './types'

export type JournalBasedOnKind =
  | 'receipt_from_po'
  | 'issue_from_receipt'
  | 'loading_from_sales'
  | 'advance_from_accrual'

export type JournalCommand =
  | { id: 'open'; labelKey: 'journals.cmd.open' }
  | { id: 'openEdit'; labelKey: 'journals.cmd.openEdit' }
  | { id: 'openSection'; labelKey: 'journals.cmd.openSection' }
  | { id: 'basedOn'; basedOn: JournalBasedOnKind; labelKey: string }

function warehouseDoc(
  store: AppStore,
  entry: UnifiedJournalEntry,
): WarehouseDocument | undefined {
  const link = entry.link
  if (link?.kind !== 'warehouse_document') return undefined
  return store.warehouse.documents.find((d) => d.id === link.documentId)
}

/** Какие кнопки показать у записи журнала. */
export function journalCommandsForEntry(
  store: AppStore,
  entry: UnifiedJournalEntry,
): JournalCommand[] {
  const cmds: JournalCommand[] = []
  const link = entry.link
  if (!link) return cmds

  cmds.push({ id: 'open', labelKey: 'journals.cmd.open' })
  if (link.kind === 'warehouse_document' || link.kind === 'sales_order') {
    cmds.push({ id: 'openEdit', labelKey: 'journals.cmd.openEdit' })
  }
  cmds.push({ id: 'openSection', labelKey: 'journals.cmd.openSection' })

  if (link.kind === 'procurement_order') {
    const order = store.procurement.orders.find((o) => o.id === link.orderId)
    if (order && order.status !== 'cancelled' && order.status !== 'draft') {
      cmds.push({
        id: 'basedOn',
        basedOn: 'receipt_from_po',
        labelKey: 'journals.basedOn.receiptFromPo',
      })
    }
  }

  const doc = warehouseDoc(store, entry)
  if (doc?.type === 'receipt' && doc.status === 'posted' && doc.lines.length > 0) {
    cmds.push({
      id: 'basedOn',
      basedOn: 'issue_from_receipt',
      labelKey: 'journals.basedOn.issueFromReceipt',
    })
  }

  if (link.kind === 'sales_order') {
    const order = store.sales.orders.find((o) => o.id === link.orderId)
    if (order && order.status !== 'cancelled') {
      cmds.push({
        id: 'basedOn',
        basedOn: 'loading_from_sales',
        labelKey: 'journals.basedOn.loadingFromSales',
      })
    }
  }

  if (link.kind === 'finance_accrual_document') {
    cmds.push({
      id: 'basedOn',
      basedOn: 'advance_from_accrual',
      labelKey: 'journals.basedOn.advanceFromAccrual',
    })
  }

  return cmds
}

export function issueDraftFromReceipt(
  warehouse: WarehouseStore,
  receipt: WarehouseDocument,
  commentPrefix: string,
): SaveDraftInput | null {
  if (receipt.type !== 'receipt' || receipt.lines.length === 0) return null
  const date = new Date().toISOString().slice(0, 10)
  return {
    type: 'issue',
    number: nextDocumentNumber(warehouse.documents, 'issue', date),
    date,
    warehouseId: receipt.warehouseId,
    purpose: 'writeoff',
    comment: `${commentPrefix} ${receipt.number}`.trim(),
    counterpartyId: receipt.counterpartyId,
    counterparty: receipt.counterparty,
    lines: receipt.lines.map((l) => ({
      itemId: l.itemId,
      quantity: l.quantity,
      inputUnit: l.inputUnit,
    })),
  }
}

export function loadingInputFromJournalSales(
  store: AppStore,
  orderId: string,
): UpsertLoadingShipmentInput | null {
  const order = store.sales.orders.find((o) => o.id === orderId)
  if (!order) return null
  return buildCombinedLoadingShipmentInputFromSales(
    order,
    store.warehouse,
    store.finishedProducts.items,
  )
}
