import { useI18n } from '@/context/I18nContext'
import type { AsOfScope } from '@/hooks/useAsOfSnapshot'

export type { AsOfScope }

type Props = {
  enabled: boolean
  onEnabledChange: (v: boolean) => void
  date: string
  onDateChange: (v: string) => void
  time: string
  onTimeChange: (v: string) => void
  scope?: AsOfScope
  onScopeChange?: (v: AsOfScope) => void
  showScope?: boolean
  /** i18n-ключ подсказки (по умолчанию общий) */
  hintKey?: string
  className?: string
}

export function AsOfSnapshotBar({
  enabled,
  onEnabledChange,
  date,
  onDateChange,
  time,
  onTimeChange,
  scope = 'all',
  onScopeChange,
  showScope = false,
  hintKey = 'asOf.hint',
  className = '',
}: Props) {
  const { t } = useI18n()

  return (
    <div
      className={`flex flex-wrap items-end gap-3 rounded-sm border border-sky-200 bg-sky-50/80 px-4 py-3 ${className}`}
    >
      <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-sky-950">
        <input
          type="checkbox"
          className="rounded border-sky-400"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
        />
        {t('asOf.enable')}
      </label>

      {enabled ? (
        <>
          <label className="flex flex-col gap-1 text-xs text-stone-600">
            {t('asOf.date')}
            <input
              type="date"
              className="fc-input min-w-[9.5rem]"
              value={date}
              onChange={(e) => onDateChange(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-stone-600">
            {t('asOf.time')}
            <input
              type="time"
              className="fc-input min-w-[7rem]"
              value={time}
              onChange={(e) => onTimeChange(e.target.value)}
            />
          </label>
          {showScope && onScopeChange ? (
            <label className="flex flex-col gap-1 text-xs text-stone-600">
              {t('asOf.scope')}
              <select
                className="fc-input min-w-[10rem]"
                value={scope}
                onChange={(e) => onScopeChange(e.target.value as AsOfScope)}
              >
                <option value="all">{t('asOf.scopeAll')}</option>
                <option value="output">{t('asOf.scopeOutput')}</option>
              </select>
            </label>
          ) : null}
          <p className="pb-1 text-xs text-sky-800/80">{t(hintKey)}</p>
        </>
      ) : null}
    </div>
  )
}
