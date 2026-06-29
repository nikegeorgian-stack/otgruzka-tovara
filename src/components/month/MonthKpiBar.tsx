import { useI18n } from '@/context/I18nContext'
import type { MonthStats } from '@/lib/stats'

type Props = { stats: MonthStats }

export function MonthKpiBar({ stats }: Props) {
  const { t, statsReadiness, statsControl } = useI18n()
  const items = [
    { label: t('stats.planH'), value: stats.planHours },
    { label: t('stats.factH'), value: stats.factHours },
    { label: t('stats.deviation'), value: stats.deviation },
    { label: t('stats.fill'), value: `${Math.round(stats.fillRate * 100)}%` },
    { label: t('stats.mismatches'), value: stats.mismatches },
    { label: t('stats.absences'), value: stats.absences },
    { label: t('stats.factShifts'), value: stats.factShifts },
    { label: t('stats.readiness'), value: statsReadiness(stats.readiness) },
    { label: t('stats.control'), value: statsControl(stats.control) },
  ]

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-sm border border-grid bg-white px-3 py-2 shadow-sm"
        >
          <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">
            {item.label}
          </div>
          <div className="mt-0.5 font-mono text-lg font-semibold text-ink">{item.value}</div>
        </div>
      ))}
    </div>
  )
}
