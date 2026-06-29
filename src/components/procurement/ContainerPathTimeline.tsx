import { useI18n } from '@/context/I18nContext'
import type { ShipmentMilestone } from '@/lib/procurement/types'
import { carrierLabel } from '@/lib/procurement/tracking/carrierUrls'

type Props = {
  milestones: ShipmentMilestone[]
}

export function ContainerPathTimeline({ milestones }: Props) {
  const { t, locale } = useI18n()
  const pathEvents = milestones
    .filter((m) => m.source === 'carrier' || m.source === 'manual')
    .sort((a, b) => a.at.localeCompare(b.at))

  if (!pathEvents.length) {
    return (
      <p className="text-sm text-stone-400">{t('procurement.tracking.pathEmpty')}</p>
    )
  }

  return (
    <ol className="relative space-y-0 border-l-2 border-teal-300 pl-4">
      {pathEvents.map((m, idx) => {
        const isLast = idx === pathEvents.length - 1
        return (
          <li key={m.id} className="relative pb-4 last:pb-0">
            <span
              className={`absolute -left-[1.35rem] top-1 flex h-4 w-4 items-center justify-center rounded-sm ${
                isLast ? 'bg-teal-600 ring-4 ring-teal-100' : 'border-2 border-teal-500 bg-white'
              }`}
            />
            <div className="rounded-sm border border-grid bg-white px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <time className="font-mono text-[11px] text-stone-500">
                  {new Date(m.at).toLocaleString(locale === 'ka' ? 'ka-GE' : 'ru-RU', {
                    day: '2-digit',
                    month: '2-digit',
                    year: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
                {m.carrier && (
                  <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-stone-600">
                    {carrierLabel(m.carrier)}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm font-medium text-stone-800">{m.note}</p>
              {m.location && (
                <p className="mt-0.5 text-xs text-stone-500">
                  {t('procurement.tracking.location')}: {m.location}
                </p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
