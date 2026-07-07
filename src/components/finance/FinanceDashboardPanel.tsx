import { useMemo } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { KpiCard } from '@/components/ui/KpiCard'
import { MonthNavigator } from '@/components/ui/MonthNavigator'
import { useI18n } from '@/context/I18nContext'
import { formatMonthTitle } from '@/lib/dates'
import { runExport } from '@/lib/export'
import { computeFinanceDashboard } from '@/lib/finance/analytics'
import { formatGel } from '@/lib/payroll'
import type { AppStore } from '@/lib/types'

type Props = {
  store: AppStore
  month: string
  onMonthChange: (m: string) => void
  onOpenStatement?: () => void
  onOpenSick?: () => void
  onOpenRates?: () => void
  onOpenPayments?: () => void
  asOfDate?: string
}

const FLOW_TONE: Record<string, string> = {
  accrued: 'bg-sky-500',
  bonus: 'bg-emerald-500',
  penalty: 'bg-red-400',
  advance: 'bg-amber-500',
  paid: 'bg-teal-600',
  remaining: 'bg-violet-500',
}

export function FinanceDashboardPanel({
  store,
  month,
  onMonthChange,
  onOpenStatement,
  onOpenSick,
  onOpenRates,
  onOpenPayments,
  asOfDate,
}: Props) {
  const { t, tf, locale } = useI18n()
  const dash = useMemo(() => computeFinanceDashboard(store, month, asOfDate), [store, month, asOfDate])

  const maxBrigadeHours = Math.max(1, ...dash.brigadeBars.map((b) => b.factHours))
  const maxDebt = Math.max(1, ...dash.debtRows.map((d) => d.remaining))
  const maxFlow = Math.max(
    1,
    ...dash.payrollFlow.map((f) => Math.abs(f.amount)),
  )
  const maxPayoutDay = Math.max(1, ...dash.payoutByDay.map((d) => d.total))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-stone-500">{t('finance.dashboard.period')}</p>
          <p className="text-lg font-semibold capitalize text-ink">
            {formatMonthTitle(month, locale)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MonthNavigator month={month} onChange={onMonthChange} />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void runExport('payroll_statement', store, { month, locale })}
          >
            {t('finance.dashboard.exportStatement')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void runExport('payroll', store, { month, locale })}
          >
            {t('finance.dashboard.exportPayroll')}
          </Button>
        </div>
      </div>

      {dash.readyToClose ? (
        <div className="rounded-sm border border-emerald-200 bg-emerald-50/90 px-4 py-3 text-sm text-emerald-950">
          {t('finance.dashboard.closeReady')}
        </div>
      ) : !dash.monthClosed && dash.payrollRows > 0 ? (
        <div className="rounded-sm border border-sky-200 bg-sky-50/80 px-4 py-3 text-sm text-sky-950">
          {t('finance.dashboard.closePending')}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={t('finance.dashboard.kpi.payroll')}
          value={formatGel(dash.totalNet)}
          tone="default"
        />
        <KpiCard
          label={t('finance.dashboard.kpi.paid')}
          value={formatGel(dash.totalPaid)}
          tone="ok"
        />
        <KpiCard
          label={t('finance.dashboard.kpi.debt')}
          value={formatGel(dash.totalRemaining)}
          tone={dash.totalRemaining > 0 ? 'warn' : 'ok'}
        />
        <KpiCard
          label={t('finance.dashboard.kpi.debtors')}
          value={dash.employeesWithDebt}
          tone={dash.employeesWithDebt > 0 ? 'warn' : 'default'}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label={t('finance.dashboard.kpi.active')} value={dash.activeEmployees} />
        <KpiCard
          label={t('finance.dashboard.kpi.fill')}
          value={`${dash.fillRatePct}%`}
          tone={dash.fillRatePct >= 90 ? 'ok' : dash.fillRatePct >= 70 ? 'default' : 'warn'}
        />
        <KpiCard
          label={t('finance.dashboard.kpi.hours')}
          value={`${dash.factHours} / ${dash.planHours}`}
        />
        <KpiCard
          label={t('finance.dashboard.kpi.sickPending')}
          value={dash.sickPending}
          tone={dash.sickPending > 0 ? 'warn' : 'default'}
        />
      </div>

      {(dash.sickPending > 0 || dash.noRateCount > 0) && (
        <div className="flex flex-wrap gap-2 rounded-sm border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-950">
          {dash.sickPending > 0 ? (
            <button
              type="button"
              className="font-medium text-amber-900 underline hover:no-underline"
              onClick={onOpenSick}
            >
              {tf('finance.dashboard.alert.sick', { n: String(dash.sickPending) })}
            </button>
          ) : null}
          {dash.noRateCount > 0 ? (
            <button
              type="button"
              className="font-medium text-amber-900 underline hover:no-underline"
              onClick={onOpenRates}
            >
              {tf('finance.dashboard.alert.noRate', { n: String(dash.noRateCount) })}
            </button>
          ) : null}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('finance.dashboard.payrollFlow')} description={t('finance.dashboard.payrollFlowHint')}>
          <div className="space-y-2">
            {dash.payrollFlow.map((f) => (
              <div key={f.key} className="flex items-center gap-3 text-sm">
                <span className="w-28 shrink-0 text-stone-600">
                  {t(`finance.dashboard.flow.${f.key}`)}
                </span>
                <div className="h-3 min-w-0 flex-1 rounded bg-stone-100">
                  <div
                    className={`h-3 rounded ${FLOW_TONE[f.key] ?? 'bg-stone-400'}`}
                    style={{ width: `${(Math.abs(f.amount) / maxFlow) * 100}%` }}
                  />
                </div>
                <span className="w-24 shrink-0 text-right font-mono text-xs tabular-nums">
                  {formatGel(f.amount)}
                </span>
              </div>
            ))}
          </div>
          {onOpenStatement ? (
            <button
              type="button"
              className="mt-4 text-sm font-medium text-accent hover:underline"
              onClick={onOpenStatement}
            >
              {t('finance.dashboard.openStatement')}
            </button>
          ) : null}
        </Card>

        <Card title={t('finance.dashboard.brigades')} description={t('finance.dashboard.brigadesHint')}>
          {dash.brigadeBars.length === 0 ? (
            <p className="py-6 text-center text-sm text-stone-500">{t('finance.dashboard.empty')}</p>
          ) : (
            <div className="space-y-2">
              {dash.brigadeBars.slice(0, 12).map((b) => (
                <div key={b.label} className="flex items-center gap-3 text-sm">
                  <span className="w-32 shrink-0 truncate text-stone-700" title={b.label}>
                    {b.label}
                  </span>
                  <div className="h-3 min-w-0 flex-1 rounded bg-stone-100">
                    <div
                      className="h-3 rounded bg-teal-500"
                      style={{ width: `${(b.factHours / maxBrigadeHours) * 100}%` }}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-right font-mono text-xs tabular-nums text-stone-600">
                    {b.factHours} ч
                  </span>
                  <span className="w-8 shrink-0 text-right text-xs text-stone-400">{b.headcount}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card
          title={t('finance.dashboard.payoutsByDay')}
          description={t('finance.dashboard.payoutsByDayHint')}
        >
          {dash.payoutByDay.length === 0 ? (
            <p className="py-6 text-center text-sm text-stone-500">{t('finance.payments.empty')}</p>
          ) : (
            <div className="space-y-2">
              {dash.payoutByDay.map((d) => (
                <div key={d.date} className="flex items-center gap-3 text-sm">
                  <span className="w-24 shrink-0 font-mono text-xs text-stone-600">{d.date}</span>
                  <div className="flex h-3 min-w-0 flex-1 overflow-hidden rounded bg-stone-100">
                    {d.advances > 0 ? (
                      <div
                        className="h-3 bg-amber-500"
                        style={{ width: `${(d.advances / maxPayoutDay) * 100}%` }}
                        title={t('fin.ledger.kind.advance')}
                      />
                    ) : null}
                    {d.payouts > 0 ? (
                      <div
                        className="h-3 bg-teal-600"
                        style={{ width: `${(d.payouts / maxPayoutDay) * 100}%` }}
                        title={t('fin.ledger.kind.payout')}
                      />
                    ) : null}
                  </div>
                  <span className="w-24 shrink-0 text-right font-mono text-xs tabular-nums">
                    {formatGel(d.total)}
                  </span>
                </div>
              ))}
            </div>
          )}
          {onOpenPayments ? (
            <button
              type="button"
              className="mt-4 text-sm font-medium text-accent hover:underline"
              onClick={onOpenPayments}
            >
              {t('finance.dashboard.openPayments')}
            </button>
          ) : null}
        </Card>
      </div>

      <Card title={t('finance.dashboard.debts')} description={t('finance.dashboard.debtsHint')}>
        {dash.debtRows.length === 0 ? (
          <p className="py-6 text-center text-sm text-emerald-700">{t('finance.dashboard.noDebts')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="fc-table w-full text-sm">
              <thead>
                <tr>
                  <th>{t('employees.colName')}</th>
                  <th>{t('employees.colBrigade')}</th>
                  <th className="text-right">{t('finance.dashboard.col.net')}</th>
                  <th className="text-right">{t('finance.dashboard.col.paid')}</th>
                  <th className="text-right">{t('finance.dashboard.col.debt')}</th>
                  <th className="w-1/4">{t('director.load.chart')}</th>
                </tr>
              </thead>
              <tbody>
                {dash.debtRows.slice(0, 20).map((d) => (
                  <tr key={d.employeeId}>
                    <td className="font-medium">{d.name}</td>
                    <td className="text-xs text-stone-500">{d.brigade}</td>
                    <td className="text-right font-mono text-xs">{formatGel(d.net)}</td>
                    <td className="text-right font-mono text-xs">{formatGel(d.paid)}</td>
                    <td className="text-right font-mono text-xs font-semibold text-amber-800">
                      {formatGel(d.remaining)}
                    </td>
                    <td>
                      <div className="h-3 w-full rounded bg-stone-100">
                        <div
                          className="h-3 rounded bg-amber-500"
                          style={{ width: `${(d.remaining / maxDebt) * 100}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
