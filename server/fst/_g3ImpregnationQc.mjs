/**
 * R3.1C — pure authoritative impregnation QC gate.
 *
 * This module intentionally has no Data Connect or gateway dependencies.  The
 * caller owns capability checks and the enclosing warehouse + production CAS.
 * The functions below only accept lineage that can be proved from posted mixer
 * documents and their movements; a free-text batch number is never sufficient.
 */
import { createHash } from 'node:crypto'

const EPS = 1e-9
const LAB_STATUSES = new Set(['pending', 'pass', 'fail'])
const DECISIONS = new Set(['approved', 'rejected'])
const DECISION_METHODS = new Set(['measured', 'edu_manual_visual'])
const DOWNSTREAM_BATCH_DOCUMENTS = new Map([
  ['shift_consumption', { documentType: 'issue', purpose: 'production_issue', movementType: 'issue' }],
  ['wip_receipt', { documentType: 'receipt', purpose: 'production_receipt', movementType: 'receipt' }],
  ['waste_to_scrap', { documentType: 'issue', purpose: 'writeoff', movementType: 'issue' }],
  ['scrap_receipt', { documentType: 'receipt', purpose: 'writeoff', movementType: 'receipt' }],
])

function ok(data = {}) {
  return { ok: true, ...data }
}

function fail(error, status = 400, extra = {}) {
  return { ok: false, error, status, ...extra }
}

function str(value) {
  return String(value ?? '').trim()
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex')
}

/** Stable command key; the verdict itself is deliberately not part of the key. */
export function canonicalImpregnationQcDecisionKey(batchRunId, decisionRevision = 1) {
  const runId = str(batchRunId)
  const revision = Number(decisionRevision)
  if (!runId || !Number.isInteger(revision) || revision < 1) return ''
  return `impregnation-qc:${runId}:v${revision}`
}

function validateDocumentLineage(document, role, productionOrderId, productionLineId) {
  const orderId = str(document?.productionOrderId)
  const lineId = str(document?.productionLineId)
  if (!orderId) return fail(`${role}_order_lineage_missing`, 409, { documentId: document.id })
  if (orderId !== productionOrderId) {
    return fail(`${role}_order_mismatch`, 409, {
      documentId: document.id,
      expectedProductionOrderId: productionOrderId,
      actualProductionOrderId: orderId,
    })
  }
  if (!lineId) return fail(`${role}_line_lineage_missing`, 409, { documentId: document.id })
  if (lineId !== productionLineId) {
    return fail(`${role}_line_mismatch`, 409, {
      documentId: document.id,
      expectedProductionLineId: productionLineId,
      actualProductionLineId: lineId,
    })
  }
  return ok()
}

function validateDocumentLineRows(document, role, batchRunId, productionOrderId, productionLineId) {
  const documentId = str(document?.id)
  const lines = Array.isArray(document?.lines) ? document.lines : []
  if (lines.length === 0) return fail(`${role}_lines_missing`, 409, { documentId })
  const lineIds = lines.map((line) => str(line?.lineId))
  if (lineIds.some((lineId) => !lineId)) {
    return fail(`${role}_document_line_id_missing`, 409, { documentId })
  }
  if (new Set(lineIds).size !== lineIds.length) {
    return fail(`${role}_document_line_id_ambiguous`, 409, { documentId })
  }
  for (const line of lines) {
    const lineId = str(line?.lineId)
    const lineBatchRunId = str(line?.batchRunId)
    const lineOrderId = str(line?.productionOrderId)
    const lineProductionLineId = str(line?.productionLineId)
    if (!lineBatchRunId) {
      return fail(`${role}_line_batch_lineage_missing`, 409, { documentId, lineId })
    }
    if (lineBatchRunId !== batchRunId) {
      return fail(`${role}_line_batch_mismatch`, 409, { documentId, lineId })
    }
    if (!lineOrderId) {
      return fail(`${role}_line_order_lineage_missing`, 409, { documentId, lineId })
    }
    if (lineOrderId !== productionOrderId) {
      return fail(`${role}_line_order_mismatch`, 409, { documentId, lineId })
    }
    if (!lineProductionLineId) {
      return fail(`${role}_line_production_lineage_missing`, 409, { documentId, lineId })
    }
    if (lineProductionLineId !== productionLineId) {
      return fail(`${role}_line_production_mismatch`, 409, { documentId, lineId })
    }
  }
  return ok({ lines })
}

function validateDocumentMovements(
  warehouse,
  document,
  role,
  expectedType,
  batchRunId,
  productionOrderId,
  productionLineId,
  { requireSingleLineAndMovement = false } = {},
) {
  const documentId = str(document?.id)
  const documentWarehouseId = str(document?.warehouseId)
  if (!documentWarehouseId) {
    return fail(`${role}_warehouse_lineage_missing`, 409, { documentId })
  }
  const lines = Array.isArray(document?.lines) ? document.lines : []
  if (requireSingleLineAndMovement && lines.length !== 1) {
    return fail(`${role}_document_line_cardinality_mismatch`, 409, {
      documentId,
      lineCount: lines.length,
    })
  }
  if (requireSingleLineAndMovement && !str(lines[0]?.locationId)) {
    return fail(`${role}_line_location_lineage_missing`, 409, { documentId })
  }
  const linesById = new Map(lines.map((line) => [str(line?.lineId), line]))
  const movements = (warehouse?.movements ?? []).filter(
    (movement) => str(movement?.documentId) === documentId,
  )
  if (movements.length === 0) {
    return fail(`${role}_movements_missing`, 409, { documentId })
  }
  if (requireSingleLineAndMovement && movements.length !== 1) {
    return fail(`${role}_movement_cardinality_mismatch`, 409, {
      documentId,
      movementCount: movements.length,
    })
  }
  if (movements.some((movement) => str(movement?.type) !== expectedType)) {
    return fail(`${role}_movement_type_mismatch`, 409, { documentId })
  }

  const quantityByLineId = new Map()
  for (const movement of movements) {
    const movementId = str(movement?.id)
    const documentLineId = str(movement?.documentLineId)
    if (!documentLineId) {
      return fail(`${role}_movement_document_lineage_missing`, 409, {
        documentId,
        movementId,
      })
    }
    const line = linesById.get(documentLineId)
    if (!line) {
      return fail(`${role}_movement_document_lineage_mismatch`, 409, {
        documentId,
        movementId,
        documentLineId,
      })
    }
    const movementItemId = str(movement?.itemId)
    const lineItemId = str(line?.itemId)
    if (!lineItemId || movementItemId !== lineItemId) {
      return fail(`${role}_movement_item_mismatch`, 409, {
        documentId,
        movementId,
        documentLineId,
        expectedItemId: lineItemId,
        actualItemId: movementItemId,
      })
    }
    const movementQuantity = Number(movement?.quantity)
    if (!Number.isFinite(movementQuantity) || movementQuantity <= 0) {
      return fail(`${role}_movement_quantity_mismatch`, 409, {
        documentId,
        movementId,
        documentLineId,
      })
    }
    if (str(movement?.warehouseId) !== documentWarehouseId) {
      return fail(`${role}_movement_warehouse_mismatch`, 409, {
        documentId,
        movementId,
        documentLineId,
        expectedWarehouseId: documentWarehouseId,
        actualWarehouseId: str(movement?.warehouseId),
      })
    }
    const lineLocationId = str(line?.locationId)
    if (lineLocationId && str(movement?.locationId) !== lineLocationId) {
      return fail(`${role}_movement_location_mismatch`, 409, {
        documentId,
        movementId,
        documentLineId,
        expectedLocationId: lineLocationId,
        actualLocationId: str(movement?.locationId),
      })
    }
    const lineBatchNo = str(line?.batchNo)
    if (lineBatchNo && str(movement?.batchNo) !== lineBatchNo) {
      return fail(`${role}_movement_batch_number_mismatch`, 409, {
        documentId,
        movementId,
        documentLineId,
        expectedBatchNo: lineBatchNo,
        actualBatchNo: str(movement?.batchNo),
      })
    }
    const movementBatchRunId = str(movement?.batchRunId)
    const movementOrderId = str(movement?.productionOrderId)
    const movementLineId = str(movement?.productionLineId)
    if (!movementBatchRunId) {
      return fail(`${role}_movement_batch_lineage_missing`, 409, {
        documentId,
        movementId: movement.id,
      })
    }
    if (movementBatchRunId !== batchRunId) {
      return fail(`${role}_movement_batch_mismatch`, 409, {
        documentId,
        movementId: movement.id,
        expectedBatchRunId: batchRunId,
        actualBatchRunId: movementBatchRunId,
      })
    }
    if (!movementOrderId) {
      return fail(`${role}_movement_order_lineage_missing`, 409, {
        documentId,
        movementId: movement.id,
      })
    }
    if (movementOrderId !== productionOrderId) {
      return fail(`${role}_movement_order_mismatch`, 409, {
        documentId,
        movementId: movement.id,
        expectedProductionOrderId: productionOrderId,
        actualProductionOrderId: movementOrderId,
      })
    }
    if (!movementLineId) {
      return fail(`${role}_movement_line_lineage_missing`, 409, {
        documentId,
        movementId: movement.id,
      })
    }
    if (movementLineId !== productionLineId) {
      return fail(`${role}_movement_line_mismatch`, 409, {
        documentId,
        movementId: movement.id,
        expectedProductionLineId: productionLineId,
        actualProductionLineId: movementLineId,
      })
    }
    quantityByLineId.set(
      documentLineId,
      (quantityByLineId.get(documentLineId) ?? 0) + movementQuantity,
    )
  }

  for (const line of lines) {
    const documentLineId = str(line?.lineId)
    const documentedQuantity = Number(line?.quantity)
    const movedQuantity = quantityByLineId.get(documentLineId)
    if (
      !Number.isFinite(documentedQuantity) ||
      documentedQuantity <= 0 ||
      movedQuantity == null ||
      Math.abs(movedQuantity - documentedQuantity) > EPS
    ) {
      return fail(`${role}_movement_quantity_mismatch`, 409, {
        documentId,
        documentLineId,
        documentedQuantity,
        movedQuantity: movedQuantity ?? 0,
      })
    }
  }
  return ok({ movements })
}

function validateCanonicalDownstreamBatchEffects(
  warehouse,
  {
    batchRunId,
    productionOrderId,
    productionLineId,
    selectedDocumentIds,
    extraBatchDocuments,
    extraBatchMovements,
    allowedDownstreamShiftReportIds,
  },
) {
  const documents = warehouse?.documents ?? []
  const movements = warehouse?.movements ?? []
  const candidateDocumentIds = new Set([
    ...extraBatchDocuments.map((document) => str(document?.id)),
    ...extraBatchMovements.map((movement) => str(movement?.documentId)),
  ])
  if (candidateDocumentIds.has('')) return fail('batch_downstream_document_id_missing', 409)

  const candidateDocuments = []
  const allowedShiftReportIds = new Set(
    (allowedDownstreamShiftReportIds ?? []).map((value) => str(value)).filter(Boolean),
  )
  for (const documentId of candidateDocumentIds) {
    if (selectedDocumentIds.has(documentId)) continue
    const matches = documents.filter((document) => str(document?.id) === documentId)
    if (matches.length !== 1) {
      return fail('batch_downstream_document_ambiguous', 409, { documentId })
    }
    candidateDocuments.push(matches[0])
  }

  const graphMovementIds = new Set(
    movements
      .filter((movement) => selectedDocumentIds.has(str(movement?.documentId)))
      .map((movement) => str(movement?.id)),
  )
  for (const document of candidateDocuments) {
    const documentId = str(document?.id)
    const role = str(document?.docRole)
    const spec = DOWNSTREAM_BATCH_DOCUMENTS.get(role)
    const isReversal = role === 'shift_correction_reversal'
    const documentWarehouseId = str(document?.warehouseId)
    const shiftReportId = str(document?.shiftReportId)
    if (
      document?.status !== 'posted' ||
      document?.cancelled === true ||
      Boolean(str(document?.reversalDocumentId)) ||
      (!spec && !isReversal) ||
      !documentWarehouseId ||
      !shiftReportId ||
      !allowedShiftReportIds.has(shiftReportId) ||
      str(document?.productionOrderId) !== productionOrderId ||
      str(document?.productionLineId) !== productionLineId
    ) {
      return fail('batch_downstream_document_invalid', 409, { documentId, role })
    }
    if (
      spec &&
      (str(document?.type) !== spec.documentType || str(document?.purpose) !== spec.purpose)
    ) {
      return fail('batch_downstream_document_invalid', 409, { documentId, role })
    }

    const lines = Array.isArray(document?.lines) ? document.lines : []
    const lineIds = lines.map((line) => str(line?.lineId))
    if (
      lines.length === 0 ||
      lineIds.some((lineId) => !lineId) ||
      new Set(lineIds).size !== lineIds.length
    ) {
      return fail('batch_downstream_document_line_invalid', 409, { documentId })
    }
    const linesById = new Map(lines.map((line) => [str(line?.lineId), line]))
    const documentMovements = movements.filter(
      (movement) => str(movement?.documentId) === documentId,
    )
    if (documentMovements.length !== lines.length) {
      return fail('batch_downstream_movement_cardinality_mismatch', 409, { documentId })
    }

    let containsBatchRun = str(document?.batchRunId) === batchRunId
    for (const movement of documentMovements) {
      const movementId = str(movement?.id)
      const documentLineId = str(movement?.documentLineId)
      const line = linesById.get(documentLineId)
      const lineQuantity = Number(line?.quantity)
      const movementQuantity = Number(movement?.quantity)
      if (!movementId || graphMovementIds.has(movementId)) {
        return fail('batch_downstream_movement_id_invalid', 409, { documentId, movementId })
      }
      graphMovementIds.add(movementId)
      if (
        movement?.cancelled === true ||
        !line ||
        !str(line?.itemId) ||
        !str(line?.locationId) ||
        str(movement?.itemId) !== str(line?.itemId) ||
        str(movement?.warehouseId) !== documentWarehouseId ||
        str(movement?.locationId) !== str(line?.locationId) ||
        str(movement?.batchNo) !== str(line?.batchNo) ||
        str(movement?.expiryDate).slice(0, 10) !== str(line?.expiryDate).slice(0, 10) ||
        str(movement?.batchRunId) !== str(line?.batchRunId) ||
        str(movement?.productionOrderId) !== productionOrderId ||
        str(movement?.productionLineId) !== productionLineId ||
        str(movement?.shiftReportId) !== shiftReportId ||
        !Number.isFinite(lineQuantity) ||
        lineQuantity <= 0 ||
        !Number.isFinite(movementQuantity) ||
        movementQuantity <= 0 ||
        Math.abs(movementQuantity - lineQuantity) > EPS
      ) {
        return fail('batch_downstream_movement_graph_invalid', 409, {
          documentId,
          movementId,
        })
      }
      if (str(movement?.batchRunId) === batchRunId) containsBatchRun = true

      if (spec && str(movement?.type) !== spec.movementType) {
        return fail('batch_downstream_movement_type_mismatch', 409, {
          documentId,
          movementId,
        })
      }
    }
    if (!containsBatchRun) {
      return fail('batch_downstream_batch_lineage_missing', 409, { documentId })
    }

    if (isReversal) {
      const sourceDocumentId = str(document?.reversesDocumentId)
      const sourceDocuments = documents.filter(
        (candidate) => str(candidate?.id) === sourceDocumentId,
      )
      const sourceDocument = sourceDocuments[0]
      if (
        !sourceDocumentId ||
        sourceDocuments.length !== 1 ||
        !DOWNSTREAM_BATCH_DOCUMENTS.has(str(sourceDocument?.docRole)) ||
        sourceDocument?.status !== 'posted' ||
        str(sourceDocument?.productionOrderId) !== productionOrderId ||
        str(sourceDocument?.productionLineId) !== productionLineId ||
        str(sourceDocument?.shiftReportId) !== shiftReportId
      ) {
        return fail('batch_downstream_reversal_source_invalid', 409, { documentId })
      }
      for (const movement of documentMovements) {
        const sourceMovementId = str(movement?.reversesMovementId)
        const sourceMatches = movements.filter(
          (candidate) => str(candidate?.id) === sourceMovementId,
        )
        const sourceMovement = sourceMatches[0]
        const expectedReverseType =
          str(sourceMovement?.type) === 'issue'
            ? 'receipt'
            : str(sourceMovement?.type) === 'receipt'
              ? 'issue'
              : ''
        if (
          !sourceMovementId ||
          sourceMatches.length !== 1 ||
          str(sourceMovement?.documentId) !== sourceDocumentId ||
          !expectedReverseType ||
          str(movement?.type) !== expectedReverseType ||
          str(movement?.itemId) !== str(sourceMovement?.itemId) ||
          str(movement?.warehouseId) !== str(sourceMovement?.warehouseId) ||
          str(movement?.locationId) !== str(sourceMovement?.locationId) ||
          str(movement?.batchNo) !== str(sourceMovement?.batchNo) ||
          str(movement?.expiryDate).slice(0, 10) !==
            str(sourceMovement?.expiryDate).slice(0, 10) ||
          str(movement?.batchRunId) !== str(sourceMovement?.batchRunId) ||
          Math.abs(Number(movement?.quantity) - Number(sourceMovement?.quantity)) > EPS
        ) {
          return fail('batch_downstream_reversal_movement_invalid', 409, {
            documentId,
            movementId: movement?.id,
          })
        }
      }
    }
  }

  return ok()
}

/**
 * Resolve one fully posted mixer batch and prove its order/line/item lineage.
 *
 * @param {object} warehouse authoritative warehouse domain
 * @param {object} reference exact authoritative lineage reference
 */
export function resolveConfirmedMixerBatch(
  warehouse,
  {
    batchRunId,
    batchReceiptDocumentId,
    productionOrderId,
    productionLineId,
    outputWarehouseItemId,
    allowDownstreamBatchEffects = false,
    allowedDownstreamShiftReportIds = [],
  } = {},
) {
  const runId = str(batchRunId)
  const receiptId = str(batchReceiptDocumentId)
  const orderId = str(productionOrderId)
  const lineId = str(productionLineId)
  const outputItemId = str(outputWarehouseItemId)

  if (!runId) return fail('batch_run_id_required', 400)
  if (!orderId) return fail('production_order_id_required', 400)
  if (!lineId) return fail('production_line_id_required', 400)
  if (!outputItemId) return fail('output_warehouse_item_id_required', 400)

  const batchDocuments = (warehouse?.documents ?? []).filter(
    (document) => str(document?.batchRunId) === runId,
  )
  const postedDocuments = batchDocuments.filter(
    (document) => str(document?.batchRunId) === runId && document?.status === 'posted',
  )
  const issues = postedDocuments.filter((document) => document?.docRole === 'batch_issue')
  const receipts = postedDocuments.filter((document) => document?.docRole === 'batch_receipt')

  if (issues.length === 0) return fail('batch_issue_not_found', 404, { batchRunId: runId })
  if (issues.length !== 1) {
    return fail('batch_issue_ambiguous', 409, {
      batchRunId: runId,
      documentIds: issues.map((document) => document.id),
    })
  }
  if (receipts.length === 0) return fail('batch_receipt_not_found', 404, { batchRunId: runId })
  if (receipts.length !== 1) {
    return fail('batch_receipt_ambiguous', 409, {
      batchRunId: runId,
      documentIds: receipts.map((document) => document.id),
    })
  }

  const issueDocument = issues[0]
  const receiptDocument = receipts[0]
  const issueDocumentId = str(issueDocument?.id)
  const receiptDocumentId = str(receiptDocument?.id)
  if (!issueDocumentId || !receiptDocumentId || issueDocumentId === receiptDocumentId) {
    return fail('batch_document_id_invalid', 409, {
      issueDocumentId,
      receiptDocumentId,
    })
  }
  const selectedDocumentIds = new Set([issueDocumentId, receiptDocumentId])
  const selectedIdMatches = (warehouse?.documents ?? []).filter((document) =>
    selectedDocumentIds.has(str(document?.id)),
  )
  if (selectedIdMatches.length !== 2) {
    return fail('batch_document_id_ambiguous', 409, {
      issueDocumentId,
      receiptDocumentId,
    })
  }
  const extraBatchDocuments = batchDocuments.filter(
    (document) => document !== issueDocument && document !== receiptDocument,
  )
  if (!allowDownstreamBatchEffects && extraBatchDocuments.length > 0) {
    return fail('batch_document_graph_ambiguous', 409, {
      batchRunId: runId,
      documentIds: batchDocuments.map((document) => document?.id),
    })
  }
  if (
    batchDocuments.some(
      (document) =>
        document?.cancelled === true ||
        document?.status === 'cancelled' ||
        Boolean(str(document?.reversalDocumentId)),
    )
  ) {
    return fail('batch_document_cancelled', 409, { batchRunId: runId })
  }
  const reversingDocuments = (warehouse?.documents ?? []).filter(
    (document) =>
      selectedDocumentIds.has(str(document?.reversesDocumentId)) ||
      selectedDocumentIds.has(str(document?.cancelledDocumentId)),
  )
  if (reversingDocuments.length > 0) {
    return fail('batch_document_reversal_found', 409, {
      batchRunId: runId,
      documentIds: reversingDocuments.map((document) => document?.id),
    })
  }
  if (str(issueDocument?.type) !== 'issue') {
    return fail('batch_issue_document_type_mismatch', 409, {
      documentId: issueDocument.id,
    })
  }
  if (str(receiptDocument?.type) !== 'receipt') {
    return fail('batch_receipt_document_type_mismatch', 409, {
      documentId: receiptDocument.id,
    })
  }
  if (str(issueDocument?.purpose) !== 'production') {
    return fail('batch_issue_document_purpose_mismatch', 409, {
      documentId: issueDocument.id,
    })
  }
  if (str(receiptDocument?.purpose) !== 'production') {
    return fail('batch_receipt_document_purpose_mismatch', 409, {
      documentId: receiptDocument.id,
    })
  }
  if (receiptId && str(receiptDocument.id) !== receiptId) {
    return fail('batch_receipt_document_mismatch', 409, {
      batchRunId: runId,
      expectedBatchReceiptDocumentId: receiptId,
      actualBatchReceiptDocumentId: receiptDocument.id,
    })
  }

  const issueLineage = validateDocumentLineage(issueDocument, 'batch_issue', orderId, lineId)
  if (!issueLineage.ok) return issueLineage
  const receiptLineage = validateDocumentLineage(receiptDocument, 'batch_receipt', orderId, lineId)
  if (!receiptLineage.ok) return receiptLineage

  const issueLines = validateDocumentLineRows(issueDocument, 'batch_issue', runId, orderId, lineId)
  if (!issueLines.ok) return issueLines
  const receiptLineageLines = validateDocumentLineRows(
    receiptDocument,
    'batch_receipt',
    runId,
    orderId,
    lineId,
  )
  if (!receiptLineageLines.ok) return receiptLineageLines

  const selectedLineIds = [
    ...issueLines.lines.map((line) => str(line?.lineId)),
    ...receiptLineageLines.lines.map((line) => str(line?.lineId)),
  ]
  if (new Set(selectedLineIds).size !== selectedLineIds.length) {
    return fail('batch_document_line_id_ambiguous', 409, { batchRunId: runId })
  }

  const relatedMovements = (warehouse?.movements ?? []).filter(
    (movement) =>
      str(movement?.batchRunId) === runId || selectedDocumentIds.has(str(movement?.documentId)),
  )
  if (relatedMovements.some((movement) => movement?.cancelled === true)) {
    return fail('batch_movement_cancelled', 409, { batchRunId: runId })
  }
  const extraBatchMovements = relatedMovements.filter(
    (movement) => !selectedDocumentIds.has(str(movement?.documentId)),
  )
  if (!allowDownstreamBatchEffects && extraBatchMovements.length > 0) {
    return fail('batch_movement_graph_ambiguous', 409, {
      batchRunId: runId,
      movementIds: relatedMovements.map((movement) => movement?.id),
    })
  }
  const movementIds = relatedMovements.map((movement) => str(movement?.id))
  if (movementIds.some((movementId) => !movementId)) {
    return fail('batch_movement_id_missing', 409, { batchRunId: runId })
  }
  if (new Set(movementIds).size !== movementIds.length) {
    return fail('batch_movement_id_ambiguous', 409, { batchRunId: runId })
  }
  if (
    allowDownstreamBatchEffects &&
    (extraBatchDocuments.length > 0 || extraBatchMovements.length > 0)
  ) {
    const downstream = validateCanonicalDownstreamBatchEffects(warehouse, {
      batchRunId: runId,
      productionOrderId: orderId,
      productionLineId: lineId,
      selectedDocumentIds,
      extraBatchDocuments,
      extraBatchMovements,
      allowedDownstreamShiftReportIds,
    })
    if (!downstream.ok) return downstream
  }

  const receiptLines = receiptDocument?.lines ?? []
  const receiptItems = [...new Set(receiptLines.map((line) => str(line?.itemId)).filter(Boolean))]
  if (receiptItems.length !== 1 || receiptItems[0] !== outputItemId) {
    return fail('batch_output_item_mismatch', 409, {
      batchRunId: runId,
      receiptDocumentId: receiptDocument.id,
      expectedOutputWarehouseItemId: outputItemId,
      actualOutputWarehouseItemIds: receiptItems,
    })
  }

  const issueMovements = validateDocumentMovements(
    warehouse,
    issueDocument,
    'batch_issue',
    'issue',
    runId,
    orderId,
    lineId,
  )
  if (!issueMovements.ok) return issueMovements
  const receiptMovements = validateDocumentMovements(
    warehouse,
    receiptDocument,
    'batch_receipt',
    'receipt',
    runId,
    orderId,
    lineId,
    { requireSingleLineAndMovement: true },
  )
  if (!receiptMovements.ok) return receiptMovements

  const receiptLineBatchNumbers = receiptLines.map((line) => str(line?.batchNo))
  if (receiptLineBatchNumbers.some((batchNo) => !batchNo)) {
    return fail('batch_number_missing', 409, { receiptDocumentId: receiptDocument.id })
  }
  const uniqueReceiptLineBatchNumbers = [...new Set(receiptLineBatchNumbers)]
  if (uniqueReceiptLineBatchNumbers.length !== 1) {
    return fail('batch_number_ambiguous', 409, {
      receiptDocumentId: receiptDocument.id,
      batchNumbers: uniqueReceiptLineBatchNumbers,
    })
  }
  const batchNo = uniqueReceiptLineBatchNumbers[0]
  const receiptDocumentBatchNo = str(receiptDocument?.batchNo)
  if (!receiptDocumentBatchNo) {
    return fail('batch_document_number_missing', 409, {
      receiptDocumentId: receiptDocument.id,
    })
  }
  if (receiptDocumentBatchNo !== batchNo) {
    return fail('batch_document_number_mismatch', 409, {
      receiptDocumentId: receiptDocument.id,
      batchNo,
      documentBatchNo: receiptDocumentBatchNo,
    })
  }
  if (receiptMovements.movements.some((movement) => str(movement?.batchNo) !== batchNo)) {
    return fail('batch_movement_number_mismatch', 409, {
      receiptDocumentId: receiptDocument.id,
      batchNo,
    })
  }

  const outputQuantity = receiptMovements.movements.reduce(
    (sum, movement) => sum + Number(movement.quantity),
    0,
  )
  return ok({
    batchRunId: runId,
    productionOrderId: orderId,
    productionLineId: lineId,
    outputWarehouseItemId: outputItemId,
    outputQuantity,
    batchNo,
    issueDocument,
    receiptDocument,
    issueMovements: issueMovements.movements,
    receiptMovements: receiptMovements.movements,
  })
}

function normalizeDecisionCommand(command) {
  const rawDecisionRevision = Number(command?.decisionRevision ?? 1)
  return {
    decisionKey: str(command?.decisionKey),
    productionOrderId: str(command?.productionOrderId),
    productionLineId: str(command?.productionLineId),
    batchRunId: str(command?.batchRunId),
    batchReceiptDocumentId: str(command?.batchReceiptDocumentId) || null,
    outputWarehouseItemId: str(command?.outputWarehouseItemId),
    labStatus: str(command?.labStatus),
    decision: str(command?.decision),
    decisionMethod: str(command?.decisionMethod),
    visualOk: command?.visualOk === true,
    reason: str(command?.reason),
    sourceQcRecordId: str(command?.sourceQcRecordId) || null,
    labEvidenceFingerprint: str(command?.labEvidenceFingerprint) || null,
    decisionRevision:
      Number.isInteger(rawDecisionRevision) && rawDecisionRevision >= 1
        ? rawDecisionRevision
        : null,
    supersedesDecisionId: str(command?.supersedesDecisionId) || null,
    supersessionReason: str(command?.supersessionReason) || null,
  }
}

function commandFingerprint(canonical) {
  return sha256(stableJson(canonical))
}

function isEffectiveDecision(row) {
  return row?.effective !== false && !str(row?.supersededByDecisionId)
}

function decisionRecordId(row) {
  return str(row?.id ?? row?.decisionId)
}

function validateDecisionHistory(batchHistory, batchRunId) {
  if (batchHistory.length === 0) return ok({ current: null })
  const ordered = [...batchHistory].sort(
    (left, right) => Number(left?.decisionRevision) - Number(right?.decisionRevision),
  )
  const anchor = ordered[0]
  const anchorOutputQuantity = Number(anchor?.outputQuantity)
  const anchorLineage = {
    productionOrderId: str(anchor?.productionOrderId),
    productionLineId: str(anchor?.productionLineId),
    batchIssueDocumentId: str(anchor?.batchIssueDocumentId),
    batchReceiptDocumentId: str(anchor?.batchReceiptDocumentId),
    outputWarehouseItemId: str(anchor?.outputWarehouseItemId),
    batchNo: str(anchor?.batchNo),
  }
  if (
    Object.values(anchorLineage).some((value) => !value) ||
    !Number.isFinite(anchorOutputQuantity) ||
    anchorOutputQuantity <= 0
  ) {
    return fail('impregnation_qc_decision_lineage_history_invalid', 409, { batchRunId })
  }
  const ids = new Set()
  for (let index = 0; index < ordered.length; index += 1) {
    const row = ordered[index]
    const rowId = decisionRecordId(row)
    const revision = Number(row?.decisionRevision)
    if (!rowId) return fail('impregnation_qc_decision_id_missing', 409, { batchRunId })
    if (ids.has(rowId)) {
      return fail('impregnation_qc_decision_id_ambiguous', 409, {
        batchRunId,
        decisionId: rowId,
      })
    }
    ids.add(rowId)
    if (!Number.isInteger(revision) || revision !== index + 1) {
      return fail('impregnation_qc_revision_history_invalid', 409, { batchRunId })
    }
    if (str(row?.decisionKey) !== canonicalImpregnationQcDecisionKey(batchRunId, revision)) {
      return fail('impregnation_qc_decision_key_history_invalid', 409, { batchRunId })
    }
    if (
      !LAB_STATUSES.has(str(row?.labStatus)) ||
      !DECISIONS.has(str(row?.decision)) ||
      !DECISION_METHODS.has(str(row?.decisionMethod))
    ) {
      return fail('impregnation_qc_decision_status_history_invalid', 409, { batchRunId })
    }
    const rowOutputQuantity = Number(row?.outputQuantity)
    if (
      str(row?.productionOrderId) !== anchorLineage.productionOrderId ||
      str(row?.productionLineId) !== anchorLineage.productionLineId ||
      str(row?.batchIssueDocumentId) !== anchorLineage.batchIssueDocumentId ||
      str(row?.batchReceiptDocumentId) !== anchorLineage.batchReceiptDocumentId ||
      str(row?.outputWarehouseItemId) !== anchorLineage.outputWarehouseItemId ||
      str(row?.batchNo) !== anchorLineage.batchNo ||
      !Number.isFinite(rowOutputQuantity) ||
      Math.abs(rowOutputQuantity - anchorOutputQuantity) > EPS
    ) {
      return fail('impregnation_qc_decision_lineage_history_invalid', 409, { batchRunId })
    }

    const previous = ordered[index - 1]
    if (!previous) {
      if (str(row?.supersedesDecisionId)) {
        return fail('impregnation_qc_supersession_history_invalid', 409, { batchRunId })
      }
    } else {
      const previousId = decisionRecordId(previous)
      if (
        str(row?.supersedesDecisionId) !== previousId ||
        !str(row?.supersessionReason) ||
        str(previous?.supersededByDecisionId) !== rowId ||
        previous?.effective !== false
      ) {
        return fail('impregnation_qc_supersession_history_invalid', 409, { batchRunId })
      }
    }
  }

  const effective = ordered.filter(isEffectiveDecision)
  if (effective.length > 1) {
    return fail('impregnation_qc_effective_decision_ambiguous', 409, {
      batchRunId,
      decisionIds: effective.map(decisionRecordId),
    })
  }
  const current = ordered[ordered.length - 1]
  if (effective.length !== 1 || effective[0] !== current) {
    return fail('impregnation_qc_effective_decision_missing', 409, { batchRunId })
  }
  return ok({ current })
}

function decisionResult(row, { idempotent }) {
  const effective = isEffectiveDecision(row)
  return {
    decisionId: row.id,
    decisionKey: row.decisionKey,
    decisionRevision: Number(row.decisionRevision) || 1,
    decision: row.decision,
    labStatus: row.labStatus,
    decisionMethod: row.decisionMethod,
    productionOrderId: row.productionOrderId,
    productionLineId: row.productionLineId,
    batchRunId: row.batchRunId,
    batchNo: row.batchNo,
    batchIssueDocumentId: row.batchIssueDocumentId,
    batchReceiptDocumentId: row.batchReceiptDocumentId,
    outputWarehouseItemId: row.outputWarehouseItemId,
    outputQuantity: row.outputQuantity,
    supersedesDecisionId: row.supersedesDecisionId,
    supersessionReason: row.supersessionReason,
    supersededByDecisionId: row.supersededByDecisionId,
    supersededAt: row.supersededAt,
    commandFingerprint: row.commandFingerprint,
    actorUid: row.actorUid,
    decidedAt: row.decidedAt,
    effective,
    lineReady: effective && row.decision === 'approved',
    idempotent,
  }
}

/**
 * Apply an authoritative impregnation decision to the production domain.
 * Capability enforcement belongs to the gateway; this helper records actor.uid.
 */
export function applyImpregnationQcDecision(
  production,
  warehouse,
  command,
  actor,
  now,
  { allowEduManualVisual = false } = {},
) {
  const canonical = normalizeDecisionCommand(command)
  if (!canonical.decisionKey) return fail('decision_key_required', 400)
  if (!canonical.batchRunId) return fail('batch_run_id_required', 400)
  if (canonical.decisionRevision == null) return fail('invalid_decision_revision', 400)
  const expectedDecisionKey = canonicalImpregnationQcDecisionKey(
    canonical.batchRunId,
    canonical.decisionRevision,
  )
  if (canonical.decisionKey !== expectedDecisionKey) {
    return fail('noncanonical_decision_key', 400, { expectedDecisionKey })
  }
  const actorUid = str(actor?.uid)
  if (!actorUid) return fail('actor_uid_required', 400)

  const fingerprint = commandFingerprint(canonical)
  const decisions = production?.impregnationQcDecisions ?? []
  const existing = decisions.filter(
    (row) => str(row?.decisionKey) === canonical.decisionKey,
  )
  if (existing.length > 1) {
    return fail('impregnation_qc_decision_key_ambiguous', 409, {
      decisionKey: canonical.decisionKey,
      decisionIds: existing.map((row) => row.id),
    })
  }
  const batchHistory = decisions.filter(
    (candidate) => str(candidate?.batchRunId) === canonical.batchRunId,
  )
  const history = validateDecisionHistory(batchHistory, canonical.batchRunId)
  if (!history.ok) return history
  if (existing.length === 1) {
    const row = existing[0]
    if (
      str(row.commandFingerprint) !== fingerprint ||
      commandFingerprint(normalizeDecisionCommand(row)) !== fingerprint
    ) {
      return fail('impregnation_qc_idempotency_conflict', 409, {
        decisionKey: canonical.decisionKey,
        decisionId: row.id,
      })
    }
  }

  if (!canonical.productionOrderId) return fail('production_order_id_required', 400)
  if (!canonical.productionLineId) return fail('production_line_id_required', 400)
  if (!canonical.outputWarehouseItemId) return fail('output_warehouse_item_id_required', 400)
  if (!LAB_STATUSES.has(canonical.labStatus)) return fail('invalid_lab_status', 400)
  if (!DECISIONS.has(canonical.decision)) return fail('invalid_qc_decision', 400)
  if (!DECISION_METHODS.has(canonical.decisionMethod)) {
    return fail('invalid_qc_decision_method', 400)
  }

  if (canonical.decisionMethod === 'edu_manual_visual') {
    if (!allowEduManualVisual) return fail('edu_manual_visual_not_allowed', 403)
    if (canonical.decision === 'approved' && canonical.visualOk !== true) {
      return fail('edu_manual_visual_requires_visual_ok', 400)
    }
    if (canonical.decision === 'approved' && !canonical.reason) {
      return fail('edu_manual_visual_reason_required', 400)
    }
  }
  if (
    canonical.decisionMethod === 'measured' &&
    canonical.decision === 'approved' &&
    canonical.labStatus !== 'pass'
  ) {
    return fail('measured_approval_requires_lab_pass', 409, {
      labStatus: canonical.labStatus,
    })
  }

  // A browser-computed `pass` is not authoritative laboratory evidence.  Until
  // an immutable server-owned evidence stream exists, measured approvals must
  // fail closed; otherwise a caller could forge labStatus=pass and unlock the
  // production line.  Measured rejections remain safe because they never make
  // the batch line-ready.  The isolated staging-only visual path is guarded
  // separately above and is the explicit rehearsal policy.
  if (canonical.decisionMethod === 'measured' && canonical.decision === 'approved') {
    return fail('authoritative_lab_evidence_required', 409)
  }

  const orderMatches = (production?.orders ?? []).filter(
    (candidate) => str(candidate?.id) === canonical.productionOrderId,
  )
  if (orderMatches.length === 0) {
    return fail('production_order_not_found', 404, {
      productionOrderId: canonical.productionOrderId,
    })
  }
  if (orderMatches.length !== 1) {
    return fail('production_order_ambiguous', 409, {
      productionOrderId: canonical.productionOrderId,
    })
  }
  const order = orderMatches[0]
  if (order.status !== 'active') {
    return fail('production_order_not_active', 409, {
      productionOrderId: canonical.productionOrderId,
      actualStatus: order.status ?? null,
    })
  }
  if (str(order.lineId) !== canonical.productionLineId) {
    return fail('production_order_line_mismatch', 409, {
      productionOrderId: canonical.productionOrderId,
      expectedProductionLineId: str(order.lineId),
      actualProductionLineId: canonical.productionLineId,
    })
  }

  const currentDecisionId = decisionRecordId(history.current)
  const allowedDownstreamShiftReportIds = currentDecisionId
    ? (production?.shiftReports ?? [])
        .filter(
          (report) =>
            report?.status === 'confirmed' &&
            str(report?.batchRunId) === canonical.batchRunId &&
            str(report?.impregnationQcDecisionId) === currentDecisionId &&
            str(report?.productionOrderId ?? report?.orderId) === canonical.productionOrderId &&
            str(report?.lineId ?? report?.productionLineId) === canonical.productionLineId,
        )
        .map((report) => str(report?.id))
        .filter(Boolean)
    : []
  const batch = resolveConfirmedMixerBatch(warehouse, {
    ...canonical,
    allowDownstreamBatchEffects: allowedDownstreamShiftReportIds.length > 0,
    allowedDownstreamShiftReportIds,
  })
  if (!batch.ok) return batch

  if (existing.length === 1) {
    const row = existing[0]
    const rowOutputQuantity = Number(row?.outputQuantity)
    if (
      str(row?.productionOrderId) !== canonical.productionOrderId ||
      str(row?.productionLineId) !== canonical.productionLineId ||
      str(row?.batchRunId) !== canonical.batchRunId ||
      str(row?.batchIssueDocumentId) !== str(batch.issueDocument.id) ||
      str(row?.batchReceiptDocumentId) !== str(batch.receiptDocument.id) ||
      str(row?.outputWarehouseItemId) !== canonical.outputWarehouseItemId ||
      str(row?.batchNo) !== batch.batchNo ||
      !Number.isFinite(rowOutputQuantity) ||
      rowOutputQuantity <= 0 ||
      Math.abs(rowOutputQuantity - batch.outputQuantity) > EPS
    ) {
      return fail('impregnation_qc_replay_lineage_mismatch', 409, {
        decisionKey: canonical.decisionKey,
        decisionId: decisionRecordId(row),
      })
    }
    return ok({
      production,
      warehouse,
      result: decisionResult(row, { idempotent: true }),
    })
  }

  const current = history.current
  if (!current) {
    if (canonical.decisionRevision !== 1) {
      return fail('impregnation_qc_initial_revision_must_be_one', 409)
    }
    if (canonical.supersedesDecisionId) {
      return fail('impregnation_qc_unexpected_supersedes', 409)
    }
  } else {
    const currentDecisionId = str(current.id ?? current.decisionId)
    const currentOutputQuantity = Number(current.outputQuantity)
    if (!currentDecisionId) {
      return fail('impregnation_qc_current_decision_id_missing', 409, {
        batchRunId: canonical.batchRunId,
      })
    }
    if (
      str(current.productionOrderId) !== canonical.productionOrderId ||
      str(current.productionLineId) !== canonical.productionLineId ||
      str(current.outputWarehouseItemId) !== canonical.outputWarehouseItemId ||
      str(current.batchIssueDocumentId) !== str(batch.issueDocument.id) ||
      str(current.batchReceiptDocumentId) !== str(batch.receiptDocument.id) ||
      str(current.batchNo) !== batch.batchNo ||
      !Number.isFinite(currentOutputQuantity) ||
      currentOutputQuantity <= 0 ||
      Math.abs(currentOutputQuantity - batch.outputQuantity) > EPS
    ) {
      return fail('impregnation_qc_current_lineage_mismatch', 409, {
        currentDecisionId,
      })
    }
    if (!canonical.supersedesDecisionId) {
      return fail('impregnation_qc_supersession_required', 409, {
        currentDecisionId,
      })
    }
    if (canonical.supersedesDecisionId !== currentDecisionId) {
      return fail('impregnation_qc_supersedes_mismatch', 409, {
        currentDecisionId,
      })
    }
    const expectedRevision = (Number(current.decisionRevision) || 1) + 1
    if (canonical.decisionRevision !== expectedRevision) {
      return fail('impregnation_qc_revision_conflict', 409, { expectedRevision })
    }
    if (!canonical.supersessionReason) {
      return fail('impregnation_qc_supersession_reason_required', 400)
    }
    const alreadyUsed = (production?.shiftReports ?? []).some(
      (report) =>
        report?.status === 'confirmed' &&
        (str(report?.impregnationQcDecisionId) === currentDecisionId ||
          str(report?.batchRunId) === canonical.batchRunId),
    )
    if (alreadyUsed) {
      return fail('impregnation_qc_decision_already_used_by_shift', 409, {
        currentDecisionId,
      })
    }
  }

  const decisionId = `impqc-${sha256(canonical.decisionKey).slice(0, 24)}`
  const row = {
    id: decisionId,
    decisionId,
    decisionKey: canonical.decisionKey,
    commandFingerprint: fingerprint,
    productionOrderId: canonical.productionOrderId,
    productionLineId: canonical.productionLineId,
    batchRunId: canonical.batchRunId,
    batchIssueDocumentId: batch.issueDocument.id,
    batchReceiptDocumentId: batch.receiptDocument.id,
    outputWarehouseItemId: canonical.outputWarehouseItemId,
    outputQuantity: batch.outputQuantity,
    batchNo: batch.batchNo,
    labStatus: canonical.labStatus,
    decision: canonical.decision,
    decisionMethod: canonical.decisionMethod,
    visualOk: canonical.visualOk,
    reason: canonical.reason || undefined,
    sourceQcRecordId: canonical.sourceQcRecordId || undefined,
    labEvidenceFingerprint: canonical.labEvidenceFingerprint || undefined,
    decisionRevision: canonical.decisionRevision,
    supersedesDecisionId: canonical.supersedesDecisionId || undefined,
    supersessionReason: canonical.supersessionReason || undefined,
    effective: true,
    actorUid,
    decidedAt: str(now),
    createdAt: str(now),
  }
  const priorDecisions = current
    ? decisions.map((candidate) =>
        candidate === current
          ? {
              ...candidate,
              effective: false,
              supersededByDecisionId: decisionId,
              supersededAt: str(now),
            }
          : candidate,
      )
    : decisions
  const nextProduction = {
    ...production,
    impregnationQcDecisions: [...priorDecisions, row],
  }
  return ok({
    production: nextProduction,
    warehouse,
    result: decisionResult(row, { idempotent: false }),
  })
}
