import { viewNavIcon } from '@/components/layout/webMobileNavIcons'
import type { MobileNavItem } from '@/components/layout/WebMobileDrawer'
import { useI18n } from '@/context/I18nContext'
import { isNavActive } from '@/lib/nav/viewRouting'
import type { ViewId } from '@/lib/types'

type Props = {
  items: MobileNavItem[]
  activeView: ViewId
  onNavigate: (view: ViewId) => void
  onOpenMenu: () => void
}

export function WebMobileNav({ items, activeView, onNavigate, onOpenMenu }: Props) {
  const { t } = useI18n()

  if (items.length === 0) return null

  const showMenu = items.length > 5

  return (
    <nav
      className="web-mobile-nav lg:hidden"
      aria-label={t('nav.mobile.label')}
    >
      <div className="web-mobile-nav__inner">
        {items.slice(0, showMenu ? 4 : items.length).map((item) => {
          const active = isNavActive(activeView, item.id)
          return (
            <button
              key={item.id}
              type="button"
              className={`web-mobile-nav__item ${active ? 'web-mobile-nav__item--active' : ''}`}
              onClick={() => onNavigate(item.id)}
            >
              {viewNavIcon(item.id, 'h-5 w-5')}
              <span className="web-mobile-nav__label">{t(item.labelKey)}</span>
            </button>
          )
        })}
        {showMenu && (
          <button
            type="button"
            className="web-mobile-nav__item"
            onClick={onOpenMenu}
            aria-label={t('nav.mobile.menu')}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            </svg>
            <span className="web-mobile-nav__label">{t('nav.mobile.menu')}</span>
          </button>
        )}
      </div>
    </nav>
  )
}
