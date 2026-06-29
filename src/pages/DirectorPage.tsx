import { useMemo, useState, type ReactNode } from 'react'
import { SalesOrderModal } from '@/components/director/SalesOrderModal'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { KpiCard } from '@/components/ui/KpiCard'
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
import { emptySalesOrder } from '@/lib/sales/init'
import { buildA2LinePortugalSalesOrder } from '@/lib/sales/presets'
import { collectOrderLoadingShipments } from '@/lib/sales/loadingLink'
import type { LoadingShipment } from '@/lib/warehouse/types'
import {
  salesStatusLabel,
  SALES_ORDER_STATUSES,
  type SalesOrder,
  type SalesOrderStatus,
  type SalesStore,
} from '@/lib/sales/types'

type Tab = 'dashboard' | 'orders' | 'planning'

type Props = {
  sales: SalesStore
  plannerOrders: ProductionOrder[]
  requests: ProductionRequest[]
  counterparties: Counterparty[]
  finishedProducts: FinishedProduct[]
  webUserName?: string
  onUpsertSalesOrder: (order: SalesOrder) => SalesOrder
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
  ) => { created: string[]; skipped: number }
  onCreateLoadingShipmentsFromSalesOrder: (
    orderId: string,
  ) => { created: string[]; skipped: number }
  onCreateCombinedLoadingFromSalesOrder: (
    orderId: string,
  ) => { created: string | null; skipped: boolean; number?: string }
  loadingShipments: LoadingShipment[]
  onOpenWarehouseLoading?: () => void
  onOpenPlanner?: (productionOrderId: string) => void
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
  webUserName,
  onUpsertSalesOrder,
  onRemoveSalesOrder,
  onSetSalesOrderStatus,
  onPlanSalesLine,
  onPlanAllSalesLines,
  onCreateLoadingShipmentsFromSalesOrder,
  onCreateCombinedLoadingFromSalesOrder,
  loadingShipments,
  onOpenWarehouseLoading,
  onOpenPlanner,
}: Props) {
  const { t, tf, locale } = useI18n()
  const { confirm } = useConfirm()
  const [tab, setTab] = useState<Tab>('dashboard')
  const [editing, setEditing] = useState<SalesOrder | null>(null)

  const today = todayIso()

  const kpis = useMemo(
    () => salesDashboardKpis(sales.orders, plannerOrders, requests, today),
    [sales.orders, plannerOrders, requests, today],
  )

  const metricsById = useMemo(() => {
    const map = new Map<string, ReturnType<typeof salesOrderMetrics>>()
    for (const o of sales.orders) {
      map.set(o.id, salesOrderMetrics(o, plannerOrders, requests, today))
    }
    return map
  }, [sales.orders, plannerOrders, requests, today])

  const lineLoad = useMemo(
    () => buildLineLoad(plannerOrders, { fromDate: today, days: 14 }),
    [plannerOrders, today],
  )
  const maxLoad = Math.max(1, ...lineLoad.map((d) => d.total))

  const atRiskOrders = useMemo(
    () =>
      sales.orders
        .filter((o) => metricsById.get(o.id)?.atRisk)
        .sort(
          (a, b) =>
            (metricsById.get(a.id)?.daysToDue ?? 99) - (metricsById.get(b.id)?.daysToDue ?? 99),
        ),
    [sales.orders, metricsById],
  )

  const sortedOrders = useMemo(
    () =>
      [...sales.orders].sort(
        (a, b) => b.orderDate.localeCompare(a.orderDate) || b.createdAt.localeCompare(a.createdAt),
      ),
    [sales.orders],
  )

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

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'dashboard', label: t('director.tab.dashboard') },
    { id: 'orders', label: t('director.tab.orders'), count: sales.orders.length || undefined },
    { id: 'planning', label: t('director.tab.planning'), count: kpis.openOrders || undefined },
  ]

  return (
    <PageLayout>
      <PageHeader
        badge={t('director.badge')}
        title={webUserName ? tf('director.welcome', { name: webUserName }) : t('director.title')}
        subtitle={t('director.subtitle')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() =>
                setEditing(
                  buildA2LinePortugalSalesOrder({
                    orderDate: today,
                    counterparties,
                    finishedProducts,
                    suggestedProductionStart: today,
                  }),
                )
              }
            >
              {t('sales.preset.a2line')}
            </Button>
            <Button onClick={() => setEditing(emptySalesOrder(today))}>{t('sales.newOrder')}</Button>
          </div>
        }
      />

      <TabBar tabs={tabs} value={tab} onChange={setTab} className="mb-4" />

      {tab === 'dashboard' && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label={t('director.kpi.openOrders')} value={kpis.openOrders} />
            <KpiCard
              label={t('director.kpi.toProduce')}
              value={`${kpis.toProduceMp.toLocaleString('ru-RU')} м.п.`}
            />
            <KpiCard
              label={t('director.kpi.inProduction')}
              value={kpis.inProductionOrders}
              tone="ok"
            />
            <KpiCard
              label={t('director.kpi.atRisk')}
              value={kpis.atRiskOrders}
              tone={kpis.atRiskOrders > 0 ? 'warn' : 'default'}
            />
          </div>

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
                    </tr>
                  </thead>
                  <tbody>
                    {atRiskOrders.map((o) => {
                      const m = metricsById.get(o.id)!
                      return (
                        <tr key={o.id}>
                          <td className="font-mono text-xs">{o.orderNumber}</td>
                          <td>{o.customer}</td>
                          <td>{o.dueDate ?? '—'}</td>
                          <td className="text-right tabular-nums text-red-600">
                            {m.daysToDue ?? '—'}
                          </td>
                          <td className="text-right tabular-nums">{m.donePct}%</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title={t('director.load.title')} description={t('director.load.hint')}>
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
                  {lineLoad.map((d) => (
                    <tr key={d.date}>
                      <td>{d.date}</td>
                      <td className="text-right tabular-nums">{Math.round(d.byLine['1'])}</td>
                      <td className="text-right tabular-nums">{Math.round(d.byLine['2'])}</td>
                      <td className="text-right tabular-nums font-medium">{Math.round(d.total)}</td>
                      <td>
                        <div className="h-3 w-full rounded bg-stone-100">
                          <div
                            className="h-3 rounded bg-teal-500"
                            style={{ width: `${(d.total / maxLoad) * 100}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {tab === 'orders' && (
        <Card title={t('sales.listTitle')} description={t('sales.listHint')}>
          {sortedOrders.length === 0 ? (
            <p className="py-8 text-center text-sm text-stone-500">{t('sales.listEmpty')}</p>
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
                    <th>{t('sales.col.status')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sortedOrders.map((o) => {
                    const m = metricsById.get(o.id)!
                    return (
                      <tr key={o.id}>
                        <td className="font-mono text-xs">{o.orderNumber || '—'}</td>
                        <td>{o.customer}</td>
                        <td className="text-right tabular-nums">
                          {m.orderedMp.toLocaleString('ru-RU')}
                        </td>
                        <td className="text-right tabular-nums">{m.donePct}%</td>
                        <td className={o.dueDate && m.atRisk ? 'text-red-600' : ''}>
                          {o.dueDate ?? '—'}
                        </td>
                        <td>
                          <select
                            className="fc-input"
                            value={o.status}
                            onChange={(e) =>
                              onSetSalesOrderStatus(o.id, e.target.value as SalesOrderStatus)
                            }
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
                            <Button variant="secondary" size="sm" onClick={() => handleDelete(o)}>
                              ✕
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

      {tab === 'planning' && (
        <PlanningTab
          orders={sortedOrders.filter(
            (o) => o.status !== 'completed' && o.status !== 'cancelled',
          )}
          metricsById={metricsById}
          today={today}
          onPlanSalesLine={onPlanSalesLine}
          onPlanAllSalesLines={onPlanAllSalesLines}
          onCreateLoadingShipmentsFromSalesOrder={onCreateLoadingShipmentsFromSalesOrder}
          onCreateCombinedLoadingFromSalesOrder={onCreateCombinedLoadingFromSalesOrder}
          loadingShipments={loadingShipments}
          onOpenWarehouseLoading={onOpenWarehouseLoading}
          onOpenPlanner={onOpenPlanner}
          statusBadge={statusBadge}
        />
      )}

      {editing && (
        <SalesOrderModal
          order={editing}
          counterparties={counterparties}
          finishedProducts={finishedProducts}
          onSave={(o) => {
            onUpsertSalesOrder(o)
            setEditing(null)
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </PageLayout>
  )
}

type PlanningTabProps = {
  orders: SalesOrder[]
  metricsById: Map<string, ReturnType<typeof salesOrderMetrics>>
  today: string
  onPlanSalesLine: Props['onPlanSalesLine']
  onPlanAllSalesLines: Props['onPlanAllSalesLines']
  onCreateLoadingShipmentsFromSalesOrder: Props['onCreateLoadingShipmentsFromSalesOrder']
  onCreateCombinedLoadingFromSalesOrder: Props['onCreateCombinedLoadingFromSalesOrder']
  loadingShipments: LoadingShipment[]
  onOpenWarehouseLoading?: () => void
  onOpenPlanner?: (productionOrderId: string) => void
  statusBadge: (status: SalesOrderStatus) => ReactNode
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

function PlanningTab({
  orders,
  metricsById,
  today,
  onPlanSalesLine,
  onPlanAllSalesLines,
  onCreateLoadingShipmentsFromSalesOrder,
  onCreateCombinedLoadingFromSalesOrder,
  loadingShipments,
  onOpenWarehouseLoading,
  onOpenPlanner,
  statusBadge,
}: PlanningTabProps) {
  const { t, tf } = useI18n()
  const [notice, setNotice] = useState<string | null>(null)

  if (orders.length === 0) {
    return (
      <Card title={t('director.tab.planning')}>
        <p className="py-8 text-center text-sm text-stone-500">{t('director.plan.empty')}</p>
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
        const unplannedLines = o.lines.filter((l) => l.productionOrderIds.length === 0).length
        const loadingLinks = collectOrderLoadingShipments(loadingShipments, o.id)
        const hasCombined = !!loadingLinks.combined || !!o.combinedLoadingShipmentId
        const lineCalcsMissing = o.lines.some((l) => !loadingLinks.byLineId.has(l.id))
        const startDate = o.suggestedProductionStart ?? today
        const endDate = o.dueDate ?? addDaysIso(startDate, 30)

        return (
          <Card key={o.id} title={`${o.orderNumber || '—'} · ${o.customer}`}>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-stone-500">
              {statusBadge(o.status)}
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
              {unplannedLines > 0 && (
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
  onPlanSalesLine,
  onOpenPlanner,
}: PlanningLineRowProps) {
  const { t, tf } = useI18n()
  const [lineChoice, setLineChoice] = useState<string>(line.preferredLineId ?? 'master')
  const [startDate, setStartDate] = useState(order.suggestedProductionStart ?? today)
  const [endDate, setEndDate] = useState(dueDate ?? addDaysIso(startDate, 30))
  const covered = coveragePct >= 100

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
      {!covered && (
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
            {t('director.plan.createOrder')}
          </Button>
        </div>
      )}
    </div>
  )
}
