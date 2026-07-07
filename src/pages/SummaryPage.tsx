import { useMemo } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageLayout } from '@/components/ui/PageLayout'
import { ExecutiveKpiStrip } from '@/components/erp/ExecutiveKpiStrip'
import { AsOfSnapshotBar } from '@/components/asOf/AsOfSnapshotBar'
import { useAsOfSnapshot } from '@/hooks/useAsOfSnapshot'
import { useI18n } from '@/context/I18nContext'
import { formatMonthTitle } from '@/lib/dates'
import { computeExecutiveKpis } from '@/lib/erp/executiveKpis'
import { listMonthKeys } from '@/lib/monthManage'
import { monthStats } from '@/lib/stats'
import type { AppStore, ViewId } from '@/lib/types'

type Props = {
  store: AppStore
  onNavigate?: (view: ViewId) => void
}

export function SummaryPage({ store, onNavigate }: Props) {
  const { t, locale, statsReadiness, statsControl } = useI18n()
  const asOf = useAsOfSnapshot()
  const {
    enabled: asOfEnabled,
    setEnabled: setAsOfEnabled,
    date: asOfDate,
    setDate: setAsOfDate,
    time: asOfTime,
    setTime: setAsOfTime,
    asOfIso,
  } = asOf
  const erpKpis = useMemo(
    () =>
      computeExecutiveKpis(
        {
          procurement: store.procurement,
          warehouse: store.warehouse,
          months: store.months,
          employees: store.employees,
        },
        new Date(),
        asOfIso ?? undefined,
      ),
    [store.procurement, store.warehouse, store.months, store.employees, asOfIso],
  )
  const months = listMonthKeys(store)
  const rows = months.map((m) => ({ month: m, stats: monthStats(store.months[m], store.employees) }))
  const total = rows.reduce(
    (acc, r) => ({
      planHours: acc.planHours + r.stats.planHours,
      factHours: acc.factHours + r.stats.factHours,
      mismatches: acc.mismatches + r.stats.mismatches,
      factShifts: acc.factShifts + r.stats.factShifts,
    }),
    { planHours: 0, factHours: 0, mismatches: 0, factShifts: 0 },
  )

  return (
    <PageLayout>
      <PageHeader title={t('summary.title')} subtitle={t('summary.subtitle')} />

      <AsOfSnapshotBar
        className="mb-4"
        enabled={asOfEnabled}
        onEnabledChange={setAsOfEnabled}
        date={asOfDate}
        onDateChange={setAsOfDate}
        time={asOfTime}
        onTimeChange={setAsOfTime}
        hintKey="asOf.hintExecutive"
      />

      <ExecutiveKpiStrip kpis={erpKpis} onNavigate={onNavigate} className="mb-6" />

      <div className="fc-table-wrap">
        <table className="fc-table min-w-full">
          <thead>
            <tr>
              <th>{t('summary.colMonth')}</th>
              <th>{t('stats.planH')}</th>
              <th>{t('stats.factH')}</th>
              <th>{t('stats.deviation')}</th>
              <th>{t('summary.colFilled')}</th>
              <th>{t('summary.colMismatchShort')}</th>
              <th>{t('stats.absences')}</th>
              <th>{t('stats.factShifts')}</th>
              <th>{t('stats.readiness')}</th>
              <th>{t('stats.control')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ month, stats }) => (
              <tr key={month}>
                <td className="font-medium capitalize">{formatMonthTitle(month, locale)}</td>
                <td className="font-mono">{stats.planHours}</td>
                <td className="font-mono">{stats.factHours}</td>
                <td className="font-mono">{stats.deviation}</td>
                <td className="font-mono">{Math.round(stats.fillRate * 100)}%</td>
                <td className="font-mono">{stats.mismatches}</td>
                <td className="font-mono">{stats.absences}</td>
                <td className="font-mono">{stats.factShifts}</td>
                <td>
                  <span
                    className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${
                      stats.readiness === 'ready'
                        ? 'bg-emerald-100 text-emerald-800'
                        : stats.readiness === 'review'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-stone-100 text-stone-600'
                    }`}
                  >
                    {statsReadiness(stats.readiness)}
                  </span>
                </td>
                <td>
                  <span
                    className={`text-xs font-semibold ${
                      stats.control === 'ok' ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {statsControl(stats.control)}
                  </span>
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-accent/30 bg-accent-soft/20 font-semibold">
              <td>{t('common.total')}</td>
              <td className="font-mono">{total.planHours}</td>
              <td className="font-mono">{total.factHours}</td>
              <td className="font-mono">{total.factHours - total.planHours}</td>
              <td colSpan={2} />
              <td colSpan={2} />
              <td colSpan={2} />
            </tr>
          </tbody>
        </table>
      </div>
    </PageLayout>
  )
}
