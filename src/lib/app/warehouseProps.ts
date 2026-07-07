import type { WarehousePageProps } from '@/components/warehouse/warehouseTypes'
import type { AppStore } from '@/lib/types'

type WarehouseActions = Pick<
  WarehousePageProps,
  | 'onUpsertItem'
  | 'onArchiveItem'
  | 'onRemoveItem'
  | 'onUpsertCategory'
  | 'onUpsertLocation'
  | 'onRemoveCategory'
  | 'onRemoveLocation'
  | 'onAddMovement'
  | 'onDeleteMovement'
  | 'onPostDocument'
  | 'onPostTransfer'
  | 'onCancelDocument'
  | 'onSaveDocumentDraft'
  | 'onPostExistingDocument'
  | 'onUnpostDocument'
  | 'onRemoveDocumentDraft'
  | 'onRunInventory'
  | 'onPostInventoryRevision'
  | 'onPostOpeningBalances'
  | 'onAcquireDocumentLock'
  | 'onReleaseDocumentLock'
  | 'onQuickEditItem'
  | 'onImportExcel'
  | 'onExportExcel'
  | 'onMergeInvoiceRegistry'
  | 'onOpenDailyIssueSession'
  | 'onAdjustDailyIssueLine'
  | 'onSetDailyIssueComment'
  | 'onPostDailyIssueSession'
  | 'onResolveWarehouseItemRequest'
  | 'onResolveWarehouseItemRenameRequest'
  | 'onCreateKeeperReplenishment'
  | 'onCreateReplenishmentFromDeficit'
  | 'onUpdateKeeperReplenishment'
  | 'onSubmitKeeperReplenishment'
  | 'onCancelKeeperReplenishment'
  | 'onReceiveKeeperReplenishment'
  | 'onUpsertLoadingShipment'
  | 'onPostLoadingShipment'
  | 'onRemoveLoadingShipment'
  | 'onUpsertCounterparty'
  | 'onOpenCounterparties'
  | 'onUpsertWorkwearCatalogItem'
  | 'onArchiveWorkwearCatalogItem'
  | 'onPostWorkwearIssuance'
>

type BuildOpts = {
  store: AppStore
  brigades: string[]
  actions: WarehouseActions
  embedded?: WarehousePageProps['embedded']
  onSaveProductionRequest?: WarehousePageProps['onSaveProductionRequest']
  onPostProductionRequest?: WarehousePageProps['onPostProductionRequest']
}

export function buildWarehousePageProps({
  store,
  brigades,
  actions,
  embedded,
  onSaveProductionRequest,
  onPostProductionRequest,
}: BuildOpts): WarehousePageProps {
  return {
    warehouse: store.warehouse,
    workwear: store.workwear,
    employees: store.employees,
    brigades,
    brigadeNamesKa: store.brigadeNamesKa,
    productionRequests: store.production.requests.filter((r) => r.status !== 'posted'),
    onSaveProductionRequest,
    onPostProductionRequest,
    embedded,
    printMeta: {
      site: store.settings.site,
      responsible: store.settings.responsible,
      signatures: store.settings.signatures,
      locale: store.settings.locale,
    },
    counterparties: store.counterparties.items.filter((c) => c.active),
    salesOrders: store.sales.orders,
    ...actions,
  }
}
