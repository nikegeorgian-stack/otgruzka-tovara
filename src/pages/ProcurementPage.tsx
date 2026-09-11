import { useEffect, useMemo, useState } from 'react'
import { KpiCard } from '@/components/ui/KpiCard'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageLayout } from '@/components/ui/PageLayout'
import { TabBar } from '@/components/ui/TabBar'
import { ProcurementAnalyticsTab } from '@/components/procurement/ProcurementAnalyticsTab'
import { ProcurementCatalogTab } from '@/components/procurement/ProcurementCatalogTab'
import { ProcurementOrdersTab } from '@/components/procurement/ProcurementOrdersTab'
import { ProcurementOrdersKanban } from '@/components/procurement/ProcurementOrdersKanban'
import { ProcurementTrackingTab } from '@/components/procurement/ProcurementTrackingTab'
import { ProcurementTrackingSync } from '@/components/procurement/ProcurementTrackingSync'
import { PurchaseOrderModal } from '@/components/procurement/PurchaseOrderModal'
import { ProcurementContainersTab } from '@/components/procurement/ProcurementContainersTab'
import { ProcurementStockTab } from '@/components/procurement/ProcurementStockTab'
import { AsOfSnapshotBar } from '@/components/asOf/AsOfSnapshotBar'
import { KanbanViewToggle, type KanbanViewMode } from '@/components/kanban'
import { G5DocumentPrintModal, type G5DocumentPrintModel } from '@/components/print/G5DocumentPrintModal'
import { useAsOfSnapshot } from '@/hooks/useAsOfSnapshot'
import {
  PROCUREMENT_TABS,
  PROCUREMENT_WEB_TABS,
  type ProcurementPageProps,
  type ProcurementTab,
} from '@/components/procurement/procurementTypes'
import { useI18n } from '@/context/I18nContext'
import { filterOrders, computeProcurementKpis } from '@/lib/procurement/analytics'
import { countTrackedContainers } from '@/lib/procurement/stockOutlook'
import { allocateOrderNumber } from '@/lib/procurement/codes'
import { categoryLabel, categoryOptionsFlat } from '@/lib/procurement/catalog'
import type {
  ProcurementScope,
  PurchaseOrder,
  PurchaseOrderStatus,
  TransportMode,
} from '@/lib/procurement/types'
import {
  purchaseOrderReceiptsHistoryToPrintModel,
  purchaseOrderToPrintModel,
  reversalToPrintModel,
} from '@/lib/print/g5PrintFromDomain'

export function ProcurementPage(
  props: ProcurementPageProps & {
    webProcurementMode?: boolean
    focusOrderId?: string | null
    onJournalFocusConsumed?: () => void
    /** Commercial ACL for G5 print prices (default false). */
    canViewCommercial?: boolean
  },
) {
  const {
    procurement,
    counterparties,
    warehouse,
    onUpsertOrder,
    onRemoveOrder,
    onReceiveOrder,
    onSetStatus,
    onUpsertProcurementCategory,
    onRemoveProcurementCategory,
    onUpsertRoutePoint,
    onRemoveRoutePoint,
    onUpsertCounterparty,
    onUpsertWarehouseItem,
    onNavigateToDirectory,
    webProcurementMode = false,
    focusOrderId,
    onJournalFocusConsumed,
    canViewCommercial = false,
  } = props

  const { t } = useI18n()
  const asOf = useAsOfSnapshot()
  const {
    enabled: asOfEnabled,
    setEnabled: setAsOfEnabled,
    date: asOfDate,
    setDate: setAsOfDate,
    time: asOfTime,
    setTime: setAsOfTime,
    asOfIso,
  } = asOf
  const tabIds = webProcurementMode ? PROCUREMENT_WEB_TABS : PROCUREMENT_TABS
  const [tab, setTab] = useState<ProcurementTab>(
    webProcurementMode ? 'containers' : 'orders',
  )
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<PurchaseOrderStatus | 'active' | 'all'>('active')
  const [scopeFilter, setScopeFilter] = useState<ProcurementScope | ''>(
    webProcurementMode ? 'international' : '',
  )
  const [categoryFilter, setCategoryFilter] = useState('')
  const [transportFilter, setTransportFilter] = useState<TransportMode | ''>('')
  const [supplierFilter, setSupplierFilter] = useState('')
  const [editOrder, setEditOrder] = useState<PurchaseOrder | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [ordersView, setOrdersView] = useState<KanbanViewMode>('list')
  const [printModel, setPrintModel] = useState<G5DocumentPrintModel | null>(null)

  useEffect(() => {
    if (!focusOrderId) return
    const order = procurement.orders.find((o) => o.id === focusOrderId)
    if (order) {
      setEditOrder(order)
      setIsNew(false)
      setTab('orders')
    }
    onJournalFocusConsumed?.()
  }, [focusOrderId])

  const tabLabels = useMemo(
    () =>
      Object.fromEntries(tabIds.map((id) => [id, t(`procurement.tab.${id}`)])) as Record<
        ProcurementTab,
        string
      >,
    [t, tabIds],
  )

  const filtered = useMemo(
    () =>
      filterOrders(procurement.orders, {
        status: statusFilter,
        scope: scopeFilter,
        categoryId: categoryFilter || undefined,
        counterpartyId: supplierFilter || undefined,
        transportMode: transportFilter,
        search,
      }),
    [
      procurement.orders,
      statusFilter,
      scopeFilter,
      categoryFilter,
      supplierFilter,
      transportFilter,
      search,
    ],
  )

  const kpis = useMemo(() => computeProcurementKpis(procurement.orders), [procurement.orders])
  const trackedContainers = useMemo(
    () => countTrackedContainers(procurement.orders),
    [procurement.orders],
  )

  const suppliers = useMemo(
    () =>
      counterparties.items.filter(
        (c) => c.active && (c.role === 'supplier' || c.role === 'both'),
      ),
    [counterparties.items],
  )

  const printDirectories = useMemo(
    () => ({
      suppliers: counterparties.items.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
      })),
      items: warehouse.items.map((i) => ({
        id: i.id,
        internalCode: i.internalCode,
        sku: i.sku,
        name: i.name,
      })),
      warehouses: warehouse.locations.map((l) => ({ id: l.id, name: l.name })),
    }),
    [counterparties.items, warehouse.items, warehouse.locations],
  )

  function openPoPrint(
    order: PurchaseOrder,
    opts: { showPrices: boolean },
  ) {
    setPrintModel(
      purchaseOrderToPrintModel(order as unknown as Record<string, unknown>, {
        showPrices: opts.showPrices,
        directories: printDirectories,
        title: t('g5.print.purchaseOrder.title'),
      }),
    )
  }

  function openPoChangePrint(
    order: PurchaseOrder,
    opts: { showPrices: boolean; statusChanged: boolean },
  ) {
    setPrintModel(
      reversalToPrintModel({
        kind: 'change',
        id: `${order.id}-change`,
        number: order.orderNumber,
        originalDocRef: order.orderNumber || order.id,
        revision: Number((order as { revision?: number }).revision) || (opts.statusChanged ? 2 : 1),
        reason: opts.statusChanged ? `status→${order.status}` : undefined,
        order: order as unknown as Record<string, unknown>,
        directories: printDirectories,
        showPrices: opts.showPrices,
        title: t('g5.print.reversal.title'),
      }),
    )
  }

  function openPoCancelPrint(order: PurchaseOrder, opts: { showPrices: boolean }) {
    setPrintModel(
      reversalToPrintModel({
        kind: 'storno',
        id: `${order.id}-cancel`,
        number: order.orderNumber,
        originalDocRef: order.orderNumber || order.id,
        revision: Number((order as { revision?: number }).revision) || 1,
        reason: 'cancelled',
        order: order as unknown as Record<string, unknown>,
        directories: printDirectories,
        showPrices: opts.showPrices,
        title: t('g5.print.reversal.title'),
      }),
    )
  }

  function openPoReceiptsPrint(order: PurchaseOrder, opts: { showPrices: boolean }) {
    const docs = warehouse.documents.filter(
      (d) =>
        d.purchaseOrderId === order.id ||
        order.warehouseDocumentIds.includes(d.id),
    )
    const embedded = (order as { receipts?: Record<string, unknown>[] }).receipts
    const sources =
      docs.length > 0
        ? docs
        : Array.isArray(embedded) && embedded.length > 0
          ? embedded
          : []
    if (sources.length === 0) {
      // Still open a receipt shell from PO open qty snapshot
      setPrintModel(
        purchaseOrderReceiptsHistoryToPrintModel(
          order as unknown as Record<string, unknown>,
          [
            {
              id: `rcpt-from-${order.id}`,
              purchaseOrderId: order.id,
              number: `${order.orderNumber}-RCPT`,
              lines: order.lines
                .filter((l) => (l.receivedQty ?? 0) > 0)
                .map((l) => ({
                  id: l.id,
                  lineId: l.id,
                  itemId: l.warehouseItemId,
                  itemNameSnapshot: l.name,
                  unit: l.unit,
                  receivedQty: l.receivedQty,
                  quantity: l.receivedQty,
                })),
            },
          ],
          {
            showPrices: opts.showPrices,
            directories: printDirectories,
            title: t('g5.print.receipt.title'),
          },
        ),
      )
      return
    }
    setPrintModel(
      purchaseOrderReceiptsHistoryToPrintModel(
        order as unknown as Record<string, unknown>,
        sources as unknown as Record<string, unknown>[],
        {
          showPrices: opts.showPrices,
          directories: printDirectories,
          title: t('g5.print.receipt.title'),
        },
      ),
    )
  }

  function openNew() {
    const { orderNumber } = allocateOrderNumber(procurement)
    const now = new Date().toISOString()
    const today = now.slice(0, 10)
    setEditOrder({
      id: crypto.randomUUID(),
      orderNumber: webProcurementMode ? '' : orderNumber,
      counterpartyId: '',
      scope: 'international',
      category: 'raw_material',
      categoryId: procurement.categories.find(
        (c) => !c.parentId && c.legacyKey === 'raw_material',
      )?.id,
      status: 'draft',
      orderDate: today,
      currency: 'CNY',
      originCountry: 'CN',
      incoterms: 'FOB',
      portOfLoading: 'Shanghai',
      portOfDischarge: 'Poti',
      destinationWarehouseId: warehouse.locations[0]?.id,
      lines: [],
      legs: [],
      milestones: [],
      statusHistory: [],
      attachments: [],
      warehouseDocumentIds: [],
      createdAt: now,
      updatedAt: now,
    })
    setIsNew(true)
  }

  async function saveOrder(order: PurchaseOrder, statusNote?: string) {
    await onUpsertOrder(order, statusNote)
    setEditOrder(null)
    setIsNew(false)
  }

  function persistTrackingSync(order: PurchaseOrder) {
    onUpsertOrder(order)
    setEditOrder(order)
  }

  return (
    <PageLayout>
      <ProcurementTrackingSync orders={procurement.orders} onApply={onUpsertOrder} />
      <PageHeader
        badge={webProcurementMode ? t('web.procurement.badge') : t('procurement.badge')}
        title={webProcurementMode ? t('web.procurement.title') : t('procurement.title')}
        subtitle={
          webProcurementMode ? t('web.procurement.subtitle') : t('procurement.subtitle')
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <KpiCard label={t('procurement.kpi.active')} value={kpis.activeOrders} />
            <KpiCard
              label={t('procurement.kpi.overdue')}
              value={kpis.overdue}
              tone={kpis.overdue > 0 ? 'warn' : 'default'}
            />
            <KpiCard label={t('procurement.kpi.inTransit')} value={kpis.inTransit} />
            {webProcurementMode && (
              <KpiCard
                label={t('procurement.kpi.containers')}
                value={trackedContainers}
                tone="warn"
              />
            )}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <TabBar
          coachPrefix="procurement"
          tabs={tabIds.map((id) => ({ id, label: tabLabels[id] }))}
          value={tab}
          onChange={setTab}
        />
        {(tab === 'orders' || tab === 'containers' || tab === 'tracking') && (
          <button
            type="button"
            className="btn-add ml-auto"
            onClick={openNew}
            data-coach="procurement:newOrder"
          >
            {t('procurement.newOrder')}
          </button>
        )}
      </div>

      {(tab === 'orders' || tab === 'tracking') && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {tab === 'orders' ? (
            <KanbanViewToggle
              mode={ordersView}
              onChange={setOrdersView}
              dataCoachKanban="procurement:ordersViewKanban"
            />
          ) : null}
          <input
            className="min-w-[12rem] flex-1 rounded-sm border border-grid px-3 py-2 text-sm"
            placeholder={t('procurement.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="rounded-sm border border-grid px-3 py-2 text-sm"
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as PurchaseOrderStatus | 'active' | 'all')
            }
          >
            <option value="active">{t('procurement.filter.active')}</option>
            <option value="all">{t('procurement.filter.all')}</option>
            <option value="draft">{t('procurement.status.draft')}</option>
            <option value="submitted">{t('procurement.status.submitted')}</option>
            <option value="approved">{t('procurement.status.approved')}</option>
            <option value="ordered">{t('procurement.status.ordered')}</option>
            <option value="production">{t('procurement.status.production')}</option>
            <option value="shipped">{t('procurement.status.shipped')}</option>
            <option value="in_transit">{t('procurement.status.in_transit')}</option>
            <option value="customs">{t('procurement.status.customs')}</option>
            <option value="arrived">{t('procurement.status.arrived')}</option>
            <option value="partial">{t('procurement.status.partial')}</option>
            <option value="received">{t('procurement.status.received')}</option>
            <option value="cancelled">{t('procurement.status.cancelled')}</option>
          </select>
          <select
            className="rounded-sm border border-grid px-3 py-2 text-sm"
            value={scopeFilter}
            onChange={(e) => setScopeFilter(e.target.value as ProcurementScope | '')}
          >
            {!webProcurementMode && (
              <option value="">{t('procurement.filter.allScopes')}</option>
            )}
            <option value="international">{t('procurement.scope.international')}</option>
            {!webProcurementMode && (
              <option value="domestic">{t('procurement.scope.domestic')}</option>
            )}
          </select>
          <select
            className="rounded-sm border border-grid px-3 py-2 text-sm"
            value={supplierFilter}
            onChange={(e) => setSupplierFilter(e.target.value)}
          >
            <option value="">{t('procurement.filter.allSuppliers')}</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            className="rounded-sm border border-grid px-3 py-2 text-sm"
            value={transportFilter}
            onChange={(e) => setTransportFilter(e.target.value as TransportMode | '')}
          >
            <option value="">{t('procurement.filter.allTransport')}</option>
            <option value="rail">{t('procurement.transport.rail')}</option>
            <option value="sea">{t('procurement.transport.sea')}</option>
            <option value="truck">{t('procurement.transport.truck')}</option>
            <option value="air">{t('procurement.transport.air')}</option>
          </select>
          <select
            className="rounded-sm border border-grid px-3 py-2 text-sm"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="">{t('procurement.filter.allCategories')}</option>
            {categoryOptionsFlat(procurement.categories).map((c) => (
              <option key={c.id} value={c.id}>
                {c.parentId ? `↳ ${categoryLabel(c)}` : categoryLabel(c)}
              </option>
            ))}
          </select>
        </div>
      )}

      {tab === 'orders' && ordersView === 'kanban' ? (
        <ProcurementOrdersKanban
          orders={filtered}
          counterparties={counterparties}
          onEdit={(o) => {
            setEditOrder(o)
            setIsNew(false)
          }}
          onSetStatus={onSetStatus}
        />
      ) : null}
      {tab === 'orders' && ordersView === 'list' ? (
        <ProcurementOrdersTab
          orders={filtered}
          counterparties={counterparties}
          onEdit={(o) => {
            setEditOrder(o)
            setIsNew(false)
          }}
          onRemove={webProcurementMode ? undefined : onRemoveOrder}
          onReceive={onReceiveOrder}
        />
      ) : null}
      {tab === 'tracking' && (
        <ProcurementTrackingTab
          orders={
            webProcurementMode
              ? procurement.orders.filter((o) => o.scope === 'international')
              : procurement.orders
          }
          counterparties={counterparties}
          onEdit={(o) => {
            setEditOrder(o)
            setIsNew(false)
          }}
        />
      )}
      {tab === 'containers' && (
        <ProcurementContainersTab
          orders={procurement.orders}
          counterparties={counterparties}
          onEdit={(o) => {
            setEditOrder(o)
            setIsNew(false)
          }}
        />
      )}
      {tab === 'stock' && (
        <>
          <AsOfSnapshotBar
            className="mb-4"
            enabled={asOfEnabled}
            onEnabledChange={setAsOfEnabled}
            date={asOfDate}
            onDateChange={setAsOfDate}
            time={asOfTime}
            onTimeChange={setAsOfTime}
            hintKey="asOf.hintProcurement"
          />
          <ProcurementStockTab
            procurement={procurement}
            warehouse={warehouse}
            asOfIso={asOfIso ?? undefined}
          />
        </>
      )}
      {tab === 'analytics' && (
        <ProcurementAnalyticsTab orders={procurement.orders} counterparties={counterparties} />
      )}
      {tab === 'catalog' && (
        <ProcurementCatalogTab
          procurement={procurement}
          onUpsertCategory={onUpsertProcurementCategory}
          onRemoveCategory={onRemoveProcurementCategory}
          onUpsertRoutePoint={onUpsertRoutePoint}
          onRemoveRoutePoint={onRemoveRoutePoint}
        />
      )}

      {editOrder && (
        <PurchaseOrderModal
          order={editOrder}
          isNew={isNew}
          authoritativeMode={webProcurementMode}
          counterparties={counterparties}
          warehouse={warehouse}
          categories={procurement.categories}
          routePoints={procurement.routePoints}
          canViewOrder
          canViewCommercial={canViewCommercial}
          onClose={() => {
            setEditOrder(null)
            setIsNew(false)
          }}
          onUpsertCounterparty={onUpsertCounterparty}
          onUpsertWarehouseItem={onUpsertWarehouseItem}
          onNavigateToDirectory={onNavigateToDirectory}
          onSave={saveOrder}
          onSyncPersist={persistTrackingSync}
          onPrintOrder={(o, opts) => openPoPrint(o, opts)}
          onPrintChange={(o, opts) => openPoChangePrint(o, opts)}
          onPrintCancel={(o, opts) => openPoCancelPrint(o, opts)}
          onPrintReceipts={(o, opts) => openPoReceiptsPrint(o, opts)}
        />
      )}
      {printModel ? (
        <G5DocumentPrintModal
          model={printModel}
          onClose={() => setPrintModel(null)}
          showCommercial={canViewCommercial}
        />
      ) : null}
    </PageLayout>
  )
}
