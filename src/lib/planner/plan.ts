import { newId } from '@/lib/production/files'
import type { ProductionRequest } from '@/lib/production/types'
import { sumFactRows } from '@/lib/production/stats'
import { dateRangeInclusive } from './dates'
import type { PlannerDayPlan, ProductionOrder } from './types'

export function formatOrderNumber(year: number, seq: number): string {
  return `ЗП-${year}-${String(seq).padStart(3, '0')}`
}

/** Равномерное распределение объёма по рабочим дням */
export function generateEvenDayPlans(order: ProductionOrder): PlannerDayPlan[] {
  const dates = dateRangeInclusive(order.startDate, order.endDate)
  const working = dates.filter((d) => {
    const existing = order.dayPlans.find((p) => p.date === d)
    return existing ? existing.isWorkingDay : true
  })
  const perDay =
    working.length > 0 ? Math.round((order.totalQtyMp / working.length) * 10) / 10 : 0

  return dates.map((date) => {
    const prev = order.dayPlans.find((p) => p.date === date)
    const isWorkingDay = prev?.isWorkingDay ?? true
    const mp = isWorkingDay ? perDay : 0
    return {
      id: prev?.id ?? newId(),
      date,
      basePlanMp: mp,
      operationalPlanMp: prev?.manualPlanMp ?? mp,
      manualPlanMp: prev?.manualPlanMp,
      lineId: prev?.lineId ?? order.lineId,
      brigadeName: prev?.brigadeName,
      note: prev?.note,
      isWorkingDay,
    }
  })
}

/** Факт по категории заказа из проведённых заявок за дату */
export function factMpForOrderOnDate(
  order: ProductionOrder,
  requests: ProductionRequest[],
  date: string,
): number {
  let total = 0
  for (const req of requests) {
    if (req.date !== date || req.status !== 'posted') continue
    const totals = sumFactRows(req.factRows)
    const orderFact = totals[order.category]?.qtyMp ?? 0
    if (orderFact <= 0) continue

    const requestLinked = req.orderId === order.id
    const segmentLinked = req.planSegments.some((s) => s.orderId === order.id)

    if (!requestLinked && !segmentLinked) continue

    if (requestLinked || req.planSegments.every((s) => s.orderId === order.id || !s.orderId)) {
      total += orderFact
      continue
    }

    const totalPlanned = req.planSegments.reduce((s, seg) => s + (seg.plannedQtyMp ?? 0), 0)
    const orderPlanned = req.planSegments
      .filter((s) => s.orderId === order.id)
      .reduce((s, seg) => s + (seg.plannedQtyMp ?? 0), 0)
    if (totalPlanned > 0 && orderPlanned > 0) {
      total += (orderFact * orderPlanned) / totalPlanned
    }
  }
  return Math.round(total * 10) / 10
}

/** Суммарный факт по заказу */
export function totalFactMpForOrder(
  order: ProductionOrder,
  requests: ProductionRequest[],
): number {
  const dates = new Set(order.dayPlans.map((p) => p.date))
  let sum = 0
  for (const d of dates) {
    sum += factMpForOrderOnDate(order, requests, d)
  }
  return sum
}

export type DayPlanRow = PlannerDayPlan & {
  factMp: number
  deviationMp: number
  remainingAfterDay: number
  cumulativeFact: number
  cumulativePlan: number
}

export function buildDayPlanRows(
  order: ProductionOrder,
  requests: ProductionRequest[],
): DayPlanRow[] {
  let cumulativeFact = 0
  let cumulativePlan = 0
  const sorted = [...order.dayPlans].sort((a, b) => a.date.localeCompare(b.date))

  return sorted.map((dp) => {
    const factMp = factMpForOrderOnDate(order, requests, dp.date)
    const planMp = dp.manualPlanMp ?? dp.operationalPlanMp
    cumulativeFact += factMp
    cumulativePlan += planMp
    const remainingAfterDay = Math.max(0, order.totalQtyMp - cumulativeFact)
    return {
      ...dp,
      factMp,
      deviationMp: factMp - planMp,
      remainingAfterDay,
      cumulativeFact,
      cumulativePlan,
    }
  })
}

/** Пересчёт оперативного плана на будущие дни */
export function recalculateOperationalPlans(
  order: ProductionOrder,
  requests: ProductionRequest[],
  asOfDate?: string,
): ProductionOrder {
  const today = asOfDate ?? new Date().toISOString().slice(0, 10)
  const totalFact = totalFactMpForOrder(order, requests)
  const remaining = Math.max(0, order.totalQtyMp - totalFact)

  const futureWorking = order.dayPlans.filter(
    (p) => p.date > today && p.isWorkingDay && p.manualPlanMp === undefined,
  )
  const perDay =
    futureWorking.length > 0
      ? Math.round((remaining / futureWorking.length) * 10) / 10
      : 0

  const dayPlans = order.dayPlans.map((dp) => {
    if (dp.date <= today || !dp.isWorkingDay || dp.manualPlanMp !== undefined) {
      return dp
    }
    return { ...dp, operationalPlanMp: perDay }
  })

  return {
    ...order,
    dayPlans,
    updatedAt: new Date().toISOString(),
  }
}

export function completionPercent(
  order: ProductionOrder,
  requests: ProductionRequest[],
): number {
  if (order.totalQtyMp <= 0) return 0
  const fact = totalFactMpForOrder(order, requests)
  return Math.min(100, Math.round((fact / order.totalQtyMp) * 1000) / 10)
}

export function forecastEndDate(
  order: ProductionOrder,
  requests: ProductionRequest[],
): string | null {
  const rows = buildDayPlanRows(order, requests)
  const remaining = order.totalQtyMp - totalFactMpForOrder(order, requests)
  if (remaining <= 0) {
    const lastWithFact = [...rows].reverse().find((r) => r.factMp > 0)
    return lastWithFact?.date ?? order.endDate
  }
  const future = rows.filter((r) => r.date >= new Date().toISOString().slice(0, 10))
  let acc = 0
  for (const row of future) {
    const plan = row.manualPlanMp ?? row.operationalPlanMp
    acc += plan
    if (acc >= remaining) return row.date
  }
  return future.length ? future[future.length - 1].date : null
}
