/**
 * PHASE P1B — warehouse documents for shift confirmation:
 * consumption issue, WIP (semi-finished) receipt, waste transfer.
 */
import { isWarehouseAccountingActive, WAREHOUSE_NOT_INITIALIZED } from './accountingStatus'
import { appendWarehouseAudit } from './audit'
import { postWarehouseDocument, postWarehouseTransfer } from './documents'
import type { ProductionShiftReport } from '@/lib/production/shiftReports'
import type { WarehouseDocument, WarehouseDocumentLine, WarehouseStore } from './types'

export type ShiftConfirmWarehouseResult = {
  ok: boolean
  error?: string
  consumptionDocumentId?: string
  wipReceiptDocumentId?: string
  wasteTransferPairId?: string
  documentIds?: string[]
}

export type PostShiftEffectsInput = {
  report: ProductionShiftReport
  actor?: { id?: string; name?: string }
  transactionGroupId: string
}

/**
 * Canonical post: processConsumed issue + waste transfer + WIP receipt.
 * Total removed from line = processConsumedQty + wasteQty = actualInputQty (no double write).
 */
export function postShiftReportWarehouseEffects(
  store: WarehouseStore,
  input: PostShiftEffectsInput,
): { store: WarehouseStore; result: ShiftConfirmWarehouseResult } {
  const { report } = input
  const groupId = input.transactionGroupId
  const date = report.shiftDate
  const now = report.confirmedAt ?? new Date().toISOString()

  if (!isWarehouseAccountingActive(store, report.productionLocationId)) {
    return { store, result: { ok: false, error: WAREHOUSE_NOT_INITIALIZED } }
  }
  if (!isWarehouseAccountingActive(store, report.packagingLocationId)) {
    return { store, result: { ok: false, error: WAREHOUSE_NOT_INITIALIZED } }
  }
  if (!isWarehouseAccountingActive(store, report.scrapLocationId)) {
    return { store, result: { ok: false, error: WAREHOUSE_NOT_INITIALIZED } }
  }

  const semiItem = store.items.find((i) => i.id === report.semiFinishedItemId)
  if (!semiItem) {
    return { store, result: { ok: false, error: 'production.shift.errSemiItem' } }
  }

  // Idempotent short-circuit
  const existingCons = store.documents.find(
    (d) =>
      d.idempotencyKey === `${report.idempotencyKey}::consumption` && d.status !== 'cancelled',
  )
  if (existingCons) {
    return {
      store,
      result: {
        ok: true,
        consumptionDocumentId: existingCons.id,
        wipReceiptDocumentId: store.documents.find(
          (d) => d.idempotencyKey === `${report.idempotencyKey}::wip`,
        )?.id,
        wasteTransferPairId: store.documents.find(
          (d) => d.idempotencyKey === `${report.idempotencyKey}::waste::issue`,
        )?.transferPairId,
      },
    }
  }

  let working = store
  const documentIds: string[] = []

  // Consumption = full actualInputQty removed from line once (spec: actualInputQty)
  // Waste is then a transfer of wasteQty — but stock already reduced by full actualInput.
  // Spec clarification: "Не допустить двойного списания wasteQty"
  // and "actualInputQty = общее количество снятое с линии" and waste moved to scrap.
  // Interpretation matching both:
  //   issue processConsumedQty as production_consumption
  //   transfer wasteQty line → scrap
  // Total removed from line = processConsumed + waste = actualInputQty. No double write.

  const consumptionLines: WarehouseDocumentLine[] = report.materialLines
    .filter((l) => l.processConsumedQty > 0)
    .map((l) => ({
      lineId: l.lineId,
      itemId: l.itemId,
      quantity: l.processConsumedQty,
      issuedQty: l.actualInputQty,
      itemCodeSnapshot: l.itemCodeSnapshot,
      itemNameSnapshot: l.itemNameSnapshot,
      unitSnapshot: l.unitSnapshot,
      batchNo: l.batchNo,
      expiryDate: l.expiryDate,
      batchOverrideReason: l.batchOverrideReason,
      comment: [
        `Вход ${l.actualInputQty}`,
        `Расход ${l.processConsumedQty}`,
        `Отход ${l.wasteQty}`,
        `Норма ${l.normQty}`,
        l.deviationReason ? `Откл: ${l.deviationReason}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
    }))

  let consumptionDocumentId: string | undefined
  if (consumptionLines.length) {
    const cons = postWarehouseDocument(working, {
      type: 'issue',
      number: `РС-${report.number}`,
      date,
      documentDateTime: now,
      warehouseId: report.productionLocationId,
      purpose: 'production_consumption',
      docRole: 'production_consumption',
      productionOrderId: report.productionOrderId,
      productionLineId: report.lineId,
      shiftReportId: report.id,
      basisType: 'production_shift_report',
      basisId: report.id,
      basisNumber: report.number,
      comment: `Фактический расход · ${report.number}`,
      lines: consumptionLines,
      transactionGroupId: groupId,
      idempotencyKey: `${report.idempotencyKey}::consumption`,
      status: 'posted',
      postedAt: now,
      postedBy: input.actor?.id,
      postedByName: input.actor?.name,
      createdBy: input.actor?.id,
      createdByName: input.actor?.name,
    })
    if (!cons.result.ok) {
      return { store, result: { ok: false, error: cons.result.error } }
    }
    const consDocId = cons.result.documentId
    working = cons.store
    // Tag movements with shiftReportId / productionOrderId
    working = {
      ...working,
      movements: working.movements.map((m) =>
        m.documentId === consDocId
          ? {
              ...m,
              productionOrderId: report.productionOrderId,
              shiftReportId: report.id,
              transactionGroupId: groupId,
            }
          : m,
      ),
    }
    consumptionDocumentId = consDocId
    documentIds.push(consDocId)
  }

  // Waste transfer pairs (per distinct batches aggregated)
  let wasteTransferPairId: string | undefined
  const wasteByKey = new Map<string, { itemId: string; qty: number; batchNo?: string; expiryDate?: string; unit: string; reason: string }>()
  for (const w of report.wasteLines) {
    if (w.quantity <= 0) continue
    const key = `${w.itemId}::${w.batchNo ?? ''}::${w.expiryDate ?? ''}`
    const cur = wasteByKey.get(key)
    if (cur) cur.qty += w.quantity
    else {
      wasteByKey.set(key, {
        itemId: w.itemId,
        qty: w.quantity,
        batchNo: w.batchNo,
        expiryDate: w.expiryDate,
        unit: w.unitSnapshot,
        reason: [w.reasonCode, w.comment].filter(Boolean).join(' · '),
      })
    }
  }

  if (wasteByKey.size) {
    const wasteLines: WarehouseDocumentLine[] = [...wasteByKey.values()].map((w) => {
      const item = working.items.find((i) => i.id === w.itemId)
      return {
        lineId: crypto.randomUUID(),
        itemId: w.itemId,
        quantity: w.qty,
        itemCodeSnapshot: item?.internalCode,
        itemNameSnapshot: item?.name,
        unitSnapshot: w.unit || item?.unit || 'kg',
        batchNo: w.batchNo,
        expiryDate: w.expiryDate,
        comment: w.reason,
        sourceLocationId: report.productionLocationId,
        destinationLocationId: report.scrapLocationId,
      }
    })
    const xfer = postWarehouseTransfer(working, {
      number: `ОТ-${report.number}`,
      date,
      documentDateTime: now,
      warehouseId: report.productionLocationId,
      targetWarehouseId: report.scrapLocationId,
      sourceWarehouseId: report.productionLocationId,
      destinationWarehouseId: report.scrapLocationId,
      purpose: 'production_waste_transfer',
      docRole: 'production_waste_issue',
      productionOrderId: report.productionOrderId,
      productionLineId: report.lineId,
      shiftReportId: report.id,
      returnReason: [...wasteByKey.values()].map((w) => w.reason).join('; '),
      basisType: 'production_shift_report',
      basisId: report.id,
      basisNumber: report.number,
      comment: `Отходы производства · ${report.number}`,
      lines: wasteLines,
      transactionGroupId: groupId,
      idempotencyKey: `${report.idempotencyKey}::waste`,
      status: 'posted',
      postedAt: now,
      postedBy: input.actor?.id,
      postedByName: input.actor?.name,
      createdBy: input.actor?.id,
      createdByName: input.actor?.name,
    })
    if (!xfer.result.ok) {
      return { store, result: { ok: false, error: xfer.result.error } }
    }
    working = xfer.store
    const xferDocId = xfer.result.documentId
    const pairId = working.documents.find((d) => d.id === xferDocId)?.transferPairId
    wasteTransferPairId = pairId
    if (pairId) {
      working = {
        ...working,
        documents: working.documents.map((d) => {
          if (d.transferPairId !== pairId) return d
          return {
            ...d,
            purpose: 'production_waste_transfer' as const,
            docRole:
              d.type === 'issue'
                ? ('production_waste_issue' as const)
                : ('production_waste_receipt' as const),
            shiftReportId: report.id,
            productionOrderId: report.productionOrderId,
            productionLineId: report.lineId,
            transactionGroupId: groupId,
          }
        }),
        movements: working.movements.map((m) => {
          const doc = working.documents.find((d) => d.id === m.documentId)
          if (!doc || doc.transferPairId !== pairId) return m
          return {
            ...m,
            productionOrderId: report.productionOrderId,
            shiftReportId: report.id,
            transactionGroupId: groupId,
          }
        }),
      }
      documentIds.push(
        ...working.documents.filter((d) => d.transferPairId === pairId).map((d) => d.id),
      )
    }
  }

  // WIP receipt at packaging location (m²)
  const wip = postWarehouseDocument(working, {
    type: 'receipt',
    number: `ПФ-${report.number}`,
    date,
    documentDateTime: now,
    warehouseId: report.packagingLocationId,
    purpose: 'production_wip_receipt',
    docRole: 'production_wip_receipt',
    productionOrderId: report.productionOrderId,
    productionLineId: report.lineId,
    shiftReportId: report.id,
    basisType: 'production_shift_report',
    basisId: report.id,
    basisNumber: report.number,
    comment: `Полуфабрикат · ${report.outputM2} м² · ${report.rollCount} рул. · ${report.number}`,
    lines: [
      {
        lineId: crypto.randomUUID(),
        itemId: report.semiFinishedItemId,
        quantity: report.outputM2,
        itemCodeSnapshot: semiItem.internalCode,
        itemNameSnapshot: semiItem.name,
        unitSnapshot: semiItem.unit || 'm2',
        comment: `rolls=${report.rollCount};m2PerRoll=${report.m2PerRollSnapshot ?? ''}`,
      },
    ],
    transactionGroupId: groupId,
    idempotencyKey: `${report.idempotencyKey}::wip`,
    status: 'posted',
    postedAt: now,
    postedBy: input.actor?.id,
    postedByName: input.actor?.name,
    createdBy: input.actor?.id,
    createdByName: input.actor?.name,
  })
  if (!wip.result.ok) {
    return { store, result: { ok: false, error: wip.result.error } }
  }
  const wipDocId = wip.result.documentId
  working = wip.store
  working = {
    ...working,
    movements: working.movements.map((m) =>
      m.documentId === wipDocId
        ? {
            ...m,
            productionOrderId: report.productionOrderId,
            shiftReportId: report.id,
            transactionGroupId: groupId,
          }
        : m,
    ),
  }
  documentIds.push(wipDocId)

  working = appendWarehouseAudit(working, {
    action: 'document_post',
    detail: `Сменный отчёт ${report.number} · расход/ПФ/отходы`,
    actorId: input.actor?.id,
    actorName: input.actor?.name,
  })

  return {
    store: working,
    result: {
      ok: true,
      consumptionDocumentId,
      wipReceiptDocumentId: wipDocId,
      wasteTransferPairId,
      documentIds,
    },
  }
}

export function isProductionShiftWarehouseDoc(
  doc: Pick<WarehouseDocument, 'purpose' | 'docRole' | 'shiftReportId'>,
): boolean {
  return (
    Boolean(doc.shiftReportId) ||
    doc.purpose === 'production_consumption' ||
    doc.purpose === 'production_wip_receipt' ||
    doc.purpose === 'production_waste_transfer' ||
    doc.docRole === 'production_consumption' ||
    doc.docRole === 'production_wip_receipt' ||
    doc.docRole === 'production_waste_issue' ||
    doc.docRole === 'production_waste_receipt'
  )
}

/** Reversal docs for correction addendum — originals stay posted and linked. */
export function postShiftReportCorrectionReversals(
  store: WarehouseStore,
  input: {
    original: ProductionShiftReport
    actor?: { id?: string; name?: string }
    reason: string
    transactionGroupId: string
  },
): { store: WarehouseStore; result: ShiftConfirmWarehouseResult } {
  const { original } = input
  const groupId = input.transactionGroupId
  const date = original.shiftDate
  const now = new Date().toISOString()
  let working = store
  const documentIds: string[] = []

  if (original.consumptionDocumentId) {
    const cons = working.documents.find((d) => d.id === original.consumptionDocumentId)
    if (cons && cons.status === 'posted') {
      const rev = postWarehouseDocument(working, {
        type: 'receipt',
        number: `СТ-${cons.number}`,
        date,
        documentDateTime: now,
        warehouseId: cons.warehouseId,
        purpose: 'production_consumption',
        docRole: 'production_consumption',
        productionOrderId: original.productionOrderId,
        productionLineId: original.lineId,
        shiftReportId: original.id,
        reversesDocumentId: cons.id,
        basisType: 'production_shift_report_correction',
        basisId: original.id,
        basisNumber: original.number,
        comment: `Сторно расхода · ${original.number} · ${input.reason}`,
        lines: cons.lines.map((l) => ({
          ...l,
          lineId: crypto.randomUUID(),
          quantity: l.quantity,
        })),
        transactionGroupId: groupId,
        idempotencyKey: `${original.idempotencyKey}::corr-rev-consumption`,
        status: 'posted',
        postedAt: now,
        postedBy: input.actor?.id,
        postedByName: input.actor?.name,
        createdBy: input.actor?.id,
        createdByName: input.actor?.name,
      })
      if (!rev.result.ok) return { store, result: { ok: false, error: rev.result.error } }
      const revDocId = rev.result.documentId
      working = rev.store
      documentIds.push(revDocId)
      working = {
        ...working,
        documents: working.documents.map((d) =>
          d.id === cons.id ? { ...d, reversalDocumentId: revDocId } : d,
        ),
        movements: working.movements.map((m) =>
          m.documentId === revDocId
            ? {
                ...m,
                productionOrderId: original.productionOrderId,
                shiftReportId: original.id,
                transactionGroupId: groupId,
              }
            : m,
        ),
      }
    }
  }

  if (original.wasteTransferPairId) {
    const pairDocs = working.documents.filter(
      (d) => d.transferPairId === original.wasteTransferPairId && d.status === 'posted',
    )
    const issue = pairDocs.find((d) => d.type === 'issue')
    const receipt = pairDocs.find((d) => d.type === 'receipt')
    if (issue && receipt) {
      // Reverse: scrap → line (transfer back)
      const xfer = postWarehouseTransfer(working, {
        number: `СТ-ОТ-${original.number}`,
        date,
        documentDateTime: now,
        warehouseId: original.scrapLocationId,
        targetWarehouseId: original.productionLocationId,
        sourceWarehouseId: original.scrapLocationId,
        destinationWarehouseId: original.productionLocationId,
        purpose: 'production_waste_transfer',
        docRole: 'production_waste_issue',
        productionOrderId: original.productionOrderId,
        productionLineId: original.lineId,
        shiftReportId: original.id,
        returnReason: input.reason,
        basisType: 'production_shift_report_correction',
        basisId: original.id,
        basisNumber: original.number,
        comment: `Сторно отходов · ${original.number} · ${input.reason}`,
        lines: issue.lines.map((l) => ({
          ...l,
          lineId: crypto.randomUUID(),
          sourceLocationId: original.scrapLocationId,
          destinationLocationId: original.productionLocationId,
        })),
        transactionGroupId: groupId,
        idempotencyKey: `${original.idempotencyKey}::corr-rev-waste`,
        status: 'posted',
        postedAt: now,
        postedBy: input.actor?.id,
        postedByName: input.actor?.name,
        createdBy: input.actor?.id,
        createdByName: input.actor?.name,
      })
      if (!xfer.result.ok) return { store, result: { ok: false, error: xfer.result.error } }
      working = xfer.store
      documentIds.push(xfer.result.documentId)
    }
  }

  if (original.wipReceiptDocumentId) {
    const wip = working.documents.find((d) => d.id === original.wipReceiptDocumentId)
    if (wip && wip.status === 'posted') {
      const rev = postWarehouseDocument(working, {
        type: 'issue',
        number: `СТ-${wip.number}`,
        date,
        documentDateTime: now,
        warehouseId: wip.warehouseId,
        purpose: 'production_wip_receipt',
        docRole: 'production_wip_receipt',
        productionOrderId: original.productionOrderId,
        productionLineId: original.lineId,
        shiftReportId: original.id,
        reversesDocumentId: wip.id,
        basisType: 'production_shift_report_correction',
        basisId: original.id,
        basisNumber: original.number,
        comment: `Сторно ПФ · ${original.number} · ${input.reason}`,
        lines: wip.lines.map((l) => ({ ...l, lineId: crypto.randomUUID() })),
        transactionGroupId: groupId,
        idempotencyKey: `${original.idempotencyKey}::corr-rev-wip`,
        status: 'posted',
        postedAt: now,
        postedBy: input.actor?.id,
        postedByName: input.actor?.name,
        createdBy: input.actor?.id,
        createdByName: input.actor?.name,
      })
      if (!rev.result.ok) return { store, result: { ok: false, error: rev.result.error } }
      const revDocId = rev.result.documentId
      working = rev.store
      documentIds.push(revDocId)
      working = {
        ...working,
        documents: working.documents.map((d) =>
          d.id === wip.id ? { ...d, reversalDocumentId: revDocId } : d,
        ),
        movements: working.movements.map((m) =>
          m.documentId === revDocId
            ? {
                ...m,
                productionOrderId: original.productionOrderId,
                shiftReportId: original.id,
                transactionGroupId: groupId,
              }
            : m,
        ),
      }
    }
  }

  working = appendWarehouseAudit(working, {
    action: 'document_post',
    detail: `Исправление сменного отчёта ${original.number} · ${input.reason}`,
    actorId: input.actor?.id,
    actorName: input.actor?.name,
  })

  return {
    store: working,
    result: { ok: true, documentIds },
  }
}
