import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { MonthNavigator } from '@/components/ui/MonthNavigator'
import { useI18n } from '@/context/I18nContext'
import { useConfirm } from '@/context/ConfirmContext'
import {
  accrualLineTotal,
  defaultAdvancePercent,
  listAdvanceAccruals,
  proposeAdvanceAccrualLines,
} from '@/lib/finance/advanceAccrual'
import { getFinance } from '@/lib/finance/calc'
import { formatGel } from '@/lib/payroll'
import type {
  FinanceAdvanceAccrualDocument,
  FinanceAdvanceAccrualLine,
  FinancePaymentMethod,
} from '@/lib/finance/types'
import type { AppStore } from '@/lib/types'
import type { FinanceDocumentActions } from './financeTypes'

type Props = {
  store: AppStore
  month: string
  onMonthChange: (m: string) => void
  documentActions: FinanceDocumentActions
  onSetDefaultAdvancePercent: (percent: number) => void
  openDocumentId?: string | null
  onOpenDocumentConsumed?: () => void
}

const STATUS_CLASS: Record<string, string> = {
  draft: 'bg-stone-100 text-stone-700',
  posted: 'bg-emerald-100 text-emerald-900',
  ready: 'bg-sky-100 text-sky-900',
  paid: 'bg-emerald-100 text-emerald-900',
  void: 'bg-red-50 text-red-800 line-through',
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

function toDraftLines(lines: FinanceAdvanceAccrualLine[]): DraftLine[] {
  return lines.map((l) => ({
    id: l.id,
    employeeId: l.employeeId,
    amount: String(l.amount),
    mode: l.mode,
    percent: l.percent,
    salaryBase: l.salaryBase,
    note: l.note,
  }))
}

export function FinanceAdvanceAccrualPanel({
  store,
  month,
  onMonthChange,
  documentActions,
  onSetDefaultAdvancePercent,
  openDocumentId,
  onOpenDocumentConsumed,
}: Props) {
  const { t } = useI18n()
  const { confirm, alert } = useConfirm()
  const fin = getFinance(store)
  const defaultPct = defaultAdvancePercent(store)
  const [pctDraft, setPctDraft] = useState(String(defaultPct))
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [draftLines, setDraftLines] = useState<DraftLine[]>([])

  const docs = useMemo(
    () => listAdvanceAccruals(fin, { month, includeVoid: true }),
    [fin, month],
  )

  useEffect(() => {
    if (!openDocumentId) return
    const found = listAdvanceAccruals(fin, { includeVoid: true }).find((d) => d.id === openDocumentId)
    if (found?.status === 'draft') {
      setEditId(found.id)
      setDraftLines(toDraftLines(found.lines))
    }
    onOpenDocumentConsumed?.()
  }, [openDocumentId, fin, onOpenDocumentConsumed])

  const totals = useMemo(() => {
    let posted = 0
    let draft = 0
    for (const d of listAdvanceAccruals(fin, { month, includeVoid: false })) {
      const sum = accrualLineTotal(d.lines)
      if (d.status === 'posted') posted += sum
      if (d.status === 'draft') draft += sum
    }
    return { posted, draft }
  }, [fin, month])

  function createFromProposal() {
    const { lines } = proposeAdvanceAccrualLines(store, month)
    if (!lines.length) {
      void alert({
        title: t('fin.accrual.emptyTitle'),
        message: t('fin.accrual.emptyBody'),
        okLabel: t('common.ok'),
      })
      return
    }
    const id = crypto.randomUUID()
    documentActions.onSaveAdvanceAccrual({
      id,
      month,
      lines,
      purpose: t('fin.accrual.defaultPurpose'),
    })
    setEditId(id)
    setDraftLines(toDraftLines(lines))
  }

  function openEdit(doc: FinanceAdvanceAccrualDocument) {
    if (doc.status !== 'draft') return
    setEditId(doc.id)
    setDraftLines(toDraftLines(doc.lines))
  }

  function closeEdit() {
    setEditId(null)
    setDraftLines([])
  }

  function saveEdit() {
    if (!editId) return
    const doc = docs.find((d) => d.id === editId)
    if (!doc || doc.status !== 'draft') return
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
    documentActions.onSaveAdvanceAccrual({
      id: editId,
      month: doc.month,
      lines,
      purpose: doc.purpose,
    })
    closeEdit()
  }

  async function postDoc(id: string) {
    const ok = await confirm({
      title: t('fin.accrual.postTitle'),
      message: t('fin.accrual.postBody'),
      confirmLabel: t('fin.accrual.post'),
      cancelLabel: t('common.cancel'),
    })
    if (!ok) return
    if (editId === id) closeEdit()
    documentActions.onPostAdvanceAccrual(id)
    const doc = listAdvanceAccruals(fin, { month, includeVoid: true }).find((d) => d.id === id)
    const ids = (doc?.lines ?? []).map((l) => l.employeeId).filter(Boolean)
    void import('@/lib/cloud/fstPushNotify').then(({ notifyEmployeesPush }) =>
      notifyEmployeesPush(
        store.access,
        ids,
        'Первая часть зарплаты',
        'Вам начислили первую часть зарплаты. Откройте «Моё», чтобы посмотреть сумму.',
        { kind: 'advance_accrual', month },
      ),
    )
  }

  async function voidDoc(id: string) {
    const ok = await confirm({
      title: t('fin.accrual.voidTitle'),
      message: t('fin.accrual.voidBody'),
      confirmLabel: t('fin.accrual.void'),
      cancelLabel: t('common.cancel'),
      danger: true,
    })
    if (ok) documentActions.onVoidAdvanceAccrual(id)
  }

  function createAv(doc: FinanceAdvanceAccrualDocument) {
    const today = new Date().toISOString().slice(0, 10)
    setBusyId(doc.id)
    try {
      const method: FinancePaymentMethod = 'bank'
      documentActions.onCreateDisbursementFromAccrual(doc.id, {
        date: today,
        method,
      })
    } finally {
      setBusyId(null)
    }
  }

  function saveDefaultPercent() {
    const n = Number(pctDraft.replace(',', '.'))
    if (!Number.isFinite(n) || n < 0 || n > 100) return
    onSetDefaultAdvancePercent(Math.round(n * 10) / 10)
  }

  const editSum = draftLines.reduce(
    (s, l) => s + Math.round(Number(String(l.amount).replace(',', '.')) || 0),
    0,
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <MonthNavigator month={month} onChange={onMonthChange} variant="both" />
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-ink-muted">
            {t('fin.accrual.defaultPercent')}
            <Input
              className="mt-1 !w-24"
              value={pctDraft}
              onChange={(e) => setPctDraft(e.target.value)}
              onBlur={saveDefaultPercent}
            />
          </label>
          <Button type="button" variant="primary" onClick={createFromProposal}>
            {t('fin.accrual.create')}
          </Button>
        </div>
      </div>

      <p className="text-sm text-ink-muted">{t('fin.accrual.hint')}</p>
      <p className="text-xs text-ink-muted">{t('fin.accrual.individualHint')}</p>

      <div className="flex flex-wrap gap-4 text-sm">
        <span>
          {t('fin.accrual.postedTotal')}:{' '}
          <strong className="tabular-nums">{formatGel(totals.posted)}</strong>
        </span>
        <span>
          {t('fin.accrual.draftTotal')}:{' '}
          <strong className="tabular-nums">{formatGel(totals.draft)}</strong>
        </span>
      </div>

      <div className="fc-table-wrap">
        <table className="fc-table min-w-full text-sm">
          <thead>
            <tr>
              <th>{t('fin.accrual.colNumber')}</th>
              <th>{t('fin.accrual.colStatus')}</th>
              <th>{t('fin.accrual.colPeople')}</th>
              <th>{t('fin.accrual.colSum')}</th>
              <th>{t('fin.accrual.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {docs.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-ink-muted">
                  {t('fin.accrual.emptyList')}
                </td>
              </tr>
            ) : (
              docs.map((d) => (
                <tr key={d.id}>
                  <td className="font-medium">{d.number}</td>
                  <td>
                    <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_CLASS[d.status]}`}>
                      {t(`fin.accrual.status.${d.status}`)}
                    </span>
                  </td>
                  <td className="tabular-nums">{d.lines.length}</td>
                  <td className="tabular-nums">{formatGel(accrualLineTotal(d.lines))}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {d.status === 'draft' && (
                        <>
                          <Button type="button" size="sm" onClick={() => openEdit(d)}>
                            {t('fin.accrual.editLines')}
                          </Button>
                          <Button type="button" size="sm" onClick={() => void postDoc(d.id)}>
                            {t('fin.accrual.post')}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => documentActions.onDeleteAdvanceAccrualDraft(d.id)}
                          >
                            {t('common.delete')}
                          </Button>
                        </>
                      )}
                      {d.status === 'posted' && (
                        <>
                          {!d.disbursementDocumentId ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="primary"
                              disabled={busyId === d.id}
                              onClick={() => createAv(d)}
                            >
                              {t('fin.accrual.createAv')}
                            </Button>
                          ) : (
                            <span className="text-xs text-ink-muted">
                              {t('fin.accrual.linkedAv')}
                            </span>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => void voidDoc(d.id)}
                          >
                            {t('fin.accrual.void')}
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editId && (
        <div className="rounded-sm border border-grid bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-ink">{t('fin.accrual.editTitle')}</h3>
            <div className="flex flex-wrap gap-2">
              <span className="text-sm tabular-nums text-ink-muted">
                {t('fin.accrual.colSum')}: <strong>{formatGel(editSum)}</strong>
              </span>
              <Button type="button" variant="primary" size="sm" onClick={saveEdit}>
                {t('fin.accrual.saveLines')}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={closeEdit}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
          <p className="mb-2 text-xs text-ink-muted">{t('fin.accrual.editHint')}</p>
          <div className="fc-table-wrap max-h-96 overflow-auto">
            <table className="fc-table min-w-full text-sm">
              <thead>
                <tr>
                  <th>{t('fin.bankTransfer.colName')}</th>
                  <th>{t('fin.accrual.colRule')}</th>
                  <th className="text-right">{t('fin.accrual.colAmount')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {draftLines.map((line) => {
                  const emp = store.employees.find((e) => e.id === line.employeeId)
                  const ruleLabel =
                    line.mode === 'fixed'
                      ? t('finance.rates.advanceFixed')
                      : line.percent != null
                        ? `${line.percent}%`
                        : `${defaultPct}%`
                  return (
                    <tr key={line.id}>
                      <td>{emp?.fullName || emp?.nameKa || line.employeeId.slice(0, 8)}</td>
                      <td className="text-xs text-ink-muted">{ruleLabel}</td>
                      <td className="text-right">
                        <Input
                          className="ml-auto !w-28 text-right font-mono"
                          inputMode="decimal"
                          value={line.amount}
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
                      </td>
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
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
