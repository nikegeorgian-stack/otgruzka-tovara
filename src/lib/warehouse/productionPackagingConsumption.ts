/**
 * PHASE P1C — warehouse effects for packaging reports.
 */
import { isWarehouseAccountingActive, WAREHOUSE_NOT_INITIALIZED } from './accountingStatus'
import { appendWarehouseAudit } from './audit'
import { cancelWarehouseDocument, postWarehouseDocument } from './documents'
import type { ProductionPackagingReport } from '@/lib/production/packagingReports'
import type { WarehouseDocumentLine, WarehouseStore } from './types'

export type PackagingReportWarehouseResult = {
  ok: boolean
  error?: string
  wipIssueDocumentId?: string
  packMaterialIssueDocumentId?: string
  fgReceiptDocumentId?: string
  documentIds?: string[]
}

export type PostPackagingReportEffectsInput = {
  report: ProductionPackagingReport
  actor?: { id?: string; name?: string }
  transactionGroupId: string
}

function existingByIdempotencyKey(store: WarehouseStore, key: string): string | undefined {
  return store.documents.find((d) => d.idempotencyKey === key && d.status !== 'cancelled')?.id
}

function existingPackagingDocumentIds(store: WarehouseStore, reportIdempotencyKey: string): string[] {
  return [
    existingByIdempotencyKey(store, `${reportIdempotencyKey}::wip`),
    existingByIdempotencyKey(store, `${reportIdempotencyKey}::pack`),
    existingByIdempotencyKey(store, `${reportIdempotencyKey}::fg`),
  ].filter(Boolean) as string[]
}

function tagMovements(
  store: WarehouseStore,
  documentId: string,
  patch: (movement: WarehouseStore['movements'][number]) => WarehouseStore['movements'][number],
): WarehouseStore {
  return {
    ...store,
    movements: store.movements.map((movement) =>
      movement.documentId === documentId ? patch(movement) : movement,
    ),
  }
}

export function postPackagingReportWarehouseEffects(
  store: WarehouseStore,
  input: PostPackagingReportEffectsInput,
): { store: WarehouseStore; result: PackagingReportWarehouseResult } {
  const { report } = input
  const now = report.confirmedAt ?? new Date().toISOString()
  const date = report.shiftDate
  // Historical local reports used the location id as the warehouse id. Keep
  // that collapsed tuple only when the report predates packagingWarehouseId.
  const packagingWarehouseId =
    report.packagingWarehouseId?.trim() || report.packagingLocationId

  if (!isWarehouseAccountingActive(store, packagingWarehouseId)) {
    return { store, result: { ok: false, error: WAREHOUSE_NOT_INITIALIZED } }
  }

  const fgItem = store.items.find((item) => item.id === report.warehouseItemId)
  if (!fgItem) {
    return { store, result: { ok: false, error: 'production.pack.errSetup' } }
  }

  const existingFg = existingByIdempotencyKey(store, `${report.idempotencyKey}::fg`)
  if (existingFg) {
    return {
      store,
      result: {
        ok: true,
        wipIssueDocumentId: existingByIdempotencyKey(store, `${report.idempotencyKey}::wip`),
        packMaterialIssueDocumentId: existingByIdempotencyKey(store, `${report.idempotencyKey}::pack`),
        fgReceiptDocumentId: existingFg,
        documentIds: [
          existingByIdempotencyKey(store, `${report.idempotencyKey}::wip`),
          existingByIdempotencyKey(store, `${report.idempotencyKey}::pack`),
          existingFg,
        ].filter(Boolean) as string[],
      },
    }
  }

  let working = store
  const documentIds: string[] = []

  const wipSourceByLineId = new Map(report.wipLines.map((line) => [line.lineId || '', line]))
  const wipLines: WarehouseDocumentLine[] = report.wipLines
    .filter((line) => line.quantity > 0)
    .map((line) => ({
      lineId: line.lineId || crypto.randomUUID(),
      itemId: line.semiFinishedItemId,
      quantity: line.quantity,
      unitSnapshot: line.unitSnapshot || 'm2',
      locationId: report.packagingLocationId,
      batchNo: line.batchNo,
      expiryDate: line.expiryDate,
    }))

  if (wipLines.length) {
    const out = postWarehouseDocument(working, {
      type: 'issue',
      number: `СП-${report.number}`,
      date,
      documentDateTime: now,
      warehouseId: packagingWarehouseId,
      purpose: 'production_wip_pack_consumption',
      docRole: 'production_wip_pack_consumption',
      productionOrderId: report.productionOrderId,
      packagingReportId: report.id,
      basisType: 'production_packaging_report',
      basisId: report.id,
      basisNumber: report.number,
      comment: `Списание ПФ на упаковку · ${report.number}`,
      lines: wipLines,
      transactionGroupId: input.transactionGroupId,
      idempotencyKey: `${report.idempotencyKey}::wip`,
      status: 'posted',
      postedAt: now,
      postedBy: input.actor?.id,
      postedByName: input.actor?.name,
      createdBy: input.actor?.id,
      createdByName: input.actor?.name,
    })
    if (!out.result.ok) {
      return { store, result: { ok: false, error: out.result.error } }
    }
    working = tagMovements(out.store, out.result.documentId, (movement) => {
      const line = wipSourceByLineId.get(movement.documentLineId ?? '')
      return line
        ? {
            ...movement,
            packagingReportId: report.id,
            productionOrderId: report.productionOrderId,
            shiftReportId: line.shiftReportId,
            sourceDocumentId: line.receiptDocumentId,
            sourceDocumentLineId: line.lineId,
            sourceShiftReportId: line.shiftReportId,
            sourceWipBatchId: line.batchNo,
          }
        : movement
    })
    documentIds.push(out.result.documentId)
  }

  const materialLines: WarehouseDocumentLine[] = report.materialLines
    .filter((line) => line.quantity > 0)
    .map((line) => ({
      lineId: line.lineId || crypto.randomUUID(),
      itemId: line.itemId,
      quantity: line.quantity,
      itemCodeSnapshot: line.itemCodeSnapshot,
      itemNameSnapshot: line.itemNameSnapshot,
      unitSnapshot: line.unitSnapshot,
      inputUnit: line.inputUnit,
      locationId: report.packagingLocationId,
      batchNo: line.batchNo,
      expiryDate: line.expiryDate,
      batchOverrideReason: line.batchOverrideReason,
      comment: `packagingReportId=${report.id}`,
    }))

  if (materialLines.length) {
    const out = postWarehouseDocument(working, {
      type: 'issue',
      number: `УПМ-${report.number}`,
      date,
      documentDateTime: now,
      warehouseId: packagingWarehouseId,
      purpose: 'production_packaging_consumption',
      docRole: 'production_packaging_consumption',
      productionOrderId: report.productionOrderId,
      packagingReportId: report.id,
      basisType: 'production_packaging_report',
      basisId: report.id,
      basisNumber: report.number,
      comment: `Расход материалов на упаковку · ${report.number}`,
      lines: materialLines,
      transactionGroupId: input.transactionGroupId,
      idempotencyKey: `${report.idempotencyKey}::pack`,
      status: 'posted',
      postedAt: now,
      postedBy: input.actor?.id,
      postedByName: input.actor?.name,
      createdBy: input.actor?.id,
      createdByName: input.actor?.name,
    })
    if (!out.result.ok) {
      return { store, result: { ok: false, error: out.result.error } }
    }
    working = tagMovements(out.store, out.result.documentId, (movement) => ({
      ...movement,
      packagingReportId: report.id,
      productionOrderId: report.productionOrderId,
    }))
    documentIds.push(out.result.documentId)
  }

  const lotId = report.finishedGoodsLotId ?? crypto.randomUUID()
  const fgReceipt = postWarehouseDocument(working, {
    type: 'receipt',
    number: `ГП-${report.number}`,
    date,
    documentDateTime: now,
    warehouseId: packagingWarehouseId,
    purpose: 'production_fg_receipt',
    docRole: 'production_fg_receipt',
    productionOrderId: report.productionOrderId,
    packagingReportId: report.id,
    finishedGoodsLotId: lotId,
    basisType: 'production_packaging_report',
    basisId: report.id,
    basisNumber: report.number,
    comment: `Приход готовой продукции · ${report.number}`,
    lines: [
      {
        lineId: crypto.randomUUID(),
        itemId: report.warehouseItemId,
        quantity: Math.max(0, report.outputM2),
        itemCodeSnapshot: fgItem.internalCode,
        itemNameSnapshot: fgItem.name,
        unitSnapshot: fgItem.unit || 'm2',
        locationId: report.packagingLocationId,
        batchNo: report.batchNo,
      },
    ],
    transactionGroupId: input.transactionGroupId,
    idempotencyKey: `${report.idempotencyKey}::fg`,
    status: 'posted',
    postedAt: now,
    postedBy: input.actor?.id,
    postedByName: input.actor?.name,
    createdBy: input.actor?.id,
    createdByName: input.actor?.name,
  })
  if (!fgReceipt.result.ok) {
    return { store, result: { ok: false, error: fgReceipt.result.error } }
  }
  working = tagMovements(fgReceipt.store, fgReceipt.result.documentId, (movement) => ({
    ...movement,
    packagingReportId: report.id,
    finishedGoodsLotId: lotId,
    productionOrderId: report.productionOrderId,
  }))
  documentIds.push(fgReceipt.result.documentId)

  working = appendWarehouseAudit(working, {
    action: 'document_post',
    detail: `Отчёт упаковки ${report.number} · ГП и расход материалов`,
    actorId: input.actor?.id,
    actorName: input.actor?.name,
  })

  return {
    store: working,
    result: {
      ok: true,
      wipIssueDocumentId: working.documents.find((d) => d.idempotencyKey === `${report.idempotencyKey}::wip`)?.id,
      packMaterialIssueDocumentId: working.documents.find((d) => d.idempotencyKey === `${report.idempotencyKey}::pack`)?.id,
      fgReceiptDocumentId: fgReceipt.result.documentId,
      documentIds,
    },
  }
}

export function reversePackagingReportWarehouseEffects(
  store: WarehouseStore,
  reportIdempotencyKey: string,
  actor?: { id?: string; name?: string },
  transactionGroupId?: string,
): { store: WarehouseStore; documentIds: string[] } {
  let working = store
  const documentIds: string[] = []
  for (const documentId of existingPackagingDocumentIds(store, reportIdempotencyKey)) {
    const out = cancelWarehouseDocument(working, documentId, {
      cancelledBy: actor?.id,
      cancelledByName: actor?.name,
      transactionGroupId,
    })
    if (!out.result.ok) continue
    working = out.store
    documentIds.push(...(out.result.ok ? out.result.reversalIds : [documentId]))
  }
  return { store: working, documentIds }
}
