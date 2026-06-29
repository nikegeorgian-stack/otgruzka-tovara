import { useMemo } from 'react'
import { Button } from '@/components/ui/Button'
import { useI18n } from '@/context/I18nContext'
import {
  formatClimateDateLabel,
  groupRoomClimateByDate,
} from '@/lib/technologist/climateJournal'
import type { RoomClimateRecord } from '@/lib/technologist/types'

type Props = {
  records: RoomClimateRecord[]
  onRemove?: (id: string) => void
  maxHeightClass?: string
  compact?: boolean
}

export function TechnologistRoomClimateJournal({
  records,
  onRemove,
  maxHeightClass = 'max-h-96',
  compact = false,
}: Props) {
  const { t, locale } = useI18n()
  const grouped = useMemo(() => groupRoomClimateByDate(records), [records])

  if (grouped.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-stone-500">
        {t('technologist.climate.empty')}
      </p>
    )
  }

  return (
    <div className={`space-y-3 overflow-y-auto ${maxHeightClass}`}>
      {grouped.map(([date, rows]) => (
        <div key={date}>
          <p className="sticky top-0 z-10 bg-white px-2 py-1 text-xs font-semibold uppercase tracking-wide text-sky-800">
            {formatClimateDateLabel(date, locale)}
          </p>
          <div className="overflow-x-auto">
            <table className="fc-table w-full text-sm">
              <thead>
                <tr>
                  <th>{t('technologist.climate.colTime')}</th>
                  <th className="text-right">{t('technologist.climate.colTemp')}</th>
                  <th className="text-right">{t('technologist.climate.colHumidity')}</th>
                  {!compact && <th>{t('technologist.climate.colRoom')}</th>}
                  {!compact && <th>{t('technologist.climate.colOperator')}</th>}
                  {onRemove && <th />}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="font-mono text-xs">{row.measuredTime}</td>
                    <td className="text-right tabular-nums">
                      {row.temperatureC.toFixed(1)} °C
                    </td>
                    <td className="text-right tabular-nums">
                      {row.humidityPct.toFixed(0)} %
                    </td>
                    {!compact && <td>{row.roomLabel ?? '—'}</td>}
                    {!compact && (
                      <td className="text-xs text-stone-600">
                        {row.recordedByName ?? '—'}
                      </td>
                    )}
                    {onRemove && (
                      <td className="text-right">
                        <Button
                          variant="ghost"
                          size="xs"
                          type="button"
                          onClick={() => onRemove(row.id)}
                        >
                          {t('common.delete')}
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}
