import { useMemo } from 'react'
import { KpiCard } from '@/components/ui/KpiCard'
import { useI18n } from '@/context/I18nContext'
import { formatNum, summarizeProductionDay } from '@/lib/production/stats'
import { PRODUCTION_CATEGORIES, PRODUCTION_LINES } from '@/lib/production/types'
import type { ProductionRequest } from '@/lib/production/types'
import { categoryLabel } from '@/lib/production/types'

type Props = {
  requests: ProductionRequest[]
  date: string
  asOfIso?: string
}

export function ProductionDaySnapshot({ requests, date, asOfIso }: Props) {
  const { t, locale } = useI18n()
  const summary = useMemo(
    () => summarizeProductionDay(requests, date, asOfIso),
    [requests, date, asOfIso],
  )

  const lineLabel = (lineId: ProductionRequest['lineId']) => {
    const line = PRODUCTION_LINES.find((l) => l.id === lineId)
    return line ? (locale === 'ka' ? line.labelKa : line.labelRu) : lineId
  }

  const topCategories = PRODUCTION_CATEGORIES.filter(
    (c) => summary.byCategory[c.key].qtyMp > 0 || summary.byCategory[c.key].qtyKg > 0,
  )

  return (
    <div className="rounded-sm border border-teal-200 bg-teal-50/50 px-4 py-3">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-teal-950">{t('production.daySnapshot.title')}</h3>
        <p className="text-xs text-teal-800/80">
          {asOfIso
            ? t('production.daySnapshot.asOfTime')
            : t('production.daySnapshot.fullDay')}
          {' · '}
          {date}
          {asOfIso ? ` · ${timeFromIso(asOfIso)}` : ''}
        </p>
      </div>

      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <KpiCard label={t('production.daySnapshot.factMp')} value={formatNum(summary.factMp)} />
        <KpiCard label={t('production.daySnapshot.planMp')} value={formatNum(summary.planMp)} />
        <KpiCard
          label={t('production.daySnapshot.requests')}
          value={String(summary.requests)}
        />
      </div>

      {summary.byLine.some((l) => l.requests > 0) ? (
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          {summary.byLine
            .filter((l) => l.requests > 0)
            .map((l) => (
              <span
                key={l.lineId}
                className="rounded-sm bg-white px-2 py-1 ring-1 ring-teal-200"
              >
                {lineLabel(l.lineId)}: {formatNum(l.factMp)} {t('production.unitMp')}
              </span>
            ))}
        </div>
      ) : null}

      {topCategories.length > 0 ? (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-stone-500">
              <th className="pb-1 pr-2">{t('production.col.category')}</th>
              <th className="pb-1 pr-2 text-right">{t('production.unitMp')}</th>
              <th className="pb-1 text-right">кг</th>
            </tr>
          </thead>
          <tbody>
            {topCategories.map((c) => (
              <tr key={c.key}>
                <td className="py-0.5 pr-2">{categoryLabel(c.key, '1', locale)}</td>
                <td className="py-0.5 pr-2 text-right tabular-nums">
                  {formatNum(summary.byCategory[c.key].qtyMp)}
                </td>
                <td className="py-0.5 text-right tabular-nums">
                  {formatNum(summary.byCategory[c.key].qtyKg)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-xs text-stone-500">{t('production.daySnapshot.empty')}</p>
      )}
    </div>
  )
}

function timeFromIso(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}
