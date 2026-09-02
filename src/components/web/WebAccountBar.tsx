import { useI18n } from '@/context/I18nContext'
import type { ReactNode } from 'react'

type Props = {
  displayName: string
  email: string
  onLogout: () => void
  /** Верхняя полоска над контентом (desktop). */
  compact?: boolean
  /** Узкий сайдбар: одна строка + ссылка выхода. */
  variant?: 'default' | 'sidebar'
  /** Слева от аккаунта (колокольчик рисков и т.п.) */
  leading?: ReactNode
}

export function WebAccountBar({
  displayName,
  email,
  onLogout,
  compact,
  variant = 'default',
  leading,
}: Props) {
  const { t } = useI18n()

  if (variant === 'sidebar') {
    return (
      <div className="flex min-w-0 items-start gap-1.5">
        {leading ? <div className="shrink-0 pt-0.5">{leading}</div> : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-ink" title={displayName}>
            {displayName}
          </p>
          <p className="truncate text-[10px] text-stone-500" title={email}>
            {email}
          </p>
          <button
            type="button"
            className="mt-1.5 text-[11px] font-medium text-stone-600 underline-offset-2 hover:text-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
            onClick={onLogout}
          >
            {t('access.switchAccount')}
          </button>
        </div>
      </div>
    )
  }

  if (compact) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2 border-b border-stone-200/80 bg-white/90 px-3 py-2 print:hidden">
        {leading}
        <span className="min-w-0 flex-1 truncate text-xs text-stone-500 sm:flex-none">
          <span className="font-semibold text-ink">{displayName}</span>
          <span className="mx-1.5 text-stone-300">·</span>
          <span className="text-stone-400">{email}</span>
        </span>
        <button
          type="button"
          className="shrink-0 rounded-md border border-stone-300/80 bg-white px-2.5 py-1 text-[11px] font-semibold text-ink hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          onClick={onLogout}
        >
          {t('access.switchAccount')}
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-md border border-stone-200 bg-stone-50/90 p-2.5">
      <p className="truncate text-xs font-semibold text-ink">{displayName}</p>
      <p className="mt-0.5 truncate text-[10px] text-stone-500">{email}</p>
      <button
        type="button"
        className="mt-2 w-full rounded-md border border-stone-300/80 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-ink hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        onClick={onLogout}
      >
        {t('access.switchAccount')}
      </button>
    </div>
  )
}
