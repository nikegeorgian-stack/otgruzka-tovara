import { useEffect, useMemo, useState } from 'react'
import { WarehouseDocumentEditor } from '@/components/warehouse/WarehouseDocumentEditor'
import { AppDialog } from '@/components/ui/AppDialog'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useI18n } from '@/context/I18nContext'
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
import { buildDocumentJournalRows } from '@/lib/warehouse/documentJournal'
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
}

export function WarehouseDocumentsTab({
  warehouse,
  brigades,
  warehouseId,
  categoryNames,
  onPostDocument,
  onPostTransfer,
  onCancelDocument,
  printMeta,
  onMergeInvoiceRegistry,
  pendingAiPick,
  onConsumeAiPick,
  allowNegativeStock = false,
  canCancelDocuments = false,
  counterparties,
  onUpsertCounterparty,
  onOpenCounterparties,
  productionRequests,
  keeperId,
  keeperName,
}: Props) {
  const { t, tf } = useI18n()
  const [open, setOpen] = useState(false)
  const [aiPick, setAiPick] = useState<WarehousePickDetail | null>(null)
  const [receiptPrintPreview, setReceiptPrintPreview] = useState<ReceiptPrintModel | null>(null)
  const [issuePrintPreview, setIssuePrintPreview] = useState<IssuePrintModel | null>(null)
  const [filterType, setFilterType] = useState<'all' | 'receipt' | 'issue'>('all')
  const [filterStatus, setFilterStatus] = useState<'all' | 'posted' | 'cancelled'>('posted')
  const [filterPurpose, setFilterPurpose] = useState<WarehouseDocumentPurpose | 'all'>('all')
  const [journalNotice, setJournalNotice] = useState<string | null>(null)
  const [cancelTarget, setCancelTarget] = useState<WarehouseDocument | null>(null)
  const [cancelReason, setCancelReason] = useState('')

  const whId = warehouseId || warehouse.locations[0]?.id || ''
  const balances = useMemo(
    () => computeAllBalances(warehouse, whId || undefined),
    [warehouse, whId],
  )

  const docs = useMemo(() => {
    let list = [...warehouse.documents]
    if (warehouseId) list = list.filter((d) => d.warehouseId === warehouseId)
    if (filterType !== 'all') list = list.filter((d) => d.type === filterType)
    if (filterStatus !== 'all') {
      list = list.filter((d) => (d.status ?? 'posted') === filterStatus)
    }
    if (filterPurpose !== 'all') list = list.filter((d) => d.purpose === filterPurpose)
    return list.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
  }, [warehouse.documents, warehouseId, filterType, filterStatus, filterPurpose])

  const journalRows = useMemo(() => buildDocumentJournalRows(warehouse, docs), [warehouse, docs])
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
    setAiPick(pendingAiPick)
    setOpen(true)
    onConsumeAiPick?.()
  }, [pendingAiPick, onConsumeAiPick])

  function handlePrint(doc: WarehouseDocument) {
    if (!printMeta) return
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
    const result = onCancelDocument(cancelTarget.id, {
      reason: cancelReason.trim() || undefined,
    })
    setCancelTarget(null)
    if (!result.ok) {
      setJournalNotice(t(result.error))
      return
    }
    setJournalNotice(t('warehouse.doc.cancelSuccess'))
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
            {t('warehouse.type')}
            <select
              className="ml-1 rounded-sm border border-grid px-2 py-1.5 text-sm"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as typeof filterType)}
            >
              <option value="all">{t('warehouse.allCategories')}</option>
              <option value="receipt">{t('warehouse.receipt')}</option>
              <option value="issue">{t('warehouse.issue')}</option>
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
              <option value="posted">{t('warehouse.doc.status.posted')}</option>
              <option value="cancelled">{t('warehouse.doc.status.cancelled')}</option>
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
                  'return',
                  'writeoff',
                  'transfer',
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
          onClick={() => {
            setAiPick(null)
            setOpen(true)
          }}
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
                <th className="px-3 py-3">{t('warehouse.doc.status')}</th>
                <th className="px-3 py-3">{t('warehouse.doc.counterparty')}</th>
                <th className="px-3 py-3 text-right">{t('warehouse.doc.total')}</th>
                <th className="px-3 py-3 w-32">{t('warehouse.print.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {journalRows.map(({ doc: d, warehouseName, totalSum }) => (
                <tr
                  key={d.id}
                  className={`border-b border-grid/60 ${d.status === 'cancelled' ? 'opacity-50' : ''}`}
                >
                  <td className="px-4 py-2.5 whitespace-nowrap">{d.date}</td>
                  <td className="px-3 py-2.5 font-medium font-mono text-xs">
                    {d.number}
                    {d.invoiceKey && d.invoiceKey !== d.number && (
                      <span className="block text-[10px] font-normal text-stone-400">
                        RS: {d.invoiceKey}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-stone-600">{warehouseName}</td>
                  <td className="px-3 py-2.5">
                    {d.type === 'receipt' ? t('warehouse.receipt') : t('warehouse.issue')}
                    {d.purpose ? (
                      <span className="block text-[10px] text-stone-400">
                        {t(`warehouse.doc.purpose.${d.purpose}`)}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5">
                    {d.status === 'cancelled' ? (
                      <span className="text-red-700">{t('warehouse.doc.status.cancelled')}</span>
                    ) : (
                      <span className="text-emerald-700">{t('warehouse.doc.status.posted')}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-stone-600">
                    {resolveCounterpartyDisplayName(d, counterparties ?? [], '') ||
                      d.keeperName ||
                      '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {totalSum > 0 ? `${formatQty(totalSum)} ₾` : '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col gap-1">
                      {printMeta && d.status !== 'cancelled' && (
                        <button
                          type="button"
                          className="text-xs font-semibold text-teal-700 hover:underline text-left"
                          onClick={() => handlePrint(d)}
                        >
                          {t('warehouse.print.previewBtn')}
                        </button>
                      )}
                      {onCancelDocument && canCancelDocuments && documentCanBeCancelled(d) && (
                        <button
                          type="button"
                          className="text-xs font-semibold text-red-700 hover:underline text-left"
                          onClick={() => handleCancel(d)}
                        >
                          {t('warehouse.doc.cancel')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-stone-50 text-xs font-medium text-stone-600">
                <td colSpan={6} className="px-4 py-2">
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
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-sm bg-white shadow-sm">
            <div className="border-b border-grid px-6 py-4">
              <h3 className="text-lg font-bold">{t('warehouse.doc.new')}</h3>
            </div>
            <div className="overflow-auto px-4 py-4">
              <WarehouseDocumentEditor
                warehouse={warehouse}
                categoryNames={categoryNames}
                balances={balances}
                brigades={brigades}
                warehouseId={whId}
                variant="modal"
                printMeta={printMeta}
                initialType={aiPick?.type}
                initialPickSearch={aiPick?.query}
                initialPickOpen={Boolean(aiPick?.query)}
                onPost={(doc) => {
                  const result = onPostDocument(doc)
                  if (result.ok) {
                    setOpen(false)
                    setAiPick(null)
                  }
                  return result
                }}
                onPostTransfer={(doc) => {
                  const result = onPostTransfer?.(doc) ?? { ok: false as const, error: 'unknown' }
                  if (result.ok) {
                    setOpen(false)
                    setAiPick(null)
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
                onCancel={() => {
                  setOpen(false)
                  setAiPick(null)
                }}
              />
            </div>
          </div>
        </div>
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
          zIndex={160}
          onClose={() => setCancelTarget(null)}
          title={t('warehouse.doc.cancelTitle')}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setCancelTarget(null)}>
                {t('common.cancel')}
              </Button>
              <Button variant="danger" size="sm" onClick={confirmCancel}>
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
                  if (e.key === 'Enter') confirmCancel()
                }}
              />
            </label>
          </div>
        </AppDialog>
      )}
    </div>
  )
}
