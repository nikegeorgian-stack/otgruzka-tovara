import { useMemo, useState, Fragment, useCallback, useEffect, useRef } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { FormNotice } from '@/components/ui/FormNotice'
import { KpiCard } from '@/components/ui/KpiCard'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageLayout } from '@/components/ui/PageLayout'
import { TabBar } from '@/components/ui/TabBar'
import { WarehouseAnalyticsTab } from '@/components/warehouse/WarehouseAnalyticsTab'
import { WarehouseAuditTab } from '@/components/warehouse/WarehouseAuditTab'
import { WarehouseDocumentsTab } from '@/components/warehouse/WarehouseDocumentsTab'
import { WarehouseImportTab } from '@/components/warehouse/WarehouseImportTab'
import { WarehouseMovementsTab } from '@/components/warehouse/WarehouseMovementsTab'
import { WarehouseDailyIssueModal } from '@/components/warehouse/WarehouseDailyIssueModal'
import { WarehouseWorkwearTab } from '@/components/warehouse/WarehouseWorkwearTab'
import { WarehouseItemRenameRequestsPanel } from '@/components/warehouse/WarehouseItemRenameRequestsPanel'
import { WarehouseItemRequestsPanel } from '@/components/warehouse/WarehouseItemRequestsPanel'
import { ProductionRequestsPanel } from '@/components/warehouse/ProductionRequestsPanel'
import { BatchConfirmRequestsPanel } from '@/components/warehouse/BatchConfirmRequestsPanel'
import { WarehouseInventoryTab } from '@/components/warehouse/WarehouseInventoryTab'
import { AsOfSnapshotBar } from '@/components/asOf/AsOfSnapshotBar'
import { ProductionDaySnapshot } from '@/components/production/ProductionDaySnapshot'
import { useAsOfSnapshot } from '@/hooks/useAsOfSnapshot'
import { WarehouseLoadingTab } from '@/components/warehouse/WarehouseLoadingTab'
import { KeeperReplenishmentPanel } from '@/components/warehouse/KeeperReplenishmentPanel'
import { WarehouseLabelPrintModal } from '@/components/warehouse/WarehouseLabelPrintModal'
import { WarehouseViewDefaultsDialog } from '@/components/warehouse/WarehouseViewDefaultsDialog'
import { PageActionOverflow } from '@/components/ui/PageActionOverflow'
import { WorkspaceWidgetDrawer } from '@/components/ui/workspace/WorkspaceWidgetDrawer'
import {
  WorkspaceWidgetChip,
  WorkspaceWidgetRail,
} from '@/components/ui/workspace/WorkspaceWidgetRail'
import { useWorkspaceWidgets } from '@/hooks/useWorkspaceWidgets'
import type { WorkspaceWidgetDef } from '@/lib/ui/workspaceWidgets'
import { WarehouseItemThumb } from '@/components/warehouse/WarehouseItemThumb'
import {
  UNITS,
  WAREHOUSE_TABS,
  WAREHOUSE_WEB_TABS,
  type WarehousePageProps,
  type WarehouseTab,
} from '@/components/warehouse/warehouseTypes'
import { findOpenDailyIssue, sessionLineCount } from '@/lib/warehouse/dailyIssue'
import { compressItemPhoto } from '@/lib/warehouse/itemPhoto'
import { useI18n } from '@/context/I18nContext'
import { useConfirm } from '@/context/ConfirmContext'
import { requestModalClose } from '@/lib/ui/requestModalClose'
import { WAREHOUSE_PICK_EVENT, consumePendingWarehousePick, type WarehousePickDetail } from '@/lib/ai/warehousePickEvent'
import { printWarehouseBalances } from '@/lib/warehouse/print'
import { getItemHistory } from '@/lib/warehouse/itemHistory'
import { unitLabel, unitsConvertible } from '@/lib/warehouse/units'
import {
  avgCostForItem,
  computeAllBalances,
  computeAllBalancesAsOf,
  formatQty,
  itemStockValue,
  lowStockItems,
  priceHistoryForItem,
} from '@/lib/warehouse/stock'
import type {
  StockMovementType,
  WarehouseCategory,
  WarehouseItem,
  WarehouseLocation,
} from '@/lib/warehouse/types'

export function WarehousePage(props: WarehousePageProps) {
  const {
    warehouse,
    workwear,
    employees,
    brigades,
    embedded,
    webWarehouseMode = false,
    webUserName,
    printMeta,
    onUpsertItem,
    onArchiveItem,
    onRemoveItem,
    onUpsertCategory,
    onUpsertLocation,
    onAddMovement,
    onDeleteMovement,
    onPostDocument,
    onRunInventory,
    onPostOpeningBalances,
    onImportExcel,
    onExportExcel,
    onMergeInvoiceRegistry,
    keeperId,
    keeperName,
    allowNegativeStock = false,
    canCancelDocuments = false,
    canUnpostDocuments = false,
    counterparties,
    productionRequests,
    onPostTransfer,
    onCancelDocument,
    onSaveDocumentDraft,
    onPostExistingDocument,
    onUnpostDocument,
    onRemoveDocumentDraft,
    onAcquireDocumentLock,
    onReleaseDocumentLock,
    onOpenDailyIssueSession,
    onAdjustDailyIssueLine,
    onSetDailyIssueComment,
    onPostDailyIssueSession,
    onResolveWarehouseItemRequest,
    onResolveWarehouseItemRenameRequest,
    onCreateKeeperReplenishment,
    onCreateReplenishmentFromDeficit,
    onUpdateKeeperReplenishment,
    onSubmitKeeperReplenishment,
    onCancelKeeperReplenishment,
    onReceiveKeeperReplenishment,
    onUpsertLoadingShipment,
    onPostLoadingShipment,
    onRemoveLoadingShipment,
    finishedProducts,
    packagingRecipes,
    salesOrders,
    onOpenSalesOrder,
    onUpsertFinishedProduct,
    onUpsertCounterparty,
    onOpenCounterparties,
    pendingBatchRuns,
    onConfirmFormulationBatch,
    onRejectFormulationBatch,
    onUpsertWorkwearCatalogItem,
    onArchiveWorkwearCatalogItem,
    onPostWorkwearIssuance,
    brigadeNamesKa,
    onSaveProductionRequest,
    onPostProductionRequest,
    journalNav,
    onJournalNavConsumed,
    userWarehouseDefaults,
    currentUserId,
    onSaveViewDefaults,
  } = props

  const { t, tf } = useI18n()
  const [tab, setTab] = useState<WarehouseTab>(
    embedded ? 'nomenclature' : (userWarehouseDefaults?.tab ?? 'balances'),
  )
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [warehouseId, setWarehouseId] = useState(userWarehouseDefaults?.warehouseId ?? '')
  const [deficitOnly, setDeficitOnly] = useState(userWarehouseDefaults?.deficitOnly ?? false)
  const [showArchived, setShowArchived] = useState(userWarehouseDefaults?.showArchived ?? false)
  const [defaultsOpen, setDefaultsOpen] = useState(false)
  const widgets = useWorkspaceWidgets(embedded ? 'warehouse-embedded' : 'warehouse')
  const [editItem, setEditItem] = useState<WarehouseItem | null>(null)
  const [cardItem, setCardItem] = useState<WarehouseItem | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [pendingJournalDocId, setPendingJournalDocId] = useState<string | null>(null)
  const [pendingJournalLoadingId, setPendingJournalLoadingId] = useState<string | null>(null)
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  })
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10))
  const asOf = useAsOfSnapshot()
  const {
    enabled: asOfEnabled,
    setEnabled: setAsOfEnabled,
    date: asOfDate,
    setDate: setAsOfDate,
    time: asOfTime,
    setTime: setAsOfTime,
    scope: asOfScope,
    setScope: setAsOfScope,
    asOfIso,
  } = asOf
  const [pendingAiPick, setPendingAiPick] = useState<WarehousePickDetail | null>(null)
  const [labelPrintIds, setLabelPrintIds] = useState<string[] | null>(null)
  const [dailyIssueSessionId, setDailyIssueSessionId] = useState<string | null>(null)

  const today = new Date().toISOString().slice(0, 10)
  const resolvedKeeperId = keeperId ?? 'local'
  const resolvedKeeperName = keeperName ?? printMeta?.responsible ?? 'Кладовщик'
  const whId = warehouseId || warehouse.locations[0]?.id || ''

  const openDailySession = useMemo(
    () =>
      findOpenDailyIssue(warehouse, resolvedKeeperId, today, whId || undefined),
    [warehouse, resolvedKeeperId, today, whId],
  )

  function openDailyIssueWindow() {
    if (!onOpenDailyIssueSession) return
    const id = onOpenDailyIssueSession({
      keeperId: resolvedKeeperId,
      keeperName: resolvedKeeperName,
      warehouseId: whId,
    })
    setDailyIssueSessionId(id)
  }

  useEffect(() => {
    const pending = consumePendingWarehousePick()
    if (pending?.query) {
      setTab('documents')
      setPendingAiPick(pending)
    }

    const handler = (event: Event) => {
      const detail = (event as CustomEvent<WarehousePickDetail>).detail
      if (!detail?.query) return
      setTab('documents')
      setPendingAiPick(detail)
    }
    window.addEventListener(WAREHOUSE_PICK_EVENT, handler)
    return () => window.removeEventListener(WAREHOUSE_PICK_EVENT, handler)
  }, [])

  useEffect(() => {
    if (!journalNav) return
    if ('warehouseDocumentId' in journalNav) {
      setTab('documents')
      setPendingJournalDocId(journalNav.warehouseDocumentId)
    } else if ('warehouseItemId' in journalNav) {
      setTab('nomenclature')
      const item = warehouse.items.find((i) => i.id === journalNav.warehouseItemId)
      if (item) setCardItem(item)
    } else if ('loadingShipmentId' in journalNav) {
      setTab('loading')
      setPendingJournalLoadingId(journalNav.loadingShipmentId)
    }
    onJournalNavConsumed?.()
  }, [journalNav, warehouse.items, onJournalNavConsumed])

  const asOfIsoMemo = asOfIso

  const outputItemIds = useMemo(() => {
    const ids = new Set<string>()
    for (const fp of finishedProducts ?? []) {
      if (fp.warehouseItemId) ids.add(fp.warehouseItemId)
    }
    return ids
  }, [finishedProducts])

  const balances = useMemo(() => {
    if (asOfIsoMemo) {
      return computeAllBalancesAsOf(warehouse, asOfIsoMemo, warehouseId || undefined)
    }
    return computeAllBalances(warehouse, warehouseId || undefined)
  }, [warehouse, warehouseId, asOfIsoMemo])

  const showAsOfBar =
    !embedded &&
    (tab === 'balances' ||
      tab === 'analytics' ||
      tab === 'movements' ||
      tab === 'nomenclature' ||
      tab === 'inventory' ||
      tab === 'workwear')

  const asOfHintKey =
    tab === 'analytics'
      ? 'asOf.hintWarehouseAnalytics'
      : tab === 'movements'
        ? 'asOf.hintWarehouseMovements'
        : 'asOf.hintWarehouse'
  const categories = useMemo(
    () => [...warehouse.categories].sort((a, b) => a.sortOrder - b.sortOrder),
    [warehouse.categories],
  )
  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const categoryNames = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories],
  )

  const baseItems = warehouse.items.filter((i) => (showArchived ? !i.active : i.active))
  const filteredItems = baseItems.filter((item) => {
    const q = search.trim().toLowerCase()
    if (warehouseId && item.warehouseId !== warehouseId) return false
    if (catFilter && item.categoryId !== catFilter) return false
    if (!q) return true
    const cat = catMap.get(item.categoryId)?.name ?? ''
    return (
      item.name.toLowerCase().includes(q) ||
      cat.toLowerCase().includes(q) ||
      item.internalCode?.toLowerCase().includes(q) ||
      item.sku?.toLowerCase().includes(q) ||
      item.barcode?.toLowerCase().includes(q)
    )
  })

  const hasItemFilter = !!(search.trim() || catFilter || deficitOnly || warehouseId || (asOfEnabled && asOfScope === 'output'))

  const scopeFilteredItems =
    asOfEnabled && asOfScope === 'output'
      ? filteredItems.filter((i) => outputItemIds.has(i.id))
      : filteredItems

  const displayItems = deficitOnly
    ? scopeFilteredItems.filter((i) => lowStockItems([i], balances).length > 0)
    : scopeFilteredItems

  const activeItems = warehouse.items.filter((i) => i.active)
  const lowStock = lowStockItems(activeItems, balances)

  const handleExport = useCallback(() => {
    onExportExcel(warehouseId || undefined)
  }, [warehouseId, onExportExcel])

  function openNewItem() {
    const catId = catFilter || categories[0]?.id || ''
    setEditItem({
      id: crypto.randomUUID(),
      internalCode: '',
      name: '',
      categoryId: catId,
      warehouseId: warehouseId || warehouse.locations[0]?.id || '',
      unit: 'шт',
      active: true,
      sortOrder: warehouse.items.length,
    })
    setIsNew(true)
  }

  const tabLabels: Record<WarehouseTab, string> = {
    balances: t('warehouse.tab.balances'),
    requests: t('warehouse.tab.requests'),
    nomenclature: t('warehouse.tab.nomenclature'),
    movements: t('warehouse.tab.movements'),
    documents: t('warehouse.tab.documents'),
    inventory: t('warehouse.tab.inventory'),
    loading: t('warehouse.tab.loading'),
    workwear: t('warehouse.tab.workwear'),
    analytics: t('warehouse.tab.analytics'),
    import: t('warehouse.tab.import'),
    audit: t('warehouse.tab.audit'),
  }

  const visibleTabs = webWarehouseMode ? WAREHOUSE_WEB_TABS : WAREHOUSE_TABS

  useEffect(() => {
    if (!visibleTabs.includes(tab)) {
      setTab(visibleTabs[0] ?? 'balances')
    }
  }, [visibleTabs, tab])

  useEffect(() => {
    if (embedded) return
    if (userWarehouseDefaults?.tab) setTab(userWarehouseDefaults.tab)
    if (userWarehouseDefaults?.warehouseId !== undefined) {
      setWarehouseId(userWarehouseDefaults.warehouseId)
    }
    if (userWarehouseDefaults?.deficitOnly !== undefined) {
      setDeficitOnly(userWarehouseDefaults.deficitOnly)
    }
    if (userWarehouseDefaults?.showArchived !== undefined) {
      setShowArchived(userWarehouseDefaults.showArchived)
    }
  }, [embedded, userWarehouseDefaults])

  const applyWarehouseDefaults = useCallback(
    (defaults: NonNullable<typeof userWarehouseDefaults>) => {
      if (defaults.tab) setTab(defaults.tab)
      if (defaults.warehouseId !== undefined) setWarehouseId(defaults.warehouseId)
      if (defaults.deficitOnly !== undefined) setDeficitOnly(defaults.deficitOnly)
      if (defaults.showArchived !== undefined) setShowArchived(defaults.showArchived)
    },
    [],
  )

  const warehouseWidgetDefs: WorkspaceWidgetDef[] = [
    { id: 'filters', labelKey: 'workspace.widget.filters', icon: '▦' },
    {
      id: 'analytics',
      labelKey: 'workspace.widget.analytics',
      icon: '◫',
      badge: lowStock.length > 0 ? lowStock.length : undefined,
    },
  ]

  const showSearchInRail = embedded || tab === 'balances' || tab === 'nomenclature'

  const filterPanel = (
    <div className="flex flex-wrap items-center gap-3">
      {(embedded || tab === 'balances' || tab === 'nomenclature') && (
        <input
          type="search"
          placeholder={t('warehouse.search')}
          className="min-w-[12rem] flex-1 rounded-sm border border-grid bg-white px-3 py-2 text-sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}
      {(embedded || (tab !== 'import' && tab !== 'audit')) && (
        <select
          className="rounded-sm border border-grid bg-white px-3 py-2 text-sm"
          value={warehouseId}
          onChange={(e) => setWarehouseId(e.target.value)}
        >
          <option value="">{t('warehouse.allLocations')}</option>
          {warehouse.locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      )}
      {(embedded || tab === 'balances' || tab === 'nomenclature') && (
        <select
          className="rounded-sm border border-grid bg-white px-3 py-2 text-sm"
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
        >
          <option value="">{t('warehouse.allCategories')}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      {!embedded && tab === 'balances' && (
        <label className="flex items-center gap-2 text-sm text-stone-600">
          <input
            type="checkbox"
            checked={deficitOnly}
            onChange={(e) => setDeficitOnly(e.target.checked)}
          />
          {t('warehouse.deficitOnly')}
        </label>
      )}
      {(embedded || tab === 'nomenclature') && (
        <>
          <label className="flex items-center gap-2 text-sm text-stone-600">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            {t('warehouse.showArchived')}
          </label>
          <button
            type="button"
            className="rounded-sm border border-teal-600 bg-white px-3 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50"
            onClick={() => setLabelPrintIds([])}
          >
            {t('warehouse.labels')}
          </button>
          <button type="button" className="btn-add" onClick={openNewItem}>
            {t('warehouse.addItem')}
          </button>
        </>
      )}
      {!embedded && (tab === 'balances' || tab === 'import') && (
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-sm border border-grid bg-white px-3 py-2 text-sm hover:bg-stone-50"
            onClick={handleExport}
          >
            {t('warehouse.exportExcel')}
          </button>
          <button
            type="button"
            className="rounded-sm border border-grid bg-white px-3 py-2 text-sm hover:bg-stone-50"
            onClick={() =>
              printWarehouseBalances(warehouse, warehouseId || undefined, t('warehouse.title'))
            }
          >
            {t('warehouse.print')}
          </button>
        </div>
      )}
      {!embedded && tab === 'analytics' && (
        <>
          <input
            type="date"
            className="rounded-sm border border-grid px-3 py-2 text-sm"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
          <span className="text-stone-400">—</span>
          <input
            type="date"
            className="rounded-sm border border-grid px-3 py-2 text-sm"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </>
      )}
    </div>
  )

  const content = (
    <>
      {!embedded && (
        <PageHeader
          density="compact"
          showBrand={false}
          title={
            webWarehouseMode && webUserName
              ? tf('web.warehouse.welcome', { name: webUserName })
              : t('warehouse.title')
          }
          subtitle={webWarehouseMode ? t('web.warehouse.pageSubtitle') : t('warehouse.subtitle')}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <TabBar
                tabs={visibleTabs.map((id) => ({ id, label: tabLabels[id] }))}
                value={tab}
                onChange={setTab}
              />
              <PageActionOverflow
                items={[
                  {
                    id: 'defaults',
                    label: t('viewDefaults.open'),
                    onClick: () => setDefaultsOpen(true),
                    hidden: !(currentUserId && onSaveViewDefaults),
                  },
                ]}
              />
            </div>
          }
        />
      )}

      {!embedded && onOpenDailyIssueSession && (
        <button
          type="button"
          onClick={openDailyIssueWindow}
          className="flex w-full items-center justify-between gap-3 rounded-sm border-2 border-teal-600/30 bg-teal-700 px-5 py-4 text-left text-white shadow-md transition hover:bg-teal-900"
        >
          <span>
            <span className="block text-[10px] font-bold uppercase tracking-[0.2em] text-teal-200">
              {t('warehouse.dailyIssue.badge')}
            </span>
            <span className="mt-0.5 block text-lg font-bold">
              {openDailySession
                ? openDailySession.number
                : t('warehouse.dailyIssue.open')}
            </span>
            <span className="mt-0.5 block text-sm text-teal-100/90">
              {openDailySession
                ? tf('warehouse.dailyIssue.resumeHint', {
                    count: sessionLineCount(openDailySession),
                    name: resolvedKeeperName,
                  })
                : t('warehouse.dailyIssue.openHint')}
            </span>
          </span>
          <span className="flex size-12 shrink-0 items-center justify-center rounded-sm bg-white/15 text-2xl font-bold">
            →
          </span>
        </button>
      )}

      {!embedded && (
        <WorkspaceWidgetRail
          widgets={warehouseWidgetDefs}
          openId={widgets.openId}
          onToggle={widgets.toggle}
          leading={
            showSearchInRail ? (
              <input
                type="search"
                placeholder={t('warehouse.search')}
                className="w-full rounded-sm border border-grid bg-white px-2 py-1.5 text-sm"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            ) : undefined
          }
          chips={
            <>
              <WorkspaceWidgetChip onClick={() => widgets.open('analytics')}>
                {tf('workspace.chip.items', { count: activeItems.length })}
              </WorkspaceWidgetChip>
              {lowStock.length > 0 ? (
                <WorkspaceWidgetChip tone="warn" onClick={() => widgets.open('analytics')}>
                  {tf('workspace.chip.lowStock', { count: lowStock.length })}
                </WorkspaceWidgetChip>
              ) : null}
              <WorkspaceWidgetChip onClick={() => widgets.open('filters')}>
                {tf('workspace.chip.tab', { label: tabLabels[tab] })}
              </WorkspaceWidgetChip>
            </>
          }
        />
      )}

      {!embedded && (
        <>
          <WorkspaceWidgetDrawer
            open={widgets.isOpen('filters')}
            title={t('workspace.widget.filters')}
            subtitle={t('workspace.widget.filtersHint')}
            onClose={widgets.close}
          >
            {filterPanel}
          </WorkspaceWidgetDrawer>
          <WorkspaceWidgetDrawer
            open={widgets.isOpen('analytics')}
            title={t('workspace.widget.analytics')}
            subtitle={t('workspace.widget.analyticsHint')}
            onClose={widgets.close}
          >
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <KpiCard label={t('warehouse.kpi.items')} value={activeItems.length} />
              <KpiCard label={t('warehouse.kpi.categories')} value={categories.length} />
              <KpiCard
                label={t('warehouse.kpi.lowStock')}
                value={lowStock.length}
                tone={lowStock.length > 0 ? 'warn' : 'default'}
              />
            </div>
          </WorkspaceWidgetDrawer>
        </>
      )}

      {embedded && filterPanel}

      {showAsOfBar && (
        <>
          <AsOfSnapshotBar
            className="mb-4"
            enabled={asOfEnabled}
            onEnabledChange={setAsOfEnabled}
            date={asOfDate}
            onDateChange={setAsOfDate}
            time={asOfTime}
            onTimeChange={setAsOfTime}
            scope={asOfScope}
            onScopeChange={setAsOfScope}
            showScope={tab === 'balances' || tab === 'nomenclature'}
            hintKey={asOfHintKey}
          />
          {asOfEnabled && productionRequests && productionRequests.length > 0 && tab === 'balances' ? (
            <div className="mb-4">
              <ProductionDaySnapshot
                requests={productionRequests}
                date={asOfDate}
                asOfIso={asOfIsoMemo ?? undefined}
              />
            </div>
          ) : null}
        </>
      )}

      {!embedded && tab === 'balances' && (
        <div className="mb-4 space-y-4">
          {!webWarehouseMode &&
            pendingBatchRuns &&
            onConfirmFormulationBatch &&
            onRejectFormulationBatch && (
              <BatchConfirmRequestsPanel
                warehouse={warehouse}
                runs={pendingBatchRuns}
                keeperId={keeperId}
                keeperName={keeperName}
                allowNegativeStock={allowNegativeStock}
                onConfirm={onConfirmFormulationBatch}
                onReject={onRejectFormulationBatch}
              />
            )}
          {!webWarehouseMode &&
            productionRequests &&
            onSaveProductionRequest &&
            onPostProductionRequest &&
            brigadeNamesKa && (
              <ProductionRequestsPanel
                requests={productionRequests}
                employees={employees}
                brigades={brigades}
                brigadeNamesKa={brigadeNamesKa}
                keeperName={keeperName}
                onSaveRequest={onSaveProductionRequest}
                onPostRequest={onPostProductionRequest}
              />
            )}
          {!webWarehouseMode && onResolveWarehouseItemRequest && (
            <WarehouseItemRequestsPanel
              warehouse={warehouse}
              keeperName={keeperName}
              onResolveRequest={onResolveWarehouseItemRequest}
            />
          )}
          {!webWarehouseMode && onResolveWarehouseItemRenameRequest && (
            <WarehouseItemRenameRequestsPanel
              warehouse={warehouse}
              keeperId={keeperId}
              keeperName={keeperName}
              onResolve={onResolveWarehouseItemRenameRequest}
            />
          )}
        </div>
      )}

      {!embedded && tab === 'balances' && (
        <BalancesTable
          items={displayItems}
          catMap={catMap}
          balances={balances}
          hasFilter={hasItemFilter}
          onEdit={setCardItem}
        />
      )}
      {(embedded || tab === 'nomenclature') && (
        <NomenclatureTable
          items={displayItems}
          catMap={catMap}
          balances={balances}
          archived={showArchived}
          hasFilter={hasItemFilter}
          onEdit={(item) => {
            setEditItem(item)
            setIsNew(false)
          }}
          onArchive={(id, arch) => onArchiveItem(id, arch)}
          onRemove={onRemoveItem}
        />
      )}
      {!embedded && tab === 'movements' && (
        <WarehouseMovementsTab
          warehouse={warehouse}
          warehouseId={warehouseId}
          brigades={brigades}
          categoryNames={categoryNames}
          balances={balances}
          printMeta={printMeta}
          allowNegativeStock={allowNegativeStock}
          counterparties={counterparties}
          onUpsertCounterparty={onUpsertCounterparty}
          onOpenCounterparties={onOpenCounterparties}
          productionRequests={productionRequests}
          keeperId={keeperId}
          keeperName={keeperName}
          onPostDocument={onPostDocument}
          onPostTransfer={onPostTransfer}
          onSaveDocumentDraft={onSaveDocumentDraft}
          onMergeInvoiceRegistry={onMergeInvoiceRegistry}
          onAddMovement={onAddMovement}
          onDeleteMovement={onDeleteMovement}
          asOfIso={asOfIsoMemo}
        />
      )}
      {!embedded && tab === 'documents' && (
        <WarehouseDocumentsTab
          warehouse={warehouse}
          brigades={brigades}
          warehouseId={warehouseId}
          categoryNames={categoryNames}
          printMeta={printMeta}
          allowNegativeStock={allowNegativeStock}
          canCancelDocuments={canCancelDocuments}
          canUnpostDocuments={canUnpostDocuments}
          counterparties={counterparties}
          onUpsertCounterparty={onUpsertCounterparty}
          onOpenCounterparties={onOpenCounterparties}
          productionRequests={productionRequests}
          keeperId={keeperId}
          keeperName={keeperName}
          onPostDocument={onPostDocument}
          onPostTransfer={onPostTransfer}
          onCancelDocument={onCancelDocument}
          onSaveDocumentDraft={onSaveDocumentDraft}
          onPostExistingDocument={onPostExistingDocument}
          onUnpostDocument={canUnpostDocuments ? onUnpostDocument : undefined}
          onRemoveDocumentDraft={onRemoveDocumentDraft}
          onAcquireDocumentLock={onAcquireDocumentLock}
          onReleaseDocumentLock={onReleaseDocumentLock}
          onQuickEditItem={(item) => {
            setEditItem(item)
            setIsNew(false)
          }}
          onMergeInvoiceRegistry={onMergeInvoiceRegistry}
          pendingAiPick={pendingAiPick}
          onConsumeAiPick={() => setPendingAiPick(null)}
          pendingOpenDocumentId={pendingJournalDocId}
          onPendingOpenConsumed={() => setPendingJournalDocId(null)}
        />
      )}
      {!embedded && tab === 'inventory' && (
        <WarehouseInventoryTab
          warehouse={warehouse}
          warehouseId={warehouseId}
          categoryNames={categoryNames}
          printMeta={printMeta}
          keeperId={keeperId}
          keeperName={keeperName ?? webUserName}
          asOfIso={asOfIsoMemo}
          onRunInventory={onRunInventory}
          onPostOpeningBalances={onPostOpeningBalances}
          onSaveDocumentDraft={onSaveDocumentDraft}
          onPostExistingDocument={onPostExistingDocument}
          onUnpostDocument={canUnpostDocuments ? onUnpostDocument : undefined}
          onAcquireDocumentLock={onAcquireDocumentLock}
          onReleaseDocumentLock={onReleaseDocumentLock}
          onQuickEditItem={(item) => {
            setEditItem(item)
            setIsNew(false)
          }}
        />
      )}
      {!embedded &&
        tab === 'workwear' &&
        onUpsertWorkwearCatalogItem &&
        onArchiveWorkwearCatalogItem &&
        onPostWorkwearIssuance && (
          <WarehouseWorkwearTab
            workwear={workwear}
            warehouse={warehouse}
            employees={employees}
            keeperId={keeperId}
            keeperName={keeperName ?? webUserName}
            asOfDate={asOfEnabled ? asOfDate : undefined}
            onUpsertCatalogItem={onUpsertWorkwearCatalogItem}
            onArchiveCatalogItem={onArchiveWorkwearCatalogItem}
            onPostIssuance={onPostWorkwearIssuance}
          />
        )}
      {!embedded && tab === 'analytics' && (
        <WarehouseAnalyticsTab
          {...props}
          warehouseId={warehouseId}
          fromDate={fromDate}
          toDate={toDate}
          asOfIso={asOfIsoMemo}
        />
      )}
      {!embedded && tab === 'import' && (
        <WarehouseImportTab
          onImportExcel={onImportExcel}
          warehouseId={warehouseId}
          locations={warehouse.locations}
          onWarehouseChange={setWarehouseId}
        />
      )}
      {!embedded && tab === 'audit' && <WarehouseAuditTab warehouse={warehouse} />}
      {!embedded &&
        tab === 'requests' &&
        onCreateKeeperReplenishment &&
        onCreateReplenishmentFromDeficit &&
        onUpdateKeeperReplenishment &&
        onSubmitKeeperReplenishment &&
        onCancelKeeperReplenishment &&
        onReceiveKeeperReplenishment && (
          <KeeperReplenishmentPanel
            warehouse={warehouse}
            warehouseId={warehouseId}
            keeperId={keeperId}
            keeperName={resolvedKeeperName}
            onCreate={() =>
              onCreateKeeperReplenishment({
                warehouseId: warehouseId || warehouse.locations[0]?.id || '',
                keeperId: keeperId ?? 'keeper',
                keeperName: resolvedKeeperName,
              })
            }
            onCreateFromDeficit={() =>
              onCreateReplenishmentFromDeficit({
                warehouseId: warehouseId || warehouse.locations[0]?.id || '',
                keeperId: keeperId ?? 'keeper',
                keeperName: resolvedKeeperName,
              })
            }
            onSubmit={onSubmitKeeperReplenishment}
            onCancel={onCancelKeeperReplenishment}
            onReceive={(id, lines) =>
              onReceiveKeeperReplenishment(id, lines, {
                keeperId,
                keeperName: resolvedKeeperName,
              })
            }
            onUpdateDraft={(id, lines) => onUpdateKeeperReplenishment(id, { lines })}
          />
        )}
      {!embedded &&
        tab === 'loading' &&
        onUpsertLoadingShipment &&
        onPostLoadingShipment &&
        onRemoveLoadingShipment && (
          <WarehouseLoadingTab
            warehouse={warehouse}
            warehouseId={warehouseId}
            counterparties={counterparties ?? []}
            finishedProducts={finishedProducts ?? []}
            packagingRecipes={packagingRecipes ?? []}
            keeperId={keeperId}
            keeperName={resolvedKeeperName}
            onUpsertItem={onUpsertItem}
            onUpsertFinishedProduct={onUpsertFinishedProduct!}
            onUpsertCounterparty={onUpsertCounterparty!}
            onOpenCounterparties={onOpenCounterparties}
            onUpsertLoadingShipment={onUpsertLoadingShipment}
            onPostLoadingShipment={onPostLoadingShipment}
            onRemoveLoadingShipment={onRemoveLoadingShipment}
            salesOrders={salesOrders}
            onOpenSalesOrder={onOpenSalesOrder}
            pendingOpenShipmentId={pendingJournalLoadingId}
            onPendingOpenConsumed={() => setPendingJournalLoadingId(null)}
          />
        )}

      {editItem && (
        <ItemEditModal
          item={editItem}
          isNew={isNew}
          categories={categories}
          locations={warehouse.locations}
          onClose={() => setEditItem(null)}
          onSave={(item) => {
            onUpsertItem(item)
            setEditItem(null)
          }}
          onAddCategory={(name) => {
            const cat: WarehouseCategory = {
              id: crypto.randomUUID(),
              name,
              sortOrder: categories.length,
            }
            onUpsertCategory(cat)
            return cat.id
          }}
          onAddLocation={(name) => {
            const loc: WarehouseLocation = {
              id: crypto.randomUUID(),
              name,
              sortOrder: warehouse.locations.length,
            }
            onUpsertLocation(loc)
            return loc.id
          }}
        />
      )}

      {cardItem && (
        <ItemCardModal
          item={cardItem}
          warehouse={warehouse}
          balances={balances}
          onClose={() => setCardItem(null)}
          onEdit={() => {
            setEditItem(cardItem)
            setIsNew(false)
            setCardItem(null)
          }}
          onPrintLabel={() => {
            setLabelPrintIds([cardItem.id])
            setCardItem(null)
          }}
        />
      )}

      {labelPrintIds !== null && (
        <WarehouseLabelPrintModal
          warehouse={warehouse}
          items={warehouse.items}
          preselectedIds={labelPrintIds}
          site={printMeta?.site}
          onUpsertItem={onUpsertItem}
          onClose={() => setLabelPrintIds(null)}
        />
      )}

      {dailyIssueSessionId && onAdjustDailyIssueLine && onSetDailyIssueComment && onPostDailyIssueSession && (
        <WarehouseDailyIssueModal
          warehouse={warehouse}
          sessionId={dailyIssueSessionId}
          warehouseId={whId}
          categoryNames={categoryNames}
          printMeta={printMeta}
          allowNegativeStock={allowNegativeStock}
          onAdjustLine={onAdjustDailyIssueLine}
          onSetComment={onSetDailyIssueComment}
          onPost={onPostDailyIssueSession}
          onClose={() => setDailyIssueSessionId(null)}
        />
      )}

      {defaultsOpen && currentUserId && onSaveViewDefaults && !embedded && (
        <WarehouseViewDefaultsDialog
          warehouse={warehouse}
          webMode={webWarehouseMode}
          initial={{
            tab,
            warehouseId: warehouseId || undefined,
            deficitOnly,
            showArchived,
          }}
          onSave={(defaults) => {
            onSaveViewDefaults('warehouse', defaults)
            applyWarehouseDefaults(defaults)
          }}
          onClose={() => setDefaultsOpen(false)}
        />
      )}
    </>
  )

  return (
    <PageLayout compact={Boolean(embedded)} className="gap-5">
      {content}
    </PageLayout>
  )
}

function BalancesTable({
  items,
  catMap,
  balances,
  hasFilter,
  onEdit,
}: {
  items: WarehouseItem[]
  catMap: Map<string, WarehouseCategory>
  balances: ReturnType<typeof computeAllBalances>
  hasFilter?: boolean
  onEdit: (item: WarehouseItem) => void
}) {
  const { t, locale } = useI18n()
  const grouped = useMemo(() => {
    const map = new Map<string, WarehouseItem[]>()
    for (const item of items) {
      const list = map.get(item.categoryId) ?? []
      list.push(item)
      map.set(item.categoryId, list)
    }
    return map
  }, [items])

  if (!items.length) {
    return (
      <EmptyState
        message={hasFilter ? t('warehouse.emptyFilter') : t('warehouse.empty')}
      />
    )
  }

  return (
    <div className="overflow-hidden rounded-sm border border-grid bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-grid bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
            <th className="w-12 px-2 py-3" />
            <th className="px-4 py-3">{t('warehouse.col.name')}</th>
            <th className="px-3 py-3 w-20">{t('warehouse.col.unit')}</th>
            <th className="px-3 py-3 w-24 text-right">{t('warehouse.col.reserved')}</th>
            <th className="px-3 py-3 w-28 text-right">{t('warehouse.col.balance')}</th>
            <th className="px-3 py-3 w-28 text-right">{t('warehouse.col.available')}</th>
          </tr>
        </thead>
        <tbody>
          {[...grouped.entries()].map(([catId, catItems]) => (
            <Fragment key={catId}>
              <tr className="bg-teal-50/60">
                <td colSpan={6} className="px-4 py-2 text-xs font-bold uppercase tracking-wide text-teal-900">
                  {catMap.get(catId)?.name ?? '—'}
                </td>
              </tr>
              {catItems.map((item) => {
                const b = balances.get(item.id)
                const low = item.minStock != null && (b?.available ?? 0) < item.minStock
                return (
                  <tr
                    key={item.id}
                    className="cursor-pointer border-b border-grid/60 hover:bg-stone-50/80"
                    onClick={() => onEdit(item)}
                  >
                    <td className="px-2 py-2.5">
                      <WarehouseItemThumb photoDataUrl={item.photoDataUrl} name={item.name} />
                    </td>
                    <td className="px-4 py-2.5 font-medium text-ink">{item.name}</td>
                    <td className="px-3 py-2.5 text-stone-500">{unitLabel(item.unit, locale)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-stone-600">
                      {formatQty(b?.reserved ?? 0)}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right tabular-nums font-semibold ${
                        low ? 'text-amber-700' : (b?.balance ?? 0) === 0 ? 'text-stone-400' : 'text-ink'
                      }`}
                    >
                      {formatQty(b?.balance ?? 0)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatQty(b?.available ?? 0)}</td>
                  </tr>
                )
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function NomenclatureTable({
  items,
  catMap,
  balances,
  archived,
  hasFilter,
  onEdit,
  onArchive,
  onRemove,
}: {
  items: WarehouseItem[]
  catMap: Map<string, WarehouseCategory>
  balances: ReturnType<typeof computeAllBalances>
  archived: boolean
  hasFilter?: boolean
  onEdit: (item: WarehouseItem) => void
  onArchive: (id: string, archived: boolean) => void
  onRemove: (id: string) => boolean
}) {
  const { t, locale } = useI18n()
  const { confirm, alert } = useConfirm()
  if (!items.length) {
    return (
      <EmptyState
        message={hasFilter ? t('warehouse.emptyFilter') : t('warehouse.empty')}
      />
    )
  }

  return (
    <div className="overflow-hidden rounded-sm border border-grid bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-grid bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
            <th className="w-12 px-2 py-3" />
            <th className="px-3 py-3">{t('warehouse.col.internalCode')}</th>
            <th className="px-4 py-3">{t('warehouse.col.name')}</th>
            <th className="px-3 py-3">{t('warehouse.col.category')}</th>
            <th className="px-3 py-3">{t('warehouse.col.sku')}</th>
            <th className="px-3 py-3 w-20">{t('warehouse.col.unit')}</th>
            <th className="px-3 py-3 w-24 text-right">{t('warehouse.col.balance')}</th>
            <th className="px-3 py-3 w-32" />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b border-grid/60 hover:bg-stone-50/80">
              <td className="px-2 py-2.5">
                <button type="button" className="block" onClick={() => onEdit(item)}>
                  <WarehouseItemThumb photoDataUrl={item.photoDataUrl} name={item.name} />
                </button>
              </td>
              <td className="px-3 py-2.5 font-mono text-xs text-teal-800">
                {item.internalCode || '—'}
              </td>
              <td className="px-4 py-2.5">
                <button
                  type="button"
                  className="text-left font-medium text-ink hover:text-teal-800 hover:underline"
                  onClick={() => onEdit(item)}
                >
                  {item.name}
                </button>
              </td>
              <td className="px-3 py-2.5 text-stone-600">{catMap.get(item.categoryId)?.name ?? '—'}</td>
              <td className="px-3 py-2.5 text-stone-500 text-xs">{item.sku ?? '—'}</td>
              <td className="px-3 py-2.5 text-stone-500">{unitLabel(item.unit, locale)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                {formatQty(balances.get(item.id)?.balance ?? 0)}
              </td>
              <td className="px-3 py-2.5 text-right text-xs">
                <button type="button" className="text-teal-700 hover:underline" onClick={() => onEdit(item)}>
                  {t('common.edit')}
                </button>
                {archived ? (
                  <button
                    type="button"
                    className="ml-3 text-emerald-700 hover:underline"
                    onClick={() => onArchive(item.id, false)}
                  >
                    {t('warehouse.restore')}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="ml-3 text-amber-700 hover:underline"
                      onClick={() => onArchive(item.id, true)}
                    >
                      {t('warehouse.archive')}
                    </button>
                    <button
                      type="button"
                      className="ml-3 text-red-600 hover:underline"
                      onClick={async () => {
                        if (!(await confirm({ message: t('warehouse.confirmDelete'), danger: true }))) return
                        if (!onRemove(item.id)) {
                          await alert({ message: t('warehouse.err.cannotDeleteHasHistory') })
                        }
                      }}
                    >
                      {t('common.delete')}
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TypeBadge({ type }: { type: StockMovementType }) {
  const { t } = useI18n()
  const styles: Record<string, string> = {
    receipt: 'bg-emerald-100 text-emerald-800',
    issue: 'bg-red-100 text-red-800',
    adjustment: 'bg-stone-200 text-stone-700',
    reserve: 'bg-amber-100 text-amber-800',
    unreserve: 'bg-sky-100 text-sky-800',
    inventory: 'bg-violet-100 text-violet-800',
  }
  const labels: Record<string, string> = {
    receipt: t('warehouse.receiptShort'),
    issue: t('warehouse.issueShort'),
    adjustment: t('warehouse.adjustmentShort'),
    reserve: t('warehouse.reserveShort'),
    unreserve: t('warehouse.unreserveShort'),
    inventory: t('warehouse.inventoryShort'),
  }
  return (
    <span className={`rounded-sm px-2 py-0.5 text-[10px] font-bold uppercase ${styles[type] ?? ''}`}>
      {labels[type] ?? type}
    </span>
  )
}

function ItemEditModal({
  item,
  isNew,
  categories,
  locations,
  onClose,
  onSave,
  onAddCategory,
  onAddLocation,
}: {
  item: WarehouseItem
  isNew: boolean
  categories: WarehouseCategory[]
  locations: WarehouseLocation[]
  onClose: () => void
  onSave: (item: WarehouseItem) => void
  onAddCategory: (name: string) => string
  onAddLocation: (name: string) => string
}) {
  const { t, locale } = useI18n()
  const { confirmUnsaved } = useConfirm()
  const [draft, setDraft] = useState(item)
  const baselineRef = useRef(JSON.stringify(item))
  const [newCat, setNewCat] = useState('')
  const [newLoc, setNewLoc] = useState('')
  const [altUnit, setAltUnit] = useState('')
  const [altQtyB, setAltQtyB] = useState('1')
  const [altRef, setAltRef] = useState('')
  const [showPackaging, setShowPackaging] = useState((item.unitConversions?.length ?? 0) > 0)
  const [error, setError] = useState<string | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)

  function isDirty() {
    return JSON.stringify(draft) !== baselineRef.current
  }

  function requestClose() {
    void requestModalClose(
      { confirmUnsaved },
      {
        isDirty,
        save: () => save(),
        close: onClose,
      },
    )
  }

  function save(): boolean {
    const name = draft.name.trim()
    if (!name) {
      setError(t('warehouse.err.nameRequired'))
      return false
    }
    setError(null)
    onSave({ ...draft, name })
    return true
  }

  async function onPhotoFile(file: File | undefined) {
    if (!file) return
    setPhotoBusy(true)
    setError(null)
    try {
      const photoDataUrl = await compressItemPhoto(file)
      setDraft({ ...draft, photoDataUrl })
    } catch {
      setError(t('warehouse.photo.errLoad'))
    } finally {
      setPhotoBusy(false)
    }
  }

  return (
    <AppDialog
      open
      onClose={requestClose}
      title={isNew ? t('warehouse.addItem') : t('warehouse.editItem')}
      size="lg"
      onPrimaryAction={() => save()}
      initialFocus="primary"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded-sm border border-grid px-4 py-2 text-sm" onClick={requestClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            data-modal-primary
            className="rounded-sm bg-teal-700 px-4 py-2 text-sm font-semibold text-white"
            onClick={() => save()}
          >
            {t('common.save')}
          </button>
        </div>
      }
    >
      <div className="space-y-4 px-6 py-4">
          {error && <FormNotice type="error" message={error} onDismiss={() => setError(null)} />}
          <label className="block text-xs font-semibold text-stone-500">
            {t('warehouse.col.internalCode')}
            <input
              readOnly
              className="mt-1 w-full cursor-not-allowed rounded-sm border border-grid bg-stone-50 px-3 py-2.5 font-mono text-sm text-teal-800"
              value={
                isNew
                  ? t('warehouse.internalCodeAuto')
                  : draft.internalCode || '—'
              }
            />
            <p className="mt-1 text-[11px] text-stone-400">{t('warehouse.internalCodeHint')}</p>
          </label>
          <div className="flex items-start gap-4">
            <WarehouseItemThumb photoDataUrl={draft.photoDataUrl} name={draft.name || '?'} size="lg" />
            <div className="min-w-0 flex-1 space-y-2">
              <label className="block text-xs font-semibold text-stone-500">
                {t('warehouse.photo')}
                <input
                  type="file"
                  accept="image/*"
                  disabled={photoBusy}
                  className="mt-1 block w-full text-xs"
                  onChange={(e) => {
                    void onPhotoFile(e.target.files?.[0])
                    e.target.value = ''
                  }}
                />
              </label>
              {draft.photoDataUrl && (
                <button
                  type="button"
                  className="text-xs text-red-600 hover:underline"
                  onClick={() => setDraft({ ...draft, photoDataUrl: undefined })}
                >
                  {t('warehouse.photo.remove')}
                </button>
              )}
              <p className="text-[11px] text-stone-400">{t('warehouse.photo.hint')}</p>
            </div>
          </div>
          <label className="block text-xs font-semibold text-stone-500">
            {t('warehouse.col.name')} *
            <input
              autoFocus
              className="mt-1 w-full rounded-sm border border-grid px-3 py-2.5 text-sm font-medium"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label className="block text-xs font-semibold text-stone-500">
            {t('warehouse.col.category')}
            <select
              className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
              value={draft.categoryId}
              onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-sm border border-grid px-3 py-2 text-sm"
              placeholder={t('warehouse.newCategory')}
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
            />
            <button
              type="button"
              className="btn-add-icon"
              onClick={() => {
                const n = newCat.trim()
                if (!n) return
                setDraft({ ...draft, categoryId: onAddCategory(n) })
                setNewCat('')
              }}
            >
              +
            </button>
          </div>
          <label className="block text-xs font-semibold text-stone-500">
            {t('warehouse.location')}
            <select
              className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
              value={draft.warehouseId}
              onChange={(e) => setDraft({ ...draft, warehouseId: e.target.value })}
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-sm border border-grid px-3 py-2 text-sm"
              placeholder={t('warehouse.newLocation')}
              value={newLoc}
              onChange={(e) => setNewLoc(e.target.value)}
            />
            <button
              type="button"
              className="btn-add-icon"
              onClick={() => {
                const n = newLoc.trim()
                if (!n) return
                setDraft({ ...draft, warehouseId: onAddLocation(n) })
                setNewLoc('')
              }}
            >
              +
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-stone-500">
              {t('warehouse.col.sku')}
              <input
                className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                value={draft.sku ?? ''}
                onChange={(e) => setDraft({ ...draft, sku: e.target.value || undefined })}
              />
            </label>
            <label className="block text-xs font-semibold text-stone-500">
              {t('warehouse.col.barcode')}
              <input
                className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                value={draft.barcode ?? ''}
                onChange={(e) => setDraft({ ...draft, barcode: e.target.value || undefined })}
              />
            </label>
          </div>
          <label className="block text-xs font-semibold text-stone-500">
            {t('warehouse.col.unit')}
            <select
              className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
              value={draft.unit}
              onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
            >
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {unitLabel(u, locale)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-semibold text-stone-500">
            {t('warehouse.weightKg')}
            <input
              type="text"
              inputMode="decimal"
              className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm tabular-nums"
              placeholder={t('warehouse.weightKgHint')}
              value={draft.weightKg ?? ''}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  weightKg: e.target.value ? Number(e.target.value.replace(',', '.')) : undefined,
                })
              }
            />
          </label>
          <label className="block text-xs font-semibold text-stone-500">
            {t('warehouse.price')}
            <input
              type="number"
              min={0}
              step="0.01"
              className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
              value={draft.price ?? ''}
              onChange={(e) =>
                setDraft({ ...draft, price: e.target.value ? Number(e.target.value) : undefined })
              }
            />
          </label>
          <label className="block text-xs font-semibold text-stone-500">
            {t('warehouse.minStock')}
            <input
              type="number"
              min={0}
              className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
              value={draft.minStock ?? ''}
              onChange={(e) =>
                setDraft({ ...draft, minStock: e.target.value ? Number(e.target.value) : undefined })
              }
            />
          </label>
          <div>
            <p className="text-xs font-semibold text-stone-500">{t('warehouse.packaging')}</p>
            <p className="mt-0.5 text-[11px] text-stone-400">{t('warehouse.packagingHint')}</p>
            {(draft.unitConversions ?? []).length > 0 && (
              <div className="mt-1.5 flex flex-col gap-1">
                {(draft.unitConversions ?? []).map((c) => (
                  <div
                    key={c.unit}
                    className="flex items-center justify-between rounded-sm border border-grid/70 bg-stone-50/70 px-2.5 py-1.5 text-xs text-stone-600"
                  >
                    <span className="tabular-nums">
                      1 {unitLabel(c.unit, locale)} = {formatQty(c.factor)}{' '}
                      {unitLabel(draft.unit, locale)}
                    </span>
                    <button
                      type="button"
                      className="text-stone-400 hover:text-red-600"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          unitConversions: (draft.unitConversions ?? []).filter(
                            (x) => x.unit !== c.unit,
                          ),
                        })
                      }
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            {showPackaging ? (
              <div className="mt-1.5 rounded-sm border border-grid/70 bg-stone-50/40 p-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="px-0.5 text-sm tabular-nums text-stone-500">1</span>
                  <select
                    className="w-24 rounded-sm border border-grid px-2 py-2 text-sm"
                    value={altUnit}
                    onChange={(e) => setAltUnit(e.target.value)}
                  >
                    <option value="">{t('warehouse.packagingUnit')}</option>
                    {UNITS.filter(
                      (u) =>
                        u !== draft.unit &&
                        !(draft.unitConversions ?? []).some((c) => c.unit === u),
                    ).map((u) => (
                      <option key={u} value={u}>
                        {unitLabel(u, locale)}
                      </option>
                    ))}
                  </select>
                  <span className="px-0.5 text-sm text-stone-400">=</span>
                  <input
                    className="w-14 rounded-sm border border-grid px-2 py-2 text-right text-sm tabular-nums"
                    inputMode="decimal"
                    value={altQtyB}
                    onChange={(e) => setAltQtyB(e.target.value)}
                  />
                  <select
                    className="w-24 rounded-sm border border-grid px-2 py-2 text-sm"
                    value={altRef || draft.unit}
                    onChange={(e) => setAltRef(e.target.value)}
                  >
                    <option value={draft.unit}>{unitLabel(draft.unit, locale)}</option>
                    {(draft.unitConversions ?? []).map((c) => (
                      <option key={c.unit} value={c.unit}>
                        {unitLabel(c.unit, locale)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn-add-icon px-2"
                    onClick={() => {
                      const unit = altUnit.trim()
                      const b = Number(altQtyB.replace(',', '.'))
                      if (!unit || !b) return
                      if (!unitsConvertible(draft.unit, unit)) {
                        setError(t('warehouse.unitDimMismatch'))
                        return
                      }
                      const ref = altRef || draft.unit
                      const refFactor =
                        ref === draft.unit
                          ? 1
                          : (draft.unitConversions ?? []).find((c) => c.unit === ref)?.factor
                      if (!refFactor) return
                      const factor = b * refFactor
                      setError(null)
                      setDraft({
                        ...draft,
                        unitConversions: [
                          ...(draft.unitConversions ?? []).filter((c) => c.unit !== unit),
                          { unit, factor },
                        ],
                      })
                      setAltUnit('')
                      setAltQtyB('1')
                      setAltRef('')
                    }}
                  >
                    +
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="mt-1.5 inline-flex items-center gap-1 rounded-sm border border-dashed border-grid px-2.5 py-1.5 text-xs font-medium text-stone-500 hover:border-stone-400 hover:text-stone-700"
                onClick={() => setShowPackaging(true)}
              >
                + {t('warehouse.packagingAdd')}
              </button>
            )}
          </div>
          <label className="block text-xs font-semibold text-stone-500">
            {t('warehouse.note')}
            <textarea
              rows={2}
              className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
              value={draft.note ?? ''}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
          </label>
      </div>
    </AppDialog>
  )
}

function ItemCardModal({
  item,
  warehouse,
  balances,
  onClose,
  onEdit,
  onPrintLabel,
}: {
  item: WarehouseItem
  warehouse: WarehousePageProps['warehouse']
  balances: ReturnType<typeof computeAllBalances>
  onClose: () => void
  onEdit: () => void
  onPrintLabel: () => void
}) {
  const { t, locale } = useI18n()
  const b = balances.get(item.id)
  const cat = warehouse.categories.find((c) => c.id === item.categoryId)
  const loc = warehouse.locations.find((l) => l.id === item.warehouseId)
  const history = getItemHistory(warehouse, item.id)
  const movements = warehouse.movements
    .filter((m) => m.itemId === item.id)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10)
  const avgCost = avgCostForItem(warehouse.movements, item.id)
  const priceHistory = priceHistoryForItem(warehouse.movements, item.id).slice(0, 8)

  return (
    <AppDialog
      open
      onClose={onClose}
      title={item.name}
      subtitle={`${item.internalCode} · ${cat?.name} · ${loc?.name}`}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded-sm border border-grid px-4 py-2 text-sm" onClick={onClose}>
            {t('common.close')}
          </button>
          <button
            type="button"
            className="rounded-sm border border-teal-600 px-4 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50"
            onClick={onPrintLabel}
          >
            {t('warehouse.labels.printOne')}
          </button>
          <button type="button" className="rounded-sm bg-teal-700 px-4 py-2 text-sm font-semibold text-white" onClick={onEdit}>
            {t('common.edit')}
          </button>
        </div>
      }
    >
      <div className="flex gap-4 border-b border-grid px-6 py-4">
        <WarehouseItemThumb photoDataUrl={item.photoDataUrl} name={item.name} size="lg" />
        <div className="min-w-0">
          <p className="font-mono text-xs font-semibold text-teal-700">{item.internalCode}</p>
          <p className="text-sm text-stone-500">
            {cat?.name} · {loc?.name}
          </p>
        </div>
      </div>
      <dl className="space-y-2 px-6 py-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-stone-500">{t('warehouse.col.balance')}</dt>
            <dd className="font-bold tabular-nums">{formatQty(b?.balance ?? 0)} {unitLabel(item.unit, locale)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-stone-500">{t('warehouse.col.available')}</dt>
            <dd className="tabular-nums">{formatQty(b?.available ?? 0)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-stone-500">{t('warehouse.col.reserved')}</dt>
            <dd className="tabular-nums">{formatQty(b?.reserved ?? 0)}</dd>
          </div>
          {item.price != null && (
            <div className="flex justify-between">
              <dt className="text-stone-500">{t('warehouse.stockValue')}</dt>
              <dd className="tabular-nums">{formatQty(itemStockValue(item, b?.balance ?? 0))} ₾</dd>
            </div>
          )}
          {avgCost != null && (
            <div className="flex justify-between">
              <dt className="text-stone-500">{t('warehouse.avgCost')}</dt>
              <dd className="tabular-nums">{formatQty(Math.round(avgCost * 100) / 100)} ₾</dd>
            </div>
          )}
        </dl>
        <div className="border-t border-grid px-6 py-3">
          <p className="text-xs font-semibold uppercase text-stone-400">{t('warehouse.itemHistory')}</p>
          {history.length === 0 ? (
            <p className="mt-2 text-xs text-stone-400">{t('warehouse.historyEmpty')}</p>
          ) : (
            <ul className="mt-2 max-h-40 space-y-2 overflow-y-auto text-xs">
              {history.map((h) => (
                <li key={h.id} className="rounded-sm bg-stone-50 px-2 py-1.5">
                  <div className="flex justify-between gap-2 text-[10px] text-stone-400">
                    <span>
                      {new Date(h.at).toLocaleString(locale === 'ka' ? 'ka-GE' : 'ru-RU', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <span className="font-semibold uppercase text-teal-700">
                      {t(`warehouse.historyKind.${h.kind}` as 'warehouse.historyKind.created')}
                    </span>
                  </div>
                  <p className="mt-0.5 text-stone-700">{h.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
        {priceHistory.length > 0 && (
          <div className="border-t border-grid px-6 py-3">
            <p className="text-xs font-semibold uppercase text-stone-400">
              {t('warehouse.priceHistory')}
            </p>
            <ul className="mt-2 space-y-1 text-xs">
              {priceHistory.map((p, i) => (
                <li key={`${p.date}-${i}`} className="flex justify-between gap-2">
                  <span className="text-stone-500">{p.date}</span>
                  <span className="tabular-nums text-stone-400">×{formatQty(p.quantity)}</span>
                  <span className="tabular-nums font-semibold">
                    {formatQty(Math.round(p.unitCost * 100) / 100)} ₾
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {movements.length > 0 && (
          <div className="border-t border-grid px-6 py-3">
            <p className="text-xs font-semibold uppercase text-stone-400">{t('warehouse.recentForItem')}</p>
            <ul className="mt-2 space-y-1 text-xs">
              {movements.map((m) => (
                <li key={m.id} className="flex justify-between">
                  <span>{m.date}</span>
                  <TypeBadge type={m.type} />
                  <span className="tabular-nums">{formatQty(Math.abs(m.quantity))}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
    </AppDialog>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-sm border border-dashed border-stone-300 bg-stone-50/50 px-6 py-16 text-center text-stone-500">
      {message}
    </div>
  )
}
