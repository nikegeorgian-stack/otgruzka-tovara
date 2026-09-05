import { summarizeRequest, summarizeProductionDay } from '@/lib/production/stats'
import type { ProductionRequest } from '@/lib/production/types'
import type { FormulationBatchRun, FormulationStore } from '@/lib/formulations/types'
import {
  analyzeBatchRun,
  varianceLevel,
  warehousePriceLookup,
} from '@/lib/formulations/batchAnalysis'
import { collectPlannerTasksForDate } from '@/lib/planner/generateRequests'
import type { ProductionOrder } from '@/lib/planner/types'
import type { WarehouseDocument, WarehouseStore } from '@/lib/warehouse/types'

export type DayOutputBatchRow = {
  runId: string
  documentNumber: string
  recipeCode: string
  recipeName: string
  status: string
  outputKg: number
  materialKg: number
  costTotal: number | null
  costPerKg: number | null
  maxAbsVariancePct: number | null
  varianceLevel: ReturnType<typeof varianceLevel>
}

export type DayOutputDocRow = {
  id: string
  number: string
  type: string
  docRole?: string
  lineCount: number
}

export type DayOutputReport = {
  date: string
  production: ReturnType<typeof summarizeProductionDay>
  /** План из planner (активные заказы), п.м */
  plannerPlanMp: number
  /** План из сменных заявок, п.м */
  requestPlanMp: number
  /** Факт из заявок, п.м */
  factMp: number
  postedRequests: number
  draftRequests: number
  batches: DayOutputBatchRow[]
  batchesConfirmed: number
  batchesPending: number
  outputKgTotal: number
  materialKgTotal: number
  batchCostTotal: number | null
  warehouseDocs: DayOutputDocRow[]
  issueDocs: number
  receiptDocs: number
}

function dateOfIso(iso: string): string {
  return iso.slice(0, 10)
}

/**
 * Сводка выпуска за день: сменные заявки + замесы + связанные складские документы.
 */
export function buildDayOutputReport(
  date: string,
  requests: ProductionRequest[],
  formulations: FormulationStore,
  warehouse: WarehouseStore,
  asOfIso?: string,
  orders?: ProductionOrder[],
): DayOutputReport {
  const production = summarizeProductionDay(requests, date, asOfIso)
  const dayRequests = requests.filter((r) => r.date === date)
  let postedRequests = 0
  let draftRequests = 0
  for (const r of dayRequests) {
    if (asOfIso && r.postedAt && r.postedAt > asOfIso) continue
    if (r.status === 'posted') postedRequests++
    else draftRequests++
  }

  const plannerPlanMp = orders
    ? Math.round(
        collectPlannerTasksForDate(orders, date).reduce((s, t) => s + t.planMp, 0) * 100,
      ) / 100
    : 0

  const priceLookup = warehousePriceLookup(warehouse)
  const recipeById = new Map(formulations.recipes.map((r) => [r.id, r]))
  const dayBatches = (formulations.batchRuns ?? []).filter((run) => {
    const d = dateOfIso(run.mixedAt)
    if (d !== date) return false
    if (asOfIso && run.createdAt > asOfIso) return false
    return true
  })

  const batches: DayOutputBatchRow[] = dayBatches.map((run) => {
    const recipe = recipeById.get(run.recipeId)
    const analysis = recipe ? analyzeBatchRun(recipe, run, priceLookup) : null
    const materialKg = run.lines.reduce((s, l) => s + l.consumeKg, 0)
    const maxAbs = analysis?.maxAbsVariancePct ?? null
    return {
      runId: run.id,
      documentNumber: run.documentNumber,
      recipeCode: run.recipeCode,
      recipeName: run.recipeName,
      status: run.status ?? 'confirmed',
      outputKg: run.outputKg,
      materialKg: Math.round(materialKg * 1000) / 1000,
      costTotal: analysis?.cost.totalCost ?? null,
      costPerKg: analysis?.cost.costPerKg ?? null,
      maxAbsVariancePct: maxAbs,
      varianceLevel: varianceLevel(maxAbs),
    }
  })

  let batchesConfirmed = 0
  let batchesPending = 0
  let outputKgTotal = 0
  let materialKgTotal = 0
  let costSum = 0
  let costCount = 0
  for (const b of batches) {
    if (b.status === 'confirmed') {
      batchesConfirmed++
      outputKgTotal += b.outputKg
      materialKgTotal += b.materialKg
    } else if (b.status === 'pending') {
      batchesPending++
    }
    if (b.costTotal != null) {
      costSum += b.costTotal
      costCount++
    }
  }

  const warehouseDocs: DayOutputDocRow[] = (warehouse.documents ?? [])
    .filter((d) => {
      if (d.date !== date) return false
      if ((d.status ?? 'posted') !== 'posted') return false
      return (
        Boolean(d.productionRequestId) ||
        Boolean(d.batchRunId) ||
        d.docRole === 'batch_issue' ||
        d.docRole === 'batch_receipt' ||
        d.docRole === 'production_issue' ||
        d.docRole === 'production_receipt' ||
        d.docRole === 'loading_issue'
      )
    })
    .map((d: WarehouseDocument) => ({
      id: d.id,
      number: d.number,
      type: d.type,
      docRole: d.docRole,
      lineCount: d.lines.length,
    }))

  return {
    date,
    production,
    plannerPlanMp,
    requestPlanMp: production.planMp,
    factMp: production.factMp,
    postedRequests,
    draftRequests,
    batches,
    batchesConfirmed,
    batchesPending,
    outputKgTotal: Math.round(outputKgTotal * 1000) / 1000,
    materialKgTotal: Math.round(materialKgTotal * 1000) / 1000,
    batchCostTotal: costCount ? Math.round(costSum * 100) / 100 : null,
    warehouseDocs,
    issueDocs: warehouseDocs.filter((d) => d.type === 'issue').length,
    receiptDocs: warehouseDocs.filter((d) => d.type === 'receipt').length,
  }
}

/** Краткая строка для заявки (используется в детализации). */
export function requestBrief(r: ProductionRequest): string {
  const s = summarizeRequest(r)
  return `${r.lineId} · ${s.factMp} м.п.`
}

export function listDayBatches(
  formulations: FormulationStore,
  date: string,
): FormulationBatchRun[] {
  return (formulations.batchRuns ?? []).filter((run) => dateOfIso(run.mixedAt) === date)
}

/** HTML для печати / окна предпросмотра. */
export function dayOutputReportPrintHtml(
  report: DayOutputReport,
  labels: {
    title: string
    plannerPlan: string
    requestPlan: string
    fact: string
    batches: string
    cost: string
  },
): string {
  const rows = report.batches
    .map(
      (b) =>
        `<tr>
          <td>${escapeHtml(b.documentNumber)}</td>
          <td>${escapeHtml(b.recipeCode)} · ${escapeHtml(b.recipeName)}</td>
          <td style="text-align:right">${b.outputKg}</td>
          <td style="text-align:right">${b.materialKg}</td>
          <td style="text-align:right">${b.costTotal ?? '—'}</td>
          <td style="text-align:right">${b.maxAbsVariancePct != null ? `${b.maxAbsVariancePct}%` : '—'}</td>
        </tr>`,
    )
    .join('')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escapeHtml(labels.title)} ${report.date}</title>
<style>
body{font-family:system-ui,sans-serif;padding:16px;color:#1c1917}
h1{font-size:18px;margin:0 0 8px}
.meta{font-size:12px;color:#57534e;margin-bottom:12px}
table{border-collapse:collapse;width:100%;font-size:12px}
th,td{border:1px solid #d6d3d1;padding:4px 6px;text-align:left}
th{background:#f5f5f4}
</style></head><body>
<h1>${escapeHtml(labels.title)} — ${report.date}</h1>
<div class="meta">
${escapeHtml(labels.plannerPlan)}: ${report.plannerPlanMp} ·
${escapeHtml(labels.requestPlan)}: ${report.requestPlanMp} ·
${escapeHtml(labels.fact)}: ${report.factMp} ·
${escapeHtml(labels.batches)}: ${report.outputKgTotal} кг ·
${escapeHtml(labels.cost)}: ${report.batchCostTotal ?? '—'}
</div>
<table>
<thead><tr><th>№</th><th>Рецепт</th><th>Выпуск</th><th>Сырьё</th><th>Себест.</th><th>Откл.%</th></tr></thead>
<tbody>${rows || '<tr><td colspan="6">—</td></tr>'}</tbody>
</table>
</body></html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
