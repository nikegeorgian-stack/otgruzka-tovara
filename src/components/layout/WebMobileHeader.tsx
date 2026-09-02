import { FiberCellBrand } from '@/components/brand/FiberCellBrand'
import { useI18n } from '@/context/I18nContext'
import type { ReactNode } from 'react'

type Props = {
  title: string
  subtitle?: string
  onOpenMenu: () => void
  trailing?: ReactNode
  brandOnDark?: boolean
}

export function WebMobileHeader({ title, subtitle, onOpenMenu, trailing, brandOnDark }: Props) {
  const { t } = useI18n()

  return (
    <header className="web-mobile-header flex lg:hidden">
      <button
        type="button"
        className="web-mobile-icon-btn shrink-0"
        aria-label={t('nav.mobile.menu')}
        onClick={onOpenMenu}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75">
          <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
        </svg>
      </button>
      <div className="min-w-0 flex-1 px-2">
        <p className="truncate text-sm font-bold text-ink">{title}</p>
        {subtitle && (
          <p className="truncate text-[11px] text-stone-500">{subtitle}</p>
        )}
      </div>
      {trailing}
      <FiberCellBrand variant={brandOnDark ? 'onDark' : 'page'} className="shrink-0 scale-90" />
    </header>
  )
}
