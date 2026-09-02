import { useI18n } from '@/context/I18nContext'
import { intlLocale } from '@/i18n/localeFormat'
import type { Locale } from '@/i18n/types'
import type { DirectorCommandBriefing, PlanFactScore } from '@/lib/director/commandBriefing'
import type { DirectorPulseNavigate } from '@/components/director/DirectorPulsePanel'
import '@/styles/director-command.css'

type Props = {
  briefing: DirectorCommandBriefing
  onNavigate: (nav: DirectorPulseNavigate) => void
}

function formatHours(n: number): string {
  const rounded = Math.round(n * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function monthCaption(monthKey: string, locale: Locale): string {
  const [y, m] = monthKey.split('-').map(Number)
  if (!y || !m) return monthKey
  return new Date(y, m - 1, 1).toLocaleDateString(intlLocale(locale), {
    month: 'long',
    year: 'numeric',
  })
}

function ScoreList({
  title,
  empty,
  rows,
  tone,
}: {
  title: string
  empty: string
  rows: PlanFactScore[]
  tone: 'under' | 'over'
}) {
  const { tf } = useI18n()
  return (
    <div className={`director-report__list is-${tone}`}>
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="director-report__empty">{empty}</p>
      ) : (
        <ul>
          {rows.map((row) => (
            <li key={`${row.kind}-${row.id}`}>
              <span>{row.name}</span>
              <b>
                {tf('director.command.hoursDelta', {
                  sign: row.deviation > 0 ? '+' : '',
                  n: formatHours(row.deviation),
                })}
              </b>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function DirectorCommandBoard({ briefing, onNavigate }: Props) {
  const { t, tf, locale } = useI18n()
  const under = [...briefing.underBrigades, ...briefing.underPeople]
  const over = [...briefing.overBrigades, ...briefing.overPeople]
  const pctClass =
    briefing.verdict === 'late' || briefing.verdict === 'lag'
      ? 'is-lag'
      : briefing.verdict === 'ahead'
        ? 'is-ahead'
        : 'is-ok'

  return (
    <section className="director-report" data-coach="director:command">
      <p className="director-report__month">{monthCaption(briefing.monthKey, locale)}</p>
      <h2 className="director-report__title">{t('director.command.title')}</h2>
      <p className={`director-report__pct ${pctClass}`} aria-label={`${Math.round(briefing.plantPct)}%`}>
        {Math.round(briefing.plantPct)}%
      </p>
      <p className="director-report__verdict">{t(`director.command.verdict.${briefing.verdict}`)}</p>
      <p className="director-report__hours">
        {tf('director.command.hoursMeta', {
          plan: formatHours(briefing.planHours),
          fact: formatHours(briefing.factHours),
        })}
      </p>

      <div className="director-report__stats">
        <button type="button" onClick={() => onNavigate({ type: 'view', view: 'month' })}>
          <small>{t('director.command.tile.fill')}</small>
          <strong>{tf('director.command.pct', { n: String(briefing.fillRatePct) })}</strong>
        </button>
        <button type="button" onClick={() => onNavigate({ type: 'view', view: 'production' })}>
          <small>{t('director.command.tile.production')}</small>
          <strong>
            {briefing.productionPlanMp > 0
              ? tf('director.command.pct', { n: String(Math.round(briefing.productionPct)) })
              : '—'}
          </strong>
        </button>
        <button type="button" onClick={() => onNavigate({ type: 'tab', tab: 'queue', focus: 'risk' })}>
          <small>{t('director.kpi.atRisk')}</small>
          <strong className={briefing.atRiskOrders > 0 ? 'is-lag' : undefined}>
            {briefing.atRiskOrders}
          </strong>
        </button>
        <button type="button" onClick={() => onNavigate({ type: 'view', view: 'warehouse' })}>
          <small>{t('erp.kpi.stockDeficit')}</small>
          <strong className={briefing.stockDeficits > 0 ? 'is-lag' : undefined}>
            {briefing.stockDeficits}
          </strong>
        </button>
      </div>

      <div className="director-report__split">
        <ScoreList
          title={t('director.command.under')}
          empty={t('director.command.underEmpty')}
          rows={under}
          tone="under"
        />
        <ScoreList
          title={t('director.command.over')}
          empty={t('director.command.overEmpty')}
          rows={over}
          tone="over"
        />
      </div>
    </section>
  )
}
