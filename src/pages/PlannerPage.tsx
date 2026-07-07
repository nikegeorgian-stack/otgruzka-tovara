import { useEffect, useMemo, useState } from 'react'
import { useWorkspaceDraftRestore } from '@/hooks/useWorkspaceDraftRestore'
import { PlannerMaterialsPanel } from '@/components/planner/PlannerMaterialsPanel'
import { MaterialStockHint } from '@/components/planner/MaterialStockHint'
import { RawMaterialPlanField } from '@/components/planner/RawMaterialPlanField'
import { Button } from '@/components/ui/Button'
import { MonthNavigator } from '@/components/ui/MonthNavigator'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageLayout } from '@/components/ui/PageLayout'
import { TabBar } from '@/components/ui/TabBar'
import { DirectoryFieldPicker } from '@/components/ui/DirectoryFieldPicker'
import { FormNotice } from '@/components/ui/FormNotice'
import { ProductColorBadge } from '@/components/ui/ProductColorBadge'
import { ProductColorPicker } from '@/components/ui/ProductColorPicker'
import { useI18n } from '@/context/I18nContext'
import { useConfirm } from '@/context/ConfirmContext'
import { AsOfSnapshotBar } from '@/components/asOf/AsOfSnapshotBar'
import { ProductionDaySnapshot } from '@/components/production/ProductionDaySnapshot'
import { useAsOfSnapshot } from '@/hooks/useAsOfSnapshot'
import { canActivateProductionOrder } from '@/lib/planner/activateGate'
import { emptyProductionOrder } from '@/lib/planner/init'
import { formatStackDescription } from '@/lib/packaging/calc'
import {
  extractSolidsPct,
  recipeDryBatchKg,
  recipeTotalCost,
  suggestFormulationForProduct,
} from '@/lib/formulations/calc'
import type { FormulationRecipe } from '@/lib/formulations/types'
import { formulationCategoryLabel } from '@/lib/formulations/types'
import type { PackagingRecipe } from '@/lib/packaging/types'
import {
  lineAllocationForDate,
  type GeneratePlannerRequestsResult,
} from '@/lib/planner/generateRequests'
import {
  orderHasMaterialShortage,
} from '@/lib/planner/materialStock'
import { PLANNER_MATERIAL_STATUSES, orderNeedsMaterialPlanning } from '@/lib/planner/materialNeeds'
import type { MaterialReserveResult } from '@/lib/planner/materialReserve'
import { attachPackagingPlanToOrder } from '@/lib/planner/packagingOrder'
import {
  buildDayPlanRows,
  generateEvenDayPlans,
  totalFactMpForOrder,
} from '@/lib/planner/plan'
import { requestShiftKey } from '@/lib/production/brigades'
import {
  buildCalendarMonth,
  buildMonthReport,
  summarizeOrder,
} from '@/lib/planner/stats'
import type {
  PlannerOrderCategory,
  PlannerPlanMode,
  PlannerRecalcMode,
  ProductionOrder,
} from '@/lib/planner/types'
import { plannerCategoryLabel, PLANNER_ORDER_CATEGORIES } from '@/lib/planner/types'
import { formatNum, weekdayLabel } from '@/lib/production/stats'
import { PRODUCTION_LINES } from '@/lib/production/types'
import type { ProductionRequest } from '@/lib/production/types'
import type { Counterparty } from '@/lib/counterparties/types'
import type { DirectorySection } from '@/lib/directories/types'
import { useDirectoryBranch } from '@/hooks/useDirectoryBranch'
import type { WorkspaceBranchFrom, WorkspaceBranchTarget } from '@/lib/workspace/types'
import { resolveOrderProductColor } from '@/lib/finishedProducts/colors'
import type { FinishedProduct } from '@/lib/finishedProducts/types'
import type { WarehouseCategory, WarehouseItem, StockMovement } from '@/lib/warehouse/types'
import type { SalesOrder } from '@/lib/sales/types'
import {
  formatSalesOrderLinkLabel,
  resolveProductionOrderSalesLink,
  type ProductionSalesLink,
} from '@/lib/sales/plannerLink'

type Tab = 'orders' | 'calendar' | 'reports' | 'materials'

type Props = {
  orders: ProductionOrder[]
  requests: ProductionRequest[]
  counterparties: Counterparty[]
  finishedProducts: FinishedProduct[]
  packagingRecipes: PackagingRecipe[]
  formulationRecipes: FormulationRecipe[]
  warehouseItems: WarehouseItem[]
  warehouseCategories: WarehouseCategory[]
  warehouseMovements: StockMovement[]
  activeMonth: string
  onMonthChange: (m: string) => void
  onSaveOrder: (o: ProductionOrder) => void
  onRemoveOrder: (id: string) => void
  onActivateOrder: (id: string) => { ok: boolean; messageKey?: string }
  onRecalculateOrder: (id: string) => void
  onNavigateToDirectory: (section: DirectorySection) => void
  branchWorkspace: (target: WorkspaceBranchTarget, from?: WorkspaceBranchFrom) => void
  clearWorkspaceDraft: (draftKey: string) => void
  workspaceRestoreSeq: number
  workspaceDrafts: Record<string, unknown>
  onGenerateRequest: (
    opts: { date: string; orderIds?: string[] },
  ) => GeneratePlannerRequestsResult
  onReserveMaterials: (orderId: string) => MaterialReserveResult
  onUnreserveMaterials: (orderId: string) => boolean
  salesOrders: SalesOrder[]
  onOpenSalesOrder?: () => void
  focusOrderId?: string | null
  onFocusOrderConsumed?: () => void
}

type PlannerWorkspaceDraft = {
  form: ProductionOrder
  editing: boolean
  selectedId: string | null
}

const STATUS_COLORS: Record<ProductionOrder['status'], string> = {
  draft: 'bg-stone-100 text-stone-700',
  active: 'bg-emerald-100 text-emerald-800',
  paused: 'bg-amber-100 text-amber-800',
  completed: 'bg-blue-100 text-blue-800',
  cancelled: 'bg-red-100 text-red-700',
}

export function PlannerPage({
  orders,
  requests,
  counterparties,
  finishedProducts,
  packagingRecipes,
  formulationRecipes,
  warehouseItems,
  warehouseCategories,
  warehouseMovements,
  activeMonth,
  onMonthChange,
  onSaveOrder,
  onRemoveOrder,
  onActivateOrder,
  onRecalculateOrder,
  onNavigateToDirectory,
  branchWorkspace,
  clearWorkspaceDraft,
  workspaceRestoreSeq,
  workspaceDrafts,
  onGenerateRequest,
  onReserveMaterials,
  onUnreserveMaterials,
  salesOrders,
  onOpenSalesOrder,
  focusOrderId,
  onFocusOrderConsumed,
}: Props) {
  const { t, tf, locale } = useI18n()
  const { confirm } = useConfirm()
  const asOf = useAsOfSnapshot({ initialDate: activeMonth + '-01' })
  const {
    enabled: asOfEnabled,
    setEnabled: setAsOfEnabled,
    date: asOfDate,
    setDate: setAsOfDate,
    time: asOfTime,
    setTime: setAsOfTime,
    asOfIso,
  } = asOf
  const PLANNER_DRAFT_KEY = 'planner-order'
  const [tab, setTab] = useState<Tab>('orders')
  const [notice, setNotice] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  const today = new Date().toISOString().slice(0, 10)
  const monthEnd = activeMonth + '-31'

  const [form, setForm] = useState<ProductionOrder>(() =>
    emptyProductionOrder(activeMonth + '-01', monthEnd),
  )

  useWorkspaceDraftRestore<PlannerWorkspaceDraft>(
    PLANNER_DRAFT_KEY,
    (draft) => {
      setForm(draft.form)
      setEditing(draft.editing)
      setSelectedId(draft.selectedId)
    },
    workspaceRestoreSeq,
    workspaceDrafts,
  )

  useEffect(() => {
    if (!focusOrderId) return
    const o = orders.find((x) => x.id === focusOrderId)
    if (o) {
      setSelectedId(o.id)
      setForm(o)
      setEditing(false)
      setTab('orders')
    }
    onFocusOrderConsumed?.()
  }, [focusOrderId, orders, onFocusOrderConsumed])

  const branchDirectory = useDirectoryBranch({
    t,
    branchWorkspace,
    onNavigateToDirectory,
    stackDraft: editing,
    returnTitle: form.productName || form.orderNumber || t('planner.newOrder'),
    returnView: 'planner',
    draftKey: PLANNER_DRAFT_KEY,
    draft: { form, editing, selectedId } satisfies PlannerWorkspaceDraft,
  })

  const selected = useMemo(
    () => orders.find((o) => o.id === selectedId) ?? null,
    [orders, selectedId],
  )

  const selectedSummary = useMemo(
    () => (selected ? summarizeOrder(selected, requests) : null),
    [selected, requests],
  )

  const selectedRows = useMemo(
    () => (selected ? buildDayPlanRows(selected, requests) : []),
    [selected, requests],
  )

  const calendar = useMemo(
    () =>
      buildCalendarMonth(
        { orders, nextOrderSeq: 0 },
        requests,
        activeMonth,
        asOfEnabled ? (asOfIso ?? undefined) : undefined,
      ),
    [orders, requests, activeMonth, asOfEnabled, asOfIso],
  )

  const report = useMemo(
    () => buildMonthReport({ orders, nextOrderSeq: 0 }, requests, activeMonth),
    [orders, requests, activeMonth],
  )

  const todayAllocation = useMemo(
    () => lineAllocationForDate(orders, today),
    [orders, today],
  )

  const categoryNames = useMemo(
    () => new Map(warehouseCategories.map((c) => [c.id, c.name])),
    [warehouseCategories],
  )

  const formPackagingPreview = useMemo(() => {
    const recipe = packagingRecipes.find((r) => r.id === form.packagingRecipeId)
    if (!recipe || !form.metersPerRoll || form.totalQtyMp <= 0) return null
    return attachPackagingPlanToOrder(form, recipe, locale).packagingPlan
  }, [form, packagingRecipes, locale])

  const formForStock = useMemo(() => {
    const recipe = packagingRecipes.find((r) => r.id === form.packagingRecipeId)
    return attachPackagingPlanToOrder(form, recipe, locale)
  }, [form, packagingRecipes, locale])

  const warehouseCtx = useMemo(
    () => ({ items: warehouseItems, movements: warehouseMovements }),
    [warehouseItems, warehouseMovements],
  )

  const materialShortageCount = useMemo(
    () =>
      orders.filter(
        (o) =>
          PLANNER_MATERIAL_STATUSES.includes(o.status) &&
          orderHasMaterialShortage(o, warehouseCtx, warehouseItems),
      ).length,
    [orders, warehouseCtx, warehouseItems],
  )

  const selectedTodayPlan = useMemo(() => {
    if (!selected) return null
    const dp = selected.dayPlans.find((p) => p.date === today)
    if (!dp || !dp.isWorkingDay) return null
    const mp = dp.manualPlanMp ?? dp.operationalPlanMp
    if (mp <= 0) return null
    return { dayPlan: dp, planMp: mp }
  }, [selected, today])

  function issueRequestForOrder(date: string, orderId: string) {
    const result = onGenerateRequest({ date, orderIds: [orderId] })
    if (result.messages.includes('no_tasks')) {
      setNotice(t('planner.issueNoPlan'))
      return
    }
    if (result.created + result.updated > 0) {
      setNotice(tf('planner.issueDone', { count: result.created + result.updated }))
      return
    }
    if (result.skipped > 0) {
      setNotice(t('planner.issueSkipped'))
      return
    }
    setNotice(t('planner.issueNoPlan'))
  }

  function issueRequestsForDate(date: string) {
    const result = onGenerateRequest({ date })
    if (result.messages.includes('no_tasks')) {
      setNotice(t('planner.issueNoPlan'))
      return
    }
    if (result.created + result.updated > 0) {
      setNotice(tf('planner.issueDone', { count: result.created + result.updated }))
      return
    }
    if (result.skipped > 0) {
      setNotice(t('planner.issueSkipped'))
    }
  }

  function startNew() {
    setSelectedId(null)
    setEditing(true)
    setForm(emptyProductionOrder(activeMonth + '-01', monthEnd))
  }

  function openOrder(o: ProductionOrder) {
    setSelectedId(o.id)
    setEditing(false)
    setForm(o)
  }

  function startEdit() {
    if (!selected) return
    setForm(selected)
    setEditing(true)
  }

  function selectCounterparty(id: string) {
    const cp = counterparties.find((c) => c.id === id)
    setForm((f) => ({
      ...f,
      counterpartyId: id || undefined,
      customer: cp?.name ?? '',
    }))
  }

  function selectFinishedProduct(id: string) {
    const fp = finishedProducts.find((p) => p.id === id)
    const suggested = fp
      ? suggestFormulationForProduct(
          fp.grammageGsm,
          fp.productType,
          undefined,
          formulationRecipes,
        )
      : undefined
    setForm((f) => ({
      ...f,
      finishedProductId: id || undefined,
      productName: fp?.name ?? '',
      category: fp?.category ?? f.category,
      colorLogo: fp?.colorLogo ?? f.colorLogo,
      productColor: fp?.productColor ?? f.productColor,
      formulationRecipeId:
        fp?.defaultFormulationRecipeId ?? suggested?.id ?? f.formulationRecipeId,
      rawMaterialKind:
        fp?.productType ?? fp?.rawMaterialKind ?? f.rawMaterialKind,
      counterpartyId: f.counterpartyId || fp?.defaultCounterpartyId,
      customer:
        f.customer ||
        counterparties.find((c) => c.id === fp?.defaultCounterpartyId)?.name ||
        '',
      rawMaterialItemId: fp?.defaultRawMaterialItemId ?? f.rawMaterialItemId,
      packagingRecipeId: fp?.defaultPackagingRecipeId ?? f.packagingRecipeId,
      metersPerRoll: fp?.metersPerRoll ?? f.metersPerRoll,
    }))
  }

  function saveOrder() {
    if ((!form.counterpartyId && !form.customer.trim()) || (!form.finishedProductId && !form.productName.trim())) {
      setNotice(t('planner.errRequired'))
      return
    }
    if (form.totalQtyMp <= 0) {
      setNotice(t('planner.errQty'))
      return
    }
    if (form.startDate > form.endDate) {
      setNotice(t('planner.errDates'))
      return
    }
    let toSave = { ...form }
    if (toSave.planMode === 'even' && toSave.status !== 'completed') {
      toSave = { ...toSave, dayPlans: generateEvenDayPlans(toSave) }
    }
    const recipe = packagingRecipes.find((r) => r.id === toSave.packagingRecipeId)
    toSave = attachPackagingPlanToOrder(toSave, recipe, locale)
    onSaveOrder(toSave)
    setSelectedId(toSave.id)
    setEditing(false)
    clearWorkspaceDraft(PLANNER_DRAFT_KEY)
    setNotice(t('planner.saved'))
  }

  async function activateOrder(id: string) {
    const order = orders.find((o) => o.id === id)
    if (!order) return

    const gate = canActivateProductionOrder(order)
    if (!gate.ok) {
      setNotice(t(gate.messageKey ?? 'planner.activate.recipePending'))
      return
    }

    if (
      orderHasMaterialShortage(order, warehouseCtx, warehouseItems) &&
      !(await confirm({ message: t('planner.material.activateWarn') }))
    ) {
      return
    }
    const res = onActivateOrder(id)
    if (!res.ok) {
      setNotice(t(res.messageKey ?? 'planner.activate.recipePending'))
      return
    }
    setNotice(t('planner.activated'))
  }

  function exportReportCsv() {
    const lines = [
      [
        t('planner.col.order'),
        t('planner.col.product'),
        t('planner.col.plan'),
        t('planner.col.fact'),
        t('planner.col.completion'),
        t('planner.col.status'),
      ].join(';'),
    ]
    for (const row of report.orders) {
      lines.push(
        [
          row.order.orderNumber,
          row.order.productName,
          row.planMp,
          row.factMp,
          row.completionPct + '%',
          t(`planner.status.${row.order.status}`),
        ].join(';'),
      )
    }
    const blob = new Blob(['\uFEFF' + lines.join('\n')], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `planner-${activeMonth}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <PageLayout>
      <PageHeader
        badge={t('planner.badge')}
        title={t('planner.title')}
        subtitle={t('planner.subtitle')}
        actions={
          <Button variant="success" onClick={startNew}>
            {t('planner.newOrder')}
          </Button>
        }
      />

      {notice && <FormNotice type="info" message={notice} onDismiss={() => setNotice(null)} />}

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-stone-500">{t('planner.month')}</span>
          <MonthNavigator month={activeMonth} onChange={onMonthChange} variant="input" />
        </label>
        <TabBar
          tabs={(
            [
              ['orders', 'planner.tab.orders'],
              ['calendar', 'planner.tab.calendar'],
              ['reports', 'planner.tab.reports'],
              [
                'materials',
                materialShortageCount > 0
                  ? `${t('planner.tab.materials')} (${materialShortageCount})`
                  : 'planner.tab.materials',
              ],
            ] as const
          ).map(([id, key]) => ({
            id,
            label: key.startsWith('planner.') ? t(key) : key,
          }))}
          value={tab}
          onChange={setTab}
        />
      </div>

      {tab === 'orders' && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div className="space-y-2">
            <h3 className="text-sm font-bold text-ink">{t('planner.orderList')}</h3>
            {orders.length === 0 && (
              <p className="rounded-sm border border-dashed border-grid bg-white p-6 text-center text-sm text-stone-500">
                {t('planner.empty')}
              </p>
            )}
            {orders.map((o) => {
              const sum = summarizeOrder(o, requests)
              const orderColor = resolveOrderProductColor(o, finishedProducts)
              const salesLink = resolveProductionOrderSalesLink(o, salesOrders)
              const hasMaterialShort =
                PLANNER_MATERIAL_STATUSES.includes(o.status) &&
                orderHasMaterialShortage(o, warehouseCtx, warehouseItems)
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => openOrder(o)}
                  className={`relative w-full overflow-hidden rounded-sm border p-3 text-left transition-colors ${
                    selectedId === o.id
                      ? 'border-accent bg-orange-50/60'
                      : 'border-grid bg-white hover:border-accent/40'
                  }`}
                >
                  {orderColor && (
                    <span
                      className="absolute inset-y-0 left-0 w-1"
                      style={{ backgroundColor: orderColor }}
                      aria-hidden
                    />
                  )}
                  <div className="flex items-start justify-between gap-2 pl-1">
                    <div>
                      <p className="font-semibold text-ink">{o.orderNumber || t('planner.draft')}</p>
                      <p className="flex items-center gap-1.5 text-sm text-stone-600">
                        {orderColor && (
                          <ProductColorBadge productColor={orderColor} showLabel={false} />
                        )}
                        {o.productName}
                      </p>
                      <p className="text-xs text-stone-400">{o.customer}</p>
                      {salesLink && (
                        <p className="mt-0.5 text-xs font-medium text-sky-800">
                          {t('planner.fromSalesOrder')}:{' '}
                          {formatSalesOrderLinkLabel(salesLink, { includeLine: true })}
                        </p>
                      )}
                      {o.lineAssignmentPending && (
                        <p className="text-xs text-amber-700">{t('planner.lineMasterPending')}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span
                        className={`rounded-sm px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[o.status]}`}
                      >
                        {t(`planner.status.${o.status}`)}
                      </span>
                      {hasMaterialShort && (
                        <span className="rounded-sm bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-800">
                          {t('planner.material.short')}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 flex gap-3 text-xs text-stone-500">
                    <span>{sum.completionPct}%</span>
                    <span>
                      {formatNum(sum.factMp)} / {formatNum(o.totalQtyMp)} {t('planner.unitMp')}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-sm bg-stone-100">
                    <div
                      className="h-full rounded-sm bg-accent transition-all"
                      style={{ width: `${Math.min(100, sum.completionPct)}%` }}
                    />
                  </div>
                </button>
              )
            })}
          </div>

          <div className="rounded-sm border border-grid bg-white p-4 shadow-sm">
            {editing ? (
              <div className="space-y-4">
                <h3 className="text-sm font-bold uppercase tracking-wide text-ink">
                  {selectedId ? t('planner.editOrder') : t('planner.newOrder')}
                </h3>
                {form.salesOrderId && (() => {
                  const salesLink = resolveProductionOrderSalesLink(form, salesOrders)
                  if (!salesLink) return null
                  return (
                    <SalesOrderLinkBanner
                      link={salesLink}
                      onOpen={onOpenSalesOrder}
                    />
                  )
                })()}
                <div className="grid gap-3 sm:grid-cols-2">
                  <DirectoryFieldPicker
                    label={t('planner.customer')}
                    hint={t('planner.customerHint')}
                    value={form.counterpartyId ?? ''}
                    placeholder={t('planner.pickCounterparty')}
                    options={counterparties
                      .filter((c) => c.active)
                      .map((c) => ({
                        value: c.id,
                        label: `${c.code} · ${c.name}`,
                      }))}
                    onChange={selectCounterparty}
                    onAdd={() => branchDirectory('counterparties')}
                  />
                  <DirectoryFieldPicker
                    label={t('planner.product')}
                    hint={t('planner.productHint')}
                    value={form.finishedProductId ?? ''}
                    placeholder={t('planner.pickProduct')}
                    options={finishedProducts
                      .filter((p) => p.active)
                      .map((p) => ({
                        value: p.id,
                        label: `${p.code} · ${p.name}`,
                      }))}
                    onChange={selectFinishedProduct}
                    onAdd={() => branchDirectory('finishedProducts')}
                  />
                  <div className="sm:col-span-2">
                    <ProductColorPicker
                      productColor={form.productColor}
                      colorLogo={form.colorLogo}
                      onColorChange={(productColor) =>
                        setForm((f) => ({ ...f, productColor }))
                      }
                      onLogoChange={(colorLogo) => setForm((f) => ({ ...f, colorLogo }))}
                    />
                  </div>
                  <label className="text-xs font-medium text-stone-500">
                    {t('planner.category')}
                    <select
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      value={form.category}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          category: e.target.value as PlannerOrderCategory,
                        }))
                      }
                    >
                      {PLANNER_ORDER_CATEGORIES.map((c) => (
                        <option key={c.key} value={c.key}>
                          {plannerCategoryLabel(c.key, locale)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs font-medium text-stone-500">
                    {t('planner.totalQty')}
                    <input
                      type="number"
                      min={0}
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      value={form.totalQtyMp || ''}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          totalQtyMp: Number(e.target.value) || 0,
                        }))
                      }
                    />
                  </label>
                  <label className="text-xs font-medium text-stone-500">
                    {t('planner.startDate')}
                    <input
                      type="date"
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      value={form.startDate}
                      onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                    />
                  </label>
                  <label className="text-xs font-medium text-stone-500">
                    {t('planner.endDate')}
                    <input
                      type="date"
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      value={form.endDate}
                      onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                    />
                  </label>
                  <label className="text-xs font-medium text-stone-500">
                    {t('planner.line')}
                    <select
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      value={form.lineId}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          lineId: e.target.value as ProductionOrder['lineId'],
                        }))
                      }
                    >
                      {PRODUCTION_LINES.filter((l) => l.id !== 'pack').map((l) => (
                        <option key={l.id} value={l.id}>
                          {locale === 'ka' ? l.labelKa : l.labelRu}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs font-medium text-stone-500">
                    {t('planner.priority')}
                    <select
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      value={form.priority}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          priority: e.target.value as ProductionOrder['priority'],
                        }))
                      }
                    >
                      <option value="normal">{t('planner.priorityNormal')}</option>
                      <option value="urgent">{t('planner.priorityUrgent')}</option>
                    </select>
                  </label>
                  <label className="text-xs font-medium text-stone-500">
                    {t('planner.planMode')}
                    <select
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      value={form.planMode}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          planMode: e.target.value as PlannerPlanMode,
                        }))
                      }
                    >
                      <option value="even">{t('planner.planModeEven')}</option>
                      <option value="manual">{t('planner.planModeManual')}</option>
                    </select>
                  </label>
                  <label className="text-xs font-medium text-stone-500">
                    {t('planner.recalcMode')}
                    <select
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      value={form.recalcMode}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          recalcMode: e.target.value as PlannerRecalcMode,
                        }))
                      }
                    >
                      <option value="auto">{t('planner.recalcAuto')}</option>
                      <option value="manual">{t('planner.recalcManual')}</option>
                    </select>
                  </label>
                  <RawMaterialPlanField
                    kind={form.rawMaterialKind}
                    itemId={form.rawMaterialItemId}
                    metersPerRoll={form.metersPerRoll}
                    warehouseItems={warehouseItems}
                    categoryNames={categoryNames}
                    onKindChange={(rawMaterialKind) =>
                      setForm((f) => ({ ...f, rawMaterialKind }))
                    }
                    onItemChange={(rawMaterialItemId) =>
                      setForm((f) => ({ ...f, rawMaterialItemId }))
                    }
                    onMetersPerRollChange={(metersPerRoll) =>
                      setForm((f) => ({ ...f, metersPerRoll }))
                    }
                    onOpenNomenclature={() => branchDirectory('nomenclature')}
                  />

                  <div className="sm:col-span-2 rounded-sm border border-violet-200/80 bg-violet-50/30 p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-violet-900">
                      {t('planner.formulationBlock')}
                    </p>
                    <DirectoryFieldPicker
                      label={t('planner.formulationRecipe')}
                      value={form.formulationRecipeId ?? ''}
                      placeholder={t('planner.formulationRecipePick')}
                      options={formulationRecipes
                        .filter((r) => r.active)
                        .map((r) => ({
                          value: r.id,
                          label: `${r.code} · ${r.variantCode ?? r.name.slice(0, 40)}`,
                        }))}
                      onChange={(id) =>
                        setForm((f) => ({
                          ...f,
                          formulationRecipeId: id || undefined,
                        }))
                      }
                      onAdd={() => branchDirectory('formulations')}
                    />
                    {form.formulationRecipeId && (() => {
                      const fr = formulationRecipes.find(
                        (r) => r.id === form.formulationRecipeId,
                      )
                      if (!fr) return null
                      return (
                        <p className="mt-2 text-xs text-stone-600">
                          {formulationCategoryLabel(fr.category, locale)} ·{' '}
                          {recipeDryBatchKg(fr)} {t('formulation.kgDry')} ·{' '}
                          {recipeTotalCost(fr).toFixed(2)} {fr.currency}
                          {extractSolidsPct(fr.note)
                            ? ` · ${t('formulation.col.solids')} ${extractSolidsPct(fr.note)}`
                            : ''}
                        </p>
                      )
                    })()}
                  </div>

                  <div className="sm:col-span-2 rounded-sm border border-amber-200/80 bg-amber-50/30 p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-amber-900">
                      {t('planner.packBlock')}
                    </p>
                    <DirectoryFieldPicker
                      label={t('planner.packRecipe')}
                      value={form.packagingRecipeId ?? ''}
                      placeholder={t('planner.packRecipePick')}
                      options={packagingRecipes
                        .filter((r) => r.active)
                        .map((r) => ({
                          value: r.id,
                          label: `${r.code} · ${r.name}`,
                        }))}
                      onChange={(id) =>
                        setForm((f) => ({
                          ...f,
                          packagingRecipeId: id || undefined,
                        }))
                      }
                      onAdd={() => branchDirectory('packagingRecipes')}
                    />
                    {form.packagingRecipeId && (() => {
                      const recipe = packagingRecipes.find(
                        (r) => r.id === form.packagingRecipeId,
                      )
                      return recipe ? (
                        <p className="mt-2 text-xs text-stone-600">
                          {formatStackDescription(recipe, locale)}
                        </p>
                      ) : null
                    })()}
                    {formPackagingPreview && (
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                        <div className="rounded-sm border border-grid bg-white px-2 py-1.5">
                          <span className="text-stone-500">{t('planner.packRolls')}</span>
                          <p className="font-semibold">{formPackagingPreview.rawRollsEstimated}</p>
                        </div>
                        <div className="rounded-sm border border-grid bg-white px-2 py-1.5">
                          <span className="text-stone-500">{t('planner.packPallets')}</span>
                          <p className="font-semibold">{formPackagingPreview.palletsNeeded}</p>
                        </div>
                        <div className="rounded-sm border border-grid bg-white px-2 py-1.5">
                          <span className="text-stone-500">{t('planner.packBoxes')}</span>
                          <p className="font-semibold">{formPackagingPreview.boxesNeeded}</p>
                        </div>
                        <div className="rounded-sm border border-grid bg-white px-2 py-1.5">
                          <span className="text-stone-500">{t('planner.packPerPallet')}</span>
                          <p className="font-semibold">{formPackagingPreview.rollsPerPallet}</p>
                        </div>
                      </div>
                    )}
                    <div className="mt-4 border-t border-amber-200/60 pt-3">
                      <p className="text-xs font-bold uppercase tracking-wide text-amber-900">
                        {t('planner.material.blockTitle')}
                      </p>
                      <div className="mt-2">
                        <MaterialStockHint
                          order={formForStock}
                          warehouseItems={warehouseItems}
                          warehouseMovements={warehouseMovements}
                        />
                      </div>
                    </div>
                  </div>

                  <label className="text-xs font-medium text-stone-500 sm:col-span-2">
                    {t('planner.note')}
                    <textarea
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      rows={2}
                      value={form.note ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                    />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-sm bg-accent px-4 py-2 text-sm font-semibold text-white"
                    onClick={saveOrder}
                  >
                    {t('planner.save')}
                  </button>
                  <button
                    type="button"
                    className="rounded-sm border border-grid px-4 py-2 text-sm"
                    onClick={() => {
                      setEditing(false)
                      clearWorkspaceDraft(PLANNER_DRAFT_KEY)
                      if (selected) setForm(selected)
                    }}
                  >
                    {t('planner.cancel')}
                  </button>
                </div>
              </div>
            ) : selected && selectedSummary ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-lg font-bold text-ink">{selected.orderNumber}</h3>
                    <p className="flex items-center gap-2 text-sm text-stone-600">
                      <ProductColorBadge
                        productColor={resolveOrderProductColor(selected, finishedProducts)}
                        colorLogo={selected.colorLogo}
                        size="md"
                      />
                      {selected.productName}
                    </p>
                    <p className="text-xs text-stone-400">
                      {selected.customer} · {plannerCategoryLabel(selected.category, locale)}
                    </p>
                  </div>
                  <span
                    className={`rounded-sm px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[selected.status]}`}
                  >
                    {t(`planner.status.${selected.status}`)}
                  </span>
                </div>

                {(() => {
                  const salesLink = resolveProductionOrderSalesLink(selected, salesOrders)
                  if (!salesLink) return null
                  return (
                    <SalesOrderLinkBanner
                      link={salesLink}
                      onOpen={onOpenSalesOrder}
                    />
                  )
                })()}

                {(selected.rawMaterialItemId ||
                  selected.formulationRecipeId ||
                  selected.packagingRecipeId) && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {selected.formulationRecipeId && (() => {
                      const fr = formulationRecipes.find(
                        (r) => r.id === selected.formulationRecipeId,
                      )
                      if (!fr) return null
                      return (
                        <div className="rounded-sm border border-violet-200 bg-violet-50/50 px-3 py-2 text-sm sm:col-span-2">
                          <p className="text-xs font-bold uppercase text-violet-900">
                            {t('planner.formulationBlock')}
                          </p>
                          <p className="mt-1 font-medium">{fr.name}</p>
                          <p className="text-xs text-stone-500">
                            {fr.code} · {formulationCategoryLabel(fr.category, locale)} ·{' '}
                            {recipeDryBatchKg(fr)} {t('formulation.kgDry')} ·{' '}
                            {recipeTotalCost(fr).toFixed(2)} {fr.currency}
                            {extractSolidsPct(fr.note)
                              ? ` · ${extractSolidsPct(fr.note)}`
                              : ''}
                          </p>
                        </div>
                      )
                    })()}
                    {selected.rawMaterialItemId && (
                      <div className="rounded-sm border border-emerald-200 bg-emerald-50/50 px-3 py-2 text-sm">
                        <p className="text-xs font-bold uppercase text-emerald-800">
                          {t('planner.rawPlanTitle')}
                        </p>
                        <p className="mt-0.5 text-[10px] text-emerald-800/70">{t('planner.rawPlanHint')}</p>
                        <p className="mt-1 font-medium">
                          {warehouseItems.find((i) => i.id === selected.rawMaterialItemId)?.name ??
                            '—'}
                        </p>
                        {selected.metersPerRoll && (
                          <p className="text-xs text-stone-500">
                            {tf('planner.metersPerRollVal', { mp: selected.metersPerRoll })}
                          </p>
                        )}
                      </div>
                    )}
                    {selected.packagingRecipeId && (
                      <div className="rounded-sm border border-amber-200 bg-amber-50/50 px-3 py-2 text-sm">
                        <p className="text-xs font-bold uppercase text-amber-900">
                          {t('planner.packBlock')}
                        </p>
                        <p className="mt-1 font-medium">
                          {packagingRecipes.find((r) => r.id === selected.packagingRecipeId)?.name ??
                            '—'}
                        </p>
                        {selected.packagingPlan && (
                          <p className="text-xs text-stone-500">
                            {selected.packagingPlan.stackDescription} ·{' '}
                            {tf('planner.packOrderSummary', {
                              rolls: selected.packagingPlan.rawRollsEstimated,
                              pallets: selected.packagingPlan.palletsNeeded,
                              boxes: selected.packagingPlan.boxesNeeded,
                            })}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {selected && orderNeedsMaterialPlanning(selected) && (
                  <MaterialStockHint
                    order={selected}
                    warehouseItems={warehouseItems}
                    warehouseMovements={warehouseMovements}
                  />
                )}

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    [t('planner.kpi.completion'), `${selectedSummary.completionPct}%`],
                    [t('planner.kpi.fact'), `${formatNum(selectedSummary.factMp)} ${t('planner.unitMp')}`],
                    [t('planner.kpi.remain'), `${formatNum(Math.max(0, selected.totalQtyMp - selectedSummary.factMp))} ${t('planner.unitMp')}`],
                    [
                      t('planner.kpi.forecast'),
                      selectedSummary.forecastEnd ?? '—',
                    ],
                  ].map(([label, val]) => (
                    <div
                      key={label}
                      className="rounded-sm border border-grid bg-paper-dark/40 px-3 py-2"
                    >
                      <p className="text-xs text-stone-500">{label}</p>
                      <p className="text-sm font-semibold text-ink">{val}</p>
                    </div>
                  ))}
                </div>

                {selected.status === 'active' && selectedTodayPlan && (
                  <div className="rounded-sm border border-emerald-300 bg-emerald-50 px-3 py-3 text-sm">
                    <p className="font-semibold text-emerald-900">
                      {tf('planner.todayPlan', {
                        mp: formatNum(selectedTodayPlan.planMp),
                        line:
                          PRODUCTION_LINES.find(
                            (l) => l.id === (selectedTodayPlan.dayPlan.lineId ?? selected.lineId),
                          )?.[locale === 'ka' ? 'labelKa' : 'labelRu'] ?? selected.lineId,
                      })}
                    </p>
                    <p className="mt-1 text-xs text-emerald-800">
                      {t('planner.todayPlanHint')}
                    </p>
                    <button
                      type="button"
                      className="btn-add-outline mt-2"
                      onClick={() => issueRequestForOrder(today, selected.id)}
                    >
                      {t('planner.issueRequest')}
                    </button>
                  </div>
                )}

                {todayAllocation.length > 0 && (
                  <div className="rounded-sm border border-grid bg-white px-3 py-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-stone-500">
                      {t('planner.lineAllocationToday')}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {todayAllocation.map((row) => {
                        const line = PRODUCTION_LINES.find((l) => l.id === row.lineId)!
                        const hasReq = requests.some(
                          (r) =>
                            requestShiftKey(r.date, r.lineId, r.shift) ===
                            requestShiftKey(today, row.lineId, 'day'),
                        )
                        return (
                          <div
                            key={row.lineId}
                            className="rounded-sm border border-emerald-200 bg-emerald-50/50 px-3 py-2 text-xs"
                          >
                            <span className="font-semibold">
                              {locale === 'ka' ? line.labelKa : line.labelRu}
                            </span>
                            <span className="ml-2">{formatNum(row.totalMp)} {t('planner.unitMp')}</span>
                            {hasReq && (
                              <span className="ml-2 text-emerald-700">{t('planner.requestExists')}</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                    <button
                      type="button"
                      className="btn-add-outline mt-3"
                      onClick={() => issueRequestsForDate(today)}
                    >
                      {t('planner.issueAllToday')}
                    </button>
                  </div>
                )}

                {selected.status === 'draft' &&
                  !canActivateProductionOrder(selected).ok && (
                    <FormNotice
                      type="info"
                      message={t('planner.activate.recipePending')}
                    />
                  )}

                <div className="flex flex-wrap gap-2">
                  {selected.status === 'draft' && (
                    <button
                      type="button"
                      disabled={!canActivateProductionOrder(selected).ok}
                      className="rounded-sm bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                      onClick={() => activateOrder(selected.id)}
                    >
                      {t('planner.activate')}
                    </button>
                  )}
                  {selected.status === 'active' && (
                    <>
                      <button
                        type="button"
                        className="rounded-sm border border-grid px-3 py-1.5 text-xs font-medium"
                        onClick={() => {
                          onRecalculateOrder(selected.id)
                          setNotice(t('planner.recalculated'))
                        }}
                      >
                        {t('planner.recalculate')}
                      </button>
                      <button
                        type="button"
                        className="rounded-sm border border-grid px-3 py-1.5 text-xs font-medium"
                        onClick={() => {
                          onSaveOrder({ ...selected, status: 'paused' })
                          setNotice(t('planner.paused'))
                        }}
                      >
                        {t('planner.pause')}
                      </button>
                      <button
                        type="button"
                        className="rounded-sm border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800"
                        onClick={() => {
                          onSaveOrder({ ...selected, status: 'completed' })
                          setNotice(t('planner.completed'))
                        }}
                      >
                        {t('planner.complete')}
                      </button>
                    </>
                  )}
                  {selected.status === 'paused' && (
                    <button
                      type="button"
                      className="rounded-sm bg-accent px-3 py-1.5 text-xs font-semibold text-white"
                      onClick={() => {
                        onSaveOrder({ ...selected, status: 'active' })
                        setNotice(t('planner.resumed'))
                      }}
                    >
                      {t('planner.resume')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="rounded-sm border border-grid px-3 py-1.5 text-xs font-medium"
                    onClick={startEdit}
                  >
                    {t('planner.edit')}
                  </button>
                  <button
                    type="button"
                    className="rounded-sm border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700"
                    onClick={async () => {
                      if (await confirm({ message: t('planner.deleteConfirm'), danger: true })) {
                        onRemoveOrder(selected.id)
                        setSelectedId(null)
                      }
                    }}
                  >
                    {t('planner.delete')}
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-xs">
                    <thead>
                      <tr className="border-b border-grid text-stone-500">
                        <th className="py-2 pr-2">{t('planner.col.date')}</th>
                        <th className="py-2 pr-2">{t('planner.col.line')}</th>
                        <th className="py-2 pr-2">{t('planner.col.basePlan')}</th>
                        <th className="py-2 pr-2">{t('planner.col.opPlan')}</th>
                        <th className="py-2 pr-2">{t('planner.col.fact')}</th>
                        <th className="py-2 pr-2">{t('planner.col.deviation')}</th>
                        <th className="py-2">{t('planner.col.remain')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedRows.map((row) => {
                        const isPast = row.date < today
                        const devClass =
                          row.deviationMp < -0.01
                            ? 'text-red-600'
                            : row.deviationMp > 0.01
                              ? 'text-emerald-600'
                              : ''
                        return (
                          <tr
                            key={row.id}
                            className={`border-b border-grid/60 ${!row.isWorkingDay ? 'opacity-40' : ''}`}
                          >
                            <td className="py-2 pr-2">
                              <span className="font-medium">{row.date.slice(5)}</span>
                              <span className="ml-1 text-stone-400 capitalize">
                                {weekdayLabel(row.date, locale).slice(0, 2)}
                              </span>
                              {selected.status === 'active' &&
                                row.date >= today &&
                                (row.manualPlanMp ?? row.operationalPlanMp) > 0 && (
                                  <button
                                    type="button"
                                    className="ml-2 text-[10px] font-semibold text-emerald-700 hover:underline"
                                    onClick={() => issueRequestForOrder(row.date, selected.id)}
                                  >
                                    →
                                  </button>
                                )}
                            </td>
                            <td className="py-2 pr-2 text-stone-600">
                              {PRODUCTION_LINES.find((l) => l.id === row.lineId)?.shortRu ?? row.lineId}
                            </td>
                            <td className="py-2 pr-2">{formatNum(row.basePlanMp)}</td>
                            <td className="py-2 pr-2">
                              {selected.planMode === 'manual' ? (
                                <input
                                  type="number"
                                  className="w-20 rounded border border-grid px-1 py-0.5"
                                  value={row.manualPlanMp ?? row.operationalPlanMp}
                                  onChange={(e) => {
                                    const v = Number(e.target.value)
                                    const dayPlans = selected.dayPlans.map((dp) =>
                                      dp.id === row.id
                                        ? {
                                            ...dp,
                                            manualPlanMp: v,
                                            operationalPlanMp: v,
                                          }
                                        : dp,
                                    )
                                    onSaveOrder({ ...selected, dayPlans })
                                  }}
                                />
                              ) : (
                                formatNum(row.manualPlanMp ?? row.operationalPlanMp)
                              )}
                            </td>
                            <td className={`py-2 pr-2 ${isPast && row.factMp === 0 ? 'text-amber-600' : ''}`}>
                              {formatNum(row.factMp)}
                            </td>
                            <td className={`py-2 pr-2 ${devClass}`}>
                              {row.factMp > 0 || isPast
                                ? (row.deviationMp > 0 ? '+' : '') + formatNum(row.deviationMp)
                                : '—'}
                            </td>
                            <td className="py-2">{formatNum(row.remainingAfterDay)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="font-semibold text-ink">
                        <td className="py-2">{t('planner.total')}</td>
                        <td className="py-2" />
                        <td className="py-2">
                          {formatNum(selectedRows.reduce((s, r) => s + r.basePlanMp, 0))}
                        </td>
                        <td className="py-2">
                          {formatNum(
                            selectedRows.reduce(
                              (s, r) => s + (r.manualPlanMp ?? r.operationalPlanMp),
                              0,
                            ),
                          )}
                        </td>
                        <td className="py-2">{formatNum(totalFactMpForOrder(selected, requests))}</td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {selected.history.length > 0 && (
                  <div>
                    <h4 className="mb-2 text-xs font-bold uppercase text-stone-500">
                      {t('planner.history')}
                    </h4>
                    <ul className="max-h-32 space-y-1 overflow-y-auto text-xs text-stone-600">
                      {[...selected.history].reverse().slice(0, 8).map((h) => (
                        <li key={h.id}>
                          <span className="text-stone-400">
                            {h.at.slice(0, 16).replace('T', ' ')}
                          </span>{' '}
                          {h.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="py-12 text-center text-sm text-stone-500">{t('planner.selectOrder')}</p>
            )}
          </div>
        </div>
      )}

      {tab === 'calendar' && (
        <div className="space-y-4">
          <AsOfSnapshotBar
            enabled={asOfEnabled}
            onEnabledChange={setAsOfEnabled}
            date={asOfDate}
            onDateChange={setAsOfDate}
            time={asOfTime}
            onTimeChange={setAsOfTime}
            hintKey="asOf.hintPlanner"
          />
          {asOfEnabled ? (
            <ProductionDaySnapshot
              requests={requests}
              date={asOfDate}
              asOfIso={asOfIso ?? undefined}
            />
          ) : null}
        <div className="overflow-x-auto rounded-sm border border-grid bg-white shadow-sm">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead>
              <tr className="border-b border-grid bg-paper-dark/50 text-stone-500">
                <th className="px-3 py-2">{t('planner.col.date')}</th>
                <th className="px-3 py-2">{t('planner.col.order')}</th>
                <th className="px-3 py-2">{t('planner.col.product')}</th>
                <th className="px-3 py-2">{t('planner.col.plan')}</th>
                <th className="px-3 py-2">{t('planner.col.fact')}</th>
                <th className="px-3 py-2">{t('planner.col.status')}</th>
              </tr>
            </thead>
            <tbody>
              {calendar.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-stone-500">
                    {t('planner.calendarEmpty')}
                  </td>
                </tr>
              )}
              {calendar.map((day) =>
                day.orders.map((cell, idx) => (
                  <tr key={`${day.date}-${cell.orderId}`} className="border-b border-grid/60">
                    {idx === 0 && (
                      <td className="px-3 py-2 align-top font-medium" rowSpan={day.orders.length}>
                        {day.date}
                        <br />
                        <span className="text-stone-400 capitalize">
                          {weekdayLabel(day.date, locale)}
                        </span>
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="font-medium text-accent hover:underline"
                        onClick={() => {
                          const o = orders.find((x) => x.id === cell.orderId)
                          if (o) {
                            openOrder(o)
                            setTab('orders')
                          }
                        }}
                      >
                        {cell.orderNumber}
                      </button>
                    </td>
                    <td className="px-3 py-2">{cell.productName}</td>
                    <td className="px-3 py-2">{formatNum(cell.planMp)}</td>
                    <td
                      className={`px-3 py-2 ${
                        cell.factMp < cell.planMp * 0.8
                          ? 'text-red-600'
                          : cell.factMp >= cell.planMp
                            ? 'text-emerald-600'
                            : ''
                      }`}
                    >
                      {formatNum(cell.factMp)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-sm px-2 py-0.5 text-xs ${STATUS_COLORS[cell.status]}`}
                      >
                        {t(`planner.status.${cell.status}`)}
                      </span>
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
        </div>
      )}

      {tab === 'materials' && (
        <PlannerMaterialsPanel
          orders={orders}
          warehouseItems={warehouseItems}
          warehouseMovements={warehouseMovements}
          onReserveOrder={onReserveMaterials}
          onUnreserveOrder={onUnreserveMaterials}
          onSelectOrder={(id) => {
            const order = orders.find((o) => o.id === id)
            if (order) openOrder(order)
            else setSelectedId(id)
            setTab('orders')
          }}
        />
      )}

      {tab === 'reports' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              [t('planner.report.active'), report.activeOrders],
              [t('planner.report.completed'), report.completedOrders],
              [t('planner.report.plan'), `${formatNum(report.totalPlanMp)} ${t('planner.unitMp')}`],
              [t('planner.report.fact'), `${formatNum(report.totalFactMp)} ${t('planner.unitMp')}`],
            ].map(([label, val]) => (
              <div
                key={String(label)}
                className="rounded-sm border border-grid bg-white px-4 py-3 shadow-sm"
              >
                <p className="text-xs text-stone-500">{label}</p>
                <p className="text-xl font-bold text-ink">{val}</p>
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              className="rounded-sm border border-grid bg-white px-4 py-2 text-sm font-medium"
              onClick={exportReportCsv}
            >
              {t('planner.exportCsv')}
            </button>
          </div>
          <div className="overflow-x-auto rounded-sm border border-grid bg-white shadow-sm">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-grid bg-paper-dark/50 text-xs text-stone-500">
                  <th className="px-3 py-2">{t('planner.col.order')}</th>
                  <th className="px-3 py-2">{t('planner.col.product')}</th>
                  <th className="px-3 py-2">{t('planner.col.plan')}</th>
                  <th className="px-3 py-2">{t('planner.col.fact')}</th>
                  <th className="px-3 py-2">{t('planner.col.completion')}</th>
                  <th className="px-3 py-2">{t('planner.col.behind')}</th>
                  <th className="px-3 py-2">{t('planner.col.forecast')}</th>
                </tr>
              </thead>
              <tbody>
                {report.orders.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-stone-500">
                      {t('planner.reportEmpty')}
                    </td>
                  </tr>
                )}
                {report.orders.map((row) => (
                  <tr key={row.order.id} className="border-b border-grid/60">
                    <td className="px-3 py-2 font-medium">{row.order.orderNumber}</td>
                    <td className="px-3 py-2">{row.order.productName}</td>
                    <td className="px-3 py-2">{formatNum(row.planMp)}</td>
                    <td className="px-3 py-2">{formatNum(row.factMp)}</td>
                    <td className="px-3 py-2">{row.completionPct}%</td>
                    <td className="px-3 py-2 text-red-600">{row.daysBehind || '—'}</td>
                    <td className="px-3 py-2">{row.forecastEnd ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </PageLayout>
  )
}

function SalesOrderLinkBanner({
  link,
  onOpen,
}: {
  link: ProductionSalesLink
  onOpen?: () => void
}) {
  const { t } = useI18n()
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-sky-200 bg-sky-50/80 px-3 py-2 text-sm">
      <div>
        <p className="text-xs font-semibold uppercase text-sky-800">{t('planner.fromSalesOrder')}</p>
        <p className="font-medium text-stone-800">
          {formatSalesOrderLinkLabel(link, { includeLine: true })}
          {link.salesOrder.customer && link.salesOrder.customer !== '—' && (
            <span className="ml-2 text-xs text-stone-500">{link.salesOrder.customer}</span>
          )}
        </p>
      </div>
      {onOpen && (
        <button
          type="button"
          className="text-xs font-semibold text-sky-800 underline"
          onClick={onOpen}
        >
          {t('planner.openSalesOrder')}
        </button>
      )}
    </div>
  )
}
