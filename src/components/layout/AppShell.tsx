import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { prefetchView } from '@/app/lazyPages'
import { FiberCellBrand } from '@/components/brand/FiberCellBrand'
import { WebAccountBar } from '@/components/web/WebAccountBar'
import { Button } from '@/components/ui/Button'
import { useI18n } from '@/context/I18nContext'
import { LOCALES, type Locale } from '@/i18n'
import { useConfirm } from '@/context/ConfirmContext'
import { AdminCabinetSwitcher } from '@/components/auth/AdminCabinetSwitcher'
import { WebMobileDrawer, type MobileNavItem } from '@/components/layout/WebMobileDrawer'
import { WebMobileHeader } from '@/components/layout/WebMobileHeader'
import { WebMobileNav } from '@/components/layout/WebMobileNav'
import { SupportToolsBar } from '@/components/layout/SupportToolsBar'
import { viewNavIcon } from '@/components/layout/webMobileNavIcons'
import { DirectorRiskBell } from '@/components/director/DirectorRiskBell'
import { releaseUiChrome } from '@/lib/ui/overlayEvents'
import {
  applySidebarExpandedToDom,
  readSidebarExpanded,
  writeSidebarExpanded,
} from '@/lib/ui/chromeLayout'
import { canAccessView, canShowNavItemForAdminPreview, isSysAdmin, viewsForUser } from '@/lib/access/permissions'
import { accessPersona, isDirectorHqPersona } from '@/lib/access/accessPersona'
import type { AdminCabinetId } from '@/lib/access/adminCabinet'
import { roleLabel } from '@/lib/access/roles'
import type { AccessStore, AppUser } from '@/lib/access/types'
import type { ViewId } from '@/lib/types'
import { exportToJson } from '@/lib/storage'
import type { AppStore } from '@/lib/types'

import { isNavActive } from '@/lib/nav/viewRouting'

function localeShort(id: Locale): string {
  if (id === 'ka') return 'GE'
  if (id === 'en') return 'EN'
  return 'RU'
}

type NavItem = { id: ViewId; labelKey: string; hintKey: string }

const NAV_GROUPS: { labelKey: string; items: NavItem[] }[] = [
  {
    labelKey: 'nav.group.personal',
    items: [
      { id: 'tasks', labelKey: 'nav.tasks', hintKey: 'nav.tasksHint' },
      { id: 'my', labelKey: 'nav.my', hintKey: 'nav.myHint' },
      { id: 'meals', labelKey: 'nav.meals', hintKey: 'nav.mealsHint' },
      { id: 'protocols', labelKey: 'nav.protocols', hintKey: 'nav.protocolsHint' },
    ],
  },
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
      { id: 'otc', labelKey: 'nav.otc', hintKey: 'nav.otcHint' },
      { id: 'mixer', labelKey: 'nav.mixer', hintKey: 'nav.mixerHint' },
      { id: 'engineer_log', labelKey: 'nav.engineerLog', hintKey: 'nav.engineerLogHint' },
    ],
  },
    {
      labelKey: 'nav.group.data',
      items: [
        { id: 'hr', labelKey: 'nav.hr', hintKey: 'nav.hrHint' },
        { id: 'hr_inspector', labelKey: 'nav.hrInspector', hintKey: 'nav.hrInspectorHint' },
        { id: 'org_tree', labelKey: 'nav.orgTree', hintKey: 'nav.orgTreeHint' },
        { id: 'office', labelKey: 'nav.office', hintKey: 'nav.officeHint' },
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
  /** Облачный кабинет системного администратора */
  webAdminMode?: boolean
  /** Облачный кабинет — email и смена учётки */
  webAccount?: { displayName: string; email: string }
  /** Предпросмотр кабинета (только sysadmin) */
  adminCabinet?: AdminCabinetId
  onAdminCabinetChange?: (cabinet: AdminCabinetId) => void
  isFstWeb?: boolean
  /** Sysadmin: объявить плановое обновление (5 мин). */
  onAnnounceMaintenance?: () => void
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
  webAdminMode,
  webAccount,
  adminCabinet = 'full',
  onAdminCabinetChange,
  isFstWeb = false,
  onAnnounceMaintenance,
  children,
}: Props) {
  const { t, locale, setLocale } = useI18n()
  const { confirm } = useConfirm()
  const isAdmin = isSysAdmin(currentUser)
  const persona = accessPersona(currentUser, adminCabinet)
  const directorHq = isDirectorHqPersona(currentUser, adminCabinet)
  const personaRole = persona?.roleId ?? currentUser?.roleId
  const employeePortal =
    currentUser?.roleId === 'employee' ||
    (viewsForUser(access, currentUser).length === 1 &&
      viewsForUser(access, currentUser)[0] === 'my')
  const timeclockPortal =
    currentUser?.roleId === 'timeclock' ||
    (viewsForUser(access, currentUser).length === 1 &&
      viewsForUser(access, currentUser)[0] === 'timeclock')

  const navGroups = NAV_GROUPS

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [navPending, setNavPending] = useState<ViewId | null>(null)
  const [sidebarExpanded, setSidebarExpanded] = useState(readSidebarExpanded)
  const [dataToolsOpen, setDataToolsOpen] = useState(false)
  const navView = navPending ?? view

  useLayoutEffect(() => {
    applySidebarExpandedToDom(sidebarExpanded)
    writeSidebarExpanded(sidebarExpanded)
  }, [sidebarExpanded])

  useEffect(() => {
    setNavPending(null)
  }, [view])

  const navigateView = useCallback(
    (next: ViewId) => {
      if (next === view && navPending === null) return
      setMobileMenuOpen(false)
      releaseUiChrome()
      setNavPending(next)
      prefetchView(next)
      startTransition(() => {
        onViewChange(next)
      })
    },
    [view, navPending, onViewChange],
  )

  useEffect(() => {
    if (navPending === null) return
    const t = window.setTimeout(() => setNavPending(null), 4000)
    return () => window.clearTimeout(t)
  }, [navPending, view])

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
    if (webAdminMode) return { title: t('web.admin.title'), subtitle: t('web.admin.subtitle') }
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
    if (directorHq) {
      return { title: t('web.director.title'), subtitle: t('web.director.subtitle') }
    }
    return { title: t('app.title'), subtitle: t('app.subtitle') }
  }, [
    t,
    directorHq,
    webAdminMode,
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

  const riskBell = (
    <DirectorRiskBell
      store={store}
      enabled={canAccessView(access, currentUser, 'director')}
      onOpenDirector={() => navigateView('director')}
    />
  )

  const showAdminTools =
    isAdmin &&
    adminCabinet === 'full' &&
    !webAdminMode &&
    !webHrMode &&
    !webHrInspectorMode &&
    !webFinanceMode &&
    !webWarehouseMode &&
    !webTechnologistMode &&
    !webProcurementMode &&
    !webWorkshopMasterMode

  if (employeePortal || timeclockPortal) {
    return (
      <div className="app-shell flex min-h-[100dvh] flex-col bg-[#faf8f4]">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-stone-200/80 bg-[#faf8f4]/95 px-4 py-3 backdrop-blur print:hidden">
          <FiberCellBrand variant="page" />
          <div className="flex items-center gap-2">
            {timeclockPortal ? (
              <span className="hidden text-xs font-medium text-stone-500 sm:inline">
                {t('timeclock.title')}
              </span>
            ) : (
              <div className="fc-tabbar !gap-0.5 !p-0.5 !text-[10px]">
                {(
                  [
                    ['my', 'nav.my'],
                    ['meals', 'nav.meals'],
                  ] as const
                ).map(([id, key]) => (
                  <button
                    key={id}
                    type="button"
                    data-coach={`nav:${id}`}
                    className={`fc-tabbar__tab !px-2 !py-1 ${view === id ? 'fc-tabbar__tab--active' : ''}`}
                    onClick={() => navigateView(id)}
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
            )}
            <div className="fc-tabbar !gap-0.5 !p-0.5 !text-[10px]">
              {LOCALES.map(({ id }) => (
                <button
                  key={id}
                  type="button"
                  className={`fc-tabbar__tab !px-2 !py-1 ${locale === id ? 'fc-tabbar__tab--active' : ''}`}
                  onClick={() => setLocale(id)}
                >
                  {localeShort(id)}
                </button>
              ))}
            </div>
            {onLogout ? (
              <Button variant="secondary" size="sm" className="!text-xs" onClick={onLogout}>
                {t('access.logout')}
              </Button>
            ) : null}
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-x-hidden">{children}</main>
      </div>
    )
  }

  return (
    <div className="app-shell flex min-h-[100dvh] flex-col lg:flex-row">
      <aside
        className={`app-sidebar relative hidden shrink-0 flex-col border-r border-stone-300/80 print:hidden lg:flex ${
          sidebarExpanded ? '' : 'app-sidebar--collapsed'
        }`}
      >
        <button
          type="button"
          className="app-sidebar__rail-toggle"
          title={sidebarExpanded ? t('nav.sidebar.collapse') : t('nav.sidebar.expand')}
          aria-label={sidebarExpanded ? t('nav.sidebar.collapse') : t('nav.sidebar.expand')}
          aria-expanded={sidebarExpanded}
          onClick={() => setSidebarExpanded((v) => !v)}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
            {sidebarExpanded ? (
              <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            )}
          </svg>
        </button>
        <div className="app-sidebar__head flex flex-col border-b border-stone-300/80 px-2.5 py-2.5">
          <div className="flex items-center justify-between gap-1">
            <FiberCellBrand
              variant="sidebar"
              className={sidebarExpanded ? 'min-w-0 flex-1' : ''}
            />
            {sidebarExpanded ? (
              <button
                type="button"
                className="app-sidebar__head-toggle shrink-0 rounded-md p-1.5 text-stone-500 hover:bg-stone-200/80 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                title={t('nav.sidebar.collapse')}
                aria-label={t('nav.sidebar.collapse')}
                aria-expanded={sidebarExpanded}
                onClick={() => setSidebarExpanded(false)}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
                  <path d="M15 6l-6 6 6 6M4 4v16" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ) : null}
          </div>
          <div className="app-sidebar__brand-text mt-1.5">
            <h1 className="text-[13px] font-bold leading-snug text-ink text-pretty">
              {cabinetMeta.title}
            </h1>
          </div>
          {sidebarExpanded && webAccount && onLogout ? (
            <div className="app-sidebar__user mt-2 min-w-0 border-t border-stone-200/80 pt-2">
              <WebAccountBar
                variant="sidebar"
                displayName={webAccount.displayName}
                email={webAccount.email}
                onLogout={onLogout}
                leading={riskBell}
              />
              {personaRole ? (
                <p className="mt-0.5 truncate text-[10px] text-stone-400">
                  {roleLabel(personaRole, locale)}
                </p>
              ) : null}
            </div>
          ) : null}
          {sidebarExpanded && !webAccount && currentUser ? (
            <div className="app-sidebar__user mt-2 flex min-w-0 items-start gap-1.5">
              {riskBell}
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-ink">{currentUser.displayName}</p>
                <p className="truncate text-[10px] text-stone-500">
                  {roleLabel(personaRole ?? currentUser.roleId, locale)}
                </p>
              </div>
            </div>
          ) : null}
          {isAdmin && onAdminCabinetChange ? (
            <div className={sidebarExpanded ? 'mt-2' : 'mt-2 px-0.5'}>
              {sidebarExpanded ? (
                <AdminCabinetSwitcher
                  density="sidebar"
                  value={adminCabinet}
                  onChange={onAdminCabinetChange}
                />
              ) : (
                <label className="block" title={t('access.cabinetSwitcherLabel')}>
                  <span className="sr-only">{t('access.cabinetSwitcherLabel')}</span>
                  <select
                    className="w-full max-w-full rounded-md border border-stone-300/90 bg-white px-0.5 py-1.5 text-center text-[10px] font-medium text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                    value={adminCabinet}
                    onChange={(e) => onAdminCabinetChange(e.target.value as typeof adminCabinet)}
                    aria-label={t('access.cabinetSwitcherLabel')}
                  >
                    <option value="full">ADM</option>
                    <option value="hr">HR</option>
                    <option value="hr_inspector">INS</option>
                    <option value="finance">FIN</option>
                    <option value="warehouse_keeper">WH</option>
                    <option value="procurement_manager">PRC</option>
                    <option value="technologist">TEC</option>
                    <option value="otc">OTC</option>
                    <option value="mixer">MIX</option>
                    <option value="chief_engineer">ENG</option>
                    <option value="workshop_master">WSM</option>
                    <option value="operations_director">DIR</option>
                    <option value="employee">EMP</option>
                    <option value="cook">COOK</option>
                  </select>
                </label>
              )}
            </div>
          ) : null}
          <div className="app-sidebar__lang fc-tabbar mt-2 !gap-0.5 !p-0.5 !text-[11px]">
            {LOCALES.map(({ id }) => (
              <button
                key={id}
                type="button"
                className={`fc-tabbar__tab flex-1 !px-1 !py-1 !text-[11px] ${
                  locale === id ? 'fc-tabbar__tab--active' : ''
                }`}
                onClick={() => setLocale(id)}
              >
                {localeShort(id)}
              </button>
            ))}
          </div>
        </div>
        <nav className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
          {navGroups.map((group) => {
            const items = group.items.filter((item) => navItemAllowed(item.id))
            if (items.length === 0) return null
            return (
              <div key={group.labelKey}>
                <p className="fc-nav-group__label">{t(group.labelKey)}</p>
                <div className="mt-0.5 flex flex-col gap-0.5">
                  {items.map((item) => {
                    const active = isNavActive(navView, item.id)
                    const label = t(item.labelKey)
                    return (
                      <button
                        key={item.id}
                        type="button"
                        data-coach={`nav:${item.id}`}
                        title={label}
                        aria-label={label}
                        onMouseEnter={() => prefetchView(item.id)}
                        onFocus={() => prefetchView(item.id)}
                        onClick={() => navigateView(item.id)}
                        className={`fc-nav-item ${active ? 'fc-nav-item--active' : ''}`}
                      >
                        <span className="fc-nav-item__icon text-current">
                          {viewNavIcon(item.id, 'h-5 w-5')}
                        </span>
                        <span className="min-w-0">
                          <div className="fc-nav-item__title">{label}</div>
                          <div className="fc-nav-item__hint">{t(item.hintKey)}</div>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </nav>
        <div className="app-sidebar__footer shrink-0 space-y-1.5 border-t border-stone-300/80 p-2">
          <div className="app-sidebar__footer-actions">
            {isAdmin &&
            adminCabinet === 'full' &&
            !webHrMode &&
            !webHrInspectorMode &&
            !webFinanceMode &&
            !webWarehouseMode &&
            !webTechnologistMode &&
            !webProcurementMode &&
            !webWorkshopMasterMode ? (
              <div className="rounded-md border border-stone-200/90 bg-white/70">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-1 px-2 py-1.5 text-left text-[11px] font-semibold text-stone-600 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                  aria-expanded={dataToolsOpen}
                  onClick={() => setDataToolsOpen((v) => !v)}
                >
                  {t('common.dataTools')}
                  <span
                    className={`text-stone-400 transition-transform ${dataToolsOpen ? 'rotate-180' : ''}`}
                    aria-hidden
                  >
                    ▾
                  </span>
                </button>
                {dataToolsOpen ? (
                  <div className="space-y-1 border-t border-stone-100 px-1.5 pb-1.5 pt-1">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-full !py-1 !text-[11px]"
                      onClick={() => exportToJson(store)}
                    >
                      {t('common.export')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-full !py-1 !text-[11px]"
                      onClick={onImport}
                    >
                      {t('common.import')}
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      className="w-full !py-1 !text-[11px]"
                      onClick={async () => {
                        if (await confirm({ message: t('common.resetConfirm'), danger: true })) onReset()
                      }}
                    >
                      {t('common.reset')}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {onLogout && !webAccount ? (
              <Button
                variant="secondary"
                size="sm"
                className="mt-1 w-full !text-[11px]"
                onClick={onLogout}
              >
                {t('access.logout')}
              </Button>
            ) : null}
          </div>
          <SupportToolsBar
            showMail={currentUser?.roleId === 'sysadmin'}
            onAnnounceMaintenance={onAnnounceMaintenance}
            showDownloads={isFstWeb}
            compact={!sidebarExpanded}
          />
        </div>
      </aside>

      <div className={`flex min-w-0 flex-1 flex-col ${workspaceOpen ? 'lg:pb-14' : ''}`}>
        <WebMobileHeader
          title={mobileHeaderTitle}
          subtitle={mobileHeaderSubtitle}
          onOpenMenu={() => setMobileMenuOpen(true)}
          trailing={riskBell}
        />
        {webAccount && onLogout && !sidebarExpanded ? (
          <div className="hidden lg:block print:hidden">
            <WebAccountBar
              compact
              displayName={webAccount.displayName}
              email={webAccount.email}
              onLogout={onLogout}
              leading={riskBell}
            />
          </div>
        ) : null}
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
        roleId={personaRole}
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
        showSupportMail={currentUser?.roleId === 'sysadmin'}
        onAnnounceMaintenance={onAnnounceMaintenance}
      />
    </div>
  )
}
