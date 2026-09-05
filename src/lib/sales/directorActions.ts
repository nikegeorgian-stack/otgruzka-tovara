import { canActivateProductionOrder } from '@/lib/planner/activateGate'
import type { ProductionOrder } from '@/lib/planner/types'
import type { ProductionRequest } from '@/lib/production/types'
import type { LoadingShipment } from '@/lib/warehouse/types'
import { collectOrderLoadingShipments } from './loadingLink'
import { salesOrderMetrics, type SalesOrderMetrics } from './calc'
import type { SalesOrder } from './types'

export type DirectorActionKind = 'risk' | 'needs_plan' | 'needs_loading' | 'needs_recipe'

export type DirectorActionItem = {
  id: string
  kind: DirectorActionKind
  orderId: string
  orderNumber: string
  customer: string
  dueDate?: string
  daysToDue?: number
  donePct: number
  coveragePct: number
  /** Прогноз опоздания, дней (0 = в срок) */
  projectedDaysLate: number
  lateLikely: boolean
  detail?: string
  productionOrderId?: string
}

export type DelayForecast = {
  remainingMp: number
  daysToDue?: number
  requiredDailyMp: number
  plannedDailyMp: number
  daysNeeded: number
  projectedDaysLate: number
  lateLikely: boolean
}

const ACTION_PRIORITY: Record<DirectorActionKind, number> = {
  risk: 0,
  needs_recipe: 1,
  needs_plan: 2,
  needs_loading: 3,
}

function avgPlannedDailyMp(
  linked: ProductionOrder[],
  today: string,
  horizonDays: number,
): number {
  const from = new Date(today + 'T00:00:00')
  const until = new Date(from)
  until.setDate(from.getDate() + Math.max(1, horizonDays))
  const untilIso = until.toISOString().slice(0, 10)
  let sum = 0
  let days = 0
  const daySet = new Set<string>()
  for (const po of linked) {
    if (po.status === 'cancelled' || po.status === 'completed') continue
    for (const dp of po.dayPlans) {
      if (!dp.isWorkingDay) continue
      if (dp.date < today || dp.date > untilIso) continue
      const mp = dp.manualPlanMp ?? dp.operationalPlanMp
      if (mp <= 0) continue
      sum += mp
      daySet.add(dp.date)
    }
  }
  days = daySet.size || horizonDays
  return days > 0 ? sum / days : 0
}

/** Прогноз опоздания: остаток / суточный план vs дней до срока */
export function computeDelayForecast(
  order: SalesOrder,
  metrics: SalesOrderMetrics,
  today: string,
): DelayForecast {
  const remainingMp = Math.max(0, Math.round((metrics.orderedMp - metrics.producedMp) * 10) / 10)
  const daysToDue = metrics.daysToDue
  if (remainingMp <= 0 || order.dueDate == null) {
    return {
      remainingMp: 0,
      daysToDue,
      requiredDailyMp: 0,
      plannedDailyMp: 0,
      daysNeeded: 0,
      projectedDaysLate: 0,
      lateLikely: false,
    }
  }

  const linked: ProductionOrder[] = []
  for (const m of metrics.lineMetrics.values()) linked.push(...m.linkedOrders)
  const horizon = daysToDue != null && daysToDue > 0 ? daysToDue : 14
  const plannedDailyMp = Math.round(avgPlannedDailyMp(linked, today, horizon) * 10) / 10

  const fallbackDaily =
    metrics.coveragePct >= 100 && metrics.orderedMp > 0
      ? metrics.orderedMp / 30
      : plannedDailyMp > 0
        ? plannedDailyMp
        : 0

  const pace = plannedDailyMp > 0 ? plannedDailyMp : fallbackDaily
  const daysNeeded = pace > 0 ? Math.ceil(remainingMp / pace) : remainingMp > 0 ? 999 : 0
  const daysLeft = daysToDue ?? 0
  const projectedDaysLate =
    daysToDue == null
      ? 0
      : daysToDue < 0
        ? Math.abs(daysToDue) + (pace > 0 ? daysNeeded : 0)
        : Math.max(0, daysNeeded - daysLeft)

  const requiredDailyMp =
    daysToDue != null && daysToDue > 0
      ? Math.round((remainingMp / daysToDue) * 10) / 10
      : remainingMp

  const lateLikely =
    remainingMp > 0 &&
    (daysToDue != null && daysToDue < 0
      ? true
      : projectedDaysLate > 0 || (metrics.atRisk && metrics.donePct < 90))

  return {
    remainingMp,
    daysToDue,
    requiredDailyMp,
    plannedDailyMp,
    daysNeeded: daysNeeded >= 999 ? 999 : daysNeeded,
    projectedDaysLate: projectedDaysLate >= 999 ? 999 : projectedDaysLate,
    lateLikely,
  }
}

function needsLoading(order: SalesOrder, shipments: LoadingShipment[]): boolean {
  if (order.status === 'draft' || order.status === 'cancelled' || order.status === 'completed') {
    return false
  }
  const links = collectOrderLoadingShipments(shipments, order.id)
  if (links.combined || order.combinedLoadingShipmentId) return false
  if (links.all.length > 0 && order.lines.every((l) => links.byLineId.has(l.id))) return false
  // Есть объём / упаковка, а калькуляции нет
  return order.lines.some(
    (l) =>
      !links.byLineId.has(l.id) &&
      (l.qtyMp > 0 || (l.rolls ?? 0) > 0 || (l.qtyAreaM2 ?? 0) > 0),
  )
}

function recipeGap(
  order: SalesOrder,
  metrics: SalesOrderMetrics,
): { productionOrderId?: string; detail?: string } | null {
  for (const line of order.lines) {
    const lm = metrics.lineMetrics.get(line.id)
    if (!lm) continue
    for (const po of lm.linkedOrders) {
      if (po.status === 'cancelled' || po.status === 'completed') continue
      const gate = canActivateProductionOrder(po)
      if (!gate.ok) {
        return { productionOrderId: po.id, detail: po.orderNumber }
      }
      if (
        po.formulationRecipeStatus === 'requested' ||
        po.formulationRecipeStatus === 'pending'
      ) {
        return { productionOrderId: po.id, detail: po.orderNumber }
      }
    }
  }
  return null
}

/** Единая очередь действий директора */
export function buildDirectorActionQueue(input: {
  orders: SalesOrder[]
  plannerOrders: ProductionOrder[]
  requests: ProductionRequest[]
  loadingShipments: LoadingShipment[]
  today: string
}): DirectorActionItem[] {
  const { orders, plannerOrders, requests, loadingShipments, today } = input
  const items: DirectorActionItem[] = []

  for (const order of orders) {
    if (order.status === 'cancelled' || order.status === 'completed') continue
    const metrics = salesOrderMetrics(order, plannerOrders, requests, today)
    const forecast = computeDelayForecast(order, metrics, today)

    const base = {
      orderId: order.id,
      orderNumber: order.orderNumber || '—',
      customer: order.customer,
      dueDate: order.dueDate,
      daysToDue: metrics.daysToDue,
      donePct: metrics.donePct,
      coveragePct: metrics.coveragePct,
      projectedDaysLate: forecast.projectedDaysLate,
      lateLikely: forecast.lateLikely,
    }

    if (metrics.atRisk || forecast.lateLikely) {
      items.push({
        ...base,
        id: `${order.id}:risk`,
        kind: 'risk',
        detail:
          forecast.projectedDaysLate > 0
            ? `+${forecast.projectedDaysLate}d`
            : undefined,
      })
    }

    const unplanned = order.lines.filter((l) => l.productionOrderIds.length === 0).length
    if (unplanned > 0) {
      items.push({
        ...base,
        id: `${order.id}:needs_plan`,
        kind: 'needs_plan',
        detail: String(unplanned),
      })
    }

    if (needsLoading(order, loadingShipments)) {
      items.push({
        ...base,
        id: `${order.id}:needs_loading`,
        kind: 'needs_loading',
      })
    }

    const recipe = recipeGap(order, metrics)
    if (recipe) {
      items.push({
        ...base,
        id: `${order.id}:needs_recipe`,
        kind: 'needs_recipe',
        productionOrderId: recipe.productionOrderId,
        detail: recipe.detail,
      })
    }
  }

  items.sort((a, b) => {
    const pk = ACTION_PRIORITY[a.kind] - ACTION_PRIORITY[b.kind]
    if (pk !== 0) return pk
    const da = a.daysToDue ?? 99
    const db = b.daysToDue ?? 99
    return da - db
  })

  return items
}

export function atRiskOrderIds(
  orders: SalesOrder[],
  plannerOrders: ProductionOrder[],
  requests: ProductionRequest[],
  today: string,
): string[] {
  const ids: string[] = []
  for (const order of orders) {
    if (order.status === 'cancelled' || order.status === 'completed') continue
    const m = salesOrderMetrics(order, plannerOrders, requests, today)
    const f = computeDelayForecast(order, m, today)
    if (m.atRisk || f.lateLikely) ids.push(order.id)
  }
  return ids
}

const SEEN_RISK_KEY = 'fst.director.seenRiskIds.v1'

export function readSeenRiskIds(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_RISK_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return new Set()
    return new Set(arr.filter((x): x is string => typeof x === 'string'))
  } catch {
    return new Set()
  }
}

export function writeSeenRiskIds(ids: Iterable<string>): void {
  try {
    localStorage.setItem(SEEN_RISK_KEY, JSON.stringify([...ids]))
  } catch {
    /* ignore quota */
  }
}

export function markRisksSeen(currentIds: string[]): void {
  const prev = readSeenRiskIds()
  for (const id of currentIds) prev.add(id)
  writeSeenRiskIds(prev)
}

/** Новые риски относительно уже просмотренных */
export function newRiskIds(currentIds: string[]): string[] {
  const seen = readSeenRiskIds()
  return currentIds.filter((id) => !seen.has(id))
}

const NAV_HINT_KEY = 'fst.director.navHint'

export type DirectorNavHint = {
  riskOnly?: boolean
  orderId?: string
  tab?: 'dashboard' | 'orders' | 'planning' | 'kanban' | 'queue'
}

export function writeDirectorNavHint(hint: DirectorNavHint): void {
  try {
    sessionStorage.setItem(NAV_HINT_KEY, JSON.stringify(hint))
  } catch {
    /* ignore */
  }
}

export function consumeDirectorNavHint(): DirectorNavHint | null {
  try {
    const raw = sessionStorage.getItem(NAV_HINT_KEY)
    if (!raw) return null
    sessionStorage.removeItem(NAV_HINT_KEY)
    return JSON.parse(raw) as DirectorNavHint
  } catch {
    return null
  }
}
