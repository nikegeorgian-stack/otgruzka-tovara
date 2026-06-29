import type { ProductionOrder } from '@/lib/planner/types'
import { totalFactMpForOrder } from '@/lib/planner/plan'
import type { ProductionLineId, ProductionRequest } from '@/lib/production/types'
import type { SalesOrder, SalesOrderLine } from './types'

export type SalesLineMetrics = {
  orderedMp: number
  plannedMp: number
  producedMp: number
  /** Покрытие плана: план / заказ */
  coveragePct: number
  /** Готовность: факт / заказ */
  donePct: number
  linkedOrders: ProductionOrder[]
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Math.round((part / whole) * 1000) / 10
}

export function salesLineMetrics(
  line: SalesOrderLine,
  plannerOrders: ProductionOrder[],
  requests: ProductionRequest[],
): SalesLineMetrics {
  const linkedOrders = plannerOrders.filter((o) => line.productionOrderIds.includes(o.id))
  const plannedMp = linkedOrders.reduce((s, o) => s + (o.totalQtyMp || 0), 0)
  const producedMp = Math.round(
    linkedOrders.reduce((s, o) => s + totalFactMpForOrder(o, requests), 0) * 10,
  ) / 10
  const orderedMp = line.qtyMp || 0
  return {
    orderedMp,
    plannedMp,
    producedMp,
    coveragePct: pct(plannedMp, orderedMp),
    donePct: pct(producedMp, orderedMp),
    linkedOrders,
  }
}

export type SalesOrderMetrics = {
  orderedMp: number
  plannedMp: number
  producedMp: number
  coveragePct: number
  donePct: number
  /** Срок просрочен или под угрозой */
  atRisk: boolean
  daysToDue?: number
  lineMetrics: Map<string, SalesLineMetrics>
}

/** Заказ под риском, если срок близко/просрочен, а готовность < 100% */
const RISK_WINDOW_DAYS = 5

export function salesOrderMetrics(
  order: SalesOrder,
  plannerOrders: ProductionOrder[],
  requests: ProductionRequest[],
  today: string,
): SalesOrderMetrics {
  const lineMetrics = new Map<string, SalesLineMetrics>()
  let orderedMp = 0
  let plannedMp = 0
  let producedMp = 0
  for (const line of order.lines) {
    const m = salesLineMetrics(line, plannerOrders, requests)
    lineMetrics.set(line.id, m)
    orderedMp += m.orderedMp
    plannedMp += m.plannedMp
    producedMp += m.producedMp
  }
  const donePct = pct(producedMp, orderedMp)

  let daysToDue: number | undefined
  let atRisk = false
  const isOpen = order.status !== 'completed' && order.status !== 'cancelled'
  if (order.dueDate && isOpen) {
    const due = new Date(order.dueDate + 'T00:00:00').getTime()
    const now = new Date(today + 'T00:00:00').getTime()
    daysToDue = Math.round((due - now) / 86_400_000)
    atRisk = daysToDue <= RISK_WINDOW_DAYS && donePct < 100
  }

  return {
    orderedMp,
    plannedMp,
    producedMp,
    coveragePct: pct(plannedMp, orderedMp),
    donePct,
    atRisk,
    daysToDue,
    lineMetrics,
  }
}

function dayPlanMp(p: { manualPlanMp?: number; operationalPlanMp: number }): number {
  return p.manualPlanMp ?? p.operationalPlanMp
}

export type LineLoadDay = {
  date: string
  byLine: Record<ProductionLineId, number>
  total: number
}

/** Загрузка линий по дням из активных заказов планировщика */
export function buildLineLoad(
  plannerOrders: ProductionOrder[],
  opts: { fromDate: string; days: number },
): LineLoadDay[] {
  const from = opts.fromDate.slice(0, 10)
  const out: LineLoadDay[] = []
  const dates: string[] = []
  const base = new Date(from + 'T00:00:00')
  for (let i = 0; i < Math.max(1, opts.days); i++) {
    const d = new Date(base)
    d.setDate(base.getDate() + i)
    dates.push(d.toISOString().slice(0, 10))
  }
  const dateSet = new Set(dates)

  const acc = new Map<string, Record<ProductionLineId, number>>()
  for (const date of dates) acc.set(date, { '1': 0, '2': 0, pack: 0 })

  for (const order of plannerOrders) {
    if (order.status !== 'active') continue
    for (const dp of order.dayPlans) {
      if (!dp.isWorkingDay) continue
      if (!dateSet.has(dp.date)) continue
      const row = acc.get(dp.date)!
      row[dp.lineId] = (row[dp.lineId] ?? 0) + dayPlanMp(dp)
    }
  }

  for (const date of dates) {
    const byLine = acc.get(date)!
    out.push({ date, byLine, total: byLine['1'] + byLine['2'] + byLine.pack })
  }
  return out
}

export type SalesDashboardKpis = {
  openOrders: number
  toProduceMp: number
  atRiskOrders: number
  inProductionOrders: number
}

export function salesDashboardKpis(
  orders: SalesOrder[],
  plannerOrders: ProductionOrder[],
  requests: ProductionRequest[],
  today: string,
): SalesDashboardKpis {
  let openOrders = 0
  let toProduceMp = 0
  let atRiskOrders = 0
  let inProductionOrders = 0
  for (const order of orders) {
    if (order.status === 'completed' || order.status === 'cancelled') continue
    openOrders += 1
    if (order.status === 'in_production') inProductionOrders += 1
    const m = salesOrderMetrics(order, plannerOrders, requests, today)
    toProduceMp += Math.max(0, m.orderedMp - m.producedMp)
    if (m.atRisk) atRiskOrders += 1
  }
  return {
    openOrders,
    toProduceMp: Math.round(toProduceMp),
    atRiskOrders,
    inProductionOrders,
  }
}
