import type { WastewaterCubeStatus } from '@/lib/wastewater/types'
import { useI18n } from '@/context/I18nContext'

const STATUS_CLASS: Record<WastewaterCubeStatus, string> = {
  filling: 'bg-sky-100 text-sky-900',
  waiting: 'bg-amber-100 text-amber-900',
  drain_zone: 'bg-teal-100 text-teal-900',
  in_use: 'bg-violet-100 text-violet-900',
  used: 'bg-stone-200 text-stone-600 line-through',
  unsuitable: 'bg-red-100 text-red-800',
}

type Props = {
  status: WastewaterCubeStatus
  className?: string
}

export function WastewaterStatusBadge({ status, className = '' }: Props) {
  const { t } = useI18n()
  return (
    <span
      className={`fc-badge inline-flex px-2 py-0.5 text-[11px] font-semibold ${STATUS_CLASS[status]} ${className}`}
    >
      {t(`wastewater.status.${status}`)}
    </span>
  )
}
