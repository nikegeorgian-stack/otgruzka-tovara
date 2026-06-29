import { PageHeader } from '@/components/ui/PageHeader'
import { PageLayout } from '@/components/ui/PageLayout'
import { useI18n } from '@/context/I18nContext'
import { formatMonthTitle } from '@/lib/dates'
import { listMonthKeys } from '@/lib/monthManage'
import { monthStats } from '@/lib/stats'
import type { AppStore } from '@/lib/types'

type Props = { store: AppStore }

export function SummaryPage({ store }: Props) {
  const { t, locale, statsReadiness, statsControl } = useI18n()
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
              <td>—</td>
              <td className="font-mono">{total.mismatches}</td>
              <td>—</td>
              <td className="font-mono">{total.factShifts}</td>
              <td colSpan={2} />
            </tr>
          </tbody>
        </table>
      </div>
    </PageLayout>
  )
}
