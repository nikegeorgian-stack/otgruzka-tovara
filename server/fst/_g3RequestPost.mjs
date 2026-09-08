/**
 * R2.9L — pure G3 production.request.post apply (warehouse + production CAS payload).
 * Shared by server gateway and unit tests. No Data Connect I/O.
 *
 * Completion contract (impregnation / non-pack):
 *   durable consume issue(s) + WIP receipt + shiftReport + wipBatch
 * Pack line additionally creates one FinishedGoodsLot (qc pending) + FG receipt.
 * Soft request.status=posted is owned by the client ONLY after this apply succeeds.
 */
import { isPeriodClosed, nextServerDocumentNumber } from './_g1CriticalHelpers.mjs'

function ok(data = {}) {
  return { ok: true, ...data }
}

function fail(error, status = 400, extra = {}) {
  return { ok: false, error, status, ...extra }
}

function balanceAt(warehouse, warehouseId, itemId) {
  let bal = 0
  for (const m of warehouse.movements ?? []) {
    if (m.itemId !== itemId) continue
    if (m.warehouseId !== warehouseId) continue
    const q = Math.abs(Number(m.quantity) || 0)
    if (m.type === 'receipt' || m.type === 'in') bal += q
    else if (m.type === 'issue' || m.type === 'out') bal -= q
    else bal += Number(m.quantity) || 0
  }
  return bal
}

function resolveLineBinding(warehouse, lineId) {
  const b = (warehouse.productionLineBindings ?? []).find(
    (x) => x.lineId === lineId || x.id === lineId,
  )
  if (!b?.productionWarehouseId || !b?.productionLocationId) {
    return { ok: false, error: 'line_location_not_configured' }
  }
  return {
    ok: true,
    productionWarehouseId: b.productionWarehouseId,
    productionLocationId: b.productionLocationId,
  }
}

function docsForRequest(warehouse, requestId) {
  return (warehouse.documents ?? []).filter(
    (d) => d.productionRequestId === requestId && d.status === 'posted',
  )
}

function hasWipReceipt(docs) {
  return docs.some(
    (d) =>
      d.type === 'receipt' &&
      (d.docRole === 'wip_receipt' ||
        d.docRole === 'production_wip_receipt' ||
        d.purpose === 'production_receipt' ||
        d.purpose === 'production_wip_receipt'),
  )
}

function hasConsumeIssue(docs) {
  return docs.some((d) => d.type === 'issue' && d.purpose === 'production_issue')
}

function hasFgReceipt(docs) {
  return docs.some(
    (d) =>
      d.type === 'receipt' &&
      (d.docRole === 'pack_receipt' || d.docRole === 'fg_receipt' || d.purpose === 'production_receipt') &&
      d.isWip !== true &&
      d.docRole !== 'wip_receipt' &&
      d.docRole !== 'production_wip_receipt',
  )
}

function appendAudit(production, entry) {
  return {
    ...production,
    auditLog: [...(production.auditLog ?? []), entry],
  }
}

/**
 * @param {object} production critical production domain
 * @param {object} warehouse critical warehouse domain
 * @param {object} command
 * @param {{ uid: string, email?: string }} actor
 * @param {string} now ISO
 */
export function applyProductionRequestPost(production, warehouse, command, actor, now) {
  const requestId = String(command.requestId ?? '').trim()
  const lineId = String(command.lineId ?? '').trim()
  const orderId = String(command.orderId ?? '').trim()
  const date = String(command.shiftDate ?? now).slice(0, 10)
  const shiftSlot = String(command.shiftSlot ?? 'day')
  const outputMp = Number(command.outputMp)
  const outputRolls = Number(command.outputRolls) || 0
  const isPack = lineId === 'pack'
  const consumeLines = Array.isArray(command.consumeLines) ? command.consumeLines : []

  if (!requestId || !lineId || !orderId) return fail('invalid_input', 400)
  if (!Number.isFinite(outputMp) || outputMp <= 0) return fail('invalid_output', 400)
  if (isPeriodClosed(warehouse, date)) return fail('period_closed', 403)

  const orderFromCritical = (production.orders ?? []).find((o) => o.id === orderId)
  const orderSnap =
    command.orderSnapshot && String(command.orderSnapshot.id ?? '') === orderId
      ? command.orderSnapshot
      : null
  const order = orderFromCritical || orderSnap
  if (!order) return fail('order_not_found', 404)

  let binding = resolveLineBinding(warehouse, lineId)
  if (!binding.ok) {
    const whId = String(command.productionWarehouseId ?? '').trim()
    const locId = String(command.productionLocationId ?? whId).trim()
    if (whId && locId) {
      binding = { ok: true, productionWarehouseId: whId, productionLocationId: locId }
    }
  }
  if (!binding.ok) return fail(binding.error || 'line_location_not_configured', 400)

  const packLocationId = String(
    command.packLocationId ?? binding.productionLocationId,
  ).trim()
  const semiFinishedItemId = String(
    command.semiFinishedItemId ?? order.semiFinishedItemId ?? order.finishedProductId ?? '',
  ).trim()
  const warehouseItemId = String(
    command.warehouseItemId ?? semiFinishedItemId,
  ).trim()
  const finishedProductId = String(
    command.finishedProductId ?? order.finishedProductId ?? '',
  ).trim()

  if (!semiFinishedItemId && !isPack) return fail('semi_finished_required', 400)
  if (isPack && !warehouseItemId) return fail('fg_item_required', 400)

  const reportId = `sr-reqpost-${requestId}`
  const wipBatchId = `wip-reqpost-${requestId}`
  const lotId = `lot-reqpost-${requestId}`
  const receiptDocId = `wh-doc-reqpost-${requestId}-wip`
  const fgDocId = `wh-doc-reqpost-${requestId}-fg`

  const existingDocs = docsForRequest(warehouse, requestId)
  const existingWip = (production.wipBatches ?? []).find(
    (b) => b.productionRequestId === requestId || b.id === wipBatchId,
  )
  const existingReport = (production.shiftReports ?? []).find(
    (r) => r.productionRequestId === requestId || r.id === reportId,
  )
  const existingLot = (production.finishedGoodsLots ?? []).find(
    (l) => l.productionRequestId === requestId || l.id === lotId,
  )

  const wipOk = hasWipReceipt(existingDocs) || Boolean(existingWip)
  const consumeOk =
    consumeLines.length === 0 ? true : hasConsumeIssue(existingDocs) || consumeLines.every((line) => {
      const wid = String(line.warehouseId ?? '').trim()
      return existingDocs.some(
        (d) =>
          d.type === 'issue' &&
          d.purpose === 'production_issue' &&
          d.warehouseId === wid &&
          d.productionRequestId === requestId,
      )
    })
  const fgOk = !isPack || Boolean(existingLot) || hasFgReceipt(existingDocs)

  if (wipOk && consumeOk && fgOk && existingReport && existingWip && (!isPack || existingLot)) {
    return ok({
      production,
      warehouse,
      result: {
        requestId,
        status: 'posted',
        idempotent: true,
        reportId: existingReport.id,
        wipBatchId: existingWip.id,
        documentIds: existingDocs.map((d) => d.id),
        finishedGoodsLotId: existingLot?.id,
      },
    })
  }

  // Stock check for missing consume issues only
  let wh = warehouse
  const shortages = []
  for (const raw of consumeLines) {
    const itemId = String(raw.itemId ?? '').trim()
    const warehouseId = String(raw.warehouseId ?? '').trim()
    const qty = Number(raw.quantity)
    if (!itemId || !warehouseId || !(qty > 0)) continue
    const issueId = `wh-doc-reqpost-${requestId}-issue-${warehouseId}`
    if ((wh.documents ?? []).some((d) => d.id === issueId && d.status === 'posted')) continue
    const avail = balanceAt(wh, warehouseId, itemId)
    if (qty > avail + 1e-9) {
      shortages.push({ itemId, warehouseId, available: avail, requested: qty })
    }
  }
  if (shortages.length) {
    return fail('insufficient_stock', 400, { shortages })
  }

  const documentIds = []

  // Consume issues (grouped by warehouse already from client)
  const byWh = new Map()
  for (const raw of consumeLines) {
    const itemId = String(raw.itemId ?? '').trim()
    const warehouseId = String(raw.warehouseId ?? '').trim()
    const qty = Number(raw.quantity)
    if (!itemId || !warehouseId || !(qty > 0)) continue
    if (!byWh.has(warehouseId)) byWh.set(warehouseId, [])
    byWh.get(warehouseId).push({ itemId, quantity: qty })
  }

  for (const [warehouseId, lines] of byWh) {
    const issueId = `wh-doc-reqpost-${requestId}-issue-${warehouseId}`
    if ((wh.documents ?? []).some((d) => d.id === issueId && d.status === 'posted')) {
      documentIds.push(issueId)
      continue
    }
    const number = nextServerDocumentNumber(wh.documents, 'issue', warehouseId, date)
    const doc = {
      id: issueId,
      type: 'issue',
      purpose: 'production_issue',
      docRole: 'production_issue',
      warehouseId,
      date,
      number: `${number}-REQ`,
      lines: lines.map((l) => ({
        lineId: `ln-${issueId}-${l.itemId}`,
        itemId: l.itemId,
        quantity: l.quantity,
      })),
      status: 'posted',
      productionRequestId: requestId,
      productionOrderId: orderId,
      productionLineId: lineId,
      shiftReportId: reportId,
      postedAt: now,
      postedBy: actor.uid,
      postedByName: actor.email ?? actor.uid,
      createdAt: now,
      idempotencyKey: `productionRequest::${requestId}::production_issue::${warehouseId}`,
    }
    const movements = doc.lines.map((l) => ({
      id: `mov-${doc.id}-${l.itemId}`,
      documentId: doc.id,
      documentLineId: l.lineId,
      warehouseId,
      itemId: l.itemId,
      quantity: l.quantity,
      type: 'issue',
      at: now,
      date,
      actorUid: actor.uid,
      productionRequestId: requestId,
      productionOrderId: orderId,
      shiftReportId: reportId,
    }))
    wh = {
      ...wh,
      documents: [...(wh.documents ?? []), doc],
      movements: [...(wh.movements ?? []), ...movements],
    }
    documentIds.push(doc.id)
  }

  // WIP receipt (impregnation and pack both need WIP side for packaging chain;
  // pack additionally posts FG below)
  if (!(wh.documents ?? []).some((d) => d.id === receiptDocId && d.status === 'posted')) {
    const number = nextServerDocumentNumber(
      wh.documents,
      'receipt',
      binding.productionWarehouseId,
      date,
    )
    const itemId = isPack ? semiFinishedItemId || warehouseItemId : warehouseItemId || semiFinishedItemId
    const doc = {
      id: receiptDocId,
      type: 'receipt',
      purpose: 'production_receipt',
      docRole: 'wip_receipt',
      warehouseId: binding.productionWarehouseId,
      date,
      number: `${number}-WIP`,
      lines: [
        {
          lineId: `ln-${receiptDocId}-1`,
          itemId,
          quantity: outputMp,
          locationId: packLocationId,
          batchNo: wipBatchId,
        },
      ],
      status: 'posted',
      productionRequestId: requestId,
      productionOrderId: orderId,
      productionLineId: lineId,
      shiftReportId: reportId,
      postedAt: now,
      postedBy: actor.uid,
      postedByName: actor.email ?? actor.uid,
      createdAt: now,
      isWip: true,
      idempotencyKey: `productionRequest::${requestId}::production_receipt::${binding.productionWarehouseId}`,
    }
    const movements = [
      {
        id: `mov-${receiptDocId}-1`,
        documentId: doc.id,
        documentLineId: doc.lines[0].lineId,
        warehouseId: binding.productionWarehouseId,
        locationId: packLocationId,
        itemId,
        quantity: outputMp,
        type: 'receipt',
        at: now,
        date,
        actorUid: actor.uid,
        batchNo: wipBatchId,
        productionRequestId: requestId,
        productionOrderId: orderId,
        shiftReportId: reportId,
        isWip: true,
      },
    ]
    wh = {
      ...wh,
      documents: [...(wh.documents ?? []), doc],
      movements: [...(wh.movements ?? []), ...movements],
    }
    documentIds.push(doc.id)
  } else {
    documentIds.push(receiptDocId)
  }

  let prod = { ...production }
  const reports = [...(prod.shiftReports ?? [])]
  if (!reports.some((r) => r.id === reportId)) {
    reports.push({
      id: reportId,
      idempotencyKey: `prod-req-post:${requestId}`,
      status: 'confirmed',
      orderId,
      productionOrderId: orderId,
      productionRequestId: requestId,
      lineId,
      shiftDate: date,
      shiftSlot,
      outputMp,
      outputRolls,
      wipBatchId,
      semiFinishedItemId: semiFinishedItemId || warehouseItemId,
      packLocationId,
      confirmedAt: now,
      confirmedBy: actor.uid,
      confirmedByName: actor.email ?? actor.uid,
      createdAt: now,
      source: 'production.request.post',
    })
  }
  prod.shiftReports = reports

  const batches = [...(prod.wipBatches ?? [])]
  if (!batches.some((b) => b.id === wipBatchId)) {
    batches.push({
      id: wipBatchId,
      orderId,
      productionOrderId: orderId,
      productionRequestId: requestId,
      shiftReportId: reportId,
      lineId,
      itemId: semiFinishedItemId || warehouseItemId,
      quantityMp: outputMp,
      rolls: outputRolls,
      locationId: packLocationId,
      isFinishedGoods: false,
      createdAt: now,
    })
  }
  prod.wipBatches = batches

  let finishedGoodsLotId
  if (isPack) {
    if (!(wh.documents ?? []).some((d) => d.id === fgDocId && d.status === 'posted')) {
      const finWh = String(command.fgWarehouseId ?? binding.productionWarehouseId).trim()
      const finLoc = String(command.fgLocationId ?? packLocationId).trim()
      const number = nextServerDocumentNumber(wh.documents, 'receipt', finWh, date)
      const doc = {
        id: fgDocId,
        type: 'receipt',
        purpose: 'production_receipt',
        docRole: 'fg_receipt',
        warehouseId: finWh,
        date,
        number: `${number}-FG`,
        lines: [
          {
            lineId: `ln-${fgDocId}-1`,
            itemId: warehouseItemId,
            quantity: outputMp,
            locationId: finLoc,
            batchNo: lotId,
          },
        ],
        status: 'posted',
        productionRequestId: requestId,
        productionOrderId: orderId,
        productionLineId: lineId,
        shiftReportId: reportId,
        postedAt: now,
        postedBy: actor.uid,
        postedByName: actor.email ?? actor.uid,
        createdAt: now,
        idempotencyKey: `productionRequest::${requestId}::pack_receipt::${finWh}`,
      }
      const movements = [
        {
          id: `mov-${fgDocId}-1`,
          documentId: doc.id,
          documentLineId: doc.lines[0].lineId,
          warehouseId: finWh,
          locationId: finLoc,
          itemId: warehouseItemId,
          quantity: outputMp,
          type: 'receipt',
          at: now,
          date,
          actorUid: actor.uid,
          batchNo: lotId,
          productionRequestId: requestId,
          productionOrderId: orderId,
          shiftReportId: reportId,
        },
      ]
      wh = {
        ...wh,
        documents: [...(wh.documents ?? []), doc],
        movements: [...(wh.movements ?? []), ...movements],
      }
      documentIds.push(doc.id)
    } else {
      documentIds.push(fgDocId)
    }

    const lots = [...(prod.finishedGoodsLots ?? [])]
    if (!lots.some((l) => l.id === lotId)) {
      lots.push({
        id: lotId,
        warehouseItemId,
        finishedProductId: finishedProductId || warehouseItemId,
        batchNo: lotId,
        productionOrderId: orderId,
        productionRequestId: requestId,
        packagingReportId: `pack-reqpost-${requestId}`,
        sourceShiftReportIds: [reportId],
        outputM2: outputMp,
        rollCount: outputRolls,
        palletCount: 0,
        packagingDate: date,
        productionDate: date,
        warehouseId: String(command.fgWarehouseId ?? binding.productionWarehouseId),
        locationId: String(command.fgLocationId ?? packLocationId),
        qcStatus: 'pending',
        quantityProduced: outputMp,
        quantityQcReleased: 0,
        quantityShipped: 0,
        quantityRemaining: 0,
        fgReceiptDocumentId: fgDocId,
        createdAt: now,
        updatedAt: now,
        transactionGroupId: `prod-req-post:${requestId}`,
      })
    }
    prod.finishedGoodsLots = lots
    finishedGoodsLotId = lotId
  }

  // Dedupe documentIds
  const uniqueDocIds = [...new Set(documentIds)]

  prod = appendAudit(prod, {
    id: `aud-reqpost-${requestId}`,
    at: now,
    action: 'production_request_post',
    actorUid: actor.uid,
    detail: `request ${requestId} docs=${uniqueDocIds.length} wip=${wipBatchId}`,
  })

  return ok({
    production: prod,
    warehouse: wh,
    result: {
      requestId,
      status: 'posted',
      reportId,
      wipBatchId,
      documentIds: uniqueDocIds,
      finishedGoodsLotId,
      g4QcEntry: Boolean(finishedGoodsLotId),
    },
  })
}

export function normalizeRequestPostIdempotencyKey(requestId, provided) {
  const rid = String(requestId ?? '').trim()
  const canonical = `prod-req-post:${rid}`
  const raw = String(provided ?? '').trim()
  if (!rid) return raw
  if (!raw || raw === rid || raw.endsWith(rid)) return canonical
  return canonical
}
