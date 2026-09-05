import { useMemo, useState } from 'react'
import { useI18n } from '@/context/I18nContext'
import { formatGel } from '@/lib/payroll'
import { employeeLedger } from '@/lib/finance/calc'
import {
  bankAccountAtDate,
  formatBankAccountLabel,
  formatIbanDisplay,
} from '@/lib/hr/employeeBank'
import { hrJournalKindLabel } from '@/lib/hr/labels'
import { isMovementJournalKind } from '@/lib/hr/movementJournal'
import { structuralUnitName } from '@/lib/hr/orgStructure'
import type { HrJournalEntry, HrJournalKind, HrStructuralUnit } from '@/lib/hr/types'
import type { AppStore, Employee } from '@/lib/types'

type Filter = 'all' | 'movement' | 'bank' | 'position' | 'salary' | 'absence'

type Props = {
  employee: Employee
  store?: AppStore
  hrStructuralUnits?: HrStructuralUnit[]
}

function formatWhen(j: HrJournalEntry): string {
  if (j.startDate && j.endDate) return `${j.startDate} — ${j.endDate}`
  if (j.dateKey) return j.dateKey
  return j.at.slice(0, 16).replace('T', ' ')
}

const ABSENCE_KINDS: HrJournalKind[] = [
  'sick',
  'vacation',
  'business_trip',
  'absence',
  'truancy',
  'unpaid_leave',
  'idle',
]

function formatPrevNext(
  j: HrJournalEntry,
  units: HrStructuralUnit[] | undefined,
): string | null {
  if (j.kind === 'unit_change' && units?.length && (j.prev || j.next)) {
    const prev =
      !j.prev || j.prev === '—' ? '—' : structuralUnitName(units, j.prev) || j.prev
    const next =
      !j.next || j.next === '—' ? '—' : structuralUnitName(units, j.next) || j.next
    return `${prev} → ${next}`
  }
  if (j.prev && j.next) return `${j.prev} → ${j.next}`
  return null
}

export function HrEmployeeHistoryPanel({ employee, store, hrStructuralUnits }: Props) {
  const { t, locale } = useI18n()
  const [filter, setFilter] = useState<Filter>('all')

  const entries = useMemo(() => {
    const list = [...(employee.hrJournal ?? [])]
    list.sort((a, b) => b.at.localeCompare(a.at))
    return list.filter((j) => {
      if (filter === 'all') return true
      if (filter === 'movement') return isMovementJournalKind(j.kind)
      if (filter === 'bank') return j.kind === 'bank_account_change'
      if (filter === 'position') return j.kind === 'position_change' || j.kind === 'unit_change'
      if (filter === 'salary') return j.kind === 'salary_change'
      return ABSENCE_KINDS.includes(j.kind)
    })
  }, [employee.hrJournal, filter])

  const accountPeriods = useMemo(() => {
    const list = [...(employee.bankAccounts ?? [])].filter((a) => a.iban?.trim())
    return list.sort((a, b) => (b.validFrom || '').localeCompare(a.validFrom || ''))
  }, [employee.bankAccounts])

  const paymentsByAccount = useMemo(() => {
    if (!store) return [] as {
      accountId: string
      label: string
      period: string
      rows: { date: string; kind: string; amount: number; label: string }[]
      total: number
    }[]

    const ledger = employeeLedger(store, employee.id).filter(
      (e) => e.kind === 'advance' || e.kind === 'payout',
    )

    return accountPeriods.map((acc) => {
      const rows = ledger
        .filter((e) => {
          const onDate = bankAccountAtDate(employee.bankAccounts, e.date)
          return onDate?.id === acc.id
        })
        .map((e) => ({
          date: e.date,
          kind: e.kind,
          amount: e.amount,
          label: e.label,
        }))
      const total = rows.reduce((s, r) => s + r.amount, 0)
      return {
        accountId: acc.id,
        label: formatIbanDisplay(acc.iban),
        period: `${acc.validFrom || '…'} — ${acc.validUntil || '…'}`,
        rows,
        total,
      }
    })
  }, [store, employee.id, employee.bankAccounts, accountPeriods])

  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: t('hr.history.filterAll') },
    { id: 'movement', label: t('hr.history.filterMovement') },
    { id: 'bank', label: t('hr.history.filterBank') },
    { id: 'position', label: t('hr.history.filterPosition') },
    { id: 'salary', label: t('hr.history.filterSalary') },
    { id: 'absence', label: t('hr.history.filterAbsence') },
  ]

  const showBankBlock = filter === 'all' || filter === 'bank'

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-ink">{t('hr.history.title')}</p>
        <p className="text-xs text-stone-500">{t('hr.history.hint')}</p>
      </div>

      <div className="flex flex-wrap gap-1">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            className={
              filter === f.id
                ? 'rounded-sm bg-ink px-2.5 py-1 text-xs font-medium text-white'
                : 'rounded-sm border border-grid px-2.5 py-1 text-xs text-ink hover:bg-stone-50'
            }
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {showBankBlock && accountPeriods.length > 0 ? (
        <div className="space-y-2 rounded-sm border border-sky-200 bg-sky-50/50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-900">
            {t('hr.history.bankAccounts')}
          </p>
          <ul className="space-y-2">
            {accountPeriods.map((acc) => {
              const pay = paymentsByAccount.find((p) => p.accountId === acc.id)
              return (
                <li key={acc.id} className="rounded-sm border border-sky-100 bg-white px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-ink">
                      {formatBankAccountLabel(acc)}
                    </span>
                    {acc.isPrimary ? (
                      <span className="text-[11px] font-medium text-teal-700">
                        {t('hr.bank.primary')}
                      </span>
                    ) : null}
                  </div>
                  {store && pay ? (
                    <p className="mt-1 text-xs text-stone-600">
                      {t('hr.history.paidViaAccount')}:{' '}
                      <span className="font-mono font-semibold">{formatGel(pay.total)}</span>
                      {pay.rows.length > 0
                        ? ` · ${pay.rows.length} ${t('hr.history.ops')}`
                        : ` · ${t('hr.history.noOps')}`}
                    </p>
                  ) : null}
                  {pay && pay.rows.length > 0 ? (
                    <ul className="mt-1.5 max-h-28 space-y-0.5 overflow-y-auto text-[11px] text-stone-500">
                      {pay.rows.slice(0, 12).map((r, i) => (
                        <li key={`${r.date}-${i}`} className="flex justify-between gap-2 tabular-nums">
                          <span>
                            {r.date} ·{' '}
                            {r.kind === 'advance'
                              ? t('fin.ledger.kind.advance')
                              : t('fin.ledger.kind.payout')}
                          </span>
                          <span>{formatGel(r.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      {entries.length === 0 ? (
        <p className="rounded-sm border border-grid bg-stone-50 px-3 py-6 text-center text-sm text-stone-400">
          {t('hr.history.empty')}
        </p>
      ) : (
        <ul className="max-h-[28rem] space-y-2 overflow-y-auto">
          {entries.map((j) => {
            const diff = formatPrevNext(j, hrStructuralUnits)
            return (
              <li
                key={j.id}
                className="rounded-sm border border-grid bg-white px-3 py-2.5 text-sm"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-ink">
                    {hrJournalKindLabel(j.kind, locale)}
                    {j.code ? ` (${j.code})` : ''}
                  </span>
                  <span className="tabular-nums text-xs text-stone-500">{formatWhen(j)}</span>
                </div>
                {j.fromBrigade || j.toBrigade ? (
                  <p className="mt-1 text-xs text-stone-700">
                    {j.fromBrigade || '—'} → {j.toBrigade || '—'}
                  </p>
                ) : null}
                {diff ? <p className="mt-1 text-xs text-stone-700">{diff}</p> : null}
                {j.note ? <p className="mt-1 text-xs text-stone-600">{j.note}</p> : null}
                {j.month ? (
                  <p className="mt-0.5 text-[11px] text-stone-400">
                    {t('hr.history.month')}: {j.month}
                  </p>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
