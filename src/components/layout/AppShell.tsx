import { startTransition, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { prefetchView } from '@/app/lazyPages'
import { FiberCellBrand } from '@/components/brand/FiberCellBrand'
import { WebAccountBar } from '@/components/web/WebAccountBar'
import { Button } from '@/components/ui/Button'
import { useI18n } from '@/context/I18nContext'
import { useConfirm } from '@/context/ConfirmContext'
import { AdminCabinetSwitcher } from '@/components/auth/AdminCabinetSwitcher'
import { WebMobileDrawer, type MobileNavItem } from '@/components/layout/WebMobileDrawer'
import { WebMobileHeader } from '@/components/layout/WebMobileHeader'
import { WebMobileNav } from '@/components/layout/WebMobileNav'
import { canShowNavItemForAdminPreview, type AdminCabinetId } from '@/lib/access/adminCabinet'
import { canAccessView, isSysAdmin } from '@/lib/access/permissions'
import { roleLabel } from '@/lib/access/roles'
import type { AccessStore, AppUser } from '@/lib/access/types'
import type { ViewId } from '@/lib/types'
import { exportToJson } from '@/lib/storage'
import type { AppStore } from '@/lib/types'

import { isNavActive } from '@/lib/nav/viewRouting'

type NavItem = { id: ViewId; labelKey: string; hintKey: string }

const NAV_GROUPS: { labelKey: string; items: NavItem[] }[] = [
  {
    labelKey: 'nav.group.timesheet',
    items: [
      { id: 'month', labelKey: 'nav.month', hintKey: 'nav.monthHint' },
      { id: 'summary', labelKey: 'nav.summary', hintKey: 'nav.summaryHint' },
    ],
  },
  {
    labelKey: 'nav.group.operations',
    items: [
      { id: 'director', labelKey: 'nav.director', hintKey: 'nav.directorHint' },
      { id: 'production', labelKey: 'nav.production', hintKey: 'nav.productionHint' },
      { id: 'planner', labelKey: 'nav.planner', hintKey: 'nav.plannerHint' },
      { id: 'warehouse', labelKey: 'nav.warehouse', hintKey: 'nav.warehouseHint' },
      { id: 'procurement', labelKey: 'nav.procurement', hintKey: 'nav.procurementHint' },
      { id: 'technologist', labelKey: 'nav.technologist', hintKey: 'nav.technologistHint' },
      { id: 'mixer', labelKey: 'nav.mixer', hintKey: 'nav.mixerHint' },
    ],
  },
    {
      labelKey: 'nav.group.data',
      items: [
        { id: 'hr', labelKey: 'nav.hr', hintKey: 'nav.hrHint' },
        { id: 'hr_inspector', labelKey: 'nav.hrInspector', hintKey: 'nav.hrInspectorHint' },
        { id: 'finance', labelKey: 'nav.finance', hintKey: 'nav.financeHint' },
        { id: 'directories', labelKey: 'nav.directories', hintKey: 'nav.directoriesHint' },
      ],
    },
  {
    labelKey: 'nav.group.system',
    items: [
      { id: 'journals', labelKey: 'nav.journals', hintKey: 'nav.journalsHint' },
      { id: 'it', labelKey: 'nav.it', hintKey: 'nav.itHint' },
      { id: 'settings', labelKey: 'nav.settings', hintKey: 'nav.settingsHint' },
    ],
  },
]

type Props = {
  store: AppStore
  access: AccessStore
  currentUser: AppUser | null
  view: ViewId
  onViewChange: (v: ViewId) => void
  onImport: () => void
  onReset: () => void
  onLogout?: () => void
  workspaceOpen?: boolean
  /** Облачный HR — компактное меню */
  webHrMode?: boolean
  /** Облачный финансовый отдел */
  webFinanceMode?: boolean
  /** Облачный кабинет кладовщика */
  webWarehouseMode?: boolean
  /** Облачный кабинет технолога */
  webTechnologistMode?: boolean
  /** Облачный кабинет закупок (импорт, контейнеры) */
  webProcurementMode?: boolean
  /** Облачный кабинет мастера цеха */
  webWorkshopMasterMode?: boolean
  webHrInspectorMode?: boolean
  /** Облачный кабинет — email и смена учётки */
  webAccount?: { displayName: string; email: string }
  /** Предпросмотр кабинета (только sysadmin) */
  adminCabinet?: AdminCabinetId
  onAdminCabinetChange?: (cabinet: AdminCabinetId) => void
  isFstWeb?: boolean
  children: ReactNode
}

export function AppShell({
  store,
  access,
  currentUser,
  view,
  onViewChange,
  onImport,
  onReset,
  onLogout,
  workspaceOpen,
  webHrMode,
  webFinanceMode,
  webWarehouseMode,
  webTechnologistMode,
  webProcurementMode,
  webWorkshopMasterMode,
  webHrInspectorMode,
  webAccount,
  adminCabinet = 'full',
  onAdminCabinetChange,
  isFstWeb = false,
  children,
}: Props) {
  const { t, locale, setLocale } = useI18n()
  const { confirm } = useConfirm()
  const isAdmin = isSysAdmin(currentUser)

  const navGroups = NAV_GROUPS

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [navPending, setNavPending] = useState<ViewId | null>(null)
  const navView = navPending ?? view

  useEffect(() => {
    setNavPending(null)
  }, [view])

  const navigateView = useCallback(
    (next: ViewId) => {
      if (next === view && navPending === null) return
      setNavPending(next)
      prefetchView(next)
      startTransition(() => {
        onViewChange(next)
      })
    },
    [view, navPending, onViewChange],
  )

  function navItemAllowed(itemId: ViewId): boolean {
    if (isAdmin && adminCabinet !== 'full') {
      return canShowNavItemForAdminPreview(
        access,
        currentUser,
        itemId,
        adminCabinet,
        isFstWeb,
      )
    }
    return canAccessView(access, currentUser, itemId)
  }

  const flatNavItems = useMemo((): MobileNavItem[] => {
    const out: MobileNavItem[] = []
    for (const group of navGroups) {
      for (const item of group.items) {
        const allowed = navItemAllowed(item.id)
        if (allowed) out.push(item)
      }
    }
    return out
  }, [navGroups, access, currentUser, isAdmin, adminCabinet, isFstWeb])

  const cabinetMeta = useMemo(() => {
    if (webHrMode) return { title: t('web.hr.title'), subtitle: t('web.hr.subtitle') }
    if (webHrInspectorMode) {
      return { title: t('web.hrInspector.title'), subtitle: t('web.hrInspector.subtitle') }
    }
    if (webFinanceMode) return { title: t('web.finance.title'), subtitle: t('web.finance.subtitle') }
    if (webWarehouseMode) return { title: t('web.warehouse.title'), subtitle: t('web.warehouse.subtitle') }
    if (webTechnologistMode) {
      return { title: t('web.technologist.title'), subtitle: t('web.technologist.subtitle') }
    }
    if (webProcurementMode) return { title: t('web.procurement.title'), subtitle: t('web.procurement.subtitle') }
    if (webWorkshopMasterMode) {
      return { title: t('web.workshopMaster.title'), subtitle: t('web.workshopMaster.subtitle') }
    }
    return { title: t('app.title'), subtitle: t('app.subtitle') }
  }, [
    t,
    webHrMode,
    webHrInspectorMode,
    webFinanceMode,
    webWarehouseMode,
    webTechnologistMode,
    webProcurementMode,
    webWorkshopMasterMode,
  ])

  const activeNavItem = flatNavItems.find((item) => isNavActive(navView, item.id))
  const mobileHeaderTitle = activeNavItem ? t(activeNavItem.labelKey) : cabinetMeta.title
  const mobileHeaderSubtitle = activeNavItem ? t(activeNavItem.hintKey) : cabinetMeta.subtitle

  const showAdminTools =
    isAdmin &&
    adminCabinet === 'full' &&
    !webHrMode &&
    !webHrInspectorMode &&
    !webFinanceMode &&
    !webWarehouseMode &&
    !webTechnologistMode &&
    !webProcurementMode &&
    !webWorkshopMasterMode

  return (
    <div className="app-shell flex min-h-[100dvh] flex-col lg:flex-row">
      <aside className="app-sidebar hidden w-56 shrink-0 flex-col border-r border-stone-300/80 print:hidden lg:flex">
        <div className="border-b border-stone-300/80 px-4 py-4">
          <FiberCellBrand variant="sidebar" className="mb-3" />
          {webHrMode ? (
            <>
              <h1 className="text-lg font-bold leading-tight text-ink">{t('web.hr.title')}</h1>
              <p className="mt-1 text-xs text-ink-muted">{t('web.hr.subtitle')}</p>
            </>
          ) : webHrInspectorMode ? (
            <>
              <h1 className="text-lg font-bold leading-tight text-ink">{t('web.hrInspector.title')}</h1>
              <p className="mt-1 text-xs text-ink-muted">{t('web.hrInspector.subtitle')}</p>
            </>
          ) : webFinanceMode ? (
            <>
              <h1 className="text-lg font-bold leading-tight text-ink">{t('web.finance.title')}</h1>
              <p className="mt-1 text-xs text-ink-muted">{t('web.finance.subtitle')}</p>
            </>
          ) : webWarehouseMode ? (
            <>
              <h1 className="text-lg font-bold leading-tight text-ink">{t('web.warehouse.title')}</h1>
              <p className="mt-1 text-xs text-ink-muted">{t('web.warehouse.subtitle')}</p>
            </>
          ) : webTechnologistMode ? (
            <>
              <h1 className="text-lg font-bold leading-tight text-ink">{t('web.technologist.title')}</h1>
              <p className="mt-1 text-xs text-ink-muted">{t('web.technologist.subtitle')}</p>
            </>
          ) : webProcurementMode ? (
            <>
              <h1 className="text-lg font-bold leading-tight text-ink">{t('web.procurement.title')}</h1>
              <p className="mt-1 text-xs text-ink-muted">{t('web.procurement.subtitle')}</p>
            </>
          ) : webWorkshopMasterMode ? (
            <>
              <h1 className="text-lg font-bold leading-tight text-ink">{t('web.workshopMaster.title')}</h1>
              <p className="mt-1 text-xs text-ink-muted">{t('web.workshopMaster.subtitle')}</p>
            </>
          ) : (
            <>
              <h1 className="text-lg font-bold leading-tight text-ink">{t('app.title')}</h1>
              <p className="mt-1 text-xs text-ink-muted">{t('app.subtitle')}</p>
            </>
          )}
          {currentUser && (
            <div className="mt-3 rounded-sm bg-stone-100/80 px-2.5 py-2">
              <p className="truncate text-xs font-semibold text-ink">{currentUser.displayName}</p>
              <p className="truncate text-[10px] text-stone-500">
                {roleLabel(currentUser.roleId, locale)}
              </p>
            </div>
          )}
          {isAdmin && onAdminCabinetChange && (
            <AdminCabinetSwitcher value={adminCabinet} onChange={onAdminCabinetChange} />
          )}
          {webAccount && onLogout && (
            <div className="mt-3">
              <WebAccountBar
                displayName={webAccount.displayName}
                email={webAccount.email}
                onLogout={onLogout}
              />
            </div>
          )}
          <div className="fc-tabbar mt-3 !gap-0.5 !p-0.5 !text-xs">
            {(['ru', 'ka'] as const).map((l) => (
              <button
                key={l}
                type="button"
                className={`fc-tabbar__tab flex-1 !px-2 !py-1 !text-xs ${
                  locale === l ? 'fc-tabbar__tab--active' : ''
                }`}
                onClick={() => setLocale(l)}
              >
                {l === 'ru' ? 'RU' : 'GE'}
              </button>
            ))}
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
          {navGroups.map((group) => {
            const items = group.items.filter((item) => navItemAllowed(item.id))
            if (items.length === 0) return null
            return (
              <div key={group.labelKey}>
                <p className="fc-nav-group__label">{t(group.labelKey)}</p>
                <div className="mt-0.5 flex flex-col gap-0.5">
                  {items.map((item) => {
                    const active = isNavActive(navView, item.id)
                    return (
                      <button
                        key={item.id}
                        type="button"
                        data-coach={`nav:${item.id}`}
                        onMouseEnter={() => prefetchView(item.id)}
                        onFocus={() => prefetchView(item.id)}
                        onClick={() => navigateView(item.id)}
                        className={`fc-nav-item ${active ? 'fc-nav-item--active' : ''}`}
                      >
                        <div className="fc-nav-item__title">{t(item.labelKey)}</div>
                        <div className="fc-nav-item__hint">{t(item.hintKey)}</div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </nav>
        <div className="space-y-2 border-t border-stone-300/80 p-3">
          {isAdmin && adminCabinet === 'full' && !webHrMode && !webHrInspectorMode && !webFinanceMode && !webWarehouseMode && !webTechnologistMode && !webProcurementMode && !webWorkshopMasterMode && (
            <>
              <Button
                variant="secondary"
                size="sm"
                className="w-full !text-xs"
                onClick={() => exportToJson(store)}
              >
                {t('common.export')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="w-full !text-xs"
                onClick={onImport}
              >
                {t('common.import')}
              </Button>
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
            </>
          )}
          {onLogout && !webAccount && (
            <Button variant="secondary" size="sm" className="w-full !text-xs" onClick={onLogout}>
              {t('access.logout')}
            </Button>
          )}
        </div>
      </aside>

      <div className={`flex min-w-0 flex-1 flex-col ${workspaceOpen ? 'lg:pb-14' : ''}`}>
        <WebMobileHeader
          title={mobileHeaderTitle}
          subtitle={mobileHeaderSubtitle}
          onOpenMenu={() => setMobileMenuOpen(true)}
        />
        {webAccount && onLogout && (
          <div className="hidden lg:block">
            <WebAccountBar
              compact
              displayName={webAccount.displayName}
              email={webAccount.email}
              onLogout={onLogout}
            />
          </div>
        )}
        <main className="app-shell-main min-h-0 flex-1 overflow-x-hidden">{children}</main>
      </div>

      <WebMobileNav
        items={flatNavItems}
        activeView={navView}
        onNavigate={navigateView}
        onOpenMenu={() => setMobileMenuOpen(true)}
      />

      <WebMobileDrawer
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        title={cabinetMeta.title}
        subtitle={cabinetMeta.subtitle}
        displayName={webAccount?.displayName ?? currentUser?.displayName}
        roleId={currentUser?.roleId}
        email={webAccount?.email}
        items={flatNavItems}
        activeView={navView}
        onNavigate={navigateView}
        onLogout={onLogout}
        adminCabinet={isAdmin ? adminCabinet : undefined}
        onAdminCabinetChange={isAdmin ? onAdminCabinetChange : undefined}
        showAdminTools={showAdminTools}
        onExport={showAdminTools ? () => exportToJson(store) : undefined}
        onImport={showAdminTools ? onImport : undefined}
        onReset={showAdminTools ? onReset : undefined}
      />
    </div>
  )
}
