import type {
  PackagingRequestData,
  PackagingRow,
  PackagingSectionKey,
  ProductionCategoryKey,
  ProductionFactRow,
  ProductionRequest,
} from './types'
import { PACKAGING_SECTIONS, PRODUCTION_CATEGORIES } from './types'

export type CategoryTotals = Record<ProductionCategoryKey, { qtyMp: number; qtyKg: number }>

export function emptyCategoryTotals(): CategoryTotals {
  return {
    ratl1: { qtyMp: 0, qtyKg: 0 },
    ratl2: { qtyMp: 0, qtyKg: 0 },
    cat4: { qtyMp: 0, qtyKg: 0 },
    cat31: { qtyMp: 0, qtyKg: 0 },
    cat32: { qtyMp: 0, qtyKg: 0 },
    defect: { qtyMp: 0, qtyKg: 0 },
  }
}

function addCell(totals: CategoryTotals, key: ProductionCategoryKey, cell: { qtyMp?: number; qtyKg?: number }) {
  totals[key].qtyMp += cell.qtyMp ?? 0
  totals[key].qtyKg += cell.qtyKg ?? 0
}

export function sumFactRows(rows: ProductionFactRow[]): CategoryTotals {
  const totals = emptyCategoryTotals()
  for (const row of rows) {
    for (const cat of PRODUCTION_CATEGORIES) {
      addCell(totals, cat.key, row[cat.key])
    }
  }
  return totals
}

export type RequestSummary = {
  planMp: number
  factMp: number
  factKg: number
  palletRolls: number
  byCategory: CategoryTotals
}

export type PackagingSectionTotals = Record<
  PackagingSectionKey,
  { plan: number; fact: number }
>

function sumPackagingRows(rows: PackagingRow[]): { plan: number; fact: number } {
  return rows.reduce(
    (acc, r) => ({
      plan: acc.plan + (r.planQty ?? 0),
      fact: acc.fact + (r.factQty ?? 0),
    }),
    { plan: 0, fact: 0 },
  )
}

export function summarizePackaging(p: PackagingRequestData): PackagingSectionTotals {
  const totals = {} as PackagingSectionTotals
  for (const s of PACKAGING_SECTIONS) {
    totals[s.key] = sumPackagingRows(p[s.key])
  }
  return totals
}

export function summarizeRequest(req: ProductionRequest): RequestSummary {
  if (req.lineId === 'pack' && req.packaging) {
    const sections = summarizePackaging(req.packaging)
    return {
      planMp: sections.rolls.plan,
      factMp: sections.rolls.fact,
      factKg: 0,
      palletRolls: 0,
      byCategory: emptyCategoryTotals(),
    }
  }
  const byCategory = sumFactRows(req.factRows)
  let factMp = 0
  let factKg = 0
  for (const cat of PRODUCTION_CATEGORIES) {
    if (cat.key === 'defect') {
      factKg += byCategory.defect.qtyKg
      factMp += byCategory.defect.qtyMp
    } else {
      factMp += byCategory[cat.key].qtyMp
    }
  }
  const planMp = (req.planSegments ?? []).reduce(
    (s, seg) => s + (seg.plannedQtyMp ?? 0),
    0,
  )
  const palletRolls = req.factRows.reduce((s, r) => s + (r.palletRollQty ?? 0), 0)
  return {
    planMp,
    factMp,
    factKg,
    palletRolls,
    byCategory,
  }
}

export type MonthLineSummary = {
  lineId: ProductionRequest['lineId']
  requests: number
  planMp: number
  factMp: number
  defectKg: number
  byCategory: CategoryTotals
}

export type MonthProductionSummary = {
  month: string
  byLine: MonthLineSummary[]
  combined: CategoryTotals
  planMp: number
  factMp: number
}

export function summarizeProductionMonth(
  requests: ProductionRequest[],
  month: string,
): MonthProductionSummary {
  const posted = requests.filter((r) => r.date.startsWith(month) && r.status === 'posted')
  const byLine = (['1', '2'] as const).map((lineId) => {
    const lineReqs = posted.filter((r) => r.lineId === lineId)
    const combined = emptyCategoryTotals()
    let planMp = 0
    let factMp = 0
    let defectKg = 0
    for (const req of lineReqs) {
      const s = summarizeRequest(req)
      planMp += s.planMp
      factMp += s.factMp
      defectKg += s.factKg
      for (const cat of PRODUCTION_CATEGORIES) {
        combined[cat.key].qtyMp += s.byCategory[cat.key].qtyMp
        combined[cat.key].qtyKg += s.byCategory[cat.key].qtyKg
      }
    }
    return {
      lineId,
      requests: lineReqs.length,
      planMp,
      factMp,
      defectKg,
      byCategory: combined,
    }
  })

  const combined = emptyCategoryTotals()
  let planMp = 0
  let factMp = 0
  for (const row of byLine) {
    planMp += row.planMp
    factMp += row.factMp
    for (const cat of PRODUCTION_CATEGORIES) {
      combined[cat.key].qtyMp += row.byCategory[cat.key].qtyMp
      combined[cat.key].qtyKg += row.byCategory[cat.key].qtyKg
    }
  }

  return { month, byLine, combined, planMp, factMp }
}

export type DayProductionSummary = {
  date: string
  /** ISO-момент среза; undefined = весь день */
  asOfIso?: string
  requests: number
  planMp: number
  factMp: number
  factKg: number
  byLine: MonthLineSummary[]
  byCategory: CategoryTotals
}

/**
 * Выработка за день: только проведённые заявки.
 * Если asOfIso задан — только заявки с postedAt ≤ asOfIso (срез «на это время»).
 */
export function summarizeProductionDay(
  requests: ProductionRequest[],
  dateIso: string,
  asOfIso?: string,
): DayProductionSummary {
  const posted = requests.filter((r) => {
    if (r.date !== dateIso || r.status !== 'posted') return false
    if (!asOfIso) return true
    if (!r.postedAt) return true
    return r.postedAt <= asOfIso
  })

  const byLine = (['1', '2', 'pack'] as const).map((lineId) => {
    const lineReqs = posted.filter((r) => r.lineId === lineId)
    const combined = emptyCategoryTotals()
    let planMp = 0
    let factMp = 0
    let defectKg = 0
    for (const req of lineReqs) {
      const s = summarizeRequest(req)
      planMp += s.planMp
      factMp += s.factMp
      defectKg += s.factKg
      for (const cat of PRODUCTION_CATEGORIES) {
        combined[cat.key].qtyMp += s.byCategory[cat.key].qtyMp
        combined[cat.key].qtyKg += s.byCategory[cat.key].qtyKg
      }
    }
    return {
      lineId,
      requests: lineReqs.length,
      planMp,
      factMp,
      defectKg,
      byCategory: combined,
    }
  })

  const byCategory = emptyCategoryTotals()
  let planMp = 0
  let factMp = 0
  let factKg = 0
  for (const row of byLine) {
    planMp += row.planMp
    factMp += row.factMp
    factKg += row.defectKg
    for (const cat of PRODUCTION_CATEGORIES) {
      byCategory[cat.key].qtyMp += row.byCategory[cat.key].qtyMp
      byCategory[cat.key].qtyKg += row.byCategory[cat.key].qtyKg
    }
  }

  return {
    date: dateIso,
    asOfIso,
    requests: posted.length,
    planMp,
    factMp,
    factKg,
    byLine,
    byCategory,
  }
}

export function formatNum(n: number | undefined): string {
  if (n === undefined || Number.isNaN(n)) return '—'
  if (Math.abs(n) < 0.0001) return '—'
  if (Math.abs(n - Math.round(n)) < 0.001) return String(Math.round(n))
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 1 })
}

export function weekdayLabel(dateIso: string, locale: 'ru' | 'ka'): string {
  const d = new Date(dateIso + 'T12:00:00')
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(locale === 'ka' ? 'ka-GE' : 'ru-RU', { weekday: 'long' })
}
