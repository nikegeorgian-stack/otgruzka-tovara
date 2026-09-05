import { useMemo, useRef, useState } from 'react'
import { collatorLocale } from '@/i18n/localeFormat'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/Button'
import { useI18n } from '@/context/I18nContext'
import { useModalScope } from '@/hooks/useModalScope'
import {
  advanceDocumentById,
} from '@/lib/finance/advanceDocuments'
import { getFinance } from '@/lib/finance/calc'
import { formatMonthTitle } from '@/lib/dates'
import { isMonthClosed } from '@/lib/monthManage'
import { formatGel } from '@/lib/payroll'
import { runExport } from '@/lib/export'
import {
  buildAccountantHandoffRows,
  copyAccountantHandoff,
} from '@/lib/finance/accountantHandoff'
import { canHandoffExport } from '@/lib/finance/disbursementDocStatus'
import { CHROME_BACKDROP_CLASS } from '@/lib/ui/chromeLayout'
import { getModalPortalRoot } from '@/lib/ui/modalScope'
import type { FinancePaymentMethod } from '@/lib/finance/types'
import type { AppStore } from '@/lib/types'
import type { FinanceDocumentActions } from './financeTypes'
import { PrintAdvanceDisbursementModal } from './PrintAdvanceDisbursementModal'

type Props = {
  store: AppStore
  documentId?: string
  defaultMonth: string
  actions: FinanceDocumentActions
  onClose: () => void
}

type LineDraft = {
  id: string
  employeeId: string
  amount: string
  note: string
}

const METHODS: FinancePaymentMethod[] = ['cash', 'card', 'bank']

export function AdvanceDocumentModal({
  store,
  documentId,
  defaultMonth,
  actions,
  onClose,
}: Props) {
  const { t, locale } = useI18n()
  const fin = getFinance(store)
  const existing = documentId ? advanceDocumentById(fin, documentId) : undefined
  const draftId = existing?.id ?? crypto.randomUUID()
  const readOnly = existing ? existing.status !== 'draft' : false
  const closed = isMonthClosed(store, existing?.month ?? defaultMonth)

  const [month, setMonth] = useState(existing?.month ?? defaultMonth)
  const [date, setDate] = useState(existing?.date ?? new Date().toISOString().slice(0, 10))
  const [method, setMethod] = useState<FinancePaymentMethod>(existing?.method ?? 'cash')
  const [purpose, setPurpose] = useState(existing?.purpose ?? '')
  const [lines, setLines] = useState<LineDraft[]>(
    () =>
      existing?.lines.map((l) => ({
        id: l.id,
        employeeId: l.employeeId,
        amount: String(l.amount),
        note: l.note ?? '',
      })) ?? [],
  )
  const [addEmployeeId, setAddEmployeeId] = useState('')
  const [printOpen, setPrintOpen] = useState(false)
  const [voidReason, setVoidReason] = useState('')
  const [copyNotice, setCopyNotice] = useState<string | null>(null)

  const panelRef = useRef<HTMLDivElement>(null)
  const { zIndex } = useModalScope({
    open: true,
    onClose,
    containerRef: panelRef,
    initialFocus: 'none',
  })

  const total = useMemo(
    () =>
      lines.reduce((s, l) => {
        const n = Number(l.amount.replace(',', '.'))
        return s + (Number.isFinite(n) ? Math.round(n) : 0)
      }, 0),
    [lines],
  )

  const employeesSorted = useMemo(
    () =>
      [...store.employees].sort((a, b) =>
        (a.fullName || '').localeCompare(b.fullName || '', collatorLocale(locale)),
      ),
    [store.employees, locale],
  )

  function buildInput() {
    return {
      id: draftId,
      month,
      date,
      method,
      purpose: purpose.trim() || undefined,
      lines: lines.map((l) => ({
        id: l.id,
        employeeId: l.employeeId,
        amount: Math.round(Number(l.amount.replace(',', '.')) || 0),
        note: l.note.trim() || undefined,
      })),
    }
  }

  function handleSaveDraft() {
    actions.onSaveAdvanceDocument(buildInput())
    onClose()
  }

  function handlePrepare() {
    const input = buildInput()
    actions.onSaveAdvanceDocument(input)
    actions.onPrepareAdvanceDocument(draftId)
    onClose()
  }

  function handleUnprepare() {
    if (!existing) return
    actions.onUnprepareAdvanceDocument(existing.id)
    onClose()
  }

  function handleMarkPaid() {
    if (!existing) return
    actions.onPostAdvanceDocument(existing.id)
    const ids = existing.lines.map((l) => l.employeeId).filter(Boolean)
    void import('@/lib/cloud/fstPushNotify').then(({ notifyEmployeesPush }) =>
      notifyEmployeesPush(
        store.access,
        ids,
        'Первая часть зарплаты',
        'Вам провели первую часть зарплаты. Откройте «Моё», чтобы посмотреть сумму.',
        { kind: 'advance_paid', month },
      ),
    )
    onClose()
  }

  function handleVoid() {
    if (!existing || !window.confirm(t('fin.advDoc.confirmVoid'))) return
    actions.onVoidAdvanceDocument(existing.id, voidReason.trim() || undefined)
    onClose()
  }

  function handleDeleteDraft() {
    if (!existing || !window.confirm(t('fin.advDoc.confirmDelete'))) return
    actions.onDeleteAdvanceDocumentDraft(existing.id)
    onClose()
  }

  async function handleCopyAccounts() {
    if (!existing) return
    const rows = buildAccountantHandoffRows(store, existing.lines, locale)
    const ok = await copyAccountantHandoff(rows, locale)
    setCopyNotice(ok ? t('fin.advDoc.copyOk') : t('fin.advDoc.copyFail'))
  }

  function addEmployee() {
    if (!addEmployeeId || lines.some((l) => l.employeeId === addEmployeeId)) return
    setLines((prev) => [
      ...prev,
      { id: crypto.randomUUID(), employeeId: addEmployeeId, amount: '', note: '' },
    ])
    setAddEmployeeId('')
  }

  const docForPrint =
    existing && canHandoffExport(existing.status) ? existing : null

  return createPortal(
    <>
      <div
        ref={panelRef}
        className={CHROME_BACKDROP_CLASS}
        style={{ zIndex }}
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <div className="app-dialog-panel flex w-full max-w-3xl flex-col overflow-hidden rounded-t-sm border border-grid bg-white shadow-xl sm:rounded-sm">
          <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-grid bg-stone-50 px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-base font-bold text-ink sm:text-lg">
                {existing ? existing.number : t('fin.advDoc.new')}
              </h2>
              <p className="text-sm text-stone-500">
                {t(`fin.advDoc.status.${existing?.status ?? 'draft'}`)}
                {existing?.status === 'void' && existing.voidReason ? ` · ${existing.voidReason}` : ''}
              </p>
            </div>
            <button
              type="button"
              className="rounded-sm p-2 text-stone-400 transition hover:bg-stone-100 hover:text-ink"
              aria-label={t('print.close')}
              onClick={onClose}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
                <path
                  d="M5 5l10 10M15 5L5 15"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </header>

          <div className="app-dialog-body space-y-4 px-4 py-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block text-xs text-stone-500">
                {t('fin.ledger.month')}
                <input
                  type="month"
                  value={month}
                  disabled={readOnly || closed}
                  className="mt-1 w-full rounded-sm border border-grid px-2 py-1.5 text-sm disabled:opacity-50"
                  onChange={(e) => setMonth(e.target.value)}
                />
              </label>
              <label className="block text-xs text-stone-500">
                {t('fin.date')}
                <input
                  type="date"
                  value={date}
                  disabled={readOnly || closed}
                  className="mt-1 w-full rounded-sm border border-grid px-2 py-1.5 text-sm disabled:opacity-50"
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <label className="block text-xs text-stone-500">
                {t('fin.method')}
                <select
                  value={method}
                  disabled={readOnly || closed}
                  className="mt-1 w-full rounded-sm border border-grid px-2 py-1.5 text-sm disabled:opacity-50"
                  onChange={(e) => setMethod(e.target.value as FinancePaymentMethod)}
                >
                  {METHODS.map((m) => (
                    <option key={m} value={m}>
                      {t(`fin.method.${m}`)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block text-xs text-stone-500">
              {t('fin.advDoc.purpose')}
              <input
                type="text"
                value={purpose}
                disabled={readOnly || closed}
                placeholder={`${t('fin.advDoc.purposeDefault')} ${formatMonthTitle(month, locale)}`}
                className="mt-1 w-full rounded-sm border border-grid px-2 py-1.5 text-sm disabled:opacity-50"
                onChange={(e) => setPurpose(e.target.value)}
              />
            </label>

            {!readOnly && !closed && (
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-[12rem] flex-1 text-xs text-stone-500">
                  {t('fin.advDoc.addEmployee')}
                  <select
                    value={addEmployeeId}
                    className="mt-1 w-full rounded-sm border border-grid px-2 py-1.5 text-sm"
                    onChange={(e) => setAddEmployeeId(e.target.value)}
                  >
                    <option value="">—</option>
                    {employeesSorted.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.fullName}
                      </option>
                    ))}
                  </select>
                </label>
                <Button variant="secondary" size="sm" disabled={!addEmployeeId} onClick={addEmployee}>
                  {t('fin.advDoc.addLine')}
                </Button>
              </div>
            )}

            <div className="fc-table-wrap">
              <table className="fc-table min-w-full text-sm">
                <thead>
                  <tr>
                    <th>{t('employees.colName')}</th>
                    <th className="text-right">{t('fin.amount')}</th>
                    <th>{t('fin.note')}</th>
                    {!readOnly && !closed && <th />}
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 ? (
                    <tr>
                      <td colSpan={readOnly ? 3 : 4} className="px-3 py-6 text-center text-stone-400">
                        {t('fin.advDoc.linesEmpty')}
                      </td>
                    </tr>
                  ) : (
                    lines.map((line) => {
                      const emp = store.employees.find((e) => e.id === line.employeeId)
                      return (
                        <tr key={line.id}>
                          <td className="px-2 py-1.5">{emp?.fullName ?? line.employeeId}</td>
                          <td className="px-2 py-1.5 text-right">
                            {readOnly || closed ? (
                              <span className="font-mono">{formatGel(Number(line.amount) || 0)}</span>
                            ) : (
                              <input
                                type="number"
                                min={0}
                                step={1}
                                value={line.amount}
                                className="w-24 rounded-sm border border-grid px-2 py-1 text-right font-mono text-xs"
                                onChange={(e) =>
                                  setLines((prev) =>
                                    prev.map((l) =>
                                      l.id === line.id ? { ...l, amount: e.target.value } : l,
                                    ),
                                  )
                                }
                              />
                            )}
                          </td>
                          <td className="px-2 py-1.5">
                            {readOnly || closed ? (
                              line.note || '—'
                            ) : (
                              <input
                                type="text"
                                value={line.note}
                                className="w-full min-w-[8rem] rounded-sm border border-grid px-2 py-1 text-xs"
                                onChange={(e) =>
                                  setLines((prev) =>
                                    prev.map((l) =>
                                      l.id === line.id ? { ...l, note: e.target.value } : l,
                                    ),
                                  )
                                }
                              />
                            )}
                          </td>
                          {!readOnly && !closed && (
                            <td className="px-2 py-1.5">
                              <button
                                type="button"
                                className="text-xs text-red-600 hover:underline"
                                onClick={() =>
                                  setLines((prev) => prev.filter((l) => l.id !== line.id))
                                }
                              >
                                  {t('common.delete')}
                              </button>
                            </td>
                          )}
                        </tr>
                      )
                    })
                  )}
                </tbody>
                {lines.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-accent/30 font-bold">
                      <td className="px-2 py-2">{t('fin.advDoc.total')}</td>
                      <td className="px-2 py-2 text-right font-mono">{formatGel(total)}</td>
                      <td colSpan={readOnly || closed ? 1 : 2} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {existing && (existing.status === 'paid' || existing.status === 'ready') && !closed && (
              <label className="block text-xs text-stone-500">
                {t('fin.advDoc.voidReason')}
                <input
                  type="text"
                  value={voidReason}
                  className="mt-1 w-full rounded-sm border border-grid px-2 py-1.5 text-sm"
                  onChange={(e) => setVoidReason(e.target.value)}
                />
              </label>
            )}
            {copyNotice ? <p className="text-xs text-teal-700">{copyNotice}</p> : null}
          </div>

          <footer className="app-dialog-footer flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-grid bg-stone-50 px-4 pt-3">
            <div className="flex flex-wrap gap-2">
              {docForPrint && docForPrint.lines.length > 0 && (
                <>
                  <Button variant="secondary" size="sm" onClick={() => setPrintOpen(true)}>
                    {t('fin.advDoc.print')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      void runExport('advance_disbursement', store, {
                        month,
                        locale,
                        documentId: docForPrint.id,
                      })
                    }
                  >
                    {t('fin.advDoc.exportExcel')}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => void handleCopyAccounts()}>
                    {t('fin.advDoc.copyAccounts')}
                  </Button>
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={onClose}>
                {t('print.close')}
              </Button>
              {!readOnly && !closed && (
                <>
                  <Button variant="secondary" size="sm" disabled={!lines.length} onClick={handleSaveDraft}>
                    {t('fin.advDoc.saveDraft')}
                  </Button>
                  <Button size="sm" disabled={!lines.length || total <= 0} onClick={handlePrepare}>
                    {t('fin.advDoc.prepare')}
                  </Button>
                </>
              )}
              {existing?.status === 'draft' && !closed && (
                <Button variant="secondary" size="sm" onClick={handleDeleteDraft}>
                  {t('common.delete')}
                </Button>
              )}
              {existing?.status === 'ready' && !closed && (
                <>
                  <Button variant="secondary" size="sm" onClick={handleUnprepare}>
                    {t('fin.advDoc.unprepare')}
                  </Button>
                  <Button size="sm" onClick={handleMarkPaid}>
                    {t('fin.advDoc.markPaid')}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={handleVoid}>
                    {t('fin.advDoc.void')}
                  </Button>
                </>
              )}
              {existing?.status === 'paid' && !closed && (
                <Button variant="secondary" size="sm" onClick={handleVoid}>
                  {t('fin.advDoc.void')}
                </Button>
              )}
            </div>
          </footer>
        </div>
      </div>

      {printOpen && docForPrint && (
        <PrintAdvanceDisbursementModal
          store={store}
          document={docForPrint}
          printLocale={locale}
          onClose={() => setPrintOpen(false)}
        />
      )}
    </>,
    getModalPortalRoot(),
  )
}
