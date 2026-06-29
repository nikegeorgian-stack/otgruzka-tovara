import { useEffect } from 'react'
import { FiberCellBrand } from '@/components/brand/FiberCellBrand'
import { AdminCabinetSwitcher } from '@/components/auth/AdminCabinetSwitcher'
import { Button } from '@/components/ui/Button'
import { CloseIcon } from '@/components/ui/icons'
import { useConfirm } from '@/context/ConfirmContext'
import { viewNavIcon } from '@/components/layout/webMobileNavIcons'
import { useI18n } from '@/context/I18nContext'
import { isNavActive } from '@/lib/nav/viewRouting'
import type { AdminCabinetId } from '@/lib/access/adminCabinet'
import { roleLabel } from '@/lib/access/roles'
import type { AccessRoleId } from '@/lib/access/types'
import type { ViewId } from '@/lib/types'

export type MobileNavItem = {
  id: ViewId
  labelKey: string
  hintKey: string
}

type Props = {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  displayName?: string
  roleId?: AccessRoleId
  email?: string
  items: MobileNavItem[]
  activeView: ViewId
  onNavigate: (view: ViewId) => void
  onLogout?: () => void
  adminCabinet?: AdminCabinetId
  onAdminCabinetChange?: (cabinet: AdminCabinetId) => void
  showAdminTools?: boolean
  onExport?: () => void
  onImport?: () => void
  onReset?: () => void
}

export function WebMobileDrawer({
  open,
  onClose,
  title,
  subtitle,
  displayName,
  roleId,
  email,
  items,
  activeView,
  onNavigate,
  onLogout,
  adminCabinet,
  onAdminCabinetChange,
  showAdminTools,
  onExport,
  onImport,
  onReset,
}: Props) {
  const { t, locale, setLocale } = useI18n()
  const { confirm } = useConfirm()

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open) return null

  return (
    <div className="web-mobile-drawer lg:hidden" role="dialog" aria-modal="true">
      <button
        type="button"
        className="web-mobile-drawer__backdrop"
        aria-label={t('common.close')}
        onClick={onClose}
      />
      <div className="web-mobile-drawer__panel">
        <div className="flex items-start justify-between gap-3 border-b border-grid px-4 py-4">
          <div className="min-w-0">
            <FiberCellBrand variant="page" className="mb-2" />
            <h2 className="text-base font-bold text-ink">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-stone-500">{subtitle}</p>}
          </div>
          <button
            type="button"
            className="web-mobile-icon-btn"
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <CloseIcon size={18} />
          </button>
        </div>

        {(displayName || email) && (
          <div className="border-b border-grid px-4 py-3">
            {displayName && (
              <p className="truncate text-sm font-semibold text-ink">{displayName}</p>
            )}
            {roleId && (
              <p className="text-xs text-stone-500">{roleLabel(roleId, locale)}</p>
            )}
            {email && <p className="mt-0.5 truncate text-[11px] text-stone-400">{email}</p>}
          </div>
        )}

        <nav className="flex-1 overflow-y-auto px-3 py-3">
          <ul className="space-y-1">
            {items.map((item) => {
              const active = isNavActive(activeView, item.id)
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`web-mobile-drawer__nav ${active ? 'web-mobile-drawer__nav--active' : ''}`}
                    onClick={() => {
                      onNavigate(item.id)
                      onClose()
                    }}
                  >
                    <span className="shrink-0 text-accent">{viewNavIcon(item.id)}</span>
                    <span className="min-w-0 text-left">
                      <span className="block text-sm font-semibold">{t(item.labelKey)}</span>
                      <span className="block truncate text-[11px] text-stone-500">
                        {t(item.hintKey)}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="space-y-3 border-t border-grid px-4 py-4">
          <div className="fc-tabbar !gap-0.5 !p-0.5 !text-xs">
            {(['ru', 'ka'] as const).map((l) => (
              <button
                key={l}
                type="button"
                className={`fc-tabbar__tab flex-1 !px-2 !py-2 !text-xs ${
                  locale === l ? 'fc-tabbar__tab--active' : ''
                }`}
                onClick={() => setLocale(l)}
              >
                {l === 'ru' ? 'RU' : 'GE'}
              </button>
            ))}
          </div>

          {adminCabinet && onAdminCabinetChange && (
            <AdminCabinetSwitcher value={adminCabinet} onChange={onAdminCabinetChange} />
          )}

          {showAdminTools && (
            <div className="grid grid-cols-2 gap-2">
              {onExport && (
                <Button variant="secondary" size="sm" className="w-full !text-xs" onClick={onExport}>
                  {t('common.export')}
                </Button>
              )}
              {onImport && (
                <Button variant="secondary" size="sm" className="w-full !text-xs" onClick={onImport}>
                  {t('common.import')}
                </Button>
              )}
            </div>
          )}
          {showAdminTools && onReset && (
            <Button
              variant="danger"
              size="sm"
              className="w-full !text-xs"
              onClick={async () => {
                if (await confirm({ message: t('common.resetConfirm'), danger: true })) onReset()
              }}
            >
              {t('common.reset')}
            </Button>
          )}

          {onLogout && (
            <Button variant="secondary" size="sm" className="w-full" onClick={onLogout}>
              {t('access.switchAccount')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
