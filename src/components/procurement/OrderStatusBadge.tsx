import { useI18n } from '@/context/I18nContext'
import type { PurchaseOrderStatus } from '@/lib/procurement/types'

const STYLES: Record<PurchaseOrderStatus, string> = {
  draft: 'bg-stone-200 text-stone-700',
  ordered: 'bg-sky-100 text-sky-800',
  production: 'bg-violet-100 text-violet-800',
  shipped: 'bg-amber-100 text-amber-900',
  in_transit: 'bg-orange-100 text-orange-900',
  customs: 'bg-fuchsia-100 text-fuchsia-900',
  arrived: 'bg-teal-100 text-teal-800',
  partial: 'bg-yellow-100 text-yellow-900',
  received: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-red-100 text-red-800',
}

export function OrderStatusBadge({ status }: { status: PurchaseOrderStatus }) {
  const { t } = useI18n()
  return (
    <span
      className={`fc-badge inline-flex px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STYLES[status] ?? 'bg-stone-100'}`}
    >
      {t(`procurement.status.${status}`)}
    </span>
  )
}
