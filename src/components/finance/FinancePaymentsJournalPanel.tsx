import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { MonthNavigator } from '@/components/ui/MonthNavigator'
import { useI18n } from '@/context/I18nContext'
import { formatMonthTitle } from '@/lib/dates'
import { financePaymentJournal } from '@/lib/finance/analytics'
import { formatGel } from '@/lib/payroll'
import type { AppStore } from '@/lib/types'

type Props = {
  store: AppStore
  month: string
  onMonthChange: (m: string) => void
  asOfDate?: string
}

function methodLabel(method: string, t: (k: string) => string): string {
  const key = `fin.method.${method}` as 'fin.method.cash'
  return t(key)
}

export function FinancePaymentsJournalPanel({ store, month, onMonthChange, asOfDate }: Props) {
  const { t, locale } = useI18n()
  const [kindFilter, setKindFilter] = useState<'all' | 'advance' | 'payout'>('all')

  const rows = useMemo(() => financePaymentJournal(store, month, asOfDate), [store, month, asOfDate])
  const filtered = useMemo(
    () => (kindFilter === 'all' ? rows : rows.filter((r) => r.kind === kindFilter)),
    [rows, kindFilter],
  )

  const totals = useMemo(() => {
    let advances = 0
    let payouts = 0
    for (const r of rows) {
      if (r.kind === 'advance') advances += r.amount
      else payouts += r.amount
    }
    return { advances, payouts, total: advances + payouts }
  }, [rows])

  function exportCsv() {
    const header = [
      t('fin.date'),
      t('finance.payments.col.kind'),
      t('employees.colName'),
      t('fin.amount'),
      t('fin.method'),
      t('fin.note'),
      t('finance.payments.col.by'),
    ]
    const lines = filtered.map((r) =>
      [
        r.date,
        r.kind === 'advance' ? t('fin.ledger.kind.advance') : t('fin.ledger.kind.payout'),
        r.employeeName,
        String(r.amount),
        methodLabel(r.method, t),
        r.note ?? '',
        r.byName ?? '',
      ]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(';'),
    )
    const blob = new Blob(['\uFEFF' + [header.join(';'), ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8',
    })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `payments-${month}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink">{t('finance.payments.title')}</h2>
          <p className="text-sm text-stone-500">
            {formatMonthTitle(month, locale)} · {t('finance.payments.subtitle')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MonthNavigator month={month} onChange={onMonthChange} />
          <Button variant="secondary" size="sm" onClick={exportCsv} disabled={!filtered.length}>
            {t('finance.dashboard.exportPayments')}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-sm border border-grid bg-white px-4 py-3 shadow-sm">
          <p className="text-xs text-stone-500">{t('fin.ledger.kind.advance')}</p>
          <p className="font-mono text-lg font-semibold text-amber-800">{formatGel(totals.advances)}</p>
        </div>
        <div className="rounded-sm border border-grid bg-white px-4 py-3 shadow-sm">
          <p className="text-xs text-stone-500">{t('fin.ledger.kind.payout')}</p>
          <p className="font-mono text-lg font-semibold text-teal-800">{formatGel(totals.payouts)}</p>
        </div>
        <div className="rounded-sm border border-grid bg-white px-4 py-3 shadow-sm">
          <p className="text-xs text-stone-500">{t('common.total')}</p>
          <p className="font-mono text-lg font-semibold">{formatGel(totals.total)}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(['all', 'advance', 'payout'] as const).map((k) => (
          <button
            key={k}
            type="button"
            className={`rounded-sm px-3 py-1.5 text-xs font-semibold ${
              kindFilter === k
                ? 'bg-teal-700 text-white'
                : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
            onClick={() => setKindFilter(k)}
          >
            {k === 'all'
              ? t('finance.payments.filterAll')
              : k === 'advance'
                ? t('fin.ledger.kind.advance')
                : t('fin.ledger.kind.payout')}
          </button>
        ))}
      </div>

      <div className="fc-table-wrap">
        <table className="fc-table min-w-full text-sm">
          <thead>
            <tr>
              <th>{t('fin.date')}</th>
              <th>{t('finance.payments.col.kind')}</th>
              <th>{t('employees.colName')}</th>
              <th className="text-right">{t('fin.amount')}</th>
              <th>{t('fin.method')}</th>
              <th>{t('fin.note')}</th>
              <th>{t('finance.payments.col.by')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-stone-500">
                  {t('finance.payments.empty')}
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={`${r.kind}-${r.id}`}>
                  <td className="font-mono text-xs">{r.date}</td>
                  <td>
                    <span
                      className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${
                        r.kind === 'advance'
                          ? 'bg-amber-100 text-amber-900'
                          : 'bg-teal-100 text-teal-900'
                      }`}
                    >
                      {r.kind === 'advance'
                        ? t('fin.ledger.kind.advance')
                        : t('fin.ledger.kind.payout')}
                    </span>
                  </td>
                  <td>{r.employeeName}</td>
                  <td className="text-right font-mono text-xs">{formatGel(r.amount)}</td>
                  <td className="text-xs">{methodLabel(r.method, t)}</td>
                  <td className="max-w-[12rem] truncate text-xs text-stone-500">{r.note ?? '—'}</td>
                  <td className="text-xs text-stone-500">{r.byName ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
