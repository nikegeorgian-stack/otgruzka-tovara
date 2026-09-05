import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useI18n } from '@/context/I18nContext'
import { useConfirm } from '@/context/ConfirmContext'
import { useModalScope } from '@/hooks/useModalScope'
import {
  accrualLineTotal,
  advanceAccrualById,
  defaultAdvancePercent,
} from '@/lib/finance/advanceAccrual'
import { getFinance } from '@/lib/finance/calc'
import { formatMonthTitle } from '@/lib/dates'
import { formatGel } from '@/lib/payroll'
import { CHROME_BACKDROP_CLASS } from '@/lib/ui/chromeLayout'
import { getModalPortalRoot } from '@/lib/ui/modalScope'
import type { AppStore } from '@/lib/types'
import type { FinanceDocumentActions } from './financeTypes'

type Props = {
  store: AppStore
  documentId: string
  defaultMonth: string
  actions: FinanceDocumentActions
  onClose: () => void
}

type DraftLine = {
  id: string
  employeeId: string
  amount: string
  mode: 'percent' | 'fixed'
  percent?: number
  salaryBase?: number
  note?: string
}

export function AdvanceAccrualModal({
  store,
  documentId,
  defaultMonth,
  actions,
  onClose,
}: Props) {
  const { t, locale } = useI18n()
  const { confirm } = useConfirm()
  const fin = getFinance(store)
  const existing = advanceAccrualById(fin, documentId)
  const defaultPct = defaultAdvancePercent(store)
  const readOnly = !existing || existing.status !== 'draft'

  const [draftLines, setDraftLines] = useState<DraftLine[]>(() =>
    (existing?.lines ?? []).map((l) => ({
      id: l.id,
      employeeId: l.employeeId,
      amount: String(l.amount),
      mode: l.mode,
      percent: l.percent,
      salaryBase: l.salaryBase,
      note: l.note,
    })),
  )

  const panelRef = useRef<HTMLDivElement>(null)
  const { zIndex } = useModalScope({
    open: true,
    onClose,
    containerRef: panelRef,
    initialFocus: 'none',
  })

  const editSum = useMemo(
    () =>
      draftLines.reduce((s, l) => s + (Math.round(Number(String(l.amount).replace(',', '.')) || 0)), 0),
    [draftLines],
  )

  if (!existing) {
    return createPortal(
      <div className={`${CHROME_BACKDROP_CLASS} flex items-center justify-center p-4`} style={{ zIndex }}>
        <div ref={panelRef} className="w-full max-w-md rounded-sm bg-white p-5 shadow-xl">
          <p className="text-sm text-stone-600">{t('journals.docNotFound')}</p>
          <Button className="mt-4" size="sm" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      </div>,
      getModalPortalRoot(),
    )
  }

  function saveLines() {
    if (readOnly) return
    const lines = draftLines
      .map((l) => ({
        id: l.id,
        employeeId: l.employeeId,
        amount: Math.round(Number(String(l.amount).replace(',', '.')) || 0),
        mode: 'fixed' as const,
        percent: l.percent,
        salaryBase: l.salaryBase,
        note: l.note,
      }))
      .filter((l) => l.amount > 0)
    if (!lines.length) return
    actions.onSaveAdvanceAccrual({
      id: existing!.id,
      month: existing!.month,
      lines,
      purpose: existing!.purpose,
    })
    onClose()
  }

  async function postDoc() {
    const ok = await confirm({
      title: t('fin.accrual.postTitle'),
      message: t('fin.accrual.postBody'),
      confirmLabel: t('fin.accrual.post'),
      cancelLabel: t('common.cancel'),
    })
    if (!ok) return
    if (!readOnly) {
      const lines = draftLines
        .map((l) => ({
          id: l.id,
          employeeId: l.employeeId,
          amount: Math.round(Number(String(l.amount).replace(',', '.')) || 0),
          mode: 'fixed' as const,
          percent: l.percent,
          salaryBase: l.salaryBase,
          note: l.note,
        }))
        .filter((l) => l.amount > 0)
      if (lines.length) {
        actions.onSaveAdvanceAccrual({
          id: existing!.id,
          month: existing!.month,
          lines,
          purpose: existing!.purpose,
        })
      }
    }
    actions.onPostAdvanceAccrual(existing!.id)
    onClose()
  }

  const statusLabel = t(`fin.accrual.status.${existing.status}`)
  const postedSum = accrualLineTotal(existing.lines)

  return createPortal(
    <div className={`${CHROME_BACKDROP_CLASS} flex items-start justify-center overflow-y-auto p-4`} style={{ zIndex }}>
      <div
        ref={panelRef}
        className="my-6 w-full max-w-3xl rounded-sm border border-grid bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-grid px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-ink">
              {t('fin.accrual.journalType')} · {existing.number}
            </h2>
            <p className="mt-0.5 text-sm text-stone-500">
              {formatMonthTitle(existing.month || defaultMonth, locale)} · {statusLabel}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <p className="text-sm tabular-nums text-ink-muted">
            {t('fin.accrual.colSum')}:{' '}
            <strong>{formatGel(readOnly ? postedSum : editSum)}</strong>
          </p>
          {!readOnly && <p className="text-xs text-ink-muted">{t('fin.accrual.editHint')}</p>}

          <div className="fc-table-wrap max-h-[min(60vh,28rem)] overflow-auto">
            <table className="fc-table min-w-full text-sm">
              <thead>
                <tr>
                  <th>{t('fin.bankTransfer.colName')}</th>
                  <th>{t('fin.accrual.colRule')}</th>
                  <th className="text-right">{t('fin.accrual.colAmount')}</th>
                  {!readOnly && <th />}
                </tr>
              </thead>
              <tbody>
                {(readOnly ? existing.lines : draftLines).map((line) => {
                  const emp = store.employees.find((e) => e.id === line.employeeId)
                  const amount =
                    'amount' in line && typeof line.amount === 'string'
                      ? line.amount
                      : String((line as { amount: number }).amount)
                  const mode = 'mode' in line ? line.mode : 'fixed'
                  const percent = 'percent' in line ? line.percent : undefined
                  const ruleLabel =
                    mode === 'fixed'
                      ? t('finance.rates.advanceFixed')
                      : percent != null
                        ? `${percent}%`
                        : `${defaultPct}%`
                  return (
                    <tr key={line.id}>
                      <td>{emp?.fullName || emp?.nameKa || line.employeeId.slice(0, 8)}</td>
                      <td className="text-xs text-ink-muted">{ruleLabel}</td>
                      <td className="text-right">
                        {readOnly ? (
                          <span className="font-mono tabular-nums">{formatGel(Number(amount) || 0)}</span>
                        ) : (
                          <Input
                            className="ml-auto !w-28 text-right font-mono"
                            inputMode="decimal"
                            value={amount}
                            onChange={(e) =>
                              setDraftLines((prev) =>
                                prev.map((l) =>
                                  l.id === line.id
                                    ? { ...l, amount: e.target.value, mode: 'fixed' }
                                    : l,
                                ),
                              )
                            }
                          />
                        )}
                      </td>
                      {!readOnly && (
                        <td>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setDraftLines((prev) => prev.filter((l) => l.id !== line.id))
                            }
                          >
                            {t('common.delete')}
                          </Button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-grid px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.close')}
          </Button>
          {!readOnly && (
            <>
              <Button variant="secondary" size="sm" onClick={saveLines}>
                {t('fin.accrual.saveLines')}
              </Button>
              <Button variant="primary" size="sm" onClick={() => void postDoc()}>
                {t('fin.accrual.post')}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>,
    getModalPortalRoot(),
  )
}
