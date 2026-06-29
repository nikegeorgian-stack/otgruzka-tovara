import { useI18n } from '@/context/I18nContext'
import type { TransportMode } from '@/lib/procurement/types'

const LABELS: Record<TransportMode, string> = {
  truck: '🚛',
  rail: '🚂',
  sea: '🚢',
  air: '✈️',
  mixed: '↔️',
}

export function TransportModeBadge({ mode }: { mode: TransportMode }) {
  const { t } = useI18n()
  return (
    <span className="inline-flex items-center gap-1 rounded-sm bg-stone-100 px-2 py-0.5 text-[10px] font-semibold text-stone-700">
      <span aria-hidden>{LABELS[mode]}</span>
      {t(`procurement.transport.${mode}`)}
    </span>
  )
}
