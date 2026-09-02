import { alkaliOverdue, localTodayYmd } from '@/lib/otc/calc'
import type { OtcStore } from '@/lib/otc/types'
import type { ProductionOrder } from '@/lib/planner/types'
import type { ProductionRequest } from '@/lib/production/types'
import { buildDirectorActionQueue } from '@/lib/sales/directorActions'
import { salesDashboardKpis } from '@/lib/sales/calc'
import type { SalesOrder } from '@/lib/sales/types'
import type { AppStore, ViewId } from '@/lib/types'
import type { LoadingShipment } from '@/lib/warehouse/types'
import type { ExecutiveKpis } from '@/lib/erp/executiveKpis'
import { computeExecutiveKpis } from '@/lib/erp/executiveKpis'

/** Карточка пульса директора (клик → раздел или вкладка кокпита) */
export type DirectorPulseCard = {
  id: string
  labelKey: string
  labelParams?: Record<string, string>
  value: string | number
  tone: 'default' | 'warn' | 'ok'
  hintKey?: string
  hintParams?: Record<string, string>
  view?: ViewId
  directorTab?: 'dashboard' | 'queue' | 'orders' | 'planning'
  focus?: 'risk' | 'needs_plan' | 'queue'
}

export type DirectorPulse = {
  plant: ExecutiveKpis
  sales: ReturnType<typeof salesDashboardKpis>
  queueCount: number
  needsPlanCount: number
  loadingDrafts: number
  openShiftRequests: number
  alkaliOverdue: number
  openDefects: number
  labFails: number
  cards: DirectorPulseCard[]
}

export type DirectorPulseInput = {
  salesOrders: SalesOrder[]
  plannerOrders: ProductionOrder[]
  requests: ProductionRequest[]
  loadingShipments: LoadingShipment[]
  otc?: OtcStore
  procurement: AppStore['procurement']
  warehouse: AppStore['warehouse']
  months: AppStore['months']
  employees: AppStore['employees']
  today?: string
  asOfIso?: string
}

function countNeedsPlan(orders: SalesOrder[]): number {
  let n = 0
  for (const o of orders) {
    if (o.status === 'completed' || o.status === 'cancelled') continue
    if (o.lines.some((l) => l.productionOrderIds.length === 0)) n++
  }
  return n
}

/** Единый «пульс завода» для кокпита операционного директора */
export function computeDirectorPulse(input: DirectorPulseInput): DirectorPulse {
  const today = input.today ?? localTodayYmd()
  const plant = computeExecutiveKpis(
    {
      procurement: input.procurement,
      warehouse: input.warehouse,
      months: input.months,
      employees: input.employees,
    },
    new Date(`${today}T12:00:00`),
    input.asOfIso,
  )

  const sales = salesDashboardKpis(
    input.salesOrders,
    input.plannerOrders,
    input.requests,
    today,
  )

  const queue = buildDirectorActionQueue({
    orders: input.salesOrders,
    plannerOrders: input.plannerOrders,
    requests: input.requests,
    loadingShipments: input.loadingShipments,
    today,
  })

  const planGap = countNeedsPlan(input.salesOrders)
  const loadingDrafts = input.loadingShipments.filter((s) => s.status === 'draft').length
  const openShiftRequests = input.requests.filter(
    (r) => r.status === 'draft' || r.status === 'saved',
  ).length

  const otc = input.otc
  const alkali = otc
    ? otc.alkaliSeries.filter((s) => s.phase === 'soaking' && alkaliOverdue(s, today)).length
    : 0
  const openDefects = otc ? otc.defects.filter((d) => d.status !== 'closed').length : 0
  const labFails = otc
    ? otc.labTests.filter((t) => t.computed.status === 'fail').length +
      otc.alkaliSeries.filter((s) => s.computed.status === 'fail').length
    : 0

  const cards: DirectorPulseCard[] = [
    {
      id: 'openOrders',
      labelKey: 'director.kpi.openOrders',
      value: sales.openOrders,
      tone: 'default',
      directorTab: 'orders',
    },
    {
      id: 'atRisk',
      labelKey: 'director.kpi.atRisk',
      value: sales.atRiskOrders,
      tone: sales.atRiskOrders > 0 ? 'warn' : 'ok',
      hintKey: 'director.kpi.clickHint',
      directorTab: 'queue',
      focus: 'risk',
    },
    {
      id: 'queue',
      labelKey: 'director.pulse.queue',
      value: queue.length,
      tone: queue.length > 0 ? 'warn' : 'ok',
      directorTab: 'queue',
      focus: 'queue',
    },
    {
      id: 'toProduce',
      labelKey: 'director.kpi.toProduce',
      value: `${sales.toProduceMp.toLocaleString('ru-RU')} м.п.`,
      tone: 'default',
      hintKey: planGap > 0 ? 'director.kpi.needsPlanHint' : undefined,
      hintParams: planGap > 0 ? { count: String(planGap) } : undefined,
      directorTab: 'planning',
      focus: 'needs_plan',
    },
    {
      id: 'inProduction',
      labelKey: 'director.kpi.inProduction',
      value: sales.inProductionOrders,
      tone: 'ok',
      directorTab: 'orders',
    },
    {
      id: 'openPo',
      labelKey: 'erp.kpi.openPo',
      value: plant.openPurchaseOrders,
      tone: plant.procurementOverdue > 0 ? 'warn' : 'default',
      hintKey: plant.procurementOverdue > 0 ? 'erp.kpi.openPoOverdue' : undefined,
      hintParams:
        plant.procurementOverdue > 0
          ? { count: String(plant.procurementOverdue) }
          : undefined,
      view: 'procurement',
    },
    {
      id: 'stockDeficit',
      labelKey: 'erp.kpi.stockDeficit',
      value: plant.stockDeficits,
      tone: plant.stockDeficits > 0 ? 'warn' : 'ok',
      view: 'warehouse',
    },
    {
      id: 'loadingDrafts',
      labelKey: 'director.pulse.loadingDrafts',
      value: loadingDrafts,
      tone: loadingDrafts > 0 ? 'warn' : 'ok',
      view: 'warehouse',
    },
    {
      id: 'shiftRequests',
      labelKey: 'director.pulse.shiftRequests',
      value: openShiftRequests,
      tone: openShiftRequests > 0 ? 'warn' : 'default',
      view: 'production',
    },
    {
      id: 'factHours',
      labelKey: 'director.pulse.factHours',
      value: Math.round(plant.factHoursMonth),
      tone: 'default',
      view: 'month',
    },
    {
      id: 'alkaliOverdue',
      labelKey: 'director.pulse.alkaliOverdue',
      value: alkali,
      tone: alkali > 0 ? 'warn' : 'ok',
      view: 'otc',
    },
    {
      id: 'otcDefects',
      labelKey: 'director.pulse.openDefects',
      value: openDefects,
      tone: openDefects > 0 ? 'warn' : 'ok',
      view: 'otc',
    },
    {
      id: 'labFails',
      labelKey: 'director.pulse.labFails',
      value: labFails,
      tone: labFails > 0 ? 'warn' : 'ok',
      view: 'otc',
    },
  ]

  return {
    plant,
    sales,
    queueCount: queue.length,
    needsPlanCount: planGap,
    loadingDrafts,
    openShiftRequests,
    alkaliOverdue: alkali,
    openDefects,
    labFails,
    cards,
  }
}
