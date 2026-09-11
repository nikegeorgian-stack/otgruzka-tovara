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
import { resolveProductionLineBinding } from '../../src/lib/production/lineReadinessCore.mjs'
import { batchMixCommandFingerprint } from '../../src/lib/formulations/batchMixFingerprint.mjs'

function ok(data = {}) {
  return { ok: true, ...data }
}

function fail(error, status = 400, extra = {}) {
  return { ok: false, error, status, ...extra }
}

function optionalId(value) {
  const id = String(value ?? '').trim()
  return id || undefined
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
        batchRunId: doc.batchRunId,
        recipeId: doc.recipeId,
        mixTaskId: doc.mixTaskId,
        productionOrderId: doc.productionOrderId,
        productionLineId: doc.productionLineId,
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
      batchRunId: doc.batchRunId,
      recipeId: doc.recipeId,
      mixTaskId: doc.mixTaskId,
      productionOrderId: doc.productionOrderId,
      productionLineId: doc.productionLineId,
      batchId: line.batchId,
      batchNo: line.batchNo,
      expiryDate: line.expiryDate,
      locationId: line.locationId,
    })
  }
  return { ok: true, movements: out }
}

function ensureItemCatalog(warehouse, lines) {
  const items = [...(warehouse.items ?? [])]
  for (const line of lines) {
    const itemId = String(line.itemId ?? '').trim()
    if (!itemId) continue
    const existing = items.find((i) => i.id === itemId)
    if (existing) continue
    const name = String(line.itemNameSnapshot ?? '').trim()
    const unit = String(line.unitSnapshot ?? line.inputUnit ?? '').trim()
    if (!name || name === itemId || !unit) {
      return { ok: false, error: 'unknown_item_incomplete_snapshot', itemId }
    }
    items.push({
      id: itemId,
      name,
      internalCode: String(line.itemCodeSnapshot ?? '').trim(),
      unit,
      sku: line.skuSnapshot != null ? String(line.skuSnapshot) : undefined,
      categoryId: line.categoryIdSnapshot != null ? String(line.categoryIdSnapshot) : undefined,
      barcode: line.barcodeSnapshot != null ? String(line.barcodeSnapshot) : undefined,
      active: line.activeSnapshot === false ? false : true,
    })
  }
  return { ok: true, warehouse: { ...warehouse, items } }
}

function requireKnownOrEnsure(warehouse, lines) {
  return ensureItemCatalog(warehouse, lines)
}

function roundMixQty(value) {
  return Math.round(Number(value) * 1000) / 1000
}

function aggregateMixLines(lines) {
  const quantities = new Map()
  for (const line of lines) {
    const itemId = String(line?.itemId ?? '').trim()
    if (!itemId) continue
    quantities.set(itemId, roundMixQty((quantities.get(itemId) ?? 0) + Number(line.quantity)))
  }
  return quantities
}

function canonicalMixSignature(validated) {
  return JSON.stringify({
    receiptItemId: validated.receiptItemId,
    receiptQuantity: validated.receiptQuantity,
    issueQuantities: [...validated.issueQuantities.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    ),
  })
}

function validateCanonicalMixerAuthority(order, command) {
  const recipeId = optionalId(command.recipeId)
  const orderRecipeId = optionalId(order?.formulationRecipeId)
  if (!recipeId) return fail('mixer_recipe_id_required', 409)
  if (!orderRecipeId || recipeId !== orderRecipeId) {
    return fail('mixer_recipe_mismatch', 409)
  }

  const outputItemId = optionalId(order?.impregnationOutputItemId)
  if (!outputItemId) return fail('impregnation_output_mapping_required', 409)

  const snapshot = order?.recipeNormSnapshot
  if (!snapshot || typeof snapshot !== 'object') {
    return fail('mixer_recipe_snapshot_required', 409)
  }
  if (
    optionalId(snapshot.recipeId) !== orderRecipeId ||
    snapshot.normBase !== 'per_batch'
  ) {
    return fail('mixer_recipe_snapshot_mismatch', 409)
  }
  const batchSize = Number(snapshot.batchSize)
  const components = Array.isArray(snapshot.components) ? snapshot.components : []
  if (!Number.isFinite(batchSize) || batchSize <= 0 || components.length === 0) {
    return fail('mixer_recipe_snapshot_invalid', 409)
  }

  const issueIn = sanitizeDocumentLines(command.issueLines ?? [])
  if (!issueIn.ok) return fail(issueIn.error, 400)
  const receiptIn = sanitizeDocumentLines(command.receiptLines ?? [])
  if (!receiptIn.ok) return fail(receiptIn.error, 400)
  if (receiptIn.lines.length !== 1) return fail('mixer_receipt_line_invalid', 409)
  if (issueIn.lines.length === 0) return fail('invalid_lines', 400)
  if (
    [...issueIn.lines, ...receiptIn.lines].some(
      (line) => Math.abs(Number(line.quantity) - roundMixQty(line.quantity)) > 1e-9,
    )
  ) {
    return fail('mixer_quantity_precision_invalid', 409)
  }

  const receiptLine = receiptIn.lines[0]
  if (receiptLine.itemId !== outputItemId) {
    return fail('mixer_output_item_mismatch', 409)
  }
  const receiptQuantity = roundMixQty(receiptLine.quantity)
  if (!(receiptQuantity > 0)) return fail('invalid_quantity', 400)

  const expectedQuantities = new Map()
  for (const component of components) {
    const itemId = optionalId(component?.warehouseItemId)
    const normQty = Number(component?.normQty)
    if (!itemId || !Number.isFinite(normQty) || normQty <= 0) {
      return fail('mixer_recipe_snapshot_invalid', 409)
    }
    const scaled = roundMixQty(normQty * (receiptQuantity / batchSize))
    if (!(scaled > 0)) return fail('mixer_recipe_snapshot_invalid', 409)
    expectedQuantities.set(
      itemId,
      roundMixQty((expectedQuantities.get(itemId) ?? 0) + scaled),
    )
  }

  const issueQuantities = aggregateMixLines(issueIn.lines)
  const expectedIds = [...expectedQuantities.keys()].sort()
  const actualIds = [...issueQuantities.keys()].sort()
  const missingItemIds = expectedIds.filter((itemId) => !issueQuantities.has(itemId))
  const extraItemIds = actualIds.filter((itemId) => !expectedQuantities.has(itemId))
  if (missingItemIds.length || extraItemIds.length) {
    return fail('mixer_components_mismatch', 409, { missingItemIds, extraItemIds })
  }
  for (const [itemId, expected] of expectedQuantities) {
    const actual = issueQuantities.get(itemId)
    if (actual == null || Math.abs(actual - expected) > 1e-6) {
      return fail('mixer_component_quantity_mismatch', 409, {
        itemId,
        expected,
        actual: actual ?? 0,
      })
    }
  }

  return ok({
    issueLines: issueIn.lines,
    receiptLines: receiptIn.lines,
    receiptItemId: outputItemId,
    receiptQuantity,
    issueQuantities,
  })
}

function batchLineageMatches(record, expected) {
  return (
    optionalId(record?.batchRunId) === expected.batchRunId &&
    optionalId(record?.recipeId) === expected.recipeId &&
    optionalId(record?.mixTaskId) === expected.mixTaskId &&
    optionalId(record?.productionOrderId) === expected.productionOrderId &&
    optionalId(record?.productionLineId) === expected.productionLineId
  )
}

function validateExistingBatchGraph(warehouse, issueDoc, receiptDoc, expected) {
  const documentIds = new Set([issueDoc.id, receiptDoc.id])
  const batchDocuments = (warehouse.documents ?? []).filter(
    (document) => optionalId(document?.batchRunId) === expected.batchRunId,
  )
  if (
    batchDocuments.length !== 2 ||
    issueDoc.status !== 'posted' ||
    receiptDoc.status !== 'posted' ||
    issueDoc.cancelled === true ||
    receiptDoc.cancelled === true ||
    issueDoc.type !== 'issue' ||
    receiptDoc.type !== 'receipt' ||
    issueDoc.purpose !== 'production' ||
    receiptDoc.purpose !== 'production' ||
    issueDoc.docRole !== 'batch_issue' ||
    receiptDoc.docRole !== 'batch_receipt' ||
    issueDoc.warehouseId !== expected.issueWarehouseId ||
    receiptDoc.warehouseId !== expected.receiptWarehouseId ||
    String(issueDoc.date ?? '').slice(0, 10) !== expected.date ||
    String(receiptDoc.date ?? '').slice(0, 10) !== expected.date ||
    String(issueDoc.number ?? '') !== expected.issueNumber ||
    String(receiptDoc.number ?? '') !== expected.receiptNumber ||
    String(receiptDoc.batchNo ?? '') !== expected.documentNumber ||
    !batchLineageMatches(issueDoc, expected) ||
    !batchLineageMatches(receiptDoc, expected) ||
    (warehouse.documents ?? []).some(
      (document) =>
        documentIds.has(String(document?.reversesDocumentId ?? '')) ||
        documentIds.has(String(document?.cancelledDocumentId ?? '')),
    )
  ) {
    return fail('batch_mix_existing_state_mismatch', 409)
  }

  const storedFingerprints = [
    optionalId(issueDoc.commandFingerprint),
    optionalId(receiptDoc.commandFingerprint),
  ]
  if (
    storedFingerprints.some(Boolean) &&
    storedFingerprints.some((fingerprint) => fingerprint !== expected.commandFingerprint)
  ) {
    return fail('batch_mix_replay_conflict', 409)
  }

  const issueLines = Array.isArray(issueDoc.lines) ? issueDoc.lines : []
  const receiptLines = Array.isArray(receiptDoc.lines) ? receiptDoc.lines : []
  const issueLineIds = issueLines.map((line) => optionalId(line?.lineId))
  const receiptLine = receiptLines[0]
  if (
    issueLines.length === 0 ||
    receiptLines.length !== 1 ||
    issueLineIds.some((lineId) => !lineId) ||
    new Set(issueLineIds).size !== issueLineIds.length ||
    !optionalId(receiptLine?.lineId) ||
    issueLines.some(
      (line) =>
        !batchLineageMatches(line, expected) ||
        !Number.isFinite(Number(line?.quantity)) ||
        Number(line.quantity) <= 0,
    ) ||
    !batchLineageMatches(receiptLine, expected) ||
    receiptLine.itemId !== expected.receiptItemId ||
    !Number.isFinite(Number(receiptLine.quantity)) ||
    Number(receiptLine.quantity) <= 0 ||
    Math.abs(Number(receiptLine.quantity) - expected.receiptQuantity) > 1e-6 ||
    optionalId(receiptLine.locationId) !== expected.receiptLocationId ||
    String(receiptLine.batchNo ?? '') !== expected.documentNumber ||
    canonicalMixSignature({
      receiptItemId: receiptLine.itemId,
      receiptQuantity: roundMixQty(receiptLine.quantity),
      issueQuantities: aggregateMixLines(issueLines),
    }) !== expected.canonicalSignature
  ) {
    return fail('batch_mix_existing_state_mismatch', 409)
  }

  const relatedMovements = (warehouse.movements ?? []).filter(
    (movement) =>
      optionalId(movement?.batchRunId) === expected.batchRunId ||
      documentIds.has(String(movement?.documentId ?? '')),
  )
  const issueMovements = relatedMovements.filter(
    (movement) => movement.documentId === issueDoc.id && movement.type === 'issue',
  )
  const receiptMovements = relatedMovements.filter(
    (movement) => movement.documentId === receiptDoc.id && movement.type === 'receipt',
  )
  if (
    relatedMovements.length !== issueMovements.length + receiptMovements.length ||
    relatedMovements.some(
      (movement) =>
        movement.cancelled === true ||
        !batchLineageMatches(movement, expected) ||
        !Number.isFinite(Number(movement?.quantity)) ||
        Number(movement.quantity) <= 0,
    ) ||
    receiptMovements.length !== 1
  ) {
    return fail('batch_mix_existing_state_mismatch', 409)
  }

  const issueLineById = new Map(issueLines.map((line) => [optionalId(line.lineId), line]))
  const issueQtyByLineId = new Map()
  for (const movement of issueMovements) {
    const lineId = optionalId(movement.documentLineId)
    const line = issueLineById.get(lineId)
    if (
      !line ||
      !Number.isFinite(Number(movement.quantity)) ||
      Number(movement.quantity) <= 0 ||
      movement.itemId !== line.itemId ||
      movement.warehouseId !== expected.issueWarehouseId ||
      String(movement.date ?? '').slice(0, 10) !== expected.date ||
      (optionalId(line.locationId) && optionalId(movement.locationId) !== optionalId(line.locationId)) ||
      (optionalId(line.batchNo) && optionalId(movement.batchNo) !== optionalId(line.batchNo))
    ) {
      return fail('batch_mix_existing_state_mismatch', 409)
    }
    issueQtyByLineId.set(
      lineId,
      roundMixQty((issueQtyByLineId.get(lineId) ?? 0) + Number(movement.quantity)),
    )
  }
  if (
    issueLines.some(
      (line) => {
        const moved = issueQtyByLineId.get(optionalId(line.lineId))
        return (
          moved == null ||
          !Number.isFinite(Number(moved)) ||
          Math.abs(Number(moved) - Number(line.quantity)) > 1e-6
        )
      },
    )
  ) {
    return fail('batch_mix_existing_state_mismatch', 409)
  }

  const receiptMovement = receiptMovements[0]
  if (
    !Number.isFinite(Number(receiptMovement.quantity)) ||
    Number(receiptMovement.quantity) <= 0 ||
    receiptMovement.documentLineId !== receiptLine.lineId ||
    receiptMovement.itemId !== receiptLine.itemId ||
    Math.abs(Number(receiptMovement.quantity) - Number(receiptLine.quantity)) > 1e-6 ||
    receiptMovement.warehouseId !== expected.receiptWarehouseId ||
    optionalId(receiptMovement.locationId) !== expected.receiptLocationId ||
    String(receiptMovement.batchNo ?? '') !== expected.documentNumber ||
    String(receiptMovement.date ?? '').slice(0, 10) !== expected.date
  ) {
    return fail('batch_mix_existing_state_mismatch', 409)
  }

  return ok({ movementsCount: relatedMovements.length })
}

/**
 * Atomically post batch_issue + batch_receipt for a mixer confirm / orphan recovery.
 * Idempotent when both docs already exist for batchRunId; fail-closed on partial.
 */
export function applyBatchMixConfirmCritical(warehouse, command, actor, now, context = {}) {
  const commandFingerprint = batchMixCommandFingerprint(command)
  const batchRunId = String(command.batchRunId ?? '').trim()
  const documentNumber = String(command.documentNumber ?? '').trim()
  const warehouseId = String(command.warehouseId ?? '').trim()
  const recipeId = optionalId(command.recipeId)
  const mixTaskId = optionalId(command.mixTaskId)
  const productionOrderId = optionalId(command.productionOrderId)
  const productionLineId = optionalId(command.productionLineId)
  const lineage = {
    batchRunId,
    ...(recipeId ? { recipeId } : {}),
    ...(mixTaskId ? { mixTaskId } : {}),
    ...(productionOrderId ? { productionOrderId } : {}),
    ...(productionLineId ? { productionLineId } : {}),
  }
  let receiptWarehouseId = warehouseId
  let receiptLocationId
  let canonicalOrder
  let canonicalInput
  if (context.enforceCanonicalLineage === true) {
    if (!productionOrderId || !productionLineId) {
      return fail('mixer_lineage_incomplete', 409)
    }
    const orders = context.production?.orders ?? []
    const orderMatches = orders.filter(
      (row) => String(row?.id ?? '').trim() === productionOrderId,
    )
    if (orderMatches.length === 0) return fail('production_order_not_found', 404)
    if (orderMatches.length !== 1) return fail('production_order_ambiguous', 409)
    const order = orderMatches[0]
    const usesCanonicalMixerAuthority = Number(order?.wipContractVersion) >= 1
    if (!usesCanonicalMixerAuthority && !mixTaskId) {
      return fail('mixer_lineage_incomplete', 409)
    }
    if (order.status !== 'active') return fail('production_order_not_active', 409)
    if (String(order.lineId ?? '').trim() !== productionLineId) {
      return fail('production_order_line_mismatch', 409)
    }
    const route = resolveProductionLineBinding(warehouse, productionLineId)
    if (!route.ok) return fail(route.error, 409)
    receiptWarehouseId = route.productionWarehouseId
    receiptLocationId = route.productionLocationId
    if (usesCanonicalMixerAuthority) {
      canonicalOrder = order
      canonicalInput = validateCanonicalMixerAuthority(order, command)
      if (!canonicalInput.ok) return canonicalInput
    }
  }
  const date = String(command.date ?? now.slice(0, 10)).slice(0, 10)
  if (!batchRunId || !warehouseId) return fail('invalid_input', 400)
  if (isPeriodClosed(warehouse, date)) return fail('period_closed', 403)

  const issueIn = canonicalInput
    ? { ok: true, lines: canonicalInput.issueLines }
    : sanitizeDocumentLines(command.issueLines ?? [])
  if (!issueIn.ok) return fail(issueIn.error, 400)
  const receiptIn = canonicalInput
    ? { ok: true, lines: canonicalInput.receiptLines }
    : sanitizeDocumentLines(command.receiptLines ?? [])
  if (!receiptIn.ok) return fail(receiptIn.error, 400)
  if (issueIn.lines.length === 0 || receiptIn.lines.length === 0) {
    return fail('invalid_lines', 400)
  }
  const issueNumber =
    String(command.issueNumber ?? '').trim() || `ЗМ-${date.replace(/-/g, '')}-XXX-Р`
  const receiptNumber =
    String(command.receiptNumber ?? '').trim() || `ЗМ-${date.replace(/-/g, '')}-XXX-П`
  const comment = String(command.comment ?? '').trim()

  const batchDocuments = (warehouse.documents ?? []).filter(
    (document) => optionalId(document?.batchRunId) === batchRunId,
  )
  const existingIssues = batchDocuments.filter(
    (d) =>
      d.docRole === 'batch_issue' &&
      d.status === 'posted',
  )
  const existingReceipts = batchDocuments.filter(
    (d) =>
      d.docRole === 'batch_receipt' &&
      d.status === 'posted',
  )
  if (context.enforceCanonicalLineage === true && existingIssues.length > 1) {
    return fail('duplicate_batch_issue_docs', 409, {
      documentIds: existingIssues.map((document) => document.id),
    })
  }
  if (context.enforceCanonicalLineage === true && existingReceipts.length > 1) {
    return fail('duplicate_batch_receipt_docs', 409, {
      documentIds: existingReceipts.map((document) => document.id),
    })
  }
  const existingIssue = existingIssues[0]
  const existingReceipt = existingReceipts[0]
  if (existingIssue && existingReceipt) {
    if (context.enforceCanonicalLineage === true) {
      if (
        optionalId(existingIssue.productionOrderId) !== productionOrderId ||
        optionalId(existingReceipt.productionOrderId) !== productionOrderId ||
        optionalId(existingIssue.productionLineId) !== productionLineId ||
        optionalId(existingReceipt.productionLineId) !== productionLineId ||
        optionalId(existingIssue.recipeId) !== recipeId ||
        optionalId(existingReceipt.recipeId) !== recipeId ||
        existingIssue.warehouseId !== warehouseId ||
        existingReceipt.warehouseId !== receiptWarehouseId ||
        optionalId(existingReceipt.lines?.[0]?.locationId) !== receiptLocationId
      ) {
        return fail('mixer_existing_lineage_mismatch', 409)
      }
      const requestedCanonical = canonicalOrder
        ? canonicalInput
        : {
            receiptItemId: receiptIn.lines[0]?.itemId,
            receiptQuantity: roundMixQty(receiptIn.lines[0]?.quantity),
            issueQuantities: aggregateMixLines(issueIn.lines),
          }
      const graph = validateExistingBatchGraph(warehouse, existingIssue, existingReceipt, {
        batchRunId,
        recipeId,
        mixTaskId,
        productionOrderId,
        productionLineId,
        issueWarehouseId: warehouseId,
        receiptWarehouseId,
        receiptLocationId,
        receiptItemId: requestedCanonical.receiptItemId,
        receiptQuantity: requestedCanonical.receiptQuantity,
        canonicalSignature: canonicalMixSignature(requestedCanonical),
        commandFingerprint,
        documentNumber,
        issueNumber,
        receiptNumber,
        date,
      })
      if (!graph.ok) return graph
      return ok({
        warehouse,
        result: {
          documentIds: [existingIssue.id, existingReceipt.id],
          issueDocumentId: existingIssue.id,
          receiptDocumentId: existingReceipt.id,
          issueNumber: existingIssue.number,
          receiptNumber: existingReceipt.number,
          receiptWarehouseId,
          receiptLocationId,
          movementsCount: graph.movementsCount,
          commandFingerprint,
          status: 'posted',
          idempotentHint: true,
        },
      })
    }
    return ok({
      warehouse,
      result: {
        documentIds: [existingIssue.id, existingReceipt.id],
        issueDocumentId: existingIssue.id,
        receiptDocumentId: existingReceipt.id,
        issueNumber: existingIssue.number,
        receiptNumber: existingReceipt.number,
        receiptWarehouseId,
        receiptLocationId,
        movementsCount: (warehouse.movements ?? []).filter(
          (movement) =>
            movement.documentId === existingIssue.id ||
            movement.documentId === existingReceipt.id,
        ).length,
        commandFingerprint,
        status: 'posted',
        idempotentHint: true,
      },
    })
  }
  if (
    existingIssue ||
    existingReceipt ||
    (context.enforceCanonicalLineage === true && batchDocuments.length > 0)
  ) {
    return fail('partial_batch_mix_docs', 409, {
      issueDocumentId: existingIssue?.id ?? null,
      receiptDocumentId: existingReceipt?.id ?? null,
    })
  }

  const issueLines = issueIn.lines.map((line) => ({ ...line, ...lineage }))
  const receiptLines = receiptIn.lines.map((line) => ({
    ...line,
    ...(documentNumber ? { batchNo: documentNumber } : {}),
    ...(receiptLocationId ? { locationId: receiptLocationId } : {}),
    ...lineage,
  }))

  const knownIssue = requireKnownOrEnsure(warehouse, issueLines)
  if (!knownIssue.ok) return fail(knownIssue.error, 400, { itemId: knownIssue.itemId })
  warehouse = knownIssue.warehouse
  const knownReceipt = requireKnownOrEnsure(warehouse, receiptLines)
  if (!knownReceipt.ok) return fail(knownReceipt.error, 400, { itemId: knownReceipt.itemId })
  warehouse = knownReceipt.warehouse

  const stock = checkIssueStock(warehouse, warehouseId, issueLines)
  if (!stock.ok) return fail(stock.error, 400, { shortages: stock.shortages })

  const issueDoc = {
    id: `wh-doc-${crypto.randomUUID()}`,
    type: 'issue',
    purpose: 'production',
    docRole: 'batch_issue',
    ...lineage,
    warehouseId,
    date,
    number: issueNumber,
    lines: issueLines,
    status: 'posted',
    postedAt: now,
    postedBy: actor.uid,
    postedByName: actor.email ?? actor.uid,
    createdAt: now,
    comment: comment || undefined,
    commandFingerprint,
  }
  const receiptDoc = {
    id: `wh-doc-${crypto.randomUUID()}`,
    type: 'receipt',
    purpose: 'production',
    docRole: 'batch_receipt',
    ...lineage,
    ...(documentNumber ? { batchNo: documentNumber } : {}),
    warehouseId: receiptWarehouseId,
    date,
    number: receiptNumber,
    lines: receiptLines.map((l) => ({ ...l, lineId: crypto.randomUUID() })),
    status: 'posted',
    postedAt: now,
    postedBy: actor.uid,
    postedByName: actor.email ?? actor.uid,
    createdAt: now,
    comment: comment || undefined,
    commandFingerprint,
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
      receiptWarehouseId,
      receiptLocationId,
      movementsCount: issueBuilt.movements.length + receiptBuilt.movements.length,
      commandFingerprint,
      status: 'posted',
    },
  })
}
