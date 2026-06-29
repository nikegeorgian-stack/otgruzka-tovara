import { useI18n } from '@/context/I18nContext'
import { CODE_DEFS } from '@/lib/codes'

export function CodeLegendBar({ compact = false }: { compact?: boolean }) {
  const { t, codeLabel } = useI18n()
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ${
        compact ? '' : 'rounded-sm border border-grid bg-white/90 px-4 py-2.5 shadow-sm'
      }`}
    >
      <span className="font-semibold text-stone-500">{t('legend.codes')}:</span>
      {CODE_DEFS.map((c) => (
        <span key={c.code} className="text-stone-600">
          <strong className="font-mono text-ink">{c.code}</strong>
          <span className="text-stone-400"> ({c.hours}{t('common.hoursShort')})</span>
          <span className="hidden sm:inline"> — {codeLabel(c.code)}</span>
        </span>
      ))}
      <span className="text-stone-400">|</span>
      <span className="text-violet-700">{t('legend.holidays')}</span>
      <span className="text-stone-400">|</span>
      <span className="text-stone-500">{t('legend.night')}</span>
    </div>
  )
}
