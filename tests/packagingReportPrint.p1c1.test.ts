import { describe, expect, it } from 'vitest'
import { buildPackagingReportPrintModel, buildQcDecisionPrintModel } from '@/lib/production/packagingReportPrint'
import type { ProductionPackagingReport } from '@/lib/production/packagingReports'
import type { FinishedGoodsLot } from '@/lib/production/finishedGoodsLots'
import type { QcLotAttachment } from '@/lib/production/qcAttachments'
import type { WarehouseStore } from '@/lib/warehouse/types'

function baseReport(): ProductionPackagingReport {
  return {
    id: 'pack-1',
    number: 'УП-20260903-001',
    status: 'confirmed',
    productionOrderId: 'order-1',
    lineId: 'pack',
    shiftDate: '2026-09-03',
    shift: 'day',
    packagingLocationId: 'pack',
    finishedProductId: 'fp-1',
    warehouseItemId: 'item-fg',
    semiFinishedItemId: 'item-wip',
    materialLines: [{ lineId: 'mat-1', itemId: 'item-rm', unitSnapshot: 'kg', quantity: 1 }],
    wipLines: [{ lineId: 'wip-1', shiftReportId: 'sr-1', semiFinishedItemId: 'item-wip', itemId: 'item-wip', quantity: 10, unitSnapshot: 'm2' }],
    outputM2: 100,
    rollCount: 10,
    palletCount: 1,
    batchNo: 'B-1',
    createdAt: '2026-09-03T09:00:00.000Z',
    updatedAt: '2026-09-03T09:05:00.000Z',
    confirmedAt: '2026-09-03T09:05:00.000Z',
    confirmedBy: 'u-1',
    confirmedByName: 'Operations Director',
    idempotencyKey: 'pack::1',
    finishedGoodsLotId: 'lot-1',
    fgReceiptDocumentId: 'doc-1',
    transactionGroupId: 'tg-1',
  }
}

function baseLot(overrides?: Partial<FinishedGoodsLot>): FinishedGoodsLot {
  return {
    id: 'lot-1',
    warehouseItemId: 'item-fg',
    finishedProductId: 'fp-1',
    batchNo: 'B-1',
    productionOrderId: 'order-1',
    packagingReportId: 'pack-1',
    sourceShiftReportIds: ['sr-1'],
    outputM2: 100,
    rollCount: 10,
    palletCount: 1,
    packagingDate: '2026-09-03',
    warehouseId: 'pack',
    locationId: 'pack',
    qcStatus: 'released',
    quantityProduced: 100,
    quantityQcReleased: 100,
    quantityShipped: 0,
    quantityRemaining: 100,
    passportAttachmentId: 'att-1',
    protocolAttachmentId: 'att-2',
    createdAt: '2026-09-03T09:05:00.000Z',
    updatedAt: '2026-09-03T09:05:00.000Z',
    ...overrides,
  }
}

const attachments: QcLotAttachment[] = [
  {
    id: 'att-1',
    lotId: 'lot-1',
    documentKind: 'passport',
    originalFilename: 'passport.pdf',
    displayName: 'passport.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 10,
    checksum: 'sum-1',
    storagePath: 'fstFiles/test/qc-lots/lot-1/att-1/blob',
    uploadStatus: 'stored',
    version: 1,
  },
  {
    id: 'att-2',
    lotId: 'lot-1',
    documentKind: 'protocol',
    originalFilename: 'protocol.pdf',
    displayName: 'protocol.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 10,
    checksum: 'sum-2',
    storagePath: 'fstFiles/test/qc-lots/lot-1/att-2/blob',
    uploadStatus: 'stored',
    version: 1,
  },
]

describe('packaging report print models', () => {
  it('builds a packaging report print model', () => {
    const model = buildPackagingReportPrintModel(baseReport(), {
      order: { id: 'order-1', orderNumber: 'ЗП-1' },
      warehouse: { documents: [{ id: 'doc-1', number: 'WIP-1' }] } as Pick<WarehouseStore, 'documents'>,
      lot: baseLot(),
      attachments,
    })

    expect(model.number).toBe('УП-20260903-001')
    expect(model.relatedDocumentNumbers).toContain('WIP-1')
    expect(model.passportAttachment?.displayName).toBe('passport.pdf')
  })

  it('builds a qc decision print model', () => {
    const model = buildQcDecisionPrintModel(baseLot(), attachments)

    expect(model.batchNo).toBe('B-1')
    expect(model.banner).toBe('ВЫПУЩЕНО ОТК')
    expect(model.passportRef).toContain('stored')
  })
})
