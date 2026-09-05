import { useMemo, useState, useEffect } from 'react'
import { Button } from '@/components/ui/Button'
import { MonthNavigator } from '@/components/ui/MonthNavigator'
import { useI18n } from '@/context/I18nContext'
import { formatMonthTitle } from '@/lib/dates'
import { getFinance } from '@/lib/finance/calc'
import { documentLineTotal, listPayoutDocuments } from '@/lib/finance/payoutDocuments'
import { formatGel } from '@/lib/payroll'
import type { AppStore } from '@/lib/types'
import { PayoutDocumentModal } from './PayoutDocumentModal'
import { FinancePaymentsJournalPanel } from './FinancePaymentsJournalPanel'
import type { FinanceDocumentActions } from './financeTypes'

type Props = {
  store: AppStore
  month: string
  onMonthChange: (m: string) => void
  documentActions: FinanceDocumentActions
  asOfDate?: string
  openDocumentId?: string | null
  onOpenDocumentConsumed?: () => void
}

const STATUS_FILTERS = ['all', 'draft', 'ready', 'paid', 'void'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

const STATUS_CLASS: Record<string, string> = {
  draft: 'bg-stone-100 text-stone-700',
  ready: 'bg-sky-100 text-sky-900',
  paid: 'bg-emerald-100 text-emerald-900',
  posted: 'bg-emerald-100 text-emerald-900',
  void: 'bg-red-50 text-red-800 line-through',
}

export function FinancePayoutDocumentsPanel({
  store,
  month,
  onMonthChange,
  documentActions,
  asOfDate,
  openDocumentId,
  onOpenDocumentConsumed,
}: Props) {
  const { t, locale } = useI18n()
  const [tab, setTab] = useState<'documents' | 'operations'>('documents')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [showArchive, setShowArchive] = useState(false)
  const [editorId, setEditorId] = useState<string | undefined>()
  const [createOpen, setCreateOpen] = useState(false)

  const fin = getFinance(store)

  const documents = useMemo(
    () =>
      listPayoutDocuments(fin, {
        month: showArchive ? undefined : month,
        status: statusFilter === 'all' ? 'all' : statusFilter,
        includeVoid: true,
      }),
    [fin, month, showArchive, statusFilter],
  )

  const docTotals = useMemo(() => {
    let paid = 0
    let ready = 0
    let draft = 0
    for (const d of listPayoutDocuments(fin, { month, includeVoid: false })) {
      const sum = documentLineTotal(d.lines)
      if (d.status === 'paid') paid += sum
      if (d.status === 'ready') ready += sum
      if (d.status === 'draft') draft += sum
    }
    return { paid, ready, draft }
  }, [fin, month])

  useEffect(() => {
    if (openDocumentId) {
      setEditorId(openDocumentId)
      setTab('documents')
      onOpenDocumentConsumed?.()
    }
  }, [openDocumentId, onOpenDocumentConsumed])

  function openDoc(id: string) {
    setEditorId(id)
    setCreateOpen(false)
  }

  function closeEditor() {
    setEditorId(undefined)
    setCreateOpen(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink">{t('fin.payDoc.panelTitle')}</h2>
          <p className="text-sm text-stone-500">
            {showArchive ? t('fin.advDoc.archiveHint') : formatMonthTitle(month, locale)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!showArchive && <MonthNavigator month={month} onChange={onMonthChange} />}
          <Button variant="secondary" size="sm" onClick={() => setCreateOpen(true)}>
            {t('fin.payDoc.new')}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-sm border border-grid bg-white px-4 py-3 shadow-sm">
          <p className="text-xs text-stone-500">{t('fin.advDoc.totalPaid')}</p>
          <p className="font-mono text-lg font-semibold text-emerald-800">{formatGel(docTotals.paid)}</p>
        </div>
        <div className="rounded-sm border border-grid bg-white px-4 py-3 shadow-sm">
          <p className="text-xs text-stone-500">{t('fin.advDoc.totalReady')}</p>
          <p className="font-mono text-lg font-semibold text-sky-800">{formatGel(docTotals.ready)}</p>
        </div>
        <div className="rounded-sm border border-grid bg-white px-4 py-3 shadow-sm">
          <p className="text-xs text-stone-500">{t('fin.advDoc.totalDraft')}</p>
          <p className="font-mono text-lg font-semibold text-stone-700">{formatGel(docTotals.draft)}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(['documents', 'operations'] as const).map((k) => (
          <button
            key={k}
            type="button"
            className={`rounded-sm px-3 py-1.5 text-xs font-semibold ${
              tab === k ? 'bg-teal-700 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
            onClick={() => setTab(k)}
          >
            {t(k === 'documents' ? 'fin.advDoc.tabDocuments' : 'fin.advDoc.tabOperations')}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-xs text-stone-600">
          <input type="checkbox" checked={showArchive} onChange={(e) => setShowArchive(e.target.checked)} />
          {t('fin.advDoc.showArchive')}
        </label>
      </div>

      {tab === 'documents' && (
        <>
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                type="button"
                className={`rounded-sm px-3 py-1.5 text-xs font-semibold ${
                  statusFilter === s
                    ? 'bg-amber-700 text-white'
                    : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                }`}
                onClick={() => setStatusFilter(s)}
              >
                {s === 'all' ? t('finance.payments.filterAll') : t(`fin.advDoc.status.${s}`)}
              </button>
            ))}
          </div>

          <div className="fc-table-wrap">
            <table className="fc-table min-w-full text-sm">
              <thead>
                <tr>
                  <th>{t('fin.advDoc.colNumber')}</th>
                  <th>{t('fin.date')}</th>
                  <th>{t('fin.ledger.month')}</th>
                  <th>{t('fin.advDoc.colStatus')}</th>
                  <th className="text-right">{t('fin.advDoc.colLines')}</th>
                  <th className="text-right">{t('fin.amount')}</th>
                  <th>{t('fin.method')}</th>
                  <th>{t('finance.payments.col.by')}</th>
                </tr>
              </thead>
              <tbody>
                {documents.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-stone-500">
                      {t('fin.payDoc.empty')}
                    </td>
                  </tr>
                ) : (
                  documents.map((d) => (
                    <tr
                      key={d.id}
                      className="cursor-pointer hover:bg-paper-dark"
                      onClick={() => openDoc(d.id)}
                    >
                      <td className="font-mono text-xs font-semibold">{d.number}</td>
                      <td className="font-mono text-xs">{d.date}</td>
                      <td className="text-xs">{formatMonthTitle(d.month, locale)}</td>
                      <td>
                        <span
                          className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${STATUS_CLASS[d.status]}`}
                        >
                          {t(`fin.advDoc.status.${d.status}`)}
                        </span>
                      </td>
                      <td className="text-right font-mono text-xs">{d.lines.length}</td>
                      <td className="text-right font-mono text-xs font-semibold">
                        {formatGel(documentLineTotal(d.lines))}
                      </td>
                      <td className="text-xs">{t(`fin.method.${d.method}`)}</td>
                      <td className="text-xs text-stone-500">{d.byName ?? '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'operations' && (
        <FinancePaymentsJournalPanel
          store={store}
          month={month}
          onMonthChange={onMonthChange}
          asOfDate={asOfDate}
          embedded
        />
      )}

      {(editorId || createOpen) && (
        <PayoutDocumentModal
          store={store}
          documentId={editorId}
          defaultMonth={month}
          actions={documentActions}
          onClose={closeEditor}
        />
      )}
    </div>
  )
}
