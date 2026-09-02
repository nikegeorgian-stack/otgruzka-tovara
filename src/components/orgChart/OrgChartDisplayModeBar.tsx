import { useI18n } from '@/context/I18nContext'
import type { OrgChartDisplayMode } from '@/lib/orgChart/types'

type Props = {
  value: OrgChartDisplayMode
  onChange: (mode: OrgChartDisplayMode) => void
}

const MODES: OrgChartDisplayMode[] = ['both', 'short', 'full']

export function OrgChartDisplayModeBar({ value, onChange }: Props) {
  const { t } = useI18n()

  return (
    <div
      className="inline-flex flex-wrap items-stretch rounded-lg border border-stone-300 bg-stone-50 p-0.5 text-xs"
      role="group"
      aria-label={t('orgTree.displayMode')}
      data-coach="orgTree:displayMode"
    >
      {MODES.map((mode) => {
        const active = value === mode
        return (
          <button
            key={mode}
            type="button"
            className={`rounded-md px-2 py-1.5 text-left transition-colors sm:px-2.5 ${
              active
                ? 'bg-white font-semibold text-stone-900 shadow-sm ring-1 ring-stone-200'
                : 'text-stone-600 hover:bg-white/70'
            }`}
            onClick={() => onChange(mode)}
            aria-pressed={active}
          >
            <span className="block">{t(`orgTree.mode.${mode}`)}</span>
            <span
              className={`mt-0.5 hidden font-mono leading-tight sm:block ${
                active ? 'text-stone-700' : 'text-stone-400'
              }`}
            >
              {t(`orgTree.modeSample.${mode}`)}
            </span>
          </button>
        )
      })}
    </div>
  )
}
