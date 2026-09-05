import { alkaliOverdue, localTodayYmd } from '@/lib/otc/calc'
import type { OtcStore } from '@/lib/otc/types'
import { computeExecutiveKpis } from '@/lib/erp/executiveKpis'
import type { ProductionOrder } from '@/lib/planner/types'
import { summarizeProductionDay } from '@/lib/production/stats'
import type { ProductionRequest } from '@/lib/production/types'
import { salesDashboardKpis } from '@/lib/sales/calc'
import { buildDirectorActionQueue } from '@/lib/sales/directorActions'
import type { SalesOrder } from '@/lib/sales/types'
import { daysInMonth, parseMonthKey } from '@/lib/dates'
import { rowStats } from '@/lib/stats'
import type { AppStore, Employee, MonthSheet, ViewId } from '@/lib/types'
import type { LoadingShipment } from '@/lib/warehouse/types'

const PERSON_HOURS_MIN = 2
const BRIGADE_HOURS_MIN = 4
const RANK_LIMIT = 8

export type PlanFactScore = {
  id: string
  name: string
  kind: 'person' | 'brigade' | 'line'
  plan: number
  fact: number
  deviation: number
  pct: number
}

export type DirectorDutyChip = {
  id: string
  labelKey: string
  count: number
  tone: 'warn' | 'ok'
  view?: ViewId
  directorTab?: 'dashboard' | 'queue' | 'orders' | 'planning'
  focus?: 'risk' | 'needs_plan' | 'queue'
}

export type DirectorCommandVerdict = 'late' | 'lag' | 'ahead' | 'ok' | 'empty'

export type DirectorCommandBriefing = {
  monthKey: string
  plantPct: number
  planHours: number
  factHours: number
  hoursDeviation: number
  productionPlanMp: number
  productionFactMp: number
  productionPct: number
  fillRatePct: number
  atRiskOrders: number
  openOrders: number
  stockDeficits: number
  underBrigades: PlanFactScore[]
  overBrigades: PlanFactScore[]
  underPeople: PlanFactScore[]
  overPeople: PlanFactScore[]
  duties: DirectorDutyChip[]
  verdict: DirectorCommandVerdict
}

export type DirectorCommandInput = {
  months: AppStore['months']
  employees: Employee[]
  salesOrders: SalesOrder[]
  plannerOrders: ProductionOrder[]
  requests: ProductionRequest[]
  loadingShipments: LoadingShipment[]
  procurement: AppStore['procurement']
  warehouse: AppStore['warehouse']
  otc?: OtcStore
  today?: string
  asOfIso?: string
}

function ratioPct(fact: number, plan: number): number {
  if (plan <= 0.05) return fact > 0.05 ? 100 : 0
  return (fact / plan) * 100
}

function score(id: string, name: string, kind: PlanFactScore['kind'], plan: number, fact: number): PlanFactScore {
  return {
    id,
    name,
    kind,
    plan,
    fact,
    deviation: fact - plan,
    pct: ratioPct(fact, plan),
  }
}

function splitRanks(rows: PlanFactScore[], minAbs: number): {
  under: PlanFactScore[]
  over: PlanFactScore[]
} {
  const under = rows
    .filter((r) => r.plan > 0.05 && r.deviation <= -minAbs)
    .sort((a, b) => a.deviation - b.deviation || a.pct - b.pct)
    .slice(0, RANK_LIMIT)
  const over = rows
    .filter((r) => r.plan > 0.05 && r.deviation >= minAbs)
    .sort((a, b) => b.deviation - a.deviation || b.pct - a.pct)
    .slice(0, RANK_LIMIT)
  return { under, over }
}

function sheetPlanFact(
  sheet: MonthSheet,
  employees: Employee[],
  asOfDate?: string,
): { people: PlanFactScore[]; brigades: PlanFactScore[]; planHours: number; factHours: number; fillRatePct: number } {
  const { year, month } = parseMonthKey(sheet.month)
  const days = daysInMonth(year, month)
  const empById = new Map(employees.map((e) => [e.id, e]))
  const people: PlanFactScore[] = []
  const brigadeAcc = new Map<string, { plan: number; fact: number }>()
  let filled = 0
  let total = 0

  for (const row of sheet.rows) {
    if (!row.employeeId) continue
    const emp = empById.get(row.employeeId)
    if (!emp?.active) continue
    const rs = rowStats(sheet, row.id, days, year, month, emp, undefined, asOfDate)
    if (rs.planHours <= 0.05 && rs.factHours <= 0.05) continue
    people.push(score(emp.id, emp.fullName, 'person', rs.planHours, rs.factHours))
    const brigadeKey = row.brigade.trim() || '—'
    const cur = brigadeAcc.get(brigadeKey) ?? { plan: 0, fact: 0 }
    cur.plan += rs.planHours
    cur.fact += rs.factHours
    brigadeAcc.set(brigadeKey, cur)
    for (let d = 1; d <= days; d++) {
      const key = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      if (asOfDate && key > asOfDate) continue
      total++
      const fact = sheet.fact[row.id]?.[key] ?? sheet.plan[row.id]?.[key]
      if (fact) filled++
    }
  }

  const brigades = [...brigadeAcc.entries()].map(([name, v]) => score(name, name, 'brigade', v.plan, v.fact))
  const planHours = people.reduce((s, r) => s + r.plan, 0)
  const factHours = people.reduce((s, r) => s + r.fact, 0)
  return {
    people,
    brigades,
    planHours,
    factHours,
    fillRatePct: total ? Math.round((filled / total) * 100) : 0,
  }
}

function pickVerdict(input: {
  atRisk: number
  underBrigades: number
  plantPct: number
  planHours: number
}): DirectorCommandVerdict {
  if (input.planHours <= 0.05) return 'empty'
  if (input.atRisk > 0) return 'late'
  if (input.underBrigades > 0 || input.plantPct < 97) return 'lag'
  if (input.plantPct >= 103) return 'ahead'
  return 'ok'
}

function duty(
  id: string,
  labelKey: string,
  count: number,
  extra?: Omit<DirectorDutyChip, 'id' | 'labelKey' | 'count' | 'tone'>,
): DirectorDutyChip | null {
  if (count <= 0) return null
  return { id, labelKey, count, tone: 'warn', ...extra }
}

/** Сводка для гендиректора: план↔факт, отстающие / перевыполнение, незакрытые функции. */
export function computeDirectorCommandBriefing(input: DirectorCommandInput): DirectorCommandBriefing {
  const today = input.today ?? localTodayYmd()
  const asOfDate = input.asOfIso?.slice(0, 10)
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
  const monthKey = plant.factHoursMonthKey
  const sheet = input.months[monthKey]
  const ranking = sheet
    ? sheetPlanFact(sheet, input.employees, asOfDate)
    : { people: [], brigades: [], planHours: 0, factHours: 0, fillRatePct: 0 }

  const peopleRanks = splitRanks(ranking.people, PERSON_HOURS_MIN)
  const brigadeRanks = splitRanks(ranking.brigades, BRIGADE_HOURS_MIN)

  const sales = salesDashboardKpis(
    input.salesOrders,
    input.plannerOrders,
    input.requests,
    today,
  )
  const production = summarizeProductionDay(input.requests, today, input.asOfIso)
  const queue = buildDirectorActionQueue({
    orders: input.salesOrders,
    plannerOrders: input.plannerOrders,
    requests: input.requests,
    loadingShipments: input.loadingShipments,
    today,
  })

  let needsPlan = 0
  for (const o of input.salesOrders) {
    if (o.status === 'completed' || o.status === 'cancelled') continue
    if (o.lines.some((l) => l.productionOrderIds.length === 0)) needsPlan++
  }
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

  const plantPct = ratioPct(ranking.factHours, ranking.planHours)
  const productionPct = ratioPct(production.factMp, production.planMp)
  const verdict = pickVerdict({
    atRisk: sales.atRiskOrders,
    underBrigades: brigadeRanks.under.length,
    plantPct,
    planHours: ranking.planHours,
  })

  const duties = [
    duty('atRisk', 'director.kpi.atRisk', sales.atRiskOrders, {
      directorTab: 'queue',
      focus: 'risk',
    }),
    duty('queue', 'director.pulse.queue', queue.length, {
      directorTab: 'queue',
      focus: 'queue',
    }),
    duty('needsPlan', 'director.command.duty.needsPlan', needsPlan, {
      directorTab: 'planning',
      focus: 'needs_plan',
    }),
    duty('openPo', 'director.command.duty.overduePo', plant.procurementOverdue, {
      view: 'procurement',
    }),
    duty('stock', 'erp.kpi.stockDeficit', plant.stockDeficits, { view: 'warehouse' }),
    duty('loading', 'director.pulse.loadingDrafts', loadingDrafts, { view: 'warehouse' }),
    duty('shifts', 'director.pulse.shiftRequests', openShiftRequests, { view: 'production' }),
    duty('alkali', 'director.pulse.alkaliOverdue', alkali, { view: 'otc' }),
    duty('defects', 'director.pulse.openDefects', openDefects, { view: 'otc' }),
    duty('lab', 'director.pulse.labFails', labFails, { view: 'otc' }),
  ].filter((d): d is DirectorDutyChip => d != null)

  return {
    monthKey,
    plantPct,
    planHours: ranking.planHours,
    factHours: ranking.factHours,
    hoursDeviation: ranking.factHours - ranking.planHours,
    productionPlanMp: production.planMp,
    productionFactMp: production.factMp,
    productionPct,
    fillRatePct: ranking.fillRatePct,
    atRiskOrders: sales.atRiskOrders,
    openOrders: sales.openOrders,
    stockDeficits: plant.stockDeficits,
    underBrigades: brigadeRanks.under,
    overBrigades: brigadeRanks.over,
    underPeople: peopleRanks.under,
    overPeople: peopleRanks.over,
    duties,
    verdict,
  }
}
