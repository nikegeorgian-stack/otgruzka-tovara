import type { ViewId } from '@/lib/types'

export type JournalNavTarget =
  | { view: 'warehouse'; warehouseDocumentId: string; mode?: 'view' | 'edit' }
  | { view: 'warehouse'; warehouseItemId: string; tab?: 'nomenclature'; mode?: 'view' | 'edit' }
  | { view: 'warehouse'; loadingShipmentId: string; tab: 'loading'; mode?: 'view' | 'edit' }
  | {
      view: 'month'
      month: string
      timesheetEntryDocumentId?: string
      mode?: 'view' | 'edit'
    }
  | { view: 'production'; productionRequestId: string; mode?: 'view' | 'edit' }
  | { view: 'procurement'; procurementOrderId: string; mode?: 'view' | 'edit' }
  | { view: 'director'; salesOrderId: string; mode?: 'view' | 'edit' }
  | { view: 'it'; mode?: 'view' | 'edit' }
  | { view: 'technologist'; technologistRef: string; mode?: 'view' | 'edit' }
  | { view: 'hr'; employeeId: string; mode?: 'view' | 'edit' }
  | { view: 'meals'; mode?: 'view' | 'edit' }
  | { view: 'directories'; mode?: 'view' | 'edit' }
  | {
      view: 'finance'
      advanceDocumentId?: string
      payoutDocumentId?: string
      accrualDocumentId?: string
      month?: string
      mode?: 'view' | 'edit'
    }

export function resolveJournalLink(
  link: import('./types').JournalLink,
  mode: 'view' | 'edit' = 'view',
): JournalNavTarget | null {
  switch (link.kind) {
    case 'warehouse_document':
      return { view: 'warehouse', warehouseDocumentId: link.documentId, mode }
    case 'warehouse_item':
      return { view: 'warehouse', warehouseItemId: link.itemId, tab: 'nomenclature', mode }
    case 'warehouse_loading':
      return { view: 'warehouse', loadingShipmentId: link.shipmentId, tab: 'loading', mode }
    case 'month':
      return { view: 'month', month: link.month, mode }
    case 'timesheet_entry_document':
      return {
        view: 'month',
        month: link.month ?? new Date().toISOString().slice(0, 7),
        timesheetEntryDocumentId: link.documentId,
        mode,
      }
    case 'production_request':
      return { view: 'production', productionRequestId: link.requestId, mode }
    case 'procurement_order':
      return { view: 'procurement', procurementOrderId: link.orderId, mode }
    case 'sales_order':
      return { view: 'director', salesOrderId: link.orderId, mode }
    case 'hr':
      return { view: 'hr', employeeId: link.employeeId, mode }
    case 'finance_advance_document':
      return {
        view: 'finance',
        advanceDocumentId: link.documentId,
        month: link.month,
        mode,
      }
    case 'finance_payout_document':
      return {
        view: 'finance',
        payoutDocumentId: link.documentId,
        month: link.month,
        mode,
      }
    case 'finance_accrual_document':
      return {
        view: 'finance',
        accrualDocumentId: link.documentId,
        month: link.month,
        mode,
      }
    case 'finance_month':
      return { view: 'finance', month: link.month, mode }
    case 'meals':
      return { view: 'meals', mode }
    case 'directories':
      return { view: 'directories', mode }
    case 'it':
      return { view: 'it', mode }
    default:
      return null
  }
}

export function journalNavLabelKey(view: ViewId): string {
  return `nav.${view}`
}
