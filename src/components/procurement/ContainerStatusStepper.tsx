import { OrderStatusBadge } from '@/components/procurement/OrderStatusBadge'
import { useI18n } from '@/context/I18nContext'
import { importStatusFlow } from '@/lib/procurement/tracking/manualUpdate'
import type { PurchaseOrderStatus } from '@/lib/procurement/types'

type Props = {
  current: PurchaseOrderStatus
  onSelect: (status: PurchaseOrderStatus) => void
}

export function ContainerStatusStepper({ current, onSelect }: Props) {
  const { t } = useI18n()
  const flow = importStatusFlow(current)

  if (!flow.length) return null

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-stone-600">
        {t('procurement.tracking.manualTitle')}
      </p>
      <p className="text-[11px] text-stone-500">{t('procurement.tracking.manualHint')}</p>
      <div className="flex flex-wrap gap-2">
        {flow.map((status) => {
          const isCurrent = status === current
          return (
            <button
              key={status}
              type="button"
              disabled={isCurrent}
              className={`rounded-sm border px-2 py-1.5 transition ${
                isCurrent
                  ? 'cursor-default border-teal-600 bg-teal-50 opacity-80'
                  : 'border-grid bg-white hover:border-teal-500 hover:bg-teal-50/60'
              }`}
              onClick={() => onSelect(status)}
            >
              <OrderStatusBadge status={status} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
