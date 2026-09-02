import { useI18n } from '@/context/I18nContext'
import type { DirectorActionItem, DirectorActionKind } from '@/lib/sales/directorActions'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'

const KIND_TONE: Record<DirectorActionKind, string> = {
  risk: 'bg-red-100 text-red-800 border-red-200',
  needs_plan: 'bg-amber-100 text-amber-900 border-amber-200',
  needs_loading: 'bg-sky-100 text-sky-900 border-sky-200',
  needs_recipe: 'bg-violet-100 text-violet-900 border-violet-200',
}

type Props = {
  items: DirectorActionItem[]
  onOpenOrder: (orderId: string) => void
  onGoPlanning: (orderId: string) => void
  onGoPlanner?: (productionOrderId: string) => void
  onGoWarehouse?: () => void
  onGoTechnologist?: () => void
}

export function DirectorActionQueue({
  items,
  onOpenOrder,
  onGoPlanning,
  onGoPlanner,
  onGoWarehouse,
  onGoTechnologist,
}: Props) {
  const { t, tf } = useI18n()

  if (items.length === 0) {
    return (
      <Card title={t('director.queue.title')} description={t('director.queue.hint')}>
        <p className="py-6 text-center text-sm text-stone-500">{t('director.queue.empty')}</p>
      </Card>
    )
  }

  return (
    <Card title={t('director.queue.title')} description={tf('director.queue.count', { count: items.length })}>
      <ul className="divide-y divide-stone-100">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center gap-2 py-2.5 first:pt-0 last:pb-0">
            <span
              className={`shrink-0 rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${KIND_TONE[item.kind]}`}
            >
              {t(`director.queue.kind.${item.kind}`)}
            </span>
            <button
              type="button"
              className="font-mono text-xs font-semibold text-sky-800 underline-offset-2 hover:underline"
              onClick={() => onOpenOrder(item.orderId)}
            >
              {item.orderNumber}
            </button>
            <span className="min-w-0 flex-1 truncate text-sm text-stone-700">{item.customer}</span>
            {item.dueDate && (
              <span
                className={`text-xs tabular-nums ${
                  (item.daysToDue ?? 99) <= 5 ? 'font-medium text-red-600' : 'text-stone-500'
                }`}
              >
                {item.dueDate}
                {item.projectedDaysLate > 0 && item.projectedDaysLate < 999 && (
                  <span className="ml-1 text-red-700">
                    {tf('director.forecast.late', { days: item.projectedDaysLate })}
                  </span>
                )}
              </span>
            )}
            <span className="text-xs tabular-nums text-stone-500">
              {tf('director.queue.ready', { pct: item.donePct })}
            </span>
            <div className="flex flex-wrap gap-1">
              {item.kind === 'needs_plan' && (
                <Button size="sm" variant="secondary" onClick={() => onGoPlanning(item.orderId)}>
                  {t('director.queue.action.plan')}
                </Button>
              )}
              {item.kind === 'needs_loading' && onGoWarehouse && (
                <Button size="sm" variant="secondary" onClick={onGoWarehouse}>
                  {t('director.queue.action.loading')}
                </Button>
              )}
              {item.kind === 'needs_recipe' && (
                <>
                  {item.productionOrderId && onGoPlanner && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => onGoPlanner(item.productionOrderId!)}
                    >
                      {t('director.queue.action.planner')}
                    </Button>
                  )}
                  {onGoTechnologist && (
                    <Button size="sm" variant="secondary" onClick={onGoTechnologist}>
                      {t('director.queue.action.recipe')}
                    </Button>
                  )}
                </>
              )}
              {item.kind === 'risk' && (
                <Button size="sm" variant="secondary" onClick={() => onOpenOrder(item.orderId)}>
                  {t('director.queue.action.open')}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}
