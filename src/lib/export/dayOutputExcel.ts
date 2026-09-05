import { loadExcelJs } from '@/lib/lazy/exceljs'
import type { DayOutputReport } from '@/lib/production/dayOutputReport'

function downloadXlsx(buffer: ArrayBuffer, filename: string): void {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export type DayOutputExcelLabels = {
  sheetSummary: string
  sheetBatches: string
  sheetDocs: string
  title: string
  date: string
  plannerPlan: string
  requestPlan: string
  fact: string
  material: string
  batchCost: string
  postedReq: string
  draftReq: string
  batchesOk: string
  batchesPending: string
  docs: string
  colBatch: string
  colRecipe: string
  colStatus: string
  colOut: string
  colMat: string
  colCost: string
  colCostPerKg: string
  colVar: string
  colDoc: string
  colType: string
  colRole: string
  colLines: string
}

/** Excel: сводка + замесы + складские документы за день. */
export async function exportDayOutputExcel(
  report: DayOutputReport,
  labels: DayOutputExcelLabels,
): Promise<void> {
  const ExcelJS = await loadExcelJs()
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Otgruzka'
  wb.created = new Date()

  const summary = wb.addWorksheet(labels.sheetSummary)
  summary.columns = [
    { width: 32 },
    { width: 18 },
  ]
  summary.addRow([labels.title, report.date])
  summary.getRow(1).font = { bold: true, size: 14 }
  summary.addRow([])
  summary.addRow([labels.plannerPlan, report.plannerPlanMp])
  summary.addRow([labels.requestPlan, report.requestPlanMp])
  summary.addRow([labels.fact, report.factMp])
  summary.addRow([labels.material, report.materialKgTotal])
  summary.addRow([labels.batchCost, report.batchCostTotal ?? ''])
  summary.addRow([labels.postedReq, report.postedRequests])
  summary.addRow([labels.draftReq, report.draftRequests])
  summary.addRow([labels.batchesOk, report.batchesConfirmed])
  summary.addRow([labels.batchesPending, report.batchesPending])
  summary.addRow([labels.docs, report.issueDocs + report.receiptDocs])

  const batches = wb.addWorksheet(labels.sheetBatches)
  batches.columns = [
    { width: 14 },
    { width: 36 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 10 },
  ]
  batches.addRow([
    labels.colBatch,
    labels.colRecipe,
    labels.colStatus,
    labels.colOut,
    labels.colMat,
    labels.colCost,
    labels.colCostPerKg,
    labels.colVar,
  ])
  batches.getRow(1).font = { bold: true }
  for (const b of report.batches) {
    batches.addRow([
      b.documentNumber,
      `${b.recipeCode} · ${b.recipeName}`,
      b.status,
      b.outputKg,
      b.materialKg,
      b.costTotal ?? '',
      b.costPerKg ?? '',
      b.maxAbsVariancePct ?? '',
    ])
  }

  const docs = wb.addWorksheet(labels.sheetDocs)
  docs.columns = [
    { width: 16 },
    { width: 12 },
    { width: 18 },
    { width: 10 },
  ]
  docs.addRow([labels.colDoc, labels.colType, labels.colRole, labels.colLines])
  docs.getRow(1).font = { bold: true }
  for (const d of report.warehouseDocs) {
    docs.addRow([d.number, d.type, d.docRole ?? '', d.lineCount])
  }

  const buffer = await wb.xlsx.writeBuffer()
  downloadXlsx(buffer as ArrayBuffer, `day-output-${report.date}.xlsx`)
}
