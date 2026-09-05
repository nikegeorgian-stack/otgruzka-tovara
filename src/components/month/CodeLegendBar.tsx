import { useI18n } from '@/context/I18nContext'
import { CODE_DEFS } from '@/lib/codes'

export function CodeLegendBar({ compact = false }: { compact?: boolean }) {
  const { t, codeLabel } = useI18n()
  return (
    <div
      className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] leading-snug ${
        compact ? '' : 'rounded-sm border border-grid bg-white/90 px-4 py-2.5 text-xs shadow-sm'
      }`}
    >
      <span className="font-semibold text-stone-500">{t('legend.codes')}:</span>
      {CODE_DEFS.map((c) => (
        <span key={c.code} className="text-stone-600" title={codeLabel(c.code)}>
          <strong className="font-mono text-ink">{c.code}</strong>
          {!compact ? (
            <>
              <span className="text-stone-400">
                {' '}
                ({c.hours}
                {t('common.hoursShort')})
              </span>
              <span className="hidden sm:inline"> — {codeLabel(c.code)}</span>
            </>
          ) : (
            <span className="text-stone-400">·{c.hours}</span>
          )}
        </span>
      ))}
      {!compact ? (
        <>
          <span className="text-stone-400">|</span>
          <span className="text-violet-700">{t('legend.holidays')}</span>
          <span className="text-stone-400">|</span>
          <span className="text-stone-500">{t('legend.night')}</span>
          <span className="text-stone-400">|</span>
          <span className="text-teal-700" title={t('table.brigadier')}>
            <span className="inline-flex h-3.5 min-w-[0.875rem] items-center justify-center rounded-sm bg-teal-600 px-0.5 text-[8px] font-bold text-white">
              ★
            </span>{' '}
            {t('legend.brigadierMark')}
          </span>
          <span className="text-violet-700" title={t('substitution.legend')}>
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-violet-600 align-middle" />{' '}
            {t('legend.substitutionMark')}
          </span>
          <span className="text-orange-700">{t('legend.prRisk')}</span>
          <span className="text-rose-700">{t('legend.pendingRisk')}</span>
        </>
      ) : (
        <span className="text-stone-400">{t('legend.holidaysShort')}</span>
      )}
    </div>
  )
}
