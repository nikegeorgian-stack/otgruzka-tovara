import { KpiCard } from '@/components/ui/KpiCard'
import { useI18n } from '@/context/I18nContext'
import { formatMonthTitle } from '@/lib/dates'
import type { ExecutiveKpis } from '@/lib/erp/executiveKpis'
import type { ViewId } from '@/lib/types'

type Props = {
  kpis: ExecutiveKpis
  onNavigate?: (view: ViewId) => void
  className?: string
}

export function ExecutiveKpiStrip({ kpis, onNavigate, className = '' }: Props) {
  const { t, tf, locale } = useI18n()
  const monthLabel = formatMonthTitle(kpis.factHoursMonthKey, locale)

  const cards = [
    {
      key: 'openPo',
      label: t('erp.kpi.openPo'),
      value: kpis.openPurchaseOrders,
      tone: kpis.procurementOverdue > 0 ? ('warn' as const) : undefined,
      hint:
        kpis.procurementOverdue > 0
          ? tf('erp.kpi.openPoOverdue', { count: String(kpis.procurementOverdue) })
          : undefined,
      view: 'procurement' as ViewId,
    },
    {
      key: 'factHours',
      label: tf('erp.kpi.factHours', { month: monthLabel }),
      value: kpis.factHoursMonth,
      view: 'month' as ViewId,
    },
    {
      key: 'stockDeficit',
      label: t('erp.kpi.stockDeficit'),
      value: kpis.stockDeficits,
      tone: kpis.stockDeficits > 0 ? ('warn' as const) : undefined,
      view: 'warehouse' as ViewId,
    },
  ]

  return (
    <div className={`grid gap-3 sm:grid-cols-3 ${className}`}>
      {cards.map((card) => {
        const inner = (
          <>
            <KpiCard label={card.label} value={card.value} tone={card.tone} />
            {card.hint && (
              <p className="mt-1 px-1 text-[10px] text-amber-800">{card.hint}</p>
            )}
          </>
        )
        if (!onNavigate) {
          return (
            <div key={card.key}>
              {inner}
            </div>
          )
        }
        return (
          <button
            key={card.key}
            type="button"
            className="rounded-sm text-left transition hover:ring-2 hover:ring-teal-500/40"
            onClick={() => onNavigate(card.view)}
          >
            {inner}
          </button>
        )
      })}
    </div>
  )
}
