import { useMemo, useState } from 'react'
import { EmployeePicker } from '@/components/ui/EmployeePicker'
import { useConfirm } from '@/context/ConfirmContext'
import { useI18n } from '@/context/I18nContext'
import { formatMonthTitle } from '@/lib/dates'
import { employeeLedger, type LedgerEntry } from '@/lib/finance/calc'
import { filterEmployeesForDate } from '@/lib/hr/employeeActive'
import { formatGel } from '@/lib/payroll'
import type { AppStore } from '@/lib/types'
import type { FinanceActions } from './financeTypes'

type Props = {
  store: AppStore
  actions: FinanceActions
  asOfDate?: string
}

const KIND_LABEL: Record<LedgerEntry['kind'], string> = {
  accrual: 'fin.ledger.kind.accrual',
  advance: 'fin.ledger.kind.advance',
  bonus: 'fin.ledger.kind.bonus',
  penalty: 'fin.ledger.kind.penalty',
  payout: 'fin.ledger.kind.payout',
}

const KIND_TONE: Record<LedgerEntry['kind'], string> = {
  accrual: 'text-ink',
  advance: 'text-amber-700',
  bonus: 'text-emerald-700',
  penalty: 'text-red-700',
  payout: 'text-sky-700',
}

export function EmployeeLedgerPanel({ store, actions, asOfDate }: Props) {
  const { t, locale, employeeName } = useI18n()
  const { confirm } = useConfirm()
  const [empId, setEmpId] = useState<string | null>(null)

  const entries = useMemo(
    () => (empId ? employeeLedger(store, empId, asOfDate) : []),
    [store, empId, asOfDate],
  )

  const pickerEmployees = useMemo(
    () => filterEmployeesForDate(store.employees, asOfDate),
    [store.employees, asOfDate],
  )

  const totals = useMemo(() => {
    let accrued = 0
    let advances = 0
    let bonus = 0
    let penalty = 0
    let paid = 0
    for (const e of entries) {
      if (e.kind === 'accrual') accrued += e.amount
      else if (e.kind === 'advance') advances += e.amount
      else if (e.kind === 'bonus') bonus += e.amount
      else if (e.kind === 'penalty') penalty += e.amount
      else if (e.kind === 'payout') paid += e.amount
    }
    const net = accrued + bonus - penalty - advances
    return { accrued, advances, bonus, penalty, paid, net, balance: net - paid }
  }, [entries])

  function removeEntry(e: LedgerEntry) {
    if (!e.refId) return
    if (e.kind === 'advance') actions.onRemoveAdvance(e.refId)
    else if (e.kind === 'bonus' || e.kind === 'penalty') actions.onRemoveAdjustment(e.refId)
    else if (e.kind === 'payout') actions.onRemovePayout(e.refId)
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-ink">{t('fin.ledger.title')}</h2>
        <p className="text-sm text-stone-500">{t('fin.ledger.hint')}</p>
      </div>

      <div className="max-w-md">
        <EmployeePicker
          employees={pickerEmployees}
          value={empId}
          onChange={setEmpId}
          asOfDate={asOfDate}
          placeholder={t('fin.ledger.pick')}
        />
      </div>

      {!empId ? (
        <div className="rounded-sm border border-grid bg-paper-dark/40 px-4 py-8 text-center text-sm text-stone-400">
          {t('fin.ledger.pick')}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi label={t('fin.col.accrued')} value={formatGel(totals.accrued)} />
            <Kpi label={t('fin.col.bonus')} value={formatGel(totals.bonus)} tone="text-emerald-700" />
            <Kpi label={t('fin.col.penalty')} value={formatGel(totals.penalty)} tone="text-red-700" />
            <Kpi label={t('fin.col.advance')} value={formatGel(totals.advances)} tone="text-amber-700" />
            <Kpi label={t('fin.col.paid')} value={formatGel(totals.paid)} tone="text-sky-700" />
            <Kpi label={t('fin.ledger.balance')} value={formatGel(totals.balance)} strong />
          </div>

          {entries.length === 0 ? (
            <div className="rounded-sm border border-grid bg-paper-dark/40 px-4 py-8 text-center text-sm text-stone-400">
              {t('fin.ledger.empty')}
            </div>
          ) : (
            <div className="fc-table-wrap">
              <table className="fc-table min-w-full">
                <thead>
                  <tr>
                    <th className="px-3 py-2 text-left">{t('fin.date')}</th>
                    <th className="px-3 py-2 text-left">{t('fin.ledger.month')}</th>
                    <th className="px-3 py-2 text-left">{t('fin.ledger.kind')}</th>
                    <th className="px-3 py-2 text-left">{t('fin.ledger.detail')}</th>
                    <th className="px-3 py-2 text-right">{t('fin.amount')}</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id} className="border-t border-grid">
                      <td className="px-3 py-2 font-mono text-xs">{e.date}</td>
                      <td className="px-3 py-2 text-xs">{formatMonthTitle(e.month, locale)}</td>
                      <td className={`px-3 py-2 text-sm font-medium ${KIND_TONE[e.kind]}`}>
                        {t(KIND_LABEL[e.kind])}
                      </td>
                      <td className="px-3 py-2 text-sm text-stone-600">
                        {e.label}
                        {e.byName ? <span className="text-stone-400"> · {e.byName}</span> : ''}
                      </td>
                      <td className={`px-3 py-2 text-right font-mono ${KIND_TONE[e.kind]}`}>
                        {e.kind === 'penalty' || e.kind === 'advance' ? '−' : ''}
                        {formatGel(e.amount)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {e.refId && (
                          <button
                            type="button"
                            className="rounded-sm border border-grid px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                            onClick={async () => {
                              if (await confirm({ message: t('fin.ledger.confirmRemove'), danger: true })) {
                                removeEntry(e)
                              }
                            }}
                          >
                            {t('common.delete')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-stone-400">
            {employeeName(store.employees.find((e) => e.id === empId)!)} · {t('fin.ledger.note')}
          </p>
        </>
      )}
    </div>
  )
}

function Kpi({
  label,
  value,
  tone = 'text-ink',
  strong = false,
}: {
  label: string
  value: string
  tone?: string
  strong?: boolean
}) {
  return (
    <div className={`rounded-sm border border-grid bg-white px-3 py-2 ${strong ? 'ring-1 ring-accent/30' : ''}`}>
      <div className="text-[11px] uppercase tracking-wide text-stone-400">{label}</div>
      <div className={`mt-0.5 font-mono text-sm font-semibold ${tone}`}>{value}</div>
    </div>
  )
}
