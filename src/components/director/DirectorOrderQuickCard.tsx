import { useI18n } from '@/context/I18nContext'
import type { DelayForecast } from '@/lib/sales/directorActions'
import type { SalesOrder } from '@/lib/sales/types'
import type { SalesOrderMetrics } from '@/lib/sales/calc'

type Props = {
  order: SalesOrder
  metrics: SalesOrderMetrics
  forecast: DelayForecast
  firstProductionOrderId?: string
  onOpenOrder: () => void
  onOpenPlanner?: (productionOrderId: string) => void
  onOpenProduction?: () => void
  onOpenWarehouse?: () => void
  onOpenPlanning?: () => void
}

export function DirectorOrderQuickCard({
  order,
  metrics,
  forecast,
  firstProductionOrderId,
  onOpenOrder,
  onOpenPlanner,
  onOpenProduction,
  onOpenWarehouse,
  onOpenPlanning,
}: Props) {
  const { t, tf } = useI18n()

  return (
    <div className="mb-3 rounded-sm border border-stone-200 bg-white px-3 py-2">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <button
            type="button"
            className="font-mono text-xs font-semibold text-sky-800 underline-offset-2 hover:underline"
            onClick={onOpenOrder}
          >
            {order.orderNumber || '—'}
          </button>
          <span className="mx-1.5 text-stone-300">·</span>
          <span className="text-sm text-stone-800">{order.customer}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="tabular-nums text-stone-500">
            {tf('director.forecast.done', { pct: metrics.donePct })}
          </span>
          <span className="tabular-nums text-stone-500">
            {tf('director.forecast.cover', { pct: metrics.coveragePct })}
          </span>
          {forecast.lateLikely ? (
            <span className="rounded-sm bg-red-100 px-1.5 py-0.5 font-medium text-red-800">
              {forecast.projectedDaysLate > 0 && forecast.projectedDaysLate < 999
                ? tf('director.forecast.late', { days: forecast.projectedDaysLate })
                : t('director.forecast.lateLikely')}
            </span>
          ) : (
            <span className="rounded-sm bg-teal-50 px-1.5 py-0.5 text-teal-800">
              {t('director.forecast.onTrack')}
            </span>
          )}
        </div>
      </div>
      {forecast.remainingMp > 0 && (
        <p className="mb-2 text-[11px] text-stone-500">
          {tf('director.forecast.pace', {
            remain: Math.round(forecast.remainingMp),
            need: forecast.requiredDailyMp,
            plan: forecast.plannedDailyMp,
          })}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        <QuickLink label={t('director.jump.order')} onClick={onOpenOrder} />
        {onOpenPlanning && (
          <QuickLink label={t('director.jump.planning')} onClick={onOpenPlanning} />
        )}
        {firstProductionOrderId && onOpenPlanner && (
          <QuickLink
            label={t('director.jump.planner')}
            onClick={() => onOpenPlanner(firstProductionOrderId)}
          />
        )}
        {onOpenProduction && (
          <QuickLink label={t('director.jump.production')} onClick={onOpenProduction} />
        )}
        {onOpenWarehouse && (
          <QuickLink label={t('director.jump.warehouse')} onClick={onOpenWarehouse} />
        )}
      </div>
    </div>
  )
}

function QuickLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-sm border border-stone-200 bg-stone-50 px-2 py-1 text-[11px] font-medium text-stone-700 hover:border-teal-400 hover:bg-teal-50 hover:text-teal-900"
    >
      {label}
    </button>
  )
}
