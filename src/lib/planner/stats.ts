import type { ProductionRequest } from '@/lib/production/types'
import {
  buildDayPlanRows,
  completionPercent,
  factMpForOrderOnDate,
  forecastEndDate,
  totalFactMpForOrder,
} from './plan'
import type { ProductionOrder, PlannerStore } from './types'

export type OrderSummary = {
  order: ProductionOrder
  factMp: number
  planMp: number
  deviationMp: number
  completionPct: number
  forecastEnd: string | null
  daysBehind: number
  daysAhead: number
}

export function summarizeOrder(
  order: ProductionOrder,
  requests: ProductionRequest[],
): OrderSummary {
  const rows = buildDayPlanRows(order, requests)
  const factMp = totalFactMpForOrder(order, requests)
  const planMp = rows.reduce(
    (s, r) => s + (r.manualPlanMp ?? r.operationalPlanMp),
    0,
  )
  let daysBehind = 0
  let daysAhead = 0
  const today = new Date().toISOString().slice(0, 10)
  for (const row of rows) {
    if (row.date > today) break
    if (row.factMp < (row.manualPlanMp ?? row.operationalPlanMp) * 0.8) daysBehind++
    if (row.factMp > (row.manualPlanMp ?? row.operationalPlanMp) * 1.2) daysAhead++
  }
  return {
    order,
    factMp,
    planMp,
    deviationMp: factMp - planMp,
    completionPct: completionPercent(order, requests),
    forecastEnd: forecastEndDate(order, requests),
    daysBehind,
    daysAhead,
  }
}

export type CalendarCell = {
  date: string
  orders: {
    orderId: string
    orderNumber: string
    productName: string
    planMp: number
    factMp: number
    status: ProductionOrder['status']
  }[]
}

export function buildCalendarMonth(
  planner: PlannerStore,
  requests: ProductionRequest[],
  month: string,
  asOfIso?: string,
): CalendarCell[] {
  const daysInMonth = new Set<string>()
  for (const order of planner.orders) {
    for (const dp of order.dayPlans) {
      if (dp.date.startsWith(month)) daysInMonth.add(dp.date)
    }
  }
  const sorted = [...daysInMonth].sort()
  return sorted.map((date) => ({
    date,
    orders: planner.orders
      .filter((o) => o.dayPlans.some((p) => p.date === date))
      .map((o) => {
        const dp = o.dayPlans.find((p) => p.date === date)!
        return {
          orderId: o.id,
          orderNumber: o.orderNumber,
          productName: o.productName,
          planMp: dp.manualPlanMp ?? dp.operationalPlanMp,
          factMp: factMpForOrderOnDate(o, requests, date, asOfIso),
          status: o.status,
        }
      }),
  }))
}

export type PlannerReport = {
  month: string
  activeOrders: number
  completedOrders: number
  totalPlanMp: number
  totalFactMp: number
  orders: OrderSummary[]
}

export function buildMonthReport(
  planner: PlannerStore,
  requests: ProductionRequest[],
  month: string,
): PlannerReport {
  const inMonth = planner.orders.filter(
    (o) =>
      o.startDate.startsWith(month) ||
      o.endDate.startsWith(month) ||
      o.dayPlans.some((p) => p.date.startsWith(month)),
  )
  const orders = inMonth.map((o) => summarizeOrder(o, requests))
  return {
    month,
    activeOrders: inMonth.filter((o) => o.status === 'active').length,
    completedOrders: inMonth.filter((o) => o.status === 'completed').length,
    totalPlanMp: orders.reduce((s, o) => s + o.planMp, 0),
    totalFactMp: orders.reduce((s, o) => s + o.factMp, 0),
    orders,
  }
}
