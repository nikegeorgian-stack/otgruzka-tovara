import type { Locale, PrintSignatures, Employee } from '@/lib/types'
import type { ProductionRequest } from '@/lib/production/types'
import type { FormulationBatchRun } from '@/lib/formulations/types'
import type { PostBatchMixResult } from '@/lib/formulations/batch'
import type { WarehouseStore } from '@/lib/warehouse/types'
import type { WorkwearStore } from '@/lib/workwear/types'
import type { ImportResult } from '@/lib/warehouse/importExport'
import type { PostWorkwearIssueResult } from '@/lib/workwear/issue'
import type {
  PostDocumentResult,
  CancelDocumentResult,
  UnpostDocumentResult,
  SaveDraftInput,
} from '@/lib/warehouse/documents'
import type {
  StockMovement,
  WarehouseCategory,
  WarehouseDocument,
  WarehouseItem,
  WarehouseLocation,
} from '@/lib/warehouse/types'
import type { UserViewDefaults, WarehouseViewDefaults } from '@/lib/viewDefaults/types'

export type WarehousePageProps = {
  warehouse: WarehouseStore
  workwear: WorkwearStore
  employees: Employee[]
  brigades: string[]
  brigadeNamesKa?: Record<string, string>
  productionRequests?: ProductionRequest[]
  onSaveProductionRequest?: (r: ProductionRequest) => void
  onPostProductionRequest?: (
    id: string,
    postedBy?: string,
  ) => { ok: boolean; messageKey?: string }
  /** Встроенный режим в «Справочники» — только номенклатура */
  embedded?: 'nomenclature'
  /** Облачный кабинет кладовщика — упрощённые вкладки */
  webWarehouseMode?: boolean
  webUserName?: string
  printMeta?: {
    site: string
    responsible?: string
    signatures?: PrintSignatures
    locale: Locale
  }
  onUpsertItem: (item: WarehouseItem) => void
  onArchiveItem: (id: string, archived: boolean) => void
  onRemoveItem: (id: string) => boolean
  onUpsertCategory: (cat: WarehouseCategory) => void
  onUpsertLocation: (loc: WarehouseLocation) => void
  onRemoveCategory?: (id: string) => boolean
  onRemoveLocation?: (id: string) => boolean
  onAddMovement: (movement: Omit<StockMovement, 'id' | 'createdAt'>) => void
  onDeleteMovement: (id: string) => boolean
  onPostDocument: (doc: Omit<WarehouseDocument, 'id' | 'createdAt'>) => PostDocumentResult
  onPostTransfer?: (
    doc: Omit<WarehouseDocument, 'id' | 'createdAt' | 'type' | 'docRole' | 'transferPairId'> & {
      targetWarehouseId: string
    },
  ) => PostDocumentResult
  onCancelDocument?: (
    documentId: string,
    args?: { reason?: string },
  ) => CancelDocumentResult
  /** Сохранить документ черновиком (без движений) */
  onSaveDocumentDraft?: (doc: SaveDraftInput) => PostDocumentResult
  /** Провести существующий черновик/документ */
  onPostExistingDocument?: (documentId: string) => PostDocumentResult
  /** Снять проведение (вернуть в черновик) */
  onUnpostDocument?: (documentId: string) => UnpostDocumentResult
  /** Удалить черновик документа */
  onRemoveDocumentDraft?: (documentId: string) => UnpostDocumentResult
  onMergeInvoiceRegistry: (registry: import('@/lib/warehouse/types').GeorgianInvoice[]) => void
  onRunInventory: (args: {
    itemId: string
    warehouseId: string
    counted: number
    date: string
    comment?: string
  }) => void
  onPostInventoryRevision: (args: {
    warehouseId: string
    date: string
    comment?: string
    lines: { itemId: string; counted: number }[]
  }) => { applied: number; skipped: number; unchanged: number }
  onPostOpeningBalances: (args: {
    warehouseId: string
    date: string
    comment?: string
    lines: { itemId: string; quantity: number }[]
  }) => { applied: number; skipped: number }
  onAcquireDocumentLock?: (
    documentId: string,
  ) => { ok: boolean; error?: string; lockedByName?: string }
  onReleaseDocumentLock?: (documentId: string) => void
  onQuickEditItem?: (item: WarehouseItem) => void
  onImportExcel: (file: File, warehouseId?: string) => Promise<ImportResult>
  onExportExcel: (warehouseId?: string) => void
  /** Выдача за день */
  keeperId?: string
  keeperName?: string
  /** Разрешён уход в минус по остатку (расход / ведомость) */
  allowNegativeStock?: boolean
  /** Разрешено сторнирование документов */
  canCancelDocuments?: boolean
  /** Снять проведение (только администратор) */
  canUnpostDocuments?: boolean
  counterparties?: import('@/lib/counterparties/types').Counterparty[]
  onUpsertCounterparty?: (c: import('@/lib/counterparties/types').Counterparty) => void
  onOpenCounterparties?: () => void
  onOpenDailyIssueSession?: (args: {
    keeperId: string
    keeperName: string
    warehouseId: string
  }) => string
  onAdjustDailyIssueLine?: (sessionId: string, itemId: string, delta: number) => void
  onSetDailyIssueComment?: (sessionId: string, comment: string) => void
  onPostDailyIssueSession?: (
    sessionId: string,
    options?: { allowNegativeStock?: boolean },
  ) => import('@/lib/warehouse/dailyIssue').PostDailyIssueResult
  onResolveWarehouseItemRequest?: (
    requestId: string,
    status: 'fulfilled' | 'rejected',
    opts?: { fulfilledItemId?: string; keeperNote?: string; keeperName?: string },
  ) => void
  onResolveWarehouseItemRenameRequest?: (
    requestId: string,
    status: 'accepted' | 'rejected',
    opts?: { keeperNote?: string; keeperId?: string; keeperName?: string },
  ) => void
  /** Заявки кладовщика на пополнение / закупку */
  onCreateKeeperReplenishment?: (input: {
    warehouseId: string
    keeperId: string
    keeperName: string
    comment?: string
    lines?: { itemId: string; requestedQty: number; note?: string }[]
  }) => string
  onCreateReplenishmentFromDeficit?: (input: {
    warehouseId: string
    keeperId: string
    keeperName: string
    comment?: string
  }) => string | null
  onUpdateKeeperReplenishment?: (
    requestId: string,
    patch: { lines?: { itemId: string; requestedQty: number; note?: string }[] },
  ) => void
  onSubmitKeeperReplenishment?: (requestId: string) => void
  onCancelKeeperReplenishment?: (requestId: string) => void
  onReceiveKeeperReplenishment?: (
    requestId: string,
    lines: { itemId: string; quantity: number }[],
    args?: { date?: string; keeperId?: string; keeperName?: string },
  ) => import('@/lib/warehouse/keeperReplenishment').ReceiveReplenishmentResult
  finishedProducts?: import('@/lib/finishedProducts/types').FinishedProduct[]
  packagingRecipes?: import('@/lib/packaging/types').PackagingRecipe[]
  onUpsertFinishedProduct?: (fp: import('@/lib/finishedProducts/types').FinishedProduct) => void
  onUpsertLoadingShipment?: (
    input: import('@/lib/warehouse/loadingShipments').UpsertLoadingShipmentInput,
  ) => string
  onPostLoadingShipment?: (
    shipmentId: string,
    args?: { keeperId?: string; keeperName?: string },
  ) => import('@/lib/warehouse/loadingShipments').PostLoadingShipmentResult
  onRemoveLoadingShipment?: (shipmentId: string) => void
  salesOrders?: import('@/lib/sales/types').SalesOrder[]
  onOpenSalesOrder?: (orderId: string) => void
  /** Замесы пропиточного состава, ожидающие подтверждения кладовщиком */
  pendingBatchRuns?: FormulationBatchRun[]
  onConfirmFormulationBatch?: (
    runId: string,
    keeper?: { id?: string; name?: string },
    options?: { allowNegativeStock?: boolean },
  ) => PostBatchMixResult
  onRejectFormulationBatch?: (
    runId: string,
    keeper?: { id?: string; name?: string },
    reason?: string,
  ) => PostBatchMixResult
  onUpsertWorkwearCatalogItem?: (item: import('@/lib/workwear/types').WorkwearCatalogItem) => void
  onArchiveWorkwearCatalogItem?: (id: string, archived: boolean) => void
  onPostWorkwearIssuance?: (
    input: {
      employeeId: string
      itemId: string
      size: string
      quantity: number
      issueDate: string
      unitPrice?: number
      comment?: string
      issuedBy: string
      issuedByName: string
    },
  ) => PostWorkwearIssueResult
  /** Переход из раздела «Журналы» */
  journalNav?: Extract<import('@/lib/journals/navigate').JournalNavTarget, { view: 'warehouse' }> | null
  onJournalNavConsumed?: () => void
  userWarehouseDefaults?: WarehouseViewDefaults
  currentUserId?: string
  onSaveViewDefaults?: <K extends keyof UserViewDefaults>(
    viewId: K,
    patch: NonNullable<UserViewDefaults[K]>,
  ) => void
}

export type WarehouseTab =
  | 'balances'
  | 'requests'
  | 'nomenclature'
  | 'movements'
  | 'documents'
  | 'inventory'
  | 'loading'
  | 'analytics'
  | 'import'
  | 'audit'
  | 'workwear'

export const WAREHOUSE_TABS: WarehouseTab[] = [
  'balances',
  'requests',
  'nomenclature',
  'workwear',
  'movements',
  'documents',
  'inventory',
  'loading',
  'analytics',
  'import',
  'audit',
]

/** Вкладки облачного кладовщика — выдача, заявки, номенклатура, приход, отгрузка */
export const WAREHOUSE_WEB_TABS: WarehouseTab[] = [
  'balances',
  'requests',
  'nomenclature',
  'workwear',
  'documents',
  'movements',
  'inventory',
  'loading',
  'analytics',
  'import',
  'audit',
]

export { UNIT_CODES as UNITS } from '@/lib/warehouse/units'
