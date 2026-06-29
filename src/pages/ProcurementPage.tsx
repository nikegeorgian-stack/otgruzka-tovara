import { useMemo, useState } from 'react'
import { KpiCard } from '@/components/ui/KpiCard'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageLayout } from '@/components/ui/PageLayout'
import { TabBar } from '@/components/ui/TabBar'
import { ProcurementAnalyticsTab } from '@/components/procurement/ProcurementAnalyticsTab'
import { ProcurementOrdersTab } from '@/components/procurement/ProcurementOrdersTab'
import { ProcurementTrackingTab } from '@/components/procurement/ProcurementTrackingTab'
import { ProcurementTrackingSync } from '@/components/procurement/ProcurementTrackingSync'
import { PurchaseOrderModal } from '@/components/procurement/PurchaseOrderModal'
import { ProcurementContainersTab } from '@/components/procurement/ProcurementContainersTab'
import { ProcurementStockTab } from '@/components/procurement/ProcurementStockTab'
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
import type {
  OrderCategory,
  ProcurementScope,
  PurchaseOrder,
  PurchaseOrderStatus,
  TransportMode,
} from '@/lib/procurement/types'

export function ProcurementPage(
  props: ProcurementPageProps & { webProcurementMode?: boolean },
) {
  const {
    procurement,
    counterparties,
    warehouse,
    onUpsertOrder,
    onRemoveOrder,
    onReceiveOrder,
    onUpsertCounterparty,
    onUpsertWarehouseItem,
    onNavigateToDirectory,
    webProcurementMode = false,
  } = props

  const { t } = useI18n()
  const tabIds = webProcurementMode ? PROCUREMENT_WEB_TABS : PROCUREMENT_TABS
  const [tab, setTab] = useState<ProcurementTab>(
    webProcurementMode ? 'containers' : 'orders',
  )
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<PurchaseOrderStatus | 'active' | 'all'>('active')
  const [scopeFilter, setScopeFilter] = useState<ProcurementScope | ''>(
    webProcurementMode ? 'international' : '',
  )
  const [categoryFilter, setCategoryFilter] = useState<OrderCategory | ''>('')
  const [transportFilter, setTransportFilter] = useState<TransportMode | ''>('')
  const [supplierFilter, setSupplierFilter] = useState('')
  const [editOrder, setEditOrder] = useState<PurchaseOrder | null>(null)
  const [isNew, setIsNew] = useState(false)

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
        category: categoryFilter,
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

  function openNew() {
    const { orderNumber } = allocateOrderNumber(procurement)
    const now = new Date().toISOString()
    const today = now.slice(0, 10)
    setEditOrder({
      id: crypto.randomUUID(),
      orderNumber,
      counterpartyId: '',
      scope: 'international',
      category: 'raw_material',
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

  function saveOrder(order: PurchaseOrder, statusNote?: string) {
    onUpsertOrder(order, statusNote)
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
          tabs={tabIds.map((id) => ({ id, label: tabLabels[id] }))}
          value={tab}
          onChange={setTab}
        />
        {(tab === 'orders' || tab === 'containers' || tab === 'tracking') && (
          <button type="button" className="btn-add ml-auto" onClick={openNew}>
            {t('procurement.newOrder')}
          </button>
        )}
      </div>

      {(tab === 'orders' || tab === 'tracking') && (
        <div className="mb-4 flex flex-wrap gap-2">
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
            <option value="in_transit">{t('procurement.status.in_transit')}</option>
            <option value="received">{t('procurement.status.received')}</option>
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
            onChange={(e) => setCategoryFilter(e.target.value as OrderCategory | '')}
          >
            <option value="">{t('procurement.filter.allCategories')}</option>
            <option value="raw_material">{t('procurement.category.raw_material')}</option>
            <option value="packaging">{t('procurement.category.packaging')}</option>
            <option value="spare_parts">{t('procurement.category.spare_parts')}</option>
          </select>
        </div>
      )}

      {tab === 'orders' && (
        <ProcurementOrdersTab
          orders={filtered}
          counterparties={counterparties}
          onEdit={(o) => {
            setEditOrder(o)
            setIsNew(false)
          }}
          onRemove={onRemoveOrder}
          onReceive={onReceiveOrder}
        />
      )}
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
        <ProcurementStockTab procurement={procurement} warehouse={warehouse} />
      )}
      {tab === 'analytics' && (
        <ProcurementAnalyticsTab orders={procurement.orders} counterparties={counterparties} />
      )}

      {editOrder && (
        <PurchaseOrderModal
          order={editOrder}
          isNew={isNew}
          counterparties={counterparties}
          warehouse={warehouse}
          onClose={() => {
            setEditOrder(null)
            setIsNew(false)
          }}
          onUpsertCounterparty={onUpsertCounterparty}
          onUpsertWarehouseItem={onUpsertWarehouseItem}
          onNavigateToDirectory={onNavigateToDirectory}
          onSave={saveOrder}
          onSyncPersist={persistTrackingSync}
        />
      )}
    </PageLayout>
  )
}
