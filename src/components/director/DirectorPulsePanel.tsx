import { KpiCard } from '@/components/ui/KpiCard'
import { useI18n } from '@/context/I18nContext'
import type { DirectorPulse, DirectorPulseCard } from '@/lib/sales/directorPulse'
import type { ViewId } from '@/lib/types'

export type DirectorPulseNavigate =
  | { type: 'view'; view: ViewId }
  | { type: 'tab'; tab: NonNullable<DirectorPulseCard['directorTab']>; focus?: DirectorPulseCard['focus'] }

type Props = {
  pulse: DirectorPulse
  onNavigate: (nav: DirectorPulseNavigate) => void
}

const ORDER_IDS = new Set(['openOrders', 'atRisk', 'queue', 'toProduce', 'inProduction'])
const PLANT_IDS = new Set(['openPo', 'stockDeficit', 'loadingDrafts', 'shiftRequests', 'factHours'])
const QC_IDS = new Set(['alkaliOverdue', 'otcDefects', 'labFails'])

function Section({
  title,
  cards,
  onNavigate,
}: {
  title: string
  cards: DirectorPulseCard[]
  onNavigate: (nav: DirectorPulseNavigate) => void
}) {
  const { t, tf } = useI18n()
  if (cards.length === 0) return null
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">{title}</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {cards.map((card) => {
          const label = card.labelParams
            ? tf(card.labelKey, card.labelParams)
            : t(card.labelKey)
          const hint =
            card.hintKey != null
              ? card.hintParams
                ? tf(card.hintKey, card.hintParams)
                : t(card.hintKey)
              : undefined
          return (
            <button
              key={card.id}
              type="button"
              className="rounded-sm text-left transition hover:ring-2 hover:ring-teal-500/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-600"
              onClick={() => {
                if (card.view) onNavigate({ type: 'view', view: card.view })
                else if (card.directorTab)
                  onNavigate({ type: 'tab', tab: card.directorTab, focus: card.focus })
              }}
            >
              <KpiCard label={label} value={card.value} tone={card.tone} hint={hint} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Пульс завода: заказы · операции · качество */
export function DirectorPulsePanel({ pulse, onNavigate }: Props) {
  const { t } = useI18n()
  const orderCards = pulse.cards.filter((c) => ORDER_IDS.has(c.id))
  const plantCards = pulse.cards.filter((c) => PLANT_IDS.has(c.id))
  const qcCards = pulse.cards.filter((c) => QC_IDS.has(c.id))

  return (
    <div className="gd-panel space-y-5 rounded-sm border border-stone-200 p-4">
      <div>
        <h2 className="text-sm font-semibold text-stone-900">{t('director.pulse.title')}</h2>
        <p className="mt-0.5 text-xs text-stone-500">{t('director.pulse.hint')}</p>
      </div>
      <Section title={t('director.pulse.section.orders')} cards={orderCards} onNavigate={onNavigate} />
      <Section title={t('director.pulse.section.plant')} cards={plantCards} onNavigate={onNavigate} />
      <Section title={t('director.pulse.section.quality')} cards={qcCards} onNavigate={onNavigate} />
    </div>
  )
}
