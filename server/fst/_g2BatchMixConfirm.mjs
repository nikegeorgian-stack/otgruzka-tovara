/**
 * R2.9I — pure critical-path batch mix confirm (issue + receipt) for G2 CAS.
 * Shared by server command handler and unit tests (no Data Connect I/O).
 */
import {
  isPeriodClosed,
  sanitizeDocumentLines,
} from './_g1CriticalHelpers.mjs'
import {
  allocateIssueLineBatches,
  buildBatchLotsFromMovements,
  ordinaryAvailableQty,
} from './_g2BatchAllocation.mjs'

function ok(data = {}) {
  return { ok: true, ...data }
}

function fail(error, status = 400, extra = {}) {
  return { ok: false, error, status, ...extra }
}

function appendAudit(warehouse, entry) {
  return {
    ...warehouse,
    auditLog: [...(warehouse.auditLog ?? []), entry],
  }
}

function itemRequiresKnownLot(warehouse, itemId, warehouseId) {
  const lots = buildBatchLotsFromMovements(warehouse.movements, { itemId, warehouseId })
  return lots.some((l) => l.batchNo && l.physical > 1e-9)
}

function checkIssueStock(warehouse, warehouseId, lines) {
  let working = [...(warehouse.movements ?? [])]
  for (const line of lines) {
    const available = ordinaryAvailableQty(working, line.itemId, warehouseId)
    if (line.quantity > available + 1e-9) {
      return {
        ok: false,
        error: 'insufficient_stock',
        shortages: [{ itemId: line.itemId, available, requested: line.quantity }],
      }
    }
    // Simulate draw so multi-line checks see prior consumption.
    working = [
      ...working,
      {
        id: `dry-${crypto.randomUUID()}`,
        type: 'issue',
        itemId: line.itemId,
        quantity: line.quantity,
        warehouseId,
        documentId: 'dry-run',
        at: new Date().toISOString(),
        date: String(new Date().toISOString()).slice(0, 10),
      },
    ]
  }
  return { ok: true }
}

function buildIssueMovements(doc, warehouse, now, actorUid) {
  const out = []
  let workingMovements = [...(warehouse?.movements ?? [])]
  for (const line of doc.lines ?? []) {
    const requireKnownLot = itemRequiresKnownLot(
      { movements: workingMovements },
      line.itemId,
      doc.warehouseId,
    )
    const alloc = allocateIssueLineBatches({
      movements: workingMovements,
      itemId: line.itemId,
      warehouseId: doc.warehouseId,
      locationId: line.locationId,
      quantity: Number(line.quantity),
      manualBatchNo: line.batchNo,
      manualExpiryDate: line.expiryDate,
      manualOverrideReason: line.batchOverrideReason,
      requireKnownLot,
      allowExpired: false,
      today: String(doc.date ?? now).slice(0, 10),
    })
    if (!alloc.ok) {
      return { ok: false, error: alloc.error, shortages: [{ itemId: line.itemId, shortfall: alloc.shortfall }] }
    }
    for (const a of alloc.allocations) {
      const mov = {
        id: `mov-${crypto.randomUUID()}`,
        documentId: doc.id,
        documentLineId: line.lineId,
        warehouseId: doc.warehouseId,
        itemId: line.itemId,
        quantity: a.quantity,
        type: 'issue',
        at: now,
        date: doc.date,
        actorUid,
        batchNo: a.batchNo,
        expiryDate: a.expiryDate,
        batchId: line.batchId,
        locationId: a.locationId ?? line.locationId,
      }
      out.push(mov)
      workingMovements = [...workingMovements, mov]
    }
  }
  return { ok: true, movements: out }
}

function buildReceiptMovements(doc, now, actorUid) {
  const out = []
  for (const line of doc.lines ?? []) {
    out.push({
      id: `mov-${crypto.randomUUID()}`,
      documentId: doc.id,
      documentLineId: line.lineId,
      warehouseId: doc.warehouseId,
      itemId: line.itemId,
      quantity: Number(line.quantity),
      type: 'receipt',
      at: now,
      date: doc.date,
      actorUid,
      batchId: line.batchId,
      batchNo: line.batchNo,
      expiryDate: line.expiryDate,
      locationId: line.locationId,
    })
  }
  return { ok: true, movements: out }
}

function requireKnownItems(warehouse, lines) {
  for (const line of lines) {
    const itemId = String(line.itemId ?? '').trim()
    if (!itemId) return fail('invalid_lines', 400)
    if (!(warehouse.items ?? []).some((i) => i.id === itemId)) {
      return fail('unknown_item', 400, { itemId })
    }
  }
  return ok()
}

/**
 * Atomically post batch_issue + batch_receipt for a mixer confirm / orphan recovery.
 * Idempotent when both docs already exist for batchRunId; fail-closed on partial.
 */
export function applyBatchMixConfirmCritical(warehouse, command, actor, now) {
  const batchRunId = String(command.batchRunId ?? '').trim()
  const warehouseId = String(command.warehouseId ?? '').trim()
  const date = String(command.date ?? now.slice(0, 10)).slice(0, 10)
  if (!batchRunId || !warehouseId) return fail('invalid_input', 400)
  if (isPeriodClosed(warehouse, date)) return fail('period_closed', 403)

  const existingIssue = (warehouse.documents ?? []).find(
    (d) =>
      d.batchRunId === batchRunId &&
      d.docRole === 'batch_issue' &&
      d.status === 'posted',
  )
  const existingReceipt = (warehouse.documents ?? []).find(
    (d) =>
      d.batchRunId === batchRunId &&
      d.docRole === 'batch_receipt' &&
      d.status === 'posted',
  )
  if (existingIssue && existingReceipt) {
    return ok({
      warehouse,
      result: {
        documentIds: [existingIssue.id, existingReceipt.id],
        issueDocumentId: existingIssue.id,
        receiptDocumentId: existingReceipt.id,
        issueNumber: existingIssue.number,
        receiptNumber: existingReceipt.number,
        status: 'posted',
        idempotentHint: true,
      },
    })
  }
  if (existingIssue || existingReceipt) {
    return fail('partial_batch_mix_docs', 409, {
      issueDocumentId: existingIssue?.id ?? null,
      receiptDocumentId: existingReceipt?.id ?? null,
    })
  }

  const issueIn = sanitizeDocumentLines(command.issueLines ?? [])
  if (!issueIn.ok) return fail(issueIn.error, 400)
  const receiptIn = sanitizeDocumentLines(command.receiptLines ?? [])
  if (!receiptIn.ok) return fail(receiptIn.error, 400)
  if (issueIn.lines.length === 0 || receiptIn.lines.length === 0) {
    return fail('invalid_lines', 400)
  }

  const knownIssue = requireKnownItems(warehouse, issueIn.lines)
  if (!knownIssue.ok) return knownIssue
  const knownReceipt = requireKnownItems(warehouse, receiptIn.lines)
  if (!knownReceipt.ok) return knownReceipt

  const stock = checkIssueStock(warehouse, warehouseId, issueIn.lines)
  if (!stock.ok) return fail(stock.error, 400, { shortages: stock.shortages })

  const issueNumber =
    String(command.issueNumber ?? '').trim() || `ЗМ-${date.replace(/-/g, '')}-XXX-Р`
  const receiptNumber =
    String(command.receiptNumber ?? '').trim() || `ЗМ-${date.replace(/-/g, '')}-XXX-П`
  const comment = String(command.comment ?? '').trim()

  const issueDoc = {
    id: `wh-doc-${crypto.randomUUID()}`,
    type: 'issue',
    purpose: 'production',
    docRole: 'batch_issue',
    batchRunId,
    warehouseId,
    date,
    number: issueNumber,
    lines: issueIn.lines,
    status: 'posted',
    postedAt: now,
    postedBy: actor.uid,
    postedByName: actor.email ?? actor.uid,
    createdAt: now,
    comment: comment || undefined,
  }
  const receiptDoc = {
    id: `wh-doc-${crypto.randomUUID()}`,
    type: 'receipt',
    purpose: 'production',
    docRole: 'batch_receipt',
    batchRunId,
    warehouseId,
    date,
    number: receiptNumber,
    lines: receiptIn.lines.map((l) => ({ ...l, lineId: crypto.randomUUID() })),
    status: 'posted',
    postedAt: now,
    postedBy: actor.uid,
    postedByName: actor.email ?? actor.uid,
    createdAt: now,
    comment: comment || undefined,
  }

  const issueBuilt = buildIssueMovements(issueDoc, warehouse, now, actor.uid)
  if (!issueBuilt.ok) return fail(issueBuilt.error, 400, { shortages: issueBuilt.shortages })
  const receiptBuilt = buildReceiptMovements(receiptDoc, now, actor.uid)
  if (!receiptBuilt.ok) return fail(receiptBuilt.error, 400)

  let next = {
    ...warehouse,
    documents: [...(warehouse.documents ?? []), issueDoc, receiptDoc],
    movements: [
      ...(warehouse.movements ?? []),
      ...issueBuilt.movements,
      ...receiptBuilt.movements,
    ],
  }
  next = appendAudit(next, {
    id: `aud-${crypto.randomUUID()}`,
    at: now,
    action: 'batch_mix_confirm',
    documentId: issueDoc.id,
    actorUid: actor.uid,
    detail: `batch_mix confirm ${batchRunId} issue=${issueNumber} receipt=${receiptNumber}`,
  })

  return ok({
    warehouse: next,
    result: {
      documentIds: [issueDoc.id, receiptDoc.id],
      issueDocumentId: issueDoc.id,
      receiptDocumentId: receiptDoc.id,
      issueNumber,
      receiptNumber,
      movementsCount: issueBuilt.movements.length + receiptBuilt.movements.length,
      status: 'posted',
    },
  })
}
