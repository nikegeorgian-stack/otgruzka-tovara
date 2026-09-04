import { useMemo, useRef, useState } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { AdvanceAccrualModal } from '@/components/finance/AdvanceAccrualModal'
import { AdvanceDocumentModal } from '@/components/finance/AdvanceDocumentModal'
import { PayoutDocumentModal } from '@/components/finance/PayoutDocumentModal'
import type { FinanceDocumentActions } from '@/components/finance/financeTypes'
import { SalesOrderModal } from '@/components/director/SalesOrderModal'
import {
  WarehouseDocumentEditor,
  type WarehouseDocumentEditorHandle,
} from '@/components/warehouse/WarehouseDocumentEditor'
import { WarehouseInventoryRevisionModal } from '@/components/warehouse/WarehouseInventoryRevisionModal'
import { WarehouseLoadingTab } from '@/components/warehouse/WarehouseLoadingTab'
import { useConfirm } from '@/context/ConfirmContext'
import { useI18n } from '@/context/I18nContext'
import { isDocumentLockedByOther } from '@/lib/warehouse/documentLock'
import { computeAllBalances } from '@/lib/warehouse/stock'
import { requestModalClose } from '@/lib/ui/requestModalClose'
import type { JournalLink } from '@/lib/journals/types'
import type { AppStore } from '@/lib/types'
import type { ProductionRequest } from '@/lib/production/types'
import type { SalesOrder } from '@/lib/sales/types'
import type { WarehousePrintMeta } from '@/lib/warehouse/printDocument'
import type { WarehousePageProps } from '@/components/warehouse/warehouseTypes'
import type { Counterparty } from '@/lib/counterparties/types'
import type { FinishedProduct } from '@/lib/finishedProducts/types'
import type { WarehouseItem } from '@/lib/warehouse/types'

export type JournalOverlayTarget =
  | { kind: 'warehouse_document'; documentId: string; mode?: 'view' | 'edit' }
  | { kind: 'warehouse_loading'; shipmentId: string }
  | { kind: 'finance_advance_document'; documentId: string; month?: string }
  | { kind: 'finance_payout_document'; documentId: string; month?: string }
  | { kind: 'finance_accrual_document'; documentId: string; month?: string }
  | { kind: 'sales_order'; orderId: string }

/** Ссылки, которые открываем окном поверх журнала (как в 1С). */
// eslint-disable-next-line react-refresh/only-export-components -- helper co-located with overlay
export function journalOverlayTarget(link: JournalLink): JournalOverlayTarget | null {
  switch (link.kind) {
    case 'warehouse_document':
      return { kind: 'warehouse_document', documentId: link.documentId }
    case 'warehouse_loading':
      return { kind: 'warehouse_loading', shipmentId: link.shipmentId }
    case 'finance_advance_document':
      return {
        kind: 'finance_advance_document',
        documentId: link.documentId,
        month: link.month,
      }
    case 'finance_payout_document':
      return {
        kind: 'finance_payout_document',
        documentId: link.documentId,
        month: link.month,
      }
    case 'finance_accrual_document':
      return {
        kind: 'finance_accrual_document',
        documentId: link.documentId,
        month: link.month,
      }
    case 'sales_order':
      return { kind: 'sales_order', orderId: link.orderId }
    default:
      return null
  }
}

type WarehouseHandlers = Pick<
  WarehousePageProps,
  | 'onPostDocument'
  | 'onPostTransfer'
  | 'onSaveDocumentDraft'
  | 'onPostExistingDocument'
  | 'onUnpostDocument'
  | 'onAcquireDocumentLock'
  | 'onReleaseDocumentLock'
  | 'onMergeInvoiceRegistry'
  | 'onUpsertCounterparty'
>

type LoadingHandlers = {
  onUpsertLoadingShipment: (
    input: import('@/lib/warehouse/loadingShipments').UpsertLoadingShipmentInput,
  ) => string
  onPostLoadingShipment: (
    shipmentId: string,
    args?: { keeperId?: string; keeperName?: string },
  ) =>
    | import('@/lib/warehouse/loadingShipments').PostLoadingShipmentResult
    | Promise<import('@/lib/warehouse/loadingShipments').PostLoadingShipmentResult>
  onRemoveLoadingShipment: (shipmentId: string) => void
  onUpsertItem: (item: WarehouseItem) => void
  onUpsertFinishedProduct: (fp: FinishedProduct) => void
  onUpsertCounterparty: (c: Counterparty) => void
}

type Props = {
  store: AppStore
  target: JournalOverlayTarget
  onClose: () => void
  brigades: string[]
  productionRequests?: ProductionRequest[]
  printMeta?: WarehousePrintMeta
  allowNegativeStock?: boolean
  keeperId?: string
  keeperName?: string
  warehouse: WarehouseHandlers
  loading?: LoadingHandlers
  financeDocumentActions?: FinanceDocumentActions
  onUpsertSalesOrder?: (order: SalesOrder) => void | SalesOrder | Promise<void | SalesOrder>
  activeMonth: string
}

export function JournalDocumentOverlay({
  store,
  target,
  onClose,
  brigades,
  productionRequests,
  printMeta,
  allowNegativeStock = false,
  keeperId,
  keeperName,
  warehouse: wh,
  loading,
  financeDocumentActions,
  onUpsertSalesOrder,
  activeMonth,
}: Props) {
  const { t } = useI18n()
  const [nestedSalesId, setNestedSalesId] = useState<string | null>(null)

  if (target.kind === 'finance_advance_document' && financeDocumentActions) {
    return (
      <AdvanceDocumentModal
        store={store}
        documentId={target.documentId}
        defaultMonth={target.month ?? activeMonth}
        actions={financeDocumentActions}
        onClose={onClose}
      />
    )
  }
  if (target.kind === 'finance_payout_document' && financeDocumentActions) {
    return (
      <PayoutDocumentModal
        store={store}
        documentId={target.documentId}
        defaultMonth={target.month ?? activeMonth}
        actions={financeDocumentActions}
        onClose={onClose}
      />
    )
  }
  if (target.kind === 'finance_accrual_document' && financeDocumentActions) {
    return (
      <AdvanceAccrualModal
        store={store}
        documentId={target.documentId}
        defaultMonth={target.month ?? activeMonth}
        actions={financeDocumentActions}
        onClose={onClose}
      />
    )
  }
  if (target.kind === 'sales_order' && onUpsertSalesOrder) {
    const order = store.sales.orders.find((o) => o.id === target.orderId)
    if (!order) {
      return (
        <AppDialog open onClose={onClose} title={t('journals.open')} size="md" ephemeral>
          <p className="px-5 py-4 text-sm text-stone-600">{t('journals.docNotFound')}</p>
        </AppDialog>
      )
    }
    return (
      <SalesOrderModal
        order={order}
        counterparties={store.counterparties?.items ?? []}
        finishedProducts={store.finishedProducts?.items ?? []}
        onUpsertCounterparty={wh.onUpsertCounterparty}
        onSave={(o) => {
          onUpsertSalesOrder(o)
          onClose()
        }}
        onClose={onClose}
      />
    )
  }
  if (target.kind === 'warehouse_loading' && loading) {
    const shipment = (store.warehouse.loadingShipments ?? []).find(
      (s) => s.id === target.shipmentId,
    )
    const title = shipment
      ? `${t('journals.docType.loading')} · ${shipment.number}`
      : t('journals.docType.loading')
    const nestedOrder = nestedSalesId
      ? store.sales.orders.find((o) => o.id === nestedSalesId)
      : null
    return (
      <>
        <AppDialog open onClose={onClose} title={title} size="xl" initialFocus="none">
          <div className="max-h-[min(80vh,52rem)] overflow-y-auto px-3 py-3">
            <WarehouseLoadingTab
              warehouse={store.warehouse}
              warehouseId={shipment?.warehouseId || store.warehouse.locations[0]?.id || ''}
              counterparties={store.counterparties?.items ?? []}
              finishedProducts={store.finishedProducts?.items ?? []}
              packagingRecipes={store.packagingRecipes?.items ?? []}
              keeperId={keeperId}
              keeperName={keeperName}
              onUpsertCounterparty={loading.onUpsertCounterparty}
              onUpsertItem={loading.onUpsertItem}
              onUpsertFinishedProduct={loading.onUpsertFinishedProduct}
              onUpsertLoadingShipment={loading.onUpsertLoadingShipment}
              onPostLoadingShipment={loading.onPostLoadingShipment}
              onRemoveLoadingShipment={loading.onRemoveLoadingShipment}
              salesOrders={store.sales.orders}
              onOpenSalesOrder={(id) => setNestedSalesId(id)}
              pendingOpenShipmentId={target.shipmentId}
              dialogMode
            />
          </div>
        </AppDialog>
        {nestedOrder && onUpsertSalesOrder && (
          <SalesOrderModal
            order={nestedOrder}
            counterparties={store.counterparties?.items ?? []}
            finishedProducts={store.finishedProducts?.items ?? []}
            onUpsertCounterparty={loading.onUpsertCounterparty ?? wh.onUpsertCounterparty}
            onSave={(o) => {
              onUpsertSalesOrder(o)
              setNestedSalesId(null)
            }}
            onClose={() => setNestedSalesId(null)}
          />
        )}
      </>
    )
  }
  if (target.kind === 'warehouse_document') {
    return (
      <WarehouseDocOverlay
        store={store}
        documentId={target.documentId}
        preferredMode={target.mode}
        onClose={onClose}
        brigades={brigades}
        productionRequests={productionRequests}
        printMeta={printMeta}
        allowNegativeStock={allowNegativeStock}
        keeperId={keeperId}
        keeperName={keeperName}
        {...wh}
      />
    )
  }
  return null
}

function WarehouseDocOverlay({
  store,
  documentId,
  preferredMode,
  onClose,
  brigades,
  productionRequests,
  printMeta,
  allowNegativeStock,
  keeperId,
  keeperName,
  onPostDocument,
  onPostTransfer,
  onSaveDocumentDraft,
  onPostExistingDocument,
  onUnpostDocument,
  onAcquireDocumentLock,
  onReleaseDocumentLock,
  onMergeInvoiceRegistry,
  onUpsertCounterparty,
}: {
  store: AppStore
  documentId: string
  preferredMode?: 'view' | 'edit'
  onClose: () => void
  brigades: string[]
  productionRequests?: ProductionRequest[]
  printMeta?: WarehousePrintMeta
  allowNegativeStock?: boolean
  keeperId?: string
  keeperName?: string
} & WarehouseHandlers) {
  const { t, tf } = useI18n()
  const { confirmUnsaved } = useConfirm()
  const docEditorRef = useRef<WarehouseDocumentEditorHandle>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const warehouse = store.warehouse
  const doc = warehouse.documents.find((d) => d.id === documentId)
  const whId = doc?.warehouseId || warehouse.locations[0]?.id || ''
  const categoryNames = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of warehouse.categories) m.set(c.id, c.name)
    return m
  }, [warehouse.categories])
  const balances = useMemo(
    () => computeAllBalances(warehouse, whId || undefined),
    // eslint-disable-next-line react-hooks/preserve-manual-memoization -- warehouse object identity from store
    [warehouse, whId],
  )
  const counterparties = store.counterparties?.items ?? []

  if (!doc) {
    return (
      <AppDialog open onClose={onClose} title={t('journals.open')} size="md" ephemeral>
        <p className="px-5 py-4 text-sm text-stone-600">{t('journals.docNotFound')}</p>
      </AppDialog>
    )
  }

  if (doc.type === 'inventory') {
    if (isDocumentLockedByOther(doc, keeperId) || !onSaveDocumentDraft) {
      return (
        <AppDialog open onClose={onClose} title={t('warehouse.doc.type.inventory')} size="md" ephemeral>
          <p className="px-5 py-4 text-sm text-stone-600">
            {isDocumentLockedByOther(doc, keeperId)
              ? tf('warehouse.inventory.lockFailed', { name: doc.lockedByName ?? '—' })
              : t('journals.docNotFound')}
          </p>
        </AppDialog>
      )
    }
    return (
      <WarehouseInventoryRevisionModal
        open
        title={`${t('warehouse.doc.type.inventory')} №${doc.number}`}
        onClose={onClose}
        warehouse={warehouse}
        warehouseId={whId}
        categoryNames={categoryNames}
        document={doc}
        keeperId={keeperId}
        keeperName={keeperName}
        readOnly={doc.status === 'posted' || doc.status === 'cancelled'}
        onSaveDraft={onSaveDocumentDraft}
        onPostExistingDocument={onPostExistingDocument}
        onUnpostDocument={onUnpostDocument}
        onAcquireLock={onAcquireDocumentLock}
        onReleaseLock={onReleaseDocumentLock}
      />
    )
  }

  const status = doc.status ?? 'posted'
  const mode: 'edit' | 'view' =
    preferredMode === 'edit' && status === 'draft' && onSaveDocumentDraft
      ? 'edit'
      : status === 'draft' && onSaveDocumentDraft
        ? 'edit'
        : 'view'

  function requestClose() {
    void requestModalClose(
      { confirmUnsaved },
      {
        isDirty: () => docEditorRef.current?.isDirty() ?? false,
        save: () => docEditorRef.current?.saveDraft() ?? false,
        close: onClose,
      },
    )
  }

  const title =
    mode === 'view'
      ? tf('warehouse.doc.viewTitle', { number: doc.number || '—' })
      : tf('warehouse.doc.editDraftTitle', { number: doc.number || '—' })

  return (
    <AppDialog
      open
      onClose={requestClose}
      title={title}
      size="xl"
      dirty={mode !== 'view'}
      onSaveDirty={
        mode !== 'view'
          ? () => {
              docEditorRef.current?.saveDraft()
            }
          : undefined
      }
      onPrimaryAction={mode === 'view' ? undefined : () => docEditorRef.current?.saveDraft()}
      initialFocus="none"
    >
      <div className="px-4 py-4">
        {notice && (
          <p className="mb-3 rounded-sm border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">
            {notice}
          </p>
        )}
        <WarehouseDocumentEditor
          ref={docEditorRef}
          warehouse={warehouse}
          categoryNames={categoryNames}
          balances={balances}
          brigades={brigades}
          warehouseId={whId}
          variant="modal"
          printMeta={printMeta}
          existingDocument={doc}
          readOnly={mode === 'view'}
          onPost={async (posted) => {
            const draftId = mode === 'edit' ? doc.id : undefined
            if (draftId && onSaveDocumentDraft && onPostExistingDocument) {
              const saved = await Promise.resolve(
                onSaveDocumentDraft({ ...posted, id: draftId }),
              )
              if (!saved.ok) return saved
              const result = await Promise.resolve(onPostExistingDocument(draftId))
              if (result.ok) {
                setNotice(t('warehouse.doc.postSuccess'))
                onClose()
              }
              return result
            }
            const result = await Promise.resolve(onPostDocument(posted))
            if (result.ok) onClose()
            return result
          }}
          onSaveDraft={
            onSaveDocumentDraft && mode !== 'view'
              ? async (draft) => {
                  const result = await Promise.resolve(onSaveDocumentDraft(draft))
                  if (result.ok) {
                    setNotice(t('warehouse.doc.draftSaved'))
                    onClose()
                  }
                  return result
                }
              : undefined
          }
          onPostTransfer={async (transferDoc) => {
            const result =
              (await Promise.resolve(onPostTransfer?.(transferDoc))) ?? {
                ok: false as const,
                error: 'unknown',
              }
            if (result.ok) onClose()
            return result
          }}
          onMergeInvoiceRegistry={onMergeInvoiceRegistry}
          allowNegativeStock={allowNegativeStock}
          counterparties={counterparties}
          onUpsertCounterparty={onUpsertCounterparty}
          productionRequests={productionRequests}
          keeperId={keeperId}
          keeperName={keeperName}
          onCancel={requestClose}
        />
      </div>
    </AppDialog>
  )
}
