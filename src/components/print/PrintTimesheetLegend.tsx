import { GE_OFFICIAL_MARKS } from '@/lib/printGeorgiaOfficial'
import { CODE_DEFS } from '@/lib/codes'
import { FST_TO_GE_OFFICIAL } from '@/lib/printGeorgiaOfficial'
import { t } from '@/i18n'
import type { Locale } from '@/lib/types'

type Props = {
  locale: Locale
  georgiaOfficial?: boolean
}

/** Легенда: при гос. шапке Грузии — условные обозначения 01-15/ნ + внутренние коды смен. */
export function PrintTimesheetLegend({ locale, georgiaOfficial = false }: Props) {
  if (georgiaOfficial) {
    return (
      <div className="print-legend print-legend-grid" role="note">
        <span className="print-legend-title">{t(locale, 'print.ge.legendOfficial')}</span>
        {GE_OFFICIAL_MARKS.map(({ code, key }) => (
          <span key={code} className="print-legend-item">
            <strong>{code}</strong>
            <span>{t(locale, key)}</span>
          </span>
        ))}
        <span className="print-legend-title print-legend-subtitle">
          {t(locale, 'print.ge.legendShifts')}
        </span>
        {CODE_DEFS.filter((c) => c.hours > 0).map((c) => (
          <span key={c.code} className="print-legend-item">
            <strong>{c.code}</strong>
            <span>{t(locale, c.labelKey)}</span>
            {FST_TO_GE_OFFICIAL[c.code] ? (
              <span className="print-legend-ge-map">→ {FST_TO_GE_OFFICIAL[c.code]}</span>
            ) : null}
          </span>
        ))}
      </div>
    )
  }

  return (
    <div className="print-legend print-legend-grid" role="note">
      <span className="print-legend-title">{t(locale, 'print.legend')}</span>
      {CODE_DEFS.map((c) => (
        <span key={c.code} className="print-legend-item">
          <strong>{c.code || '·'}</strong>
          <span>{t(locale, `code.label.${c.code}`)}</span>
        </span>
      ))}
    </div>
  )
}
