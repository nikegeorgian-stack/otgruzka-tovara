/**
 * PHASE P1C.1 — print model for packaging reports / QC decisions.
 * Uses snapshots and stable IDs only — never live product/recipe lookup for facts.
 */
import type { ProductionOrder } from '@/lib/planner/types'
import type { FinishedGoodsLot } from './finishedGoodsLots'
import type { ProductionPackagingReport } from './packagingReports'
import type { QcLotAttachment } from './qcAttachments'
import type { WarehouseStore } from '@/lib/warehouse/types'

export type PackagingReportPrintModel = {
  number: string
  shiftDate: string
  shift: string
  lineId: string
  productionOrderId: string
  productionOrderNumber?: string
  packagingLocationId: string
  finishedProductId: string
  warehouseItemId: string
  semiFinishedItemId: string
  batchNo: string
  outputM2: number
  rollCount: number
  palletCount: number
  m2PerRollSnapshot?: number
  rollsPerPalletSnapshot?: number
  wipLines: Array<{
    shiftReportId: string
    itemId: string
    quantity: number
    unitSnapshot: string
    batchNo?: string
  }>
  materialLines: Array<{
    itemId: string
    itemCodeSnapshot?: string
    itemNameSnapshot?: string
    quantity: number
    unitSnapshot: string
    batchNo?: string
  }>
  relatedDocumentNumbers: string[]
  finishedGoodsLotId?: string
  qcStatus?: string
  passportAttachment?: { id: string; displayName: string; uploadStatus: string }
  protocolAttachment?: { id: string; displayName: string; uploadStatus: string }
  confirmedAt?: string
  confirmedByName?: string
  isCorrection: boolean
  correctsReportNumber?: string
  correctionReason?: string
  electronicSignatures: Array<{ role: string; name: string; at?: string }>
  manualSignatureSlots: string[]
  banner?: 'ИСПРАВЛЕНИЕ' | 'СТОРНО' | 'ОЖИДАЕТ ОТК' | 'ВЫПУЩЕНО ОТК'
}

export function buildPackagingReportPrintModel(
  report: ProductionPackagingReport,
  opts?: {
    order?: Pick<ProductionOrder, 'id' | 'orderNumber'> | null
    warehouse?: Pick<WarehouseStore, 'documents'> | null
    lot?: FinishedGoodsLot | null
    attachments?: QcLotAttachment[]
  },
): PackagingReportPrintModel {
  const docs = opts?.warehouse?.documents ?? []
  const relatedIds = [
    report.fgReceiptDocumentId,
    ...(opts?.lot?.fgReceiptDocumentId ? [opts.lot.fgReceiptDocumentId] : []),
  ].filter(Boolean) as string[]
  const relatedDocumentNumbers = docs
    .filter(
      (d) =>
        relatedIds.includes(d.id) ||
        d.packagingReportId === report.id ||
        (opts?.lot && d.finishedGoodsLotId === opts.lot.id),
    )
    .map((d) => d.number)

  const attachments = opts?.attachments ?? []
  const passport = attachments.find((a) => a.id === opts?.lot?.passportAttachmentId)
  const protocol = attachments.find((a) => a.id === opts?.lot?.protocolAttachmentId)

  let banner: PackagingReportPrintModel['banner']
  if (report.correctsReportId || report.correctionReason) banner = 'ИСПРАВЛЕНИЕ'
  else if (opts?.lot?.qcStatus === 'released') banner = 'ВЫПУЩЕНО ОТК'
  else if (opts?.lot?.qcStatus === 'pending' || opts?.lot?.qcStatus === 'in_review') {
    banner = 'ОЖИДАЕТ ОТК'
  }

  return {
    number: report.number,
    shiftDate: report.shiftDate,
    shift: report.shift,
    lineId: report.lineId,
    productionOrderId: report.productionOrderId,
    productionOrderNumber: opts?.order?.orderNumber,
    packagingLocationId: report.packagingLocationId,
    finishedProductId: report.finishedProductId,
    warehouseItemId: report.warehouseItemId,
    semiFinishedItemId: report.semiFinishedItemId,
    batchNo: report.batchNo,
    outputM2: report.outputM2,
    rollCount: report.rollCount,
    palletCount: report.palletCount,
    m2PerRollSnapshot: report.m2PerRollSnapshot,
    rollsPerPalletSnapshot: report.rollsPerPalletSnapshot,
    wipLines: report.wipLines.map((w) => ({
      shiftReportId: w.shiftReportId,
      itemId: w.itemId,
      quantity: w.quantity,
      unitSnapshot: w.unitSnapshot,
      batchNo: w.batchNo,
    })),
    materialLines: report.materialLines.map((m) => ({
      itemId: m.itemId,
      itemCodeSnapshot: m.itemCodeSnapshot,
      itemNameSnapshot: m.itemNameSnapshot,
      quantity: m.quantity,
      unitSnapshot: m.unitSnapshot,
      batchNo: m.batchNo,
    })),
    relatedDocumentNumbers,
    finishedGoodsLotId: report.finishedGoodsLotId,
    qcStatus: opts?.lot?.qcStatus,
    passportAttachment: passport
      ? { id: passport.id, displayName: passport.displayName, uploadStatus: passport.uploadStatus }
      : undefined,
    protocolAttachment: protocol
      ? { id: protocol.id, displayName: protocol.displayName, uploadStatus: protocol.uploadStatus }
      : undefined,
    confirmedAt: report.confirmedAt,
    confirmedByName: report.confirmedByName,
    isCorrection: Boolean(report.correctsReportId),
    correctsReportNumber: undefined,
    correctionReason: report.correctionReason,
    electronicSignatures: [
      {
        role: 'packaging_master',
        name: report.confirmedByName ?? '',
        at: report.confirmedAt,
      },
      ...(opts?.lot?.releasedByName
        ? [
            {
              role: 'otc',
              name: opts.lot.releasedByName,
              at: opts.lot.releasedAt,
            },
          ]
        : []),
    ],
    manualSignatureSlots: ['Мастер упаковки', 'ОТК', 'Кладовщик'],
    banner,
  }
}

export type QcDecisionPrintModel = {
  lotId: string
  batchNo: string
  finishedProductId: string
  warehouseItemId: string
  qcStatus: string
  quantityProduced: number
  quantityQcReleased: number
  quantityShipped: number
  quantityRemaining: number
  packagingReportId: string
  productionOrderId: string
  passportRef?: string
  protocolRef?: string
  releasedAt?: string
  releasedByName?: string
  regradeReason?: string
  originalLotId?: string
  regradedLotId?: string
  electronicSignatures: Array<{ role: string; name: string; at?: string }>
  manualSignatureSlots: string[]
  banner?: string
}

export function buildQcDecisionPrintModel(
  lot: FinishedGoodsLot,
  attachments?: QcLotAttachment[],
): QcDecisionPrintModel {
  const list = attachments ?? []
  const passport = list.find((a) => a.id === lot.passportAttachmentId)
  const protocol = list.find((a) => a.id === lot.protocolAttachmentId)
  return {
    lotId: lot.id,
    batchNo: lot.batchNo,
    finishedProductId: lot.finishedProductId,
    warehouseItemId: lot.warehouseItemId,
    qcStatus: lot.qcStatus,
    quantityProduced: lot.quantityProduced,
    quantityQcReleased: lot.quantityQcReleased,
    quantityShipped: lot.quantityShipped,
    quantityRemaining: lot.quantityRemaining,
    packagingReportId: lot.packagingReportId,
    productionOrderId: lot.productionOrderId,
    passportRef: passport ? `${passport.displayName} (${passport.uploadStatus})` : undefined,
    protocolRef: protocol ? `${protocol.displayName} (${protocol.uploadStatus})` : undefined,
    releasedAt: lot.releasedAt,
    releasedByName: lot.releasedByName,
    regradeReason: lot.regradeReason,
    originalLotId: lot.originalLotId,
    regradedLotId: lot.regradedLotId,
    electronicSignatures: lot.releasedByName
      ? [{ role: 'otc', name: lot.releasedByName, at: lot.releasedAt }]
      : [],
    manualSignatureSlots: ['ОТК', 'Директор производства'],
    banner:
      lot.qcStatus === 'released'
        ? 'ВЫПУЩЕНО ОТК'
        : lot.qcStatus === 'rejected' || lot.qcStatus === 'scrap_pending'
          ? 'БРАК'
          : lot.qcStatus === 'regrade_pending'
            ? 'ПЕРЕКВАЛИФИКАЦИЯ'
            : 'ОЖИДАЕТ ОТК',
  }
}
