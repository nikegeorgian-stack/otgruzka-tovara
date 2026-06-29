import { Input } from '@/components/ui/Input'
import { useI18n } from '@/context/I18nContext'
import { formatMonthTitle, shiftMonth } from '@/lib/dates'

type Props = {
  month: string
  onChange: (month: string) => void
  /** Показать поле type="month" вместо кнопок ‹ › */
  variant?: 'arrows' | 'input' | 'both'
  className?: string
}

export function MonthNavigator({
  month,
  onChange,
  variant = 'arrows',
  className = '',
}: Props) {
  const { locale } = useI18n()

  if (variant === 'input') {
    return (
      <Input
        type="month"
        className={`!w-auto ${className}`.trim()}
        value={month}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`.trim()}>
      {(variant === 'arrows' || variant === 'both') && (
        <div className="fc-tabbar !gap-0 !p-0">
          <button
            type="button"
            className="fc-tabbar__tab !rounded-r-none"
            onClick={() => onChange(shiftMonth(month, -1))}
            aria-label="Previous month"
          >
            ‹
          </button>
          <span className="flex min-w-[9rem] items-center justify-center px-2 text-sm font-semibold capitalize text-ink">
            {formatMonthTitle(month, locale)}
          </span>
          <button
            type="button"
            className="fc-tabbar__tab !rounded-l-none"
            onClick={() => onChange(shiftMonth(month, 1))}
            aria-label="Next month"
          >
            ›
          </button>
        </div>
      )}
      {variant === 'both' && (
        <Input
          type="month"
          className="!w-auto"
          value={month}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  )
}
