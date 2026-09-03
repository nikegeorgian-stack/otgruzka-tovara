import { useEffect, useMemo, useRef, useState } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { WarehouseDocumentEditor, type WarehouseDocumentEditorHandle } from '@/components/warehouse/WarehouseDocumentEditor'
import { WarehouseInventoryRevisionModal } from '@/components/warehouse/WarehouseInventoryRevisionModal'
import { Button } from '@/components/ui/Button'
import { CreateLinkedTaskButton } from '@/components/tasks/CreateLinkedTaskButton'
import { Input } from '@/components/ui/Input'
import { useI18n } from '@/context/I18nContext'
import type { AccessStore, AppUser } from '@/lib/access/types'
import { draftFromWarehouseReceipt } from '@/lib/tasks/linkRefs'
import type { WorkTaskDraft } from '@/lib/tasks/types'
import type { WarehousePickDetail } from '@/lib/ai/warehousePickEvent'
import {
  buildIssuePrintModelFromDocument,
  buildReceiptPrintModelFromDocument,
  type IssuePrintModel,
  type ReceiptPrintModel,
} from '@/lib/warehouse/printDocument'
import { WarehouseIssuePrintPreview } from '@/components/warehouse/WarehouseIssuePrintPreview'
import { WarehouseReceiptPrintPreview } from '@/components/warehouse/WarehouseReceiptPrintPreview'
import { computeAllBalances, formatQty } from '@/lib/warehouse/stock'
import { isDocumentLockedByOther } from '@/lib/warehouse/documentLock'
import {
  buildDocumentCardMeta,
  documentSourceKind,
  isAutomaticDocument,
  queryDocumentJournal,
  type JournalSourceFilter,
} from '@/lib/warehouse/documentJournalQuery'
import {
  documentCanBeCancelled,
  resolveCounterpartyDisplayName,
} from '@/lib/warehouse/documentValidation'
import type { WarehouseDocument, WarehouseDocumentPurpose } from '@/lib/warehouse/types'
import type { WarehousePageProps } from './warehouseTypes'

type Props = Pick<
  WarehousePageProps,
  | 'warehouse'
  | 'brigades'
  | 'onPostDocument'
  | 'onPostTransfer'
  | 'onCancelDocument'
  | 'onSaveDocumentDraft'
  | 'onPostExistingDocument'
  | 'onRemoveDocumentDraft'
  | 'onAcquireDocumentLock'
  | 'onReleaseDocumentLock'
  | 'onQuickEditItem'
  | 'onMergeInvoiceRegistry'
  | 'printMeta'
  | 'allowNegativeStock'
  | 'canCancelDocuments'
  | 'counterparties'
  | 'onUpsertCounterparty'
  | 'onOpenCounterparties'
  | 'productionRequests'
  | 'keeperId'
  | 'keeperName'
> & {
  warehouseId: string
  categoryNames: Map<string, string>
  pendingAiPick?: WarehousePickDetail | null
  onConsumeAiPick?: () => void
  /** Открыть документ из общего журнала */
  pendingOpenDocumentId?: string | null
  onPendingOpenConsumed?: () => void
  access?: AccessStore
  currentUser?: AppUser | null
  onCreateWorkTask?: (draft: WorkTaskDraft) => string
}

type DocModalState =
  | { mode: 'new'; aiPick?: WarehousePickDetail | null }
  | { mode: 'edit'; doc: WarehouseDocument }
  | { mode: 'view'; doc: WarehouseDocument }

function srcNumber(
  warehouse: WarehousePageProps['warehouse'],
  id: string,
): string {
  return warehouse.documents.find((d) => d.id === id)?.number ?? id.slice(0, 8)
}

export function WarehouseDocumentsTab({
  warehouse,
  brigades,
  warehouseId,
  categoryNames,
  onPostDocument,
  onPostTransfer,
  onCancelDocument,
  onSaveDocumentDraft,
  onPostExistingDocument,
  onRemoveDocumentDraft,
  onAcquireDocumentLock,
  onReleaseDocumentLock,
  onQuickEditItem,
  printMeta,
  onMergeInvoiceRegistry,
  pendingAiPick,
  onConsumeAiPick,
  pendingOpenDocumentId,
  onPendingOpenConsumed,
  allowNegativeStock = false,
  canCancelDocuments = false,
  counterparties,
  onUpsertCounterparty,
  onOpenCounterparties,
  productionRequests,
  keeperId,
  keeperName,
  access,
  currentUser,
  onCreateWorkTask,
}: Props) {
  const { t, tf } = useI18n()
  const docEditorRef = useRef<WarehouseDocumentEditorHandle>(null)
  const [docModal, setDocModal] = useState<DocModalState | null>(null)
  const [docDirty, setDocDirty] = useState(false)
  const [receiptPrintPreview, setReceiptPrintPreview] = useState<ReceiptPrintModel | null>(null)
  const [issuePrintPreview, setIssuePrintPreview] = useState<IssuePrintModel | null>(null)
  const [filterType, setFilterType] = useState<'all' | 'receipt' | 'issue' | 'inventory'>('all')
  const [filterStatus, setFilterStatus] = useState<'all' | 'draft' | 'posted' | 'cancelled'>(
    'all',
  )
  const [filterPurpose, setFilterPurpose] = useState<WarehouseDocumentPurpose | 'all'>('all')
  const [filterSource, setFilterSource] = useState<JournalSourceFilter>('all')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [journalNotice, setJournalNotice] = useState<string | null>(null)
  const [cancelTarget, setCancelTarget] = useState<WarehouseDocument | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [inventoryEditDoc, setInventoryEditDoc] = useState<WarehouseDocument | null>(null)

  const whId = warehouseId || warehouse.locations[0]?.id || ''
  const balances = useMemo(
    () => computeAllBalances(warehouse, whId || undefined),
    [warehouse, whId],
  )

  const journalRows = useMemo(
    () =>
      queryDocumentJournal(warehouse, {
        warehouseId: warehouseId || undefined,
        type: filterType,
        status: filterStatus,
        purpose: filterPurpose,
        source: filterSource,
        search,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      }),
    [
      warehouse,
      warehouseId,
      filterType,
      filterStatus,
      filterPurpose,
      filterSource,
      search,
      dateFrom,
      dateTo,
    ],
  )
  const docs = useMemo(() => journalRows.map((r) => r.doc), [journalRows])
  const journalTotals = useMemo(
    () =>
      journalRows.reduce(
        (acc, row) => ({
          count: acc.count + 1,
          lines: acc.lines + row.lineCount,
          sum: acc.sum + row.totalSum,
        }),
        { count: 0, lines: 0, sum: 0 },
      ),
    [journalRows],
  )

  useEffect(() => {
    if (!pendingAiPick?.query) return
    setDocModal({ mode: 'new', aiPick: pendingAiPick })
    onConsumeAiPick?.()
  }, [pendingAiPick, onConsumeAiPick])

  useEffect(() => {
    if (!pendingOpenDocumentId) return
    const doc = warehouse.documents.find((d) => d.id === pendingOpenDocumentId)
    if (!doc) {
      onPendingOpenConsumed?.()
      return
    }
    openDocumentForEdit(doc)
    onPendingOpenConsumed?.()
  }, [pendingOpenDocumentId])

  function handlePrint(doc: WarehouseDocument) {
    if (!printMeta) return
    if (doc.type === 'reservation') {
      setJournalNotice(t('warehouse.doc.reservationPrintNotice'))
      return
    }
    if (doc.type === 'receipt') {
      const model = buildReceiptPrintModelFromDocument(warehouse, doc, printMeta, {
        productionRequests,
        counterparties,
      })
      if (model) setReceiptPrintPreview(model)
      return
    }
    const model = buildIssuePrintModelFromDocument(warehouse, doc, printMeta, {
      productionRequests,
      counterparties,
    })
    if (model) setIssuePrintPreview(model)
  }

  function handleCancel(doc: WarehouseDocument) {
    if (!onCancelDocument) return
    setCancelReason('')
    setCancelTarget(doc)
  }

  function confirmCancel() {
    if (!onCancelDocument || !cancelTarget) return
    const reason = cancelReason.trim()
    if (!reason) {
      setJournalNotice(t('warehouse.doc.errCancelReasonRequired'))
      return
    }
    const result = onCancelDocument(cancelTarget.id, { reason })
    setCancelTarget(null)
    if (!result.ok) {
      setJournalNotice(t(result.error))
      return
    }
    setJournalNotice(t('warehouse.doc.cancelSuccess'))
  }

  function handlePostExisting(doc: WarehouseDocument) {
    if (!onPostExistingDocument) return
    if (!window.confirm(t('warehouse.doc.postConfirm'))) return
    const result = onPostExistingDocument(doc.id)
    setJournalNotice(result.ok ? t('warehouse.doc.postSuccess') : t(result.error))
  }

  function handleRemoveDraft(doc: WarehouseDocument) {
    if (!onRemoveDocumentDraft) return
    const result = onRemoveDocumentDraft(doc.id)
    setJournalNotice(result.ok ? t('warehouse.doc.draftRemoved') : t(result.error))
  }

  function openDocumentForEdit(doc: WarehouseDocument) {
    if (doc.type === 'inventory') {
      if (isDocumentLockedByOther(doc, keeperId)) {
        setJournalNotice(
          tf('warehouse.inventory.lockFailed', { name: doc.lockedByName ?? '—' }),
        )
        return
      }
      setInventoryEditDoc(doc)
      return
    }
    const status = doc.status ?? 'posted'
    if (status === 'draft' && onSaveDocumentDraft) {
      setDocModal({ mode: 'edit', doc })
      return
    }
    if (status === 'posted' || status === 'cancelled') {
      setDocModal({ mode: 'view', doc })
    }
  }

  function closeDocModal() {
    setDocModal(null)
    setDocDirty(false)
  }

  function docTypeLabel(type: WarehouseDocument['type']) {
    if (type === 'inventory') return t('warehouse.doc.type.inventory')
    if (type === 'reservation') return t('warehouse.doc.type.reservation')
    if (type === 'receipt') return t('warehouse.receipt')
    return t('warehouse.issue')
  }

  function docModalTitle(): string {
    if (!docModal) return ''
    if (docModal.mode === 'new') {
      const typ = docModal.aiPick?.type
      if (typ === 'issue') return t('warehouse.issue')
      if (typ === 'receipt') return t('warehouse.receipt')
      return t('warehouse.doc.new')
    }
    if (docModal.mode === 'view') {
      return tf('warehouse.doc.viewTitle', { number: docModal.doc.number || '—' })
    }
    return tf('warehouse.doc.editDraftTitle', { number: docModal.doc.number || '—' })
  }

  return (
    <div className="space-y-4">
      {journalNotice && (
        <p className="rounded-sm border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">
          {journalNotice}
          <button type="button" className="ml-2 text-xs underline" onClick={() => setJournalNotice(null)}>
            ×
          </button>
        </p>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <label className="text-xs text-stone-500">
            {t('warehouse.doc.search')}
            <Input
              className="ml-1 min-w-[12rem]"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('warehouse.doc.searchPlaceholder')}
            />
          </label>
          <label className="text-xs text-stone-500">
            {t('warehouse.doc.dateFrom')}
            <input
              type="date"
              className="ml-1 rounded-sm border border-grid px-2 py-1.5 text-sm"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <label className="text-xs text-stone-500">
            {t('warehouse.doc.dateTo')}
            <input
              type="date"
              className="ml-1 rounded-sm border border-grid px-2 py-1.5 text-sm"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
          <label className="text-xs text-stone-500">
            {t('warehouse.type')}
            <select
              className="ml-1 rounded-sm border border-grid px-2 py-1.5 text-sm"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as typeof filterType)}
            >
              <option value="all">{t('warehouse.allCategories')}</option>
              <option value="receipt">{t('warehouse.receipt')}</option>
              <option value="issue">{t('warehouse.issue')}</option>
              <option value="inventory">{t('warehouse.doc.type.inventory')}</option>
              <option value="reservation">{t('warehouse.doc.type.reservation')}</option>
            </select>
          </label>
          <label className="text-xs text-stone-500">
            {t('warehouse.doc.status')}
            <select
              className="ml-1 rounded-sm border border-grid px-2 py-1.5 text-sm"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
            >
              <option value="all">{t('warehouse.allCategories')}</option>
              <option value="draft">{t('warehouse.doc.status.draft')}</option>
              <option value="posted">{t('warehouse.doc.status.posted')}</option>
              <option value="cancelled">{t('warehouse.doc.status.cancelled')}</option>
            </select>
          </label>
          <label className="text-xs text-stone-500">
            {t('warehouse.doc.source')}
            <select
              className="ml-1 rounded-sm border border-grid px-2 py-1.5 text-sm"
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value as JournalSourceFilter)}
            >
              <option value="all">{t('warehouse.allCategories')}</option>
              {(
                [
                  'manual',
                  'production',
                  'batch',
                  'transfer',
                  'loading',
                  'opening',
                  'reversal',
                  'procurement',
                ] as JournalSourceFilter[]
              )
                .filter((s) => s !== 'all')
                .map((s) => (
                  <option key={s} value={s}>
                    {t(`warehouse.doc.source.${s}`)}
                  </option>
                ))}
            </select>
          </label>
          <label className="text-xs text-stone-500">
            {t('warehouse.doc.purpose')}
            <select
              className="ml-1 rounded-sm border border-grid px-2 py-1.5 text-sm"
              value={filterPurpose}
              onChange={(e) =>
                setFilterPurpose(e.target.value as WarehouseDocumentPurpose | 'all')
              }
            >
              <option value="all">{t('warehouse.allCategories')}</option>
              {(
                [
                  'purchase',
                  'production_issue',
                  'production_receipt',
                  'loading',
                  'return',
                  'writeoff',
                  'transfer',
                  'opening_inventory',
                  'other',
                ] as WarehouseDocumentPurpose[]
              ).map((p) => (
                <option key={p} value={p}>
                  {t(`warehouse.doc.purpose.${p}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          type="button"
          className="rounded-sm bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
          onClick={() => setDocModal({ mode: 'new' })}
        >
          {t('warehouse.doc.new')}
        </button>
      </div>
      {docs.length === 0 ? (
        <p className="rounded-sm border border-dashed border-stone-300 bg-stone-50/50 px-6 py-12 text-center text-sm text-stone-500">
          {t('warehouse.doc.empty')}
        </p>
      ) : (
        <div className="overflow-hidden rounded-sm border border-grid bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-grid bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                <th className="px-4 py-3">{t('warehouse.date')}</th>
                <th className="px-3 py-3">{t('warehouse.doc.number')}</th>
                <th className="px-3 py-3">{t('warehouse.location')}</th>
                <th className="px-3 py-3">{t('warehouse.type')}</th>
                <th className="px-3 py-3">{t('warehouse.doc.source')}</th>
                <th className="px-3 py-3">{t('warehouse.doc.status')}</th>
                <th className="px-3 py-3">{t('warehouse.doc.lines')}</th>
                <th className="px-3 py-3">{t('warehouse.doc.counterparty')}</th>
                <th className="px-3 py-3 text-right">{t('warehouse.doc.total')}</th>
                <th className="px-3 py-3 w-32">{t('warehouse.print.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {journalRows.map(({ doc: d, warehouseName, totalSum, lineCount }) => (
                <tr
                  key={d.id}
                  className={`border-b border-grid/60 cursor-pointer hover:bg-stone-50 ${
                    d.status === 'cancelled'
                      ? 'opacity-50'
                      : d.status === 'draft'
                        ? 'bg-amber-50/40'
                        : ''
                  }`}
                  title={t('warehouse.doc.clickOpen')}
                  onClick={() => openDocumentForEdit(d)}
                >
                  <td className="px-4 py-2.5 whitespace-nowrap">{d.date}</td>
                  <td className="px-3 py-2.5 font-medium font-mono text-xs">
                    {d.number}
                    {isAutomaticDocument(d) ? (
                      <span className="ml-1 rounded bg-sky-100 px-1 text-[10px] text-sky-800">
                        auto
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 text-stone-600">{warehouseName}</td>
                  <td className="px-3 py-2.5">
                    {docTypeLabel(d.type)}
                    {d.purpose && d.type !== 'inventory' ? (
                      <span className="block text-[10px] text-stone-400">
                        {t(`warehouse.doc.purpose.${d.purpose}`)}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-stone-600">
                    {t(`warehouse.doc.source.${documentSourceKind(d)}`)}
                  </td>
                  <td className="px-3 py-2.5">
                    {d.status === 'cancelled' ? (
                      <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800">
                        {t('warehouse.doc.status.cancelled')}
                      </span>
                    ) : d.status === 'draft' ? (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">
                        {isDocumentLockedByOther(d, keeperId)
                          ? tf('warehouse.inventory.lockedBy', { name: d.lockedByName ?? '—' })
                          : t('warehouse.doc.status.draft')}
                      </span>
                    ) : (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800">
                        {t('warehouse.doc.status.posted')}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-stone-600">{lineCount}</td>
                  <td className="px-3 py-2.5 text-stone-600">
                    {resolveCounterpartyDisplayName(d, counterparties ?? [], '') ||
                      d.keeperName ||
                      '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {totalSum > 0 ? `${formatQty(totalSum)} ₾` : '—'}
                  </td>
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <div className="flex flex-col gap-1">
                      {printMeta && (d.type === 'receipt' || d.type === 'issue') && (
                        <button
                          type="button"
                          className="text-xs font-semibold text-teal-700 hover:underline text-left"
                          onClick={() => handlePrint(d)}
                        >
                          {t('warehouse.print.previewBtn')}
                        </button>
                      )}
                      {d.status === 'draft' && onPostExistingDocument && (
                        <button
                          type="button"
                          className="text-xs font-semibold text-emerald-700 hover:underline text-left"
                          onClick={() => handlePostExisting(d)}
                        >
                          {t('warehouse.doc.post')}
                        </button>
                      )}
                      {d.status === 'draft' && onRemoveDocumentDraft && (
                        <button
                          type="button"
                          className="text-xs font-semibold text-red-700 hover:underline text-left"
                          onClick={() => handleRemoveDraft(d)}
                        >
                          {t('warehouse.doc.deleteDraft')}
                        </button>
                      )}
                      {onCancelDocument &&
                        canCancelDocuments &&
                        (d.status ?? 'posted') === 'posted' &&
                        documentCanBeCancelled(d) && (
                          <button
                            type="button"
                            className="text-xs font-semibold text-red-700 hover:underline text-left"
                            onClick={() => handleCancel(d)}
                          >
                            {t('warehouse.doc.cancel')}
                          </button>
                        )}
                      {d.reversesDocumentId && (
                        <button
                          type="button"
                          className="text-xs font-semibold text-stone-600 hover:underline text-left"
                          onClick={() => {
                            const src = warehouse.documents.find((x) => x.id === d.reversesDocumentId)
                            if (src) openDocumentForEdit(src)
                          }}
                        >
                          {t('warehouse.doc.linkOriginal')}
                        </button>
                      )}
                      {d.reversalDocumentId && (
                        <button
                          type="button"
                          className="text-xs font-semibold text-stone-600 hover:underline text-left"
                          onClick={() => {
                            const rev = warehouse.documents.find((x) => x.id === d.reversalDocumentId)
                            if (rev) openDocumentForEdit(rev)
                          }}
                        >
                          {t('warehouse.doc.linkReversal')}
                        </button>
                      )}
                      {d.type === 'receipt' &&
                        (d.status ?? 'posted') === 'posted' &&
                        access &&
                        currentUser &&
                        onCreateWorkTask ? (
                          <CreateLinkedTaskButton
                            draft={draftFromWarehouseReceipt({
                              documentId: d.id,
                              documentNumber: d.number,
                              createdBy: currentUser.id,
                              createdByName: currentUser.displayName,
                            })}
                            access={access}
                            currentUser={currentUser}
                            onCreate={onCreateWorkTask}
                            labelKey="tasks.link.receiptDiscrepancy"
                          />
                        ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-stone-50 text-xs font-medium text-stone-600">
                <td colSpan={8} className="px-4 py-2">
                  {tf('warehouse.doc.journalSummary', {
                    count: String(journalTotals.count),
                    lines: String(journalTotals.lines),
                  })}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {journalTotals.sum > 0 ? `${formatQty(journalTotals.sum)} ₾` : '—'}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {inventoryEditDoc && onSaveDocumentDraft && (
        <WarehouseInventoryRevisionModal
          open
          title={`${t('warehouse.doc.type.inventory')} №${inventoryEditDoc.number}`}
          onClose={() => setInventoryEditDoc(null)}
          warehouse={warehouse}
          warehouseId={whId}
          categoryNames={categoryNames}
          document={inventoryEditDoc}
          keeperId={keeperId}
          keeperName={keeperName}
          readOnly={
            inventoryEditDoc.status === 'posted' || inventoryEditDoc.status === 'cancelled'
          }
          onSaveDraft={onSaveDocumentDraft}
          onPostExistingDocument={onPostExistingDocument}
          onCancelDocument={canCancelDocuments ? onCancelDocument : undefined}
          onAcquireLock={onAcquireDocumentLock}
          onReleaseLock={onReleaseDocumentLock}
          onQuickEditItem={onQuickEditItem}
        />
      )}
      {docModal && (
        <AppDialog
          open
          onClose={closeDocModal}
          title={docModalTitle()}
          size="preview"
          dirty={docModal.mode !== 'view' && docDirty}
          onSaveDirty={async () => {
            const ok = docEditorRef.current?.saveDraft()
            if (ok === false) throw new Error('draft_save_failed')
          }}
          onPrimaryAction={
            docModal.mode === 'view' ? undefined : () => docEditorRef.current?.saveDraft()
          }
          initialFocus="none"
        >
          <div className="px-4 py-3">
            {docModal.mode === 'view' && (
              <div className="mb-3 space-y-2">
                <p className="rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {t('warehouse.doc.immutableNotice')}
                </p>
                {(() => {
                  const meta = buildDocumentCardMeta(warehouse, docModal.doc)
                  return (
                    <dl className="grid gap-2 rounded-sm border border-grid bg-stone-50 px-3 py-2 text-xs text-stone-700 sm:grid-cols-2">
                      <div>
                        <dt className="text-stone-400">{t('warehouse.doc.source')}</dt>
                        <dd>{t(`warehouse.doc.source.${meta.sourceKind}`)}</dd>
                      </div>
                      <div>
                        <dt className="text-stone-400">{t('warehouse.doc.revision')}</dt>
                        <dd>{meta.revision}</dd>
                      </div>
                      <div>
                        <dt className="text-stone-400">{t('warehouse.doc.createdAt')}</dt>
                        <dd>{meta.createdLabel}</dd>
                      </div>
                      <div>
                        <dt className="text-stone-400">{t('warehouse.doc.postedAt')}</dt>
                        <dd>{meta.postedLabel}</dd>
                      </div>
                      {meta.originalId ? (
                        <div>
                          <dt className="text-stone-400">{t('warehouse.doc.linkOriginal')}</dt>
                          <dd>
                            <button
                              type="button"
                              className="text-teal-700 underline"
                              onClick={() => {
                                const src = warehouse.documents.find((x) => x.id === meta.originalId)
                                if (src) openDocumentForEdit(src)
                              }}
                            >
                              {srcNumber(warehouse, meta.originalId)}
                            </button>
                          </dd>
                        </div>
                      ) : null}
                      {meta.reversalId ? (
                        <div>
                          <dt className="text-stone-400">{t('warehouse.doc.linkReversal')}</dt>
                          <dd>
                            <button
                              type="button"
                              className="text-teal-700 underline"
                              onClick={() => {
                                const rev = warehouse.documents.find((x) => x.id === meta.reversalId)
                                if (rev) openDocumentForEdit(rev)
                              }}
                            >
                              {srcNumber(warehouse, meta.reversalId)}
                            </button>
                          </dd>
                        </div>
                      ) : null}
                      {meta.cancellationReason ? (
                        <div className="sm:col-span-2">
                          <dt className="text-stone-400">{t('warehouse.doc.cancelReasonLabel')}</dt>
                          <dd>{meta.cancellationReason}</dd>
                        </div>
                      ) : null}
                      {meta.technical.idempotencyKey ? (
                        <div className="sm:col-span-2 font-mono text-[10px] text-stone-400">
                          idempotency: {meta.technical.idempotencyKey}
                        </div>
                      ) : null}
                    </dl>
                  )
                })()}
              </div>
            )}
            <WarehouseDocumentEditor
              ref={docEditorRef}
              warehouse={warehouse}
              categoryNames={categoryNames}
              balances={balances}
              brigades={brigades}
              warehouseId={whId}
              variant="modal"
              lockType={docModal.mode !== 'new' || Boolean(docModal.aiPick?.type)}
              printMeta={printMeta}
              initialType={docModal.mode === 'new' ? docModal.aiPick?.type : undefined}
              initialPickSearch={docModal.mode === 'new' ? docModal.aiPick?.query : undefined}
              initialPickOpen={docModal.mode === 'new' ? Boolean(docModal.aiPick?.query) : false}
              existingDocument={docModal.mode !== 'new' ? docModal.doc : null}
              readOnly={docModal.mode === 'view'}
              onDirtyChange={setDocDirty}
              onPost={(doc) => {
                const draftId = docModal.mode === 'edit' ? docModal.doc.id : undefined
                if (draftId && onSaveDocumentDraft && onPostExistingDocument) {
                  const saved = onSaveDocumentDraft({ ...doc, id: draftId })
                  if (!saved.ok) return saved
                  const result = onPostExistingDocument(draftId)
                  if (result.ok) {
                    closeDocModal()
                    setJournalNotice(t('warehouse.doc.postSuccess'))
                  }
                  return result
                }
                const result = onPostDocument(doc)
                if (result.ok) {
                  closeDocModal()
                }
                return result
              }}
              onSaveDraft={
                onSaveDocumentDraft && docModal.mode !== 'view'
                  ? (doc) => {
                      const result = onSaveDocumentDraft(doc)
                      if (result.ok) {
                        closeDocModal()
                        setJournalNotice(t('warehouse.doc.draftSaved'))
                      }
                      return result
                    }
                  : undefined
              }
              onPostTransfer={(doc) => {
                const result = onPostTransfer?.(doc) ?? { ok: false as const, error: 'unknown' }
                if (result.ok) {
                  closeDocModal()
                }
                return result
              }}
              onMergeInvoiceRegistry={onMergeInvoiceRegistry}
              allowNegativeStock={allowNegativeStock}
              counterparties={counterparties}
              onUpsertCounterparty={onUpsertCounterparty}
              onOpenCounterparties={onOpenCounterparties}
              productionRequests={productionRequests}
              keeperId={keeperId}
              keeperName={keeperName}
              onCancel={closeDocModal}
            />
          </div>
        </AppDialog>
      )}
      {receiptPrintPreview && (
        <WarehouseReceiptPrintPreview
          model={receiptPrintPreview}
          onClose={() => setReceiptPrintPreview(null)}
        />
      )}
      {issuePrintPreview && (
        <WarehouseIssuePrintPreview
          model={issuePrintPreview}
          onClose={() => setIssuePrintPreview(null)}
        />
      )}
      {cancelTarget && (
        <AppDialog
          open
          size="md"
          onClose={() => setCancelTarget(null)}
          title={t('warehouse.doc.cancelTitle')}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setCancelTarget(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={!cancelReason.trim()}
                onClick={confirmCancel}
              >
                {t('warehouse.doc.cancelConfirm')}
              </Button>
            </div>
          }
        >
          <div className="space-y-3 px-5 py-4">
            <p className="text-sm text-stone-600">{cancelTarget.number || cancelTarget.id}</p>
            <label className="block text-sm">
              <span className="mb-1 block text-stone-500">
                {t('warehouse.doc.cancelReasonLabel')}
              </span>
              <Input
                autoFocus
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && cancelReason.trim()) confirmCancel()
                }}
              />
            </label>
          </div>
        </AppDialog>
      )}
    </div>
  )
}
