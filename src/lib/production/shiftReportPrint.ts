/**
 * PHASE P1B — print model for confirmed shift production report.
 * Uses only snapshots / stable IDs — never live recipe or name matching.
 */
import type { ProductionOrder } from '@/lib/planner/types'
import type { ProductionShiftReport } from '@/lib/production/shiftReports'
import type { WarehouseStore } from '@/lib/warehouse/types'

export type ShiftReportPrintMaterialLine = {
  itemId: string
  itemCodeSnapshot?: string
  itemNameSnapshot?: string
  unitSnapshot: string
  normQty: number
  actualInputQty: number
  processConsumedQty: number
  wasteQty: number
  deviationQty: number
  deviationPct: number
  tolerancePct: number
  deviationReason?: string
  batchNo?: string
  expiryDate?: string
}

export type ShiftReportPrintWasteLine = {
  itemId: string
  batchNo?: string
  quantity: number
  unitSnapshot: string
  reasonCode: string
  comment?: string
}

export type ShiftReportPrintModel = {
  number: string
  shiftDate: string
  shift: string
  lineId: string
  productionOrderId: string
  productionOrderNumber?: string
  responsibleNameSnapshot?: string
  responsibleRoleSnapshot?: string
  recipeVersionId: string
  recipeVersionNumber: number
  recipeContentHash: string
  recipeNormBase: string
  legacyCapture?: boolean
  materialLines: ShiftReportPrintMaterialLine[]
  wasteLines: ShiftReportPrintWasteLine[]
  outputM2: number
  rollCount: number
  m2PerRollSnapshot?: number
  semiFinishedItemId: string
  consumptionDocumentNumber?: string
  wipReceiptDocumentNumber?: string
  wasteDocumentNumbers: string[]
  confirmedAt?: string
  confirmedByName?: string
  isCorrection: boolean
  correctsReportNumber?: string
  correctionReason?: string
  electronicSignatures: {
    role: string
    name: string
    at?: string
  }[]
  manualSignatureSlots: string[]
}

export function buildShiftReportPrintModel(
  report: ProductionShiftReport,
  opts?: {
    order?: Pick<ProductionOrder, 'id' | 'orderNumber'> | null
    warehouse?: Pick<WarehouseStore, 'documents'> | null
  },
): ShiftReportPrintModel {
  const snap = report.recipeNormSnapshot
  const docs = opts?.warehouse?.documents ?? []
  const cons = report.consumptionDocumentId
    ? docs.find((d) => d.id === report.consumptionDocumentId)
    : undefined
  const wip = report.wipReceiptDocumentId
    ? docs.find((d) => d.id === report.wipReceiptDocumentId)
    : undefined
  const wasteNos = report.wasteTransferPairId
    ? docs
        .filter((d) => d.transferPairId === report.wasteTransferPairId)
        .map((d) => d.number)
        .filter(Boolean)
    : []

  return {
    number: report.number,
    shiftDate: report.shiftDate,
    shift: report.shift,
    lineId: report.lineId,
    productionOrderId: report.productionOrderId,
    productionOrderNumber: opts?.order?.orderNumber,
    responsibleNameSnapshot: report.responsibleNameSnapshot,
    responsibleRoleSnapshot: report.responsibleRoleSnapshot,
    recipeVersionId: snap.recipeVersionId,
    recipeVersionNumber: snap.versionNumber,
    recipeContentHash: snap.contentHash,
    recipeNormBase: snap.normBase,
    legacyCapture: snap.legacyCapture,
    materialLines: report.materialLines.map((l) => ({
      itemId: l.itemId,
      itemCodeSnapshot: l.itemCodeSnapshot,
      itemNameSnapshot: l.itemNameSnapshot,
      unitSnapshot: l.unitSnapshot,
      normQty: l.normQty,
      actualInputQty: l.actualInputQty,
      processConsumedQty: l.processConsumedQty,
      wasteQty: l.wasteQty,
      deviationQty: l.deviationQty,
      deviationPct: l.deviationPct,
      tolerancePct: l.tolerancePct,
      deviationReason: l.deviationReason,
      batchNo: l.batchNo,
      expiryDate: l.expiryDate,
    })),
    wasteLines: report.wasteLines.map((w) => ({
      itemId: w.itemId,
      batchNo: w.batchNo,
      quantity: w.quantity,
      unitSnapshot: w.unitSnapshot,
      reasonCode: w.reasonCode,
      comment: w.comment,
    })),
    outputM2: report.outputM2,
    rollCount: report.rollCount,
    m2PerRollSnapshot: report.m2PerRollSnapshot,
    semiFinishedItemId: report.semiFinishedItemId,
    consumptionDocumentNumber: cons?.number,
    wipReceiptDocumentNumber: wip?.number,
    wasteDocumentNumbers: wasteNos,
    confirmedAt: report.confirmedAt,
    confirmedByName: report.confirmedByName,
    isCorrection: Boolean(report.correctsReportId),
    correctsReportNumber: report.correctsReportId,
    correctionReason: report.correctionReason,
    electronicSignatures: [
      {
        role: 'master',
        name: report.confirmedByName || report.responsibleNameSnapshot || '—',
        at: report.confirmedAt,
      },
    ],
    manualSignatureSlots: ['master', 'warehouse', 'director'],
  }
}

/** Resolve corrects report number from production store list (stable id only). */
export function withCorrectsReportNumber(
  model: ShiftReportPrintModel,
  reports: Pick<ProductionShiftReport, 'id' | 'number'>[],
  correctsReportId?: string,
): ShiftReportPrintModel {
  if (!correctsReportId) return model
  const src = reports.find((r) => r.id === correctsReportId)
  return {
    ...model,
    correctsReportNumber: src?.number ?? correctsReportId,
  }
}
