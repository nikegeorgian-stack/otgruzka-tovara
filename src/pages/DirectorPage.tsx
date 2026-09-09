import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { SalesOrderModal } from '@/components/director/SalesOrderModal'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageLayout } from '@/components/ui/PageLayout'
import { TabBar } from '@/components/ui/TabBar'
import { useConfirm } from '@/context/ConfirmContext'
import { useI18n } from '@/context/I18nContext'
import type { Counterparty } from '@/lib/counterparties/types'
import type { FinishedProduct } from '@/lib/finishedProducts/types'
import type { ProductionOrder } from '@/lib/planner/types'
import type { ProductionLineId, ProductionRequest } from '@/lib/production/types'
import {
  buildLineLoad,
  salesDashboardKpis,
  salesOrderMetrics,
} from '@/lib/sales/calc'
import {
  buildDirectorActionQueue,
  computeDelayForecast,
  consumeDirectorNavHint,
  markRisksSeen,
} from '@/lib/sales/directorActions'
import { computeDirectorPulse } from '@/lib/sales/directorPulse'
import { DirectorCommandBoard } from '@/components/director/DirectorCommandBoard'
import { DirectorPulsePanel, type DirectorPulseNavigate } from '@/components/director/DirectorPulsePanel'
import { computeDirectorCommandBriefing } from '@/lib/director/commandBriefing'
import type { ExecutiveKpiInput } from '@/lib/erp/executiveKpis'
import type { OtcStore } from '@/lib/otc/types'
import { AsOfSnapshotBar } from '@/components/asOf/AsOfSnapshotBar'
import { useAsOfSnapshot } from '@/hooks/useAsOfSnapshot'
import { emptySalesOrder } from '@/lib/sales/init'
import { collectOrderLoadingShipments } from '@/lib/sales/loadingLink'
import { saveProductionCycleContext } from '@/lib/productionCycle'
import {
  salesStatusLabel,
  salesFulfillmentLabel,
  SALES_ORDER_STATUSES,
  SALES_FULFILLMENT_STATUSES,
  type SalesOrder,
  type SalesOrderStatus,
  type SalesStore,
} from '@/lib/sales/types'
import { buildPlanSalesLinePreview } from '@/lib/sales/planPreview'
import type { LoadingShipment, WarehouseStore } from '@/lib/warehouse/types'
import { DirectorActionQueue } from '@/components/director/DirectorActionQueue'
import { DirectorOrderQuickCard } from '@/components/director/DirectorOrderQuickCard'
import { SalesOrderKanban } from '@/components/director/SalesOrderKanban'
import { KanbanViewToggle } from '@/components/kanban'
import { G5DocumentPrintModal, type G5DocumentPrintModel } from '@/components/print/G5DocumentPrintModal'
import { g5FlagsFromStore } from '@/lib/planner/g5Activation'
import {
  isCancelledStatus,
  reversalToPrintModel,
  salesOrderToPrintModel,
  shouldPrintChange,
  warehouseDocToReversalPrintModel,
} from '@/lib/print/g5PrintFromDomain'
import type { AppStore } from '@/lib/types'

type Tab = 'dashboard' | 'queue' | 'orders' | 'planning'
type OrdersView = 'list' | 'kanban'

type Props = {
  sales: SalesStore
  plannerOrders: ProductionOrder[]
  requests: ProductionRequest[]
  counterparties: Counterparty[]
  finishedProducts: FinishedProduct[]
  warehouse: WarehouseStore
  webUserName?: string
  onUpsertSalesOrder: (order: SalesOrder) => SalesOrder | Promise<SalesOrder>
  onUpsertCounterparty: (c: Counterparty) => void
  onOpenCounterpartiesJournal?: () => void
  onRemoveSalesOrder: (id: string) => void
  onSetSalesOrderStatus: (id: string, status: SalesOrderStatus, message?: string) => void
  onPlanSalesLine: (
    orderId: string,
    salesLineId: string,
    productionLineId: ProductionLineId | undefined,
    dates: { startDate: string; endDate: string },
  ) => string | null
  onPlanAllSalesLines: (
    orderId: string,
    dates: { startDate: string; endDate: string },
    productionLineId?: ProductionLineId,
  ) => { created: string[]; skipped: number; reservedMp?: number }
  onCreateLoadingShipmentsFromSalesOrder: (
    orderId: string,
  ) => { created: string[]; skipped: number }
  onCreateCombinedLoadingFromSalesOrder: (
    orderId: string,
  ) => { created: string | null; skipped: boolean; number?: string }
  loadingShipments: LoadingShipment[]
  onOpenWarehouseLoading?: () => void
  onOpenPlanner?: (productionOrderId: string) => void
  onOpenProduction?: () => void
  onOpenTechnologist?: () => void
  focusSalesOrderId?: string | null
  onJournalFocusConsumed?: () => void
  erpInput?: ExecutiveKpiInput
  otc?: OtcStore
  onErpNavigate?: (view: import('@/lib/types').ViewId) => void
  /** Гендиректор: только отчёты, без заказов/планирования. */
  reportOnly?: boolean
  /** Optional full store for G5 activation flags (master-data / sales planning). */
  store?: AppStore | null
  /** Commercial ACL for G5 print prices (default false). */
  canViewCommercial?: boolean
  /** Alias kept for callers; defaults false. */
  showCommercial?: boolean
}

function lineNeedsEnsure(line: SalesOrder['lines'][number]): boolean {
  const rem = line.progress?.remainingToPlanQty
  if (typeof rem === 'number') return rem > 0.05
  return line.productionOrderIds.length === 0 && (line.qtyMp || 0) > 0
}

function orderIsOpenCommercial(o: SalesOrder): boolean {
  const c = o.commercialStatus
  if (c) return c !== 'completed' && c !== 'cancelled'
  return o.status !== 'completed' && o.status !== 'cancelled'
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

const TONE_CLASS: Record<string, string> = {
  neutral: 'bg-stone-200 text-stone-700',
  info: 'bg-sky-100 text-sky-800',
  warn: 'bg-amber-100 text-amber-800',
  good: 'bg-teal-100 text-teal-800',
  danger: 'bg-red-100 text-red-700',
}

export function DirectorPage({
  sales,
  plannerOrders,
  requests,
  counterparties,
  finishedProducts,
  warehouse,
  webUserName,
  onUpsertSalesOrder,
  onUpsertCounterparty,
  onOpenCounterpartiesJournal,
  onRemoveSalesOrder,
  onSetSalesOrderStatus,
  onPlanSalesLine,
  onPlanAllSalesLines,
  onCreateLoadingShipmentsFromSalesOrder,
  onCreateCombinedLoadingFromSalesOrder,
  loadingShipments,
  onOpenWarehouseLoading,
  onOpenPlanner,
  onOpenProduction,
  onOpenTechnologist,
  focusSalesOrderId,
  onJournalFocusConsumed,
  erpInput,
  otc,
  onErpNavigate,
  reportOnly = false,
  store = null,
  canViewCommercial = false,
  showCommercial = false,
}: Props) {
  const { t, tf, locale } = useI18n()
  const g5Flags = g5FlagsFromStore(store)
  const commercialPrint = canViewCommercial || showCommercial
  const [printModel, setPrintModel] = useState<G5DocumentPrintModel | null>(null)
  const { confirm } = useConfirm()
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
  const [tab, setTab] = useState<Tab>('dashboard')
  const [ordersView, setOrdersView] = useState<OrdersView>('list')
  const [editing, setEditing] = useState<SalesOrder | null>(null)
  const [orderQuery, setOrderQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<SalesOrderStatus | 'all'>('all')
  const [riskOnly, setRiskOnly] = useState(false)
  const [planningOnlyAction, setPlanningOnlyAction] = useState(true)
  const [highlightOrderId, setHighlightOrderId] = useState<string | null>(null)
  const [opsOpen, setOpsOpen] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches,
  )

  useEffect(() => {
    if (!focusSalesOrderId) return
    if (reportOnly) {
      onJournalFocusConsumed?.()
      return
    }
    const order = sales.orders.find((o) => o.id === focusSalesOrderId)
    if (order) {
      setEditing(order)
      setTab('orders')
    }
    onJournalFocusConsumed?.()
  }, [focusSalesOrderId, sales.orders, onJournalFocusConsumed, reportOnly])

  useEffect(() => {
    const hint = consumeDirectorNavHint()
    if (!hint || reportOnly) return
    if (hint.riskOnly) {
      setRiskOnly(true)
      setStatusFilter('all')
      setOrderQuery('')
    }
    if (hint.orderId) {
      const order = sales.orders.find((o) => o.id === hint.orderId)
      if (order) setEditing(order)
      setHighlightOrderId(hint.orderId)
    }
    if (hint.tab === 'kanban') {
      setTab('orders')
      setOrdersView('kanban')
    } else if (
      hint.tab === 'queue' ||
      hint.tab === 'orders' ||
      hint.tab === 'planning' ||
      hint.tab === 'dashboard'
    ) {
      setTab(hint.tab)
    } else if (hint.riskOnly) {
      setTab('queue')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- consume once on mount

  useEffect(() => {
    if (reportOnly) setTab('dashboard')
  }, [reportOnly])

  const today = todayIso()

  const kpis = useMemo(
    () => salesDashboardKpis(sales.orders, plannerOrders, requests, today),
    [sales.orders, plannerOrders, requests, today],
  )

  const pulse = useMemo(() => {
    if (!erpInput) return null
    return computeDirectorPulse({
      salesOrders: sales.orders,
      plannerOrders,
      requests,
      loadingShipments,
      otc,
      procurement: erpInput.procurement,
      warehouse: erpInput.warehouse,
      months: erpInput.months,
      employees: erpInput.employees,
      today,
      asOfIso: asOfIso ?? undefined,
    })
  }, [erpInput, sales.orders, plannerOrders, requests, loadingShipments, otc, today, asOfIso])

  const briefing = useMemo(() => {
    if (!erpInput) return null
    return computeDirectorCommandBriefing({
      months: erpInput.months,
      employees: erpInput.employees,
      salesOrders: sales.orders,
      plannerOrders,
      requests,
      loadingShipments,
      procurement: erpInput.procurement,
      warehouse: erpInput.warehouse,
      otc,
      today,
      asOfIso: asOfIso ?? undefined,
    })
  }, [erpInput, sales.orders, plannerOrders, requests, loadingShipments, otc, today, asOfIso])

  const metricsById = useMemo(() => {
    const map = new Map<string, ReturnType<typeof salesOrderMetrics>>()
    for (const o of sales.orders) {
      map.set(o.id, salesOrderMetrics(o, plannerOrders, requests, today))
    }
    return map
  }, [sales.orders, plannerOrders, requests, today])

  const forecastById = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computeDelayForecast>>()
    for (const o of sales.orders) {
      const m = metricsById.get(o.id)
      if (m) map.set(o.id, computeDelayForecast(o, m, today))
    }
    return map
  }, [sales.orders, metricsById, today])

  const actionQueue = useMemo(
    () =>
      buildDirectorActionQueue({
        orders: sales.orders,
        plannerOrders,
        requests,
        loadingShipments,
        today,
      }),
    [sales.orders, plannerOrders, requests, loadingShipments, today],
  )

  useEffect(() => {
    if (tab === 'queue' || (tab === 'orders' && riskOnly)) {
      const ids = actionQueue.filter((a) => a.kind === 'risk').map((a) => a.orderId)
      if (ids.length) markRisksSeen(ids)
    }
  }, [tab, riskOnly, actionQueue])

  const lineLoad = useMemo(
    () => buildLineLoad(plannerOrders, { fromDate: today, days: 14 }),
    [plannerOrders, today],
  )
  const maxLoad = Math.max(1, ...lineLoad.map((d) => d.total))

  const atRiskOrders = useMemo(
    () =>
      sales.orders
        .filter((o) => {
          const m = metricsById.get(o.id)
          const f = forecastById.get(o.id)
          return m?.atRisk || f?.lateLikely
        })
        .sort(
          (a, b) =>
            (metricsById.get(a.id)?.daysToDue ?? 99) - (metricsById.get(b.id)?.daysToDue ?? 99),
        ),
    [sales.orders, metricsById, forecastById],
  )

  const sortedOrders = useMemo(
    () =>
      [...sales.orders].sort(
        (a, b) => b.orderDate.localeCompare(a.orderDate) || b.createdAt.localeCompare(a.createdAt),
      ),
    [sales.orders],
  )

  const needsPlanCount = useMemo(() => {
    let n = 0
    for (const o of sales.orders) {
      if (!orderIsOpenCommercial(o)) continue
      if (o.commercialStatus === 'draft' || o.status === 'draft') continue
      if (o.lines.some(lineNeedsEnsure)) n++
    }
    return n
  }, [sales.orders])

  const filteredOrders = useMemo(() => {
    const q = orderQuery.trim().toLowerCase()
    return sortedOrders.filter((o) => {
      if (statusFilter !== 'all' && o.status !== statusFilter) return false
      if (riskOnly) {
        const m = metricsById.get(o.id)
        const f = forecastById.get(o.id)
        if (!m?.atRisk && !f?.lateLikely) return false
      }
      if (!q) return true
      const hay = `${o.orderNumber} ${o.customer} ${o.region ?? ''} ${o.logistics ?? ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [sortedOrders, orderQuery, statusFilter, riskOnly, metricsById, forecastById])

  const openForPlanning = useMemo(
    () =>
      sortedOrders.filter(
        (o) =>
          orderIsOpenCommercial(o) &&
          o.commercialStatus !== 'draft' &&
          o.status !== 'draft',
      ),
    [sortedOrders],
  )

  const planningOrders = useMemo(() => {
    if (!planningOnlyAction) return openForPlanning
    return openForPlanning.filter((o) => o.lines.some(lineNeedsEnsure))
  }, [openForPlanning, planningOnlyAction])

  function openOrder(order: SalesOrder) {
    saveProductionCycleContext({ salesOrderId: order.id })
    setEditing(order)
    setTab('orders')
    setOrdersView('list')
  }

  function focusAtRisk() {
    setRiskOnly(true)
    setStatusFilter('all')
    setOrderQuery('')
    if (reportOnly) {
      document.getElementById('director-risk-report')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    setTab('queue')
  }

  function focusNeedsPlan() {
    if (reportOnly) return
    setPlanningOnlyAction(true)
    setTab('planning')
  }

  function handlePulseNavigate(nav: DirectorPulseNavigate) {
    if (nav.type === 'view') {
      onErpNavigate?.(nav.view)
      return
    }
    if (reportOnly) {
      if (nav.focus === 'risk' || nav.tab === 'queue') focusAtRisk()
      return
    }
    if (nav.focus === 'risk') focusAtRisk()
    else if (nav.focus === 'needs_plan') focusNeedsPlan()
    else if (nav.focus === 'queue') setTab('queue')
    else setTab(nav.tab)
  }

  function clearOrderFilters() {
    setRiskOnly(false)
    setStatusFilter('all')
    setOrderQuery('')
  }

  function goPlanningForOrder(orderId: string) {
    setHighlightOrderId(orderId)
    setPlanningOnlyAction(false)
    setTab('planning')
  }

  async function handleDelete(order: SalesOrder) {
    const ok = await confirm({
      title: t('sales.deleteTitle'),
      message: tf('sales.deleteConfirm', { order: order.orderNumber || '—' }),
      danger: true,
    })
    if (ok) onRemoveSalesOrder(order.id)
  }

  function statusBadge(status: SalesOrderStatus) {
    const tone = SALES_ORDER_STATUSES.find((s) => s.key === status)?.tone ?? 'neutral'
    return (
      <span
        className={`inline-block rounded-sm px-2 py-0.5 text-xs font-medium ${TONE_CLASS[tone]}`}
      >
        {salesStatusLabel(status, locale)}
      </span>
    )
  }

  function fulfillmentBadge(order: SalesOrder) {
    const key = order.fulfillmentStatus
    if (!key || key === 'unplanned') return null
    const tone = SALES_FULFILLMENT_STATUSES.find((s) => s.key === key)?.tone ?? 'neutral'
    return (
      <span
        className={`inline-block rounded-sm px-2 py-0.5 text-xs font-medium ${TONE_CLASS[tone]}`}
        title={t('sales.fulfillment.label')}
      >
        {salesFulfillmentLabel(key, locale)}
      </span>
    )
  }

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'dashboard', label: t('director.tab.dashboard') },
    { id: 'queue', label: t('director.tab.queue'), count: actionQueue.length || undefined },
    { id: 'orders', label: t('director.tab.orders'), count: sales.orders.length || undefined },
    {
      id: 'planning',
      label: t('director.tab.planning'),
      count: needsPlanCount || undefined,
    },
  ]

  return (
    <PageLayout>
      {reportOnly ? (
        <PageHeader
          badge={t('director.badge')}
          title={t('director.reportTitle')}
          subtitle={t('director.reportSubtitle')}
        />
      ) : (
        <>
          <PageHeader
            badge={t('director.badge')}
            title={webUserName ? tf('director.welcome', { name: webUserName }) : t('director.title')}
            subtitle={t('director.subtitle')}
            actions={
              <Button onClick={() => setEditing(emptySalesOrder(today))} data-coach="director:newOrder">
                {t('sales.newOrder')}
              </Button>
            }
          />

          {(kpis.atRiskOrders > 0 || needsPlanCount > 0 || actionQueue.length > 0) && (
            <div className="flex flex-wrap items-center gap-2 rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-stone-800">
              <span className="mr-1 font-medium">{t('director.focus.title')}</span>
              {actionQueue.length > 0 && (
                <Button size="sm" variant="secondary" onClick={() => setTab('queue')}>
                  {tf('director.focus.queue', { count: actionQueue.length })}
                </Button>
              )}
              {kpis.atRiskOrders > 0 && (
                <Button size="sm" variant="secondary" onClick={focusAtRisk}>
                  {tf('director.focus.atRisk', { count: kpis.atRiskOrders })}
                </Button>
              )}
              {needsPlanCount > 0 && (
                <Button size="sm" variant="secondary" onClick={focusNeedsPlan}>
                  {tf('director.focus.needsPlan', { count: needsPlanCount })}
                </Button>
              )}
            </div>
          )}

          <TabBar coachPrefix="director" tabs={tabs} value={tab} onChange={setTab} className="mb-1" />
        </>
      )}

      {tab === 'queue' && !reportOnly && (
        <DirectorActionQueue
          items={actionQueue}
          onOpenOrder={(id) => {
            const o = sales.orders.find((x) => x.id === id)
            if (o) openOrder(o)
          }}
          onGoPlanning={goPlanningForOrder}
          onGoPlanner={onOpenPlanner}
          onGoWarehouse={onOpenWarehouseLoading}
          onGoTechnologist={onOpenTechnologist}
        />
      )}

      {(tab === 'dashboard' || reportOnly) && (
        <div className="space-y-4">
          {briefing && <DirectorCommandBoard briefing={briefing} onNavigate={handlePulseNavigate} />}

          {reportOnly ? (
            <Card
              title={t('director.risk.title')}
              description={t('director.risk.hintReport')}
              className="scroll-mt-4"
            >
              <div id="director-risk-report">
                {atRiskOrders.length === 0 ? (
                  <p className="py-6 text-center text-sm text-stone-500">{t('director.risk.empty')}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="fc-table w-full text-sm">
                      <thead>
                        <tr>
                          <th>{t('sales.col.order')}</th>
                          <th>{t('sales.col.customer')}</th>
                          <th>{t('sales.field.dueDate')}</th>
                          <th className="text-right">{t('director.col.daysLeft')}</th>
                          <th className="text-right">{t('director.col.forecast')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {atRiskOrders.map((o) => {
                          const m = metricsById.get(o.id)!
                          const f = forecastById.get(o.id)
                          return (
                            <tr key={o.id}>
                              <td className="font-mono text-xs">{o.orderNumber}</td>
                              <td>{o.customer}</td>
                              <td>{o.dueDate ?? '—'}</td>
                              <td className="text-right tabular-nums text-red-600">
                                {m.daysToDue ?? '—'}
                              </td>
                              <td className="text-right text-xs">
                                {f?.lateLikely ? (
                                  <span className="font-medium text-red-700">
                                    {f.projectedDaysLate > 0 && f.projectedDaysLate < 999
                                      ? tf('director.forecast.late', { days: f.projectedDaysLate })
                                      : t('director.forecast.lateLikely')}
                                  </span>
                                ) : (
                                  <span className="text-teal-700">{t('director.forecast.onTrack')}</span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </Card>
          ) : (
            <>
          <details className="rounded-sm border border-stone-200 bg-white px-3 py-2 text-sm">
            <summary className="cursor-pointer select-none font-medium text-stone-700">
              {t('director.asOf.toggle')}
            </summary>
            <div className="mt-2">
              <AsOfSnapshotBar
                enabled={asOfEnabled}
                onEnabledChange={setAsOfEnabled}
                date={asOfDate}
                onDateChange={setAsOfDate}
                time={asOfTime}
                onTimeChange={setAsOfTime}
                hintKey="asOf.hintExecutive"
              />
            </div>
          </details>

          <details
            className="director-dash-ops rounded-sm border border-stone-200 bg-white px-3 py-1 text-sm"
            open={opsOpen}
            onToggle={(e) => setOpsOpen((e.currentTarget as HTMLDetailsElement).open)}
          >
            <summary className="director-dash-ops__summary cursor-pointer select-none font-medium text-stone-700">
              {t('director.command.moreOps')}
            </summary>
            <div className="mt-3 space-y-4">
          {pulse && <DirectorPulsePanel pulse={pulse} onNavigate={handlePulseNavigate} />}

          <Card title={t('director.risk.title')} description={t('director.risk.hint')}>
            {atRiskOrders.length === 0 ? (
              <p className="py-6 text-center text-sm text-stone-500">{t('director.risk.empty')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="fc-table w-full text-sm">
                  <thead>
                    <tr>
                      <th>{t('sales.col.order')}</th>
                      <th>{t('sales.col.customer')}</th>
                      <th>{t('sales.field.dueDate')}</th>
                      <th className="text-right">{t('director.col.daysLeft')}</th>
                      <th className="text-right">{t('director.col.done')}</th>
                      <th className="text-right">{t('director.col.forecast')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {atRiskOrders.map((o) => {
                      const m = metricsById.get(o.id)!
                      const f = forecastById.get(o.id)
                      return (
                        <tr
                          key={o.id}
                          className="cursor-pointer hover:bg-amber-50/80"
                          onClick={() => openOrder(o)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              openOrder(o)
                            }
                          }}
                          tabIndex={0}
                          role="button"
                        >
                          <td className="font-mono text-xs text-sky-800 underline-offset-2 hover:underline">
                            {o.orderNumber}
                          </td>
                          <td>{o.customer}</td>
                          <td>{o.dueDate ?? '—'}</td>
                          <td className="text-right tabular-nums text-red-600">
                            {m.daysToDue ?? '—'}
                          </td>
                          <td>
                            <DoneBar pct={m.donePct} />
                          </td>
                          <td className="text-right text-xs">
                            {f?.lateLikely ? (
                              <span className="font-medium text-red-700">
                                {f.projectedDaysLate > 0 && f.projectedDaysLate < 999
                                  ? tf('director.forecast.late', { days: f.projectedDaysLate })
                                  : t('director.forecast.lateLikely')}
                              </span>
                            ) : (
                              <span className="text-teal-700">{t('director.forecast.onTrack')}</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title={t('director.load.title')} description={t('director.load.hint')}>
            <div className="mb-2 flex flex-wrap gap-3 text-xs text-stone-500">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2 w-3 rounded-sm bg-sky-500" />
                {tf('mixer.line', { line: '1' })}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2 w-3 rounded-sm bg-teal-500" />
                {tf('mixer.line', { line: '2' })}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="fc-table w-full text-sm">
                <thead>
                  <tr>
                    <th>{t('director.load.date')}</th>
                    <th className="text-right">{tf('mixer.line', { line: '1' })}</th>
                    <th className="text-right">{tf('mixer.line', { line: '2' })}</th>
                    <th className="text-right">{t('director.load.total')}</th>
                    <th className="w-1/3">{t('director.load.chart')}</th>
                  </tr>
                </thead>
                <tbody>
                  {lineLoad.map((d) => {
                    const l1 = d.byLine['1'] ?? 0
                    const l2 = d.byLine['2'] ?? 0
                    return (
                      <tr key={d.date}>
                        <td>{d.date}</td>
                        <td className="text-right tabular-nums">{Math.round(l1)}</td>
                        <td className="text-right tabular-nums">{Math.round(l2)}</td>
                        <td className="text-right tabular-nums font-medium">{Math.round(d.total)}</td>
                        <td>
                          <div className="flex h-3 w-full overflow-hidden rounded bg-stone-100">
                            <div
                              className="h-3 bg-sky-500"
                              style={{ width: `${(l1 / maxLoad) * 100}%` }}
                              title={tf('mixer.line', { line: '1' })}
                            />
                            <div
                              className="h-3 bg-teal-500"
                              style={{ width: `${(l2 / maxLoad) * 100}%` }}
                              title={tf('mixer.line', { line: '2' })}
                            />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
            </div>
          </details>
            </>
          )}
        </div>
      )}

      {tab === 'orders' && !reportOnly && (
        <Card title={t('sales.listTitle')} description={t('sales.listHint')}>
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <KanbanViewToggle
              mode={ordersView}
              onChange={setOrdersView}
              dataCoachKanban="director:ordersViewKanban"
            />
            {ordersView === 'list' && (
              <>
                <div className="min-w-[12rem] flex-1 sm:max-w-xs">
                  <Input
                    value={orderQuery}
                    onChange={(e) => setOrderQuery(e.target.value)}
                    placeholder={t('director.orders.search')}
                    aria-label={t('director.orders.search')}
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <FilterChip
                    active={!riskOnly && statusFilter === 'all'}
                    onClick={clearOrderFilters}
                    label={t('common.all')}
                  />
                  <FilterChip
                    active={riskOnly}
                    onClick={() => {
                      setRiskOnly(true)
                      setStatusFilter('all')
                    }}
                    label={t('director.orders.filterRisk')}
                    warn
                  />
                  {SALES_ORDER_STATUSES.map((s) => (
                    <FilterChip
                      key={s.key}
                      active={!riskOnly && statusFilter === s.key}
                      onClick={() => {
                        setRiskOnly(false)
                        setStatusFilter(s.key)
                      }}
                      label={salesStatusLabel(s.key, locale)}
                    />
                  ))}
                </div>
              </>
            )}
          </div>

          {ordersView === 'kanban' ? (
            <SalesOrderKanban
              orders={sortedOrders}
              metricsById={metricsById}
              onSetStatus={onSetSalesOrderStatus}
              onOpenOrder={(o) => setEditing(o)}
            />
          ) : sortedOrders.length === 0 ? (
            <p className="py-8 text-center text-sm text-stone-500">{t('sales.listEmpty')}</p>
          ) : filteredOrders.length === 0 ? (
            <p className="py-8 text-center text-sm text-stone-500">{t('director.orders.emptyFilter')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="fc-table w-full text-sm">
                <thead>
                  <tr>
                    <th>{t('sales.col.order')}</th>
                    <th>{t('sales.col.customer')}</th>
                    <th className="text-right">{t('sales.col.qty')}</th>
                    <th className="text-right">{t('director.col.done')}</th>
                    <th>{t('sales.field.dueDate')}</th>
                    <th>{t('director.col.forecast')}</th>
                    <th>{t('sales.col.status')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((o) => {
                    const m = metricsById.get(o.id)!
                    const f = forecastById.get(o.id)
                    return (
                      <tr key={o.id} className={m.atRisk || f?.lateLikely ? 'bg-amber-50/40' : undefined}>
                        <td>
                          <button
                            type="button"
                            className="font-mono text-xs text-sky-800 underline-offset-2 hover:underline"
                            onClick={() => setEditing(o)}
                          >
                            {o.orderNumber || '—'}
                          </button>
                          {o.priority === 'urgent' && (
                            <span className="ml-1 rounded-sm bg-red-100 px-1 py-0.5 text-[10px] font-semibold uppercase text-red-700">
                              {t('director.orders.urgent')}
                            </span>
                          )}
                        </td>
                        <td>
                          <div>{o.customer}</div>
                          {(o.region || o.logistics) && (
                            <div className="text-xs text-stone-400">
                              {[o.region, o.logistics].filter(Boolean).join(' · ')}
                            </div>
                          )}
                        </td>
                        <td className="text-right tabular-nums">
                          {m.orderedMp.toLocaleString('ru-RU')}
                        </td>
                        <td>
                          <DoneBar pct={m.donePct} />
                        </td>
                        <td className={o.dueDate && (m.atRisk || f?.lateLikely) ? 'font-medium text-red-600' : ''}>
                          {o.dueDate ?? '—'}
                        </td>
                        <td className="text-xs">
                          {f?.lateLikely ? (
                            <span className="font-medium text-red-700">
                              {f.projectedDaysLate > 0 && f.projectedDaysLate < 999
                                ? tf('director.forecast.late', { days: f.projectedDaysLate })
                                : t('director.forecast.lateLikely')}
                            </span>
                          ) : (
                            <span className="text-teal-700">{t('director.forecast.onTrack')}</span>
                          )}
                        </td>
                        <td>
                          <select
                            className="fc-input"
                            value={o.status}
                            onChange={(e) =>
                              onSetSalesOrderStatus(o.id, e.target.value as SalesOrderStatus)
                            }
                            onClick={(e) => e.stopPropagation()}
                          >
                            {SALES_ORDER_STATUSES.map((s) => (
                              <option key={s.key} value={s.key}>
                                {salesStatusLabel(s.key, locale)}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="secondary" size="sm" onClick={() => setEditing(o)}>
                              {t('common.edit')}
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleDelete(o)}
                              title={t('common.delete')}
                            >
                              {t('common.delete')}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'planning' && !reportOnly && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <FilterChip
              active={planningOnlyAction}
              onClick={() => setPlanningOnlyAction(true)}
              label={tf('director.plan.filterAction', { count: needsPlanCount })}
              warn={needsPlanCount > 0}
            />
            <FilterChip
              active={!planningOnlyAction}
              onClick={() => setPlanningOnlyAction(false)}
              label={t('director.plan.filterAll')}
            />
          </div>
          <PlanningTab
            orders={planningOrders}
            emptyHint={
              planningOnlyAction && openForPlanning.length > 0
                ? t('director.plan.emptyAction')
                : undefined
            }
            metricsById={metricsById}
            forecastById={forecastById}
            highlightOrderId={highlightOrderId}
            today={today}
            sales={sales}
            warehouse={warehouse}
            finishedProducts={finishedProducts}
            onPlanSalesLine={onPlanSalesLine}
            onPlanAllSalesLines={onPlanAllSalesLines}
            onCreateLoadingShipmentsFromSalesOrder={onCreateLoadingShipmentsFromSalesOrder}
            onCreateCombinedLoadingFromSalesOrder={onCreateCombinedLoadingFromSalesOrder}
            loadingShipments={loadingShipments}
            onOpenWarehouseLoading={onOpenWarehouseLoading}
            onOpenPlanner={onOpenPlanner}
            onOpenProduction={onOpenProduction}
            onOpenOrder={(o) => setEditing(o)}
            onPrintShipmentReversal={(o) => {
              const cancelDoc = warehouse.documents.find(
                (d) =>
                  (d as { salesOrderId?: string }).salesOrderId === o.id &&
                  (String((d as { docRole?: string }).docRole ?? '') ===
                    'finished_goods_shipment_cancel' ||
                    Boolean(d.reversesDocumentId)),
              )
              if (cancelDoc) {
                setPrintModel(
                  warehouseDocToReversalPrintModel(
                    cancelDoc as unknown as Record<string, unknown>,
                    {
                      showPrices: commercialPrint,
                      directories: {
                        items: warehouse.items.map((i) => ({
                          id: i.id,
                          internalCode: i.internalCode,
                          sku: i.sku,
                          name: i.name,
                        })),
                      },
                      reason: cancelDoc.cancellationReason || 'shipment_cancel',
                    },
                  ),
                )
              }
            }}
            statusBadge={statusBadge}
            fulfillmentBadge={fulfillmentBadge}
          />
        </div>
      )}

      {editing && !reportOnly && (
        <SalesOrderModal
          order={editing}
          counterparties={counterparties}
          finishedProducts={finishedProducts}
          authoritativeMasterData={g5Flags.masterDataActive || g5Flags.salesPlanningActive}
          onUpsertCounterparty={
            g5Flags.masterDataActive || g5Flags.salesPlanningActive
              ? undefined
              : onUpsertCounterparty
          }
          onOpenCounterpartiesJournal={onOpenCounterpartiesJournal}
          showPrintChange={shouldPrintChange(editing as unknown as Record<string, unknown>)}
          showPrintReversal={
            isCancelledStatus(editing.commercialStatus ?? editing.status) ||
            warehouse.documents.some(
              (d) =>
                (d as { salesOrderId?: string }).salesOrderId === editing.id &&
                (String((d as { docRole?: string }).docRole ?? '') ===
                  'finished_goods_shipment_cancel' ||
                  Boolean(d.reversesDocumentId)),
            )
          }
          onPrint={(o) => {
            setPrintModel(
              salesOrderToPrintModel(o as unknown as Record<string, unknown>, {
                showPrices: commercialPrint,
                directories: {
                  customers: counterparties.map((c) => ({
                    id: c.id,
                    code: c.code,
                    name: c.name,
                  })),
                  products: finishedProducts.map((f) => ({
                    id: f.id,
                    code: f.code,
                    name: f.name,
                  })),
                },
                actorName: webUserName,
                at: new Date().toISOString(),
                title: t('g5.print.salesOrder.title'),
              }),
            )
          }}
          onPrintChange={(o) => {
            setPrintModel(
              reversalToPrintModel({
                kind: 'change',
                id: `${o.id}-change`,
                number: o.orderNumber,
                originalDocRef: o.orderNumber || o.id,
                revision: Number((o as { revision?: number }).revision) || 2,
                reason: 'commercial_change',
                order: o as unknown as Record<string, unknown>,
                directories: {
                  customers: counterparties.map((c) => ({
                    id: c.id,
                    code: c.code,
                    name: c.name,
                  })),
                  products: finishedProducts.map((f) => ({
                    id: f.id,
                    code: f.code,
                    name: f.name,
                  })),
                },
                actorName: webUserName,
                at: new Date().toISOString(),
                showPrices: commercialPrint,
                title: t('g5.print.reversal.title'),
              }),
            )
          }}
          onPrintReversal={(o) => {
            const cancelDoc = warehouse.documents.find(
              (d) =>
                (d as { salesOrderId?: string }).salesOrderId === o.id &&
                (String((d as { docRole?: string }).docRole ?? '') ===
                  'finished_goods_shipment_cancel' ||
                  Boolean(d.reversesDocumentId)),
            )
            if (cancelDoc) {
              setPrintModel(
                warehouseDocToReversalPrintModel(cancelDoc as unknown as Record<string, unknown>, {
                  showPrices: commercialPrint,
                  directories: {
                    items: warehouse.items.map((i) => ({
                      id: i.id,
                      internalCode: i.internalCode,
                      sku: i.sku,
                      name: i.name,
                    })),
                  },
                  reason: cancelDoc.cancellationReason || 'shipment_cancel',
                }),
              )
              return
            }
            setPrintModel(
              reversalToPrintModel({
                kind: 'storno',
                id: `${o.id}-storno`,
                number: o.orderNumber,
                originalDocRef: o.orderNumber || o.id,
                revision: Number((o as { revision?: number }).revision) || 1,
                reason: 'order_cancelled',
                order: o as unknown as Record<string, unknown>,
                directories: {
                  products: finishedProducts.map((f) => ({
                    id: f.id,
                    code: f.code,
                    name: f.name,
                  })),
                },
                actorName: webUserName,
                at: new Date().toISOString(),
                showPrices: commercialPrint,
                title: t('g5.print.reversal.title'),
              }),
            )
          }}
          onSave={async (o) => {
            await onUpsertSalesOrder(o)
            setEditing(null)
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {printModel ? (
        <G5DocumentPrintModal
          model={printModel}
          onClose={() => setPrintModel(null)}
          showCommercial={commercialPrint}
        />
      ) : null}
    </PageLayout>
  )
}

type PlanningTabProps = {
  orders: SalesOrder[]
  emptyHint?: string
  metricsById: Map<string, ReturnType<typeof salesOrderMetrics>>
  forecastById: Map<string, ReturnType<typeof computeDelayForecast>>
  highlightOrderId?: string | null
  today: string
  sales: SalesStore
  warehouse: WarehouseStore
  finishedProducts: FinishedProduct[]
  onPlanSalesLine: Props['onPlanSalesLine']
  onPlanAllSalesLines: Props['onPlanAllSalesLines']
  onCreateLoadingShipmentsFromSalesOrder: Props['onCreateLoadingShipmentsFromSalesOrder']
  onCreateCombinedLoadingFromSalesOrder: Props['onCreateCombinedLoadingFromSalesOrder']
  loadingShipments: LoadingShipment[]
  onOpenWarehouseLoading?: () => void
  onOpenPlanner?: (productionOrderId: string) => void
  onOpenProduction?: () => void
  onOpenOrder: (order: SalesOrder) => void
  onPrintShipmentReversal?: (order: SalesOrder) => void
  statusBadge: (status: SalesOrderStatus) => ReactNode
  fulfillmentBadge: (order: SalesOrder) => ReactNode
}

function OrderLoadingCalcBlock({
  order,
  shipments,
  onOpenWarehouse,
}: {
  order: SalesOrder
  shipments: LoadingShipment[]
  onOpenWarehouse?: () => void
}) {
  const { t, tf } = useI18n()
  const links = useMemo(
    () => collectOrderLoadingShipments(shipments, order.id),
    [shipments, order.id],
  )

  if (!links.all.length) return null

  return (
    <div className="mb-3 rounded-sm border border-stone-200 bg-stone-50/80 px-3 py-2">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase text-stone-500">
          {t('director.plan.calcTitle')}
        </span>
        {onOpenWarehouse && (
          <button
            type="button"
            className="text-xs font-semibold text-teal-800 underline"
            onClick={onOpenWarehouse}
          >
            {t('director.plan.openWarehouseCalc')}
          </button>
        )}
      </div>
      {links.combined && (
        <div className="mb-1 text-sm text-stone-800">
          <span className="text-stone-500">{t('director.plan.calcCombined')}: </span>
          <span className="font-mono font-bold">{links.combined.number}</span>
          <span className="ml-2 text-xs text-stone-500">
            {formatInt(links.combined.totalsRolls)} {t('director.plan.calcRolls')} ·{' '}
            {formatInt(links.combined.totalsPalletPlaces)} {t('director.plan.calcPlaces')}
          </span>
        </div>
      )}
      <ul className="space-y-0.5 text-xs text-stone-600">
        {order.lines.map((line) => {
          const sh = links.byLineId.get(line.id)
          if (!sh) return null
          return (
            <li key={line.id}>
              {line.productName} →{' '}
              <span className="font-mono font-semibold text-stone-800">{sh.number}</span>
            </li>
          )
        })}
      </ul>
      {!links.combined && links.byLineId.size === 0 && links.all.length > 0 && (
        <p className="text-xs text-stone-500">
          {tf('director.plan.calcCount', { count: links.all.length })}
        </p>
      )}
    </div>
  )
}

function formatInt(n: number): string {
  return Math.round(n).toLocaleString('ru-RU')
}

function DoneBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)))
  const bar =
    clamped >= 100 ? 'bg-teal-500' : clamped > 0 ? 'bg-amber-500' : 'bg-stone-300'
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-stone-200 sm:w-20">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${clamped}%` }} />
      </div>
      <span className="w-8 text-right tabular-nums text-xs text-stone-600">{clamped}%</span>
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  label,
  warn,
}: {
  active: boolean
  onClick: () => void
  label: string
  warn?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-sm border px-2.5 py-1 text-xs font-medium transition',
        active
          ? warn
            ? 'border-amber-400 bg-amber-100 text-amber-950'
            : 'border-teal-600 bg-teal-600 text-white'
          : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:bg-stone-50',
      ].join(' ')}
    >
      {label}
    </button>
  )
}

function PlanningTab({
  orders,
  emptyHint,
  metricsById,
  forecastById,
  highlightOrderId,
  today,
  sales,
  warehouse,
  finishedProducts,
  onPlanSalesLine,
  onPlanAllSalesLines,
  onCreateLoadingShipmentsFromSalesOrder,
  onCreateCombinedLoadingFromSalesOrder,
  loadingShipments,
  onOpenWarehouseLoading,
  onOpenPlanner,
  onOpenProduction,
  onOpenOrder,
  onPrintShipmentReversal,
  statusBadge,
  fulfillmentBadge,
}: PlanningTabProps) {
  const { t, tf } = useI18n()
  const [notice, setNotice] = useState<string | null>(null)

  if (orders.length === 0) {
    return (
      <Card title={t('director.tab.planning')}>
        <p className="py-8 text-center text-sm text-stone-500">
          {emptyHint ?? t('director.plan.empty')}
        </p>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {notice && (
        <p className="rounded-sm border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">
          {notice}
        </p>
      )}
      {orders.map((o) => {
        const m = metricsById.get(o.id)!
        const forecast = forecastById.get(o.id)!
        const unplannedLines = o.lines.filter(lineNeedsEnsure).length
        const loadingLinks = collectOrderLoadingShipments(loadingShipments, o.id)
        const hasCombined = !!loadingLinks.combined || !!o.combinedLoadingShipmentId
        const lineCalcsMissing = o.lines.some((l) => !loadingLinks.byLineId.has(l.id))
        const startDate = o.suggestedProductionStart ?? today
        const endDate = o.dueDate ?? addDaysIso(startDate, 30)
        const firstPo =
          o.lines.flatMap((l) => l.productionOrderIds).find(Boolean) ??
          [...m.lineMetrics.values()].flatMap((lm) => lm.linkedOrders.map((po) => po.id))[0]
        const highlighted = highlightOrderId === o.id
        const canPlan =
          (o.commercialStatus ?? (o.status === 'draft' ? 'draft' : 'confirmed')) === 'confirmed'

        return (
          <Card
            key={o.id}
            title={`${o.orderNumber || '—'} · ${o.customer}`}
            className={highlighted ? 'ring-2 ring-teal-500' : undefined}
          >
            <DirectorOrderQuickCard
              order={o}
              metrics={m}
              forecast={forecast}
              firstProductionOrderId={firstPo}
              onOpenOrder={() => onOpenOrder(o)}
              onOpenPlanner={onOpenPlanner}
              onOpenProduction={onOpenProduction}
              onOpenWarehouse={onOpenWarehouseLoading}
            />
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-stone-500">
              {statusBadge(o.status)}
              {fulfillmentBadge(o)}
              {o.dueDate && <span>{tf('director.plan.due', { date: o.dueDate })}</span>}
              {o.region && <span>{o.region}</span>}
              {o.logistics && <span>{o.logistics}</span>}
              <span>{tf('director.plan.coverage', { pct: m.coveragePct })}</span>
              {loadingLinks.all.length > 0 && (
                <span className="text-teal-700">
                  {tf('director.plan.loadingLinked', { count: loadingLinks.all.length })}
                </span>
              )}
            </div>
            <OrderLoadingCalcBlock
              order={o}
              shipments={loadingShipments}
              onOpenWarehouse={onOpenWarehouseLoading}
            />
            <div className="mb-3 flex flex-wrap gap-2">
              {unplannedLines > 0 && canPlan && (
                <Button
                  size="sm"
                  onClick={() => {
                    const res = onPlanAllSalesLines(o.id, { startDate, endDate })
                    setNotice(
                      tf('director.plan.allCreated', {
                        created: res.created.length,
                        skipped: res.skipped,
                      }),
                    )
                  }}
                >
                  {tf('director.plan.createAll', { count: unplannedLines })}
                </Button>
              )}
              {!canPlan && unplannedLines > 0 && (
                <span className="self-center text-xs text-amber-700">
                  {t('director.plan.needConfirm')}
                </span>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const res = onCreateLoadingShipmentsFromSalesOrder(o.id)
                  setNotice(
                    res.created.length
                      ? tf('director.plan.loadingCreated', { count: res.created.length })
                      : t('director.plan.loadingSkipped'),
                  )
                }}
              >
                {t('director.plan.createLoadingLines')}
              </Button>
              {!hasCombined && o.lines.length > 1 && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    const res = onCreateCombinedLoadingFromSalesOrder(o.id)
                    if (res.created) {
                      setNotice(
                        tf('director.plan.combinedCreated', { number: res.number ?? '—' }),
                      )
                    } else {
                      setNotice(t('director.plan.loadingSkipped'))
                    }
                  }}
                >
                  {t('director.plan.createCombinedLoading')}
                </Button>
              )}
              {lineCalcsMissing && hasCombined && (
                <span className="self-center text-xs text-stone-500">
                  {t('director.plan.calcCombinedOnly')}
                </span>
              )}
              {onPrintShipmentReversal &&
                warehouse.documents.some(
                  (d) =>
                    (d as { salesOrderId?: string }).salesOrderId === o.id &&
                    (String((d as { docRole?: string }).docRole ?? '') ===
                      'finished_goods_shipment_cancel' ||
                      Boolean(d.reversesDocumentId)),
                ) && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onPrintShipmentReversal(o)}
                  >
                    {t('g5.print.action.printShipmentReversal')}
                  </Button>
                )}
            </div>
            <div className="space-y-2">
              {o.lines.map((line) => {
                const lm = m.lineMetrics.get(line.id)!
                return (
                  <PlanningLineRow
                    key={line.id}
                    orderId={o.id}
                    order={o}
                    line={line}
                    loadingShipment={loadingLinks.byLineId.get(line.id)}
                    linkedProductionOrders={lm.linkedOrders}
                    coveragePct={lm.coveragePct}
                    plannedMp={lm.plannedMp}
                    dueDate={o.dueDate}
                    today={today}
                    sales={sales}
                    warehouse={warehouse}
                    finishedProducts={finishedProducts}
                    canPlan={canPlan}
                    onPlanSalesLine={onPlanSalesLine}
                    onOpenPlanner={onOpenPlanner}
                  />
                )
              })}
            </div>
          </Card>
        )
      })}
    </div>
  )
}

type PlanningLineRowProps = {
  orderId: string
  order: SalesOrder
  line: SalesOrder['lines'][number]
  loadingShipment?: LoadingShipment
  linkedProductionOrders: ProductionOrder[]
  coveragePct: number
  plannedMp: number
  dueDate?: string
  today: string
  sales: SalesStore
  warehouse: WarehouseStore
  finishedProducts: FinishedProduct[]
  canPlan: boolean
  onPlanSalesLine: Props['onPlanSalesLine']
  onOpenPlanner?: (productionOrderId: string) => void
}

function PlanningLineRow({
  orderId,
  order,
  line,
  loadingShipment,
  linkedProductionOrders,
  coveragePct,
  plannedMp,
  dueDate,
  today,
  sales,
  warehouse,
  finishedProducts,
  canPlan,
  onPlanSalesLine,
  onOpenPlanner,
}: PlanningLineRowProps) {
  const { t, tf } = useI18n()
  const [lineChoice, setLineChoice] = useState<string>(line.preferredLineId ?? 'master')
  const [startDate, setStartDate] = useState(order.suggestedProductionStart ?? today)
  const [endDate, setEndDate] = useState(dueDate ?? addDaysIso(startDate, 30))
  const covered = coveragePct >= 100
  const preview = buildPlanSalesLinePreview({
    order,
    line,
    warehouse,
    finishedProducts,
    reservations: sales.reservations ?? [],
    allocations: sales.allocations ?? [],
  })

  function handleCreate() {
    const productionLineId: ProductionLineId | undefined =
      lineChoice === 'master' ? undefined : (lineChoice as ProductionLineId)
    onPlanSalesLine(orderId, line.id, productionLineId, { startDate, endDate })
  }

  return (
    <div className="rounded-sm border border-stone-200 bg-stone-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-stone-800">{line.productName}</div>
          <div className="text-xs text-stone-500">
            {tf('director.plan.lineQty', { qty: line.qtyMp, planned: plannedMp })}
            {line.qtyAreaM2 ? ` · ${line.qtyAreaM2.toLocaleString('ru-RU')} м²` : ''}
            {line.targetGsm ? ` · ${line.targetGsm} г/м²` : ''}
            {' · '}
            <span className={covered ? 'text-teal-700' : 'text-amber-700'}>
              {tf('director.plan.coverage', { pct: coveragePct })}
            </span>
          </div>
          {!covered && preview.remainingToEnsureMp > 0 && (
            <div className="mt-0.5 text-xs text-stone-600">
              {preview.proposeReserveMp > 0 && (
                <span className="mr-2 text-teal-800">
                  {tf('director.plan.previewReserve', { qty: preview.proposeReserveMp })}
                </span>
              )}
              {preview.proposeProduceMp > 0 && (
                <span className="text-amber-800">
                  {tf('director.plan.previewProduce', { qty: preview.proposeProduceMp })}
                </span>
              )}
            </div>
          )}
          {line.labelNote && (
            <div className="mt-0.5 truncate text-xs text-stone-400">{line.labelNote}</div>
          )}
          {loadingShipment && (
            <div className="mt-0.5 text-xs font-medium text-teal-800">
              {t('director.plan.calcLine')}: {loadingShipment.number}
            </div>
          )}
          {linkedProductionOrders.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {linkedProductionOrders.map((po) => (
                <div key={po.id} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium text-sky-800">
                    {t('director.plan.productionOrder')}:{' '}
                    <span className="font-mono">{po.orderNumber || '—'}</span>
                    {po.lineAssignmentPending && (
                      <span className="ml-1 text-amber-700">({t('director.plan.lineMaster')})</span>
                    )}
                  </span>
                  {onOpenPlanner && (
                    <button
                      type="button"
                      className="font-semibold text-sky-800 underline"
                      onClick={() => onOpenPlanner(po.id)}
                    >
                      {t('director.plan.openInPlanner')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {!covered && canPlan && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-xs text-stone-500">
            {t('sales.col.preferLine')}
            <select
              className="fc-input mt-0.5 w-36"
              value={lineChoice}
              onChange={(e) => setLineChoice(e.target.value)}
            >
              <option value="master">{t('director.plan.lineMaster')}</option>
              <option value="1">1</option>
              <option value="2">2</option>
            </select>
          </label>
          <label className="text-xs text-stone-500">
            {t('director.plan.productionStart')}
            <Input
              type="date"
              className="mt-0.5 w-40"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </label>
          <label className="text-xs text-stone-500">
            {t('sales.field.dueDate')}
            <Input
              type="date"
              className="mt-0.5 w-40"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </label>
          <Button size="sm" onClick={handleCreate}>
            {t('director.plan.ensureLine')}
          </Button>
        </div>
      )}
      {!covered && !canPlan && (
        <p className="mt-2 text-xs text-amber-700">{t('director.plan.needConfirm')}</p>
      )}
    </div>
  )
}
