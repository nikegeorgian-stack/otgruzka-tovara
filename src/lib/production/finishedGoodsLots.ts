/**
 * PHASE P1C — finished goods lots with QC lifecycle.
 * Canonical FG QC lives here (linked to OTC UI), not in technologistQc.
 */
export type FinishedGoodsQcStatus =
  | 'pending'
  | 'in_review'
  | 'released'
  | 'regrade_pending'
  | 'rejected'
  | 'scrap_pending'
  | 'written_off'

export type FinishedGoodsLot = {
  id: string
  /** Stable warehouse item for FG ledger (m²) */
  warehouseItemId: string
  finishedProductId: string
  batchNo: string
  productionOrderId: string
  packagingReportId: string
  sourceShiftReportIds: string[]
  outputM2: number
  rollCount: number
  palletCount: number
  m2PerRollSnapshot?: number
  rollsPerPalletSnapshot?: number
  productionDate?: string
  packagingDate: string
  warehouseId: string
  locationId: string
  qcStatus: FinishedGoodsQcStatus
  /**
   * Authoritative server decision mirror (SQL QcLotDecision).
   * Client qcStatus alone is not proof of release on web.
   */
  serverQcDecisionId?: string
  serverQcDecisionStatus?: string
  serverQcDecisionRevision?: number
  quantityProduced: number
  quantityQcReleased: number
  quantityShipped: number
  /** released − shipped (computed on write for convenience) */
  quantityRemaining: number
  conversionDeviationReason?: string
  passportAttachmentId?: string
  protocolAttachmentId?: string
  releasedAt?: string
  releasedBy?: string
  releasedByName?: string
  rejectReason?: string
  rejectedAt?: string
  rejectedBy?: string
  /** Regrade links */
  originalLotId?: string
  regradedLotId?: string
  regradeTargetFinishedProductId?: string
  regradeTargetWarehouseItemId?: string
  regradeReason?: string
  scrapTransferPairId?: string
  fgReceiptDocumentId?: string
  createdAt: string
  updatedAt: string
  transactionGroupId?: string
}

export function computeLotRemaining(lot: Pick<FinishedGoodsLot, 'quantityQcReleased' | 'quantityShipped'>): number {
  return Math.max(0, (lot.quantityQcReleased || 0) - (lot.quantityShipped || 0))
}

export function isLotAvailableForShipment(lot: FinishedGoodsLot): boolean {
  const released =
    lot.serverQcDecisionStatus === 'released' ||
    (lot.serverQcDecisionStatus == null && lot.qcStatus === 'released')
  return released && computeLotRemaining(lot) > 1e-9
}

export function lotQcBadgeKey(status: FinishedGoodsQcStatus): string {
  switch (status) {
    case 'pending':
    case 'in_review':
      return 'production.fg.badge.pendingQc'
    case 'released':
      return 'production.fg.badge.released'
    case 'regrade_pending':
      return 'production.fg.badge.regrade'
    case 'rejected':
    case 'scrap_pending':
      return 'production.fg.badge.rejected'
    case 'written_off':
      return 'production.fg.badge.writtenOff'
    default:
      return 'production.fg.badge.pendingQc'
  }
}

export function listPendingQcLots(lots: FinishedGoodsLot[] | undefined): FinishedGoodsLot[] {
  return (lots ?? []).filter(
    (lot) => lot.qcStatus === 'pending' || lot.qcStatus === 'in_review',
  )
}
