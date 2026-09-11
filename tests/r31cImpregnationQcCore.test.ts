import { describe, expect, it } from 'vitest'
import {
  applyImpregnationQcDecision,
  canonicalImpregnationQcDecisionKey,
  resolveConfirmedMixerBatch,
} from '../server/fst/_g3ImpregnationQc.mjs'
import { parseCriticalPayload } from '../server/fst/_g1CriticalHelpers.mjs'

const NOW = '2026-09-10T10:00:00.000Z'
const ORDER_ID = 'po-cello-160'
const LINE_ID = '1'
const RUN_ID = 'mix-cello-160-001'
const OUTPUT_ITEM_ID = 'impregnation-rp-0003'

function warehouseFixture() {
  return {
    documents: [
      {
        id: 'batch-issue-1',
        type: 'issue',
        purpose: 'production',
        docRole: 'batch_issue',
        status: 'posted',
        batchRunId: RUN_ID,
        productionOrderId: ORDER_ID,
        productionLineId: LINE_ID,
        warehouseId: 'main',
        lines: [
          {
            lineId: 'issue-line-a',
            itemId: 'chem-a',
            quantity: 3,
            locationId: 'raw-a',
            batchRunId: RUN_ID,
            productionOrderId: ORDER_ID,
            productionLineId: LINE_ID,
          },
          {
            lineId: 'issue-line-b',
            itemId: 'water',
            quantity: 2,
            locationId: 'raw-b',
            batchRunId: RUN_ID,
            productionOrderId: ORDER_ID,
            productionLineId: LINE_ID,
          },
        ],
      },
      {
        id: 'batch-receipt-1',
        type: 'receipt',
        purpose: 'production',
        docRole: 'batch_receipt',
        status: 'posted',
        batchRunId: RUN_ID,
        productionOrderId: ORDER_ID,
        productionLineId: LINE_ID,
        batchNo: 'IMP-001',
        warehouseId: 'main',
        lines: [
          {
            lineId: 'receipt-line-a',
            itemId: OUTPUT_ITEM_ID,
            quantity: 5,
            batchNo: 'IMP-001',
            locationId: 'line-location-1',
            batchRunId: RUN_ID,
            productionOrderId: ORDER_ID,
            productionLineId: LINE_ID,
          },
        ],
      },
    ],
    movements: [
      {
        id: 'movement-issue-a',
        documentId: 'batch-issue-1',
        documentLineId: 'issue-line-a',
        type: 'issue',
        itemId: 'chem-a',
        quantity: 3,
        warehouseId: 'main',
        locationId: 'raw-a',
        batchRunId: RUN_ID,
        productionOrderId: ORDER_ID,
        productionLineId: LINE_ID,
      },
      {
        id: 'movement-issue-b',
        documentId: 'batch-issue-1',
        documentLineId: 'issue-line-b',
        type: 'issue',
        itemId: 'water',
        quantity: 2,
        warehouseId: 'main',
        locationId: 'raw-b',
        batchRunId: RUN_ID,
        productionOrderId: ORDER_ID,
        productionLineId: LINE_ID,
      },
      {
        id: 'movement-receipt-a',
        documentId: 'batch-receipt-1',
        documentLineId: 'receipt-line-a',
        type: 'receipt',
        itemId: OUTPUT_ITEM_ID,
        quantity: 5,
        warehouseId: 'main',
        locationId: 'line-location-1',
        batchRunId: RUN_ID,
        productionOrderId: ORDER_ID,
        productionLineId: LINE_ID,
        batchNo: 'IMP-001',
      },
    ],
  }
}

function productionFixture(status = 'active', lineId = LINE_ID) {
  return {
    orders: [{ id: ORDER_ID, status, lineId }],
    impregnationQcDecisions: [],
    auditLog: [],
  }
}

function batchReference(overrides = {}) {
  return {
    batchRunId: RUN_ID,
    batchReceiptDocumentId: 'batch-receipt-1',
    productionOrderId: ORDER_ID,
    productionLineId: LINE_ID,
    outputWarehouseItemId: OUTPUT_ITEM_ID,
    ...overrides,
  }
}

function addExactShiftConsumption(warehouse: ReturnType<typeof warehouseFixture>) {
  ;(warehouse.documents as Array<Record<string, unknown>>).push({
    id: 'shift-consumption-1',
    type: 'issue',
    purpose: 'production_issue',
    docRole: 'shift_consumption',
    status: 'posted',
    warehouseId: 'main',
    productionOrderId: ORDER_ID,
    productionLineId: LINE_ID,
    shiftReportId: 'shift-1',
    lines: [
      {
        lineId: 'shift-consumption-line-1',
        itemId: OUTPUT_ITEM_ID,
        quantity: 1,
        locationId: 'line-location-1',
        batchNo: 'IMP-001',
        batchRunId: RUN_ID,
      },
    ],
  })
  ;(warehouse.movements as Array<Record<string, unknown>>).push({
    id: 'shift-consumption-movement-1',
    documentId: 'shift-consumption-1',
    documentLineId: 'shift-consumption-line-1',
    type: 'issue',
    itemId: OUTPUT_ITEM_ID,
    quantity: 1,
    warehouseId: 'main',
    locationId: 'line-location-1',
    batchNo: 'IMP-001',
    batchRunId: RUN_ID,
    productionOrderId: ORDER_ID,
    productionLineId: LINE_ID,
    shiftReportId: 'shift-1',
  })
}

function measuredCommand(overrides = {}) {
  const batchRunId = String(overrides.batchRunId ?? RUN_ID)
  const decisionRevision = Number(overrides.decisionRevision ?? 1)
  return {
    ...batchReference({ batchRunId }),
    decisionKey: canonicalImpregnationQcDecisionKey(batchRunId, decisionRevision),
    decisionRevision,
    labStatus: 'pass',
    decision: 'approved',
    decisionMethod: 'measured',
    sourceQcRecordId: 'lab-record-1',
    labEvidenceFingerprint: 'sha256:lab-evidence-1',
    ...overrides,
  }
}

function eduManualCommand(overrides = {}) {
  return measuredCommand({
    labStatus: 'pending',
    decisionMethod: 'edu_manual_visual',
    visualOk: true,
    reason: 'EDU rehearsal: visual acceptance by responsible technologist',
    sourceQcRecordId: undefined,
    labEvidenceFingerprint: undefined,
    ...overrides,
  })
}

const EDU_OPTIONS = { allowEduManualVisual: true }

function expectFailureWithoutMutation(
  production,
  warehouse,
  command,
  expectedError,
  options = EDU_OPTIONS,
) {
  const productionBefore = structuredClone(production)
  const warehouseBefore = structuredClone(warehouse)
  const result = applyImpregnationQcDecision(
    production,
    warehouse,
    command,
    { uid: 'technologist-1' },
    NOW,
    options,
  )
  expect(result.ok).toBe(false)
  expect(result.error).toBe(expectedError)
  expect(production).toEqual(productionBefore)
  expect(warehouse).toEqual(warehouseBefore)
  return result
}

describe('R3.1C resolveConfirmedMixerBatch', () => {
  it('resolves one posted issue+receipt only when documents and movements prove exact lineage', () => {
    const warehouse = warehouseFixture()
    const result = resolveConfirmedMixerBatch(warehouse, batchReference())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.issueDocument.id).toBe('batch-issue-1')
    expect(result.receiptDocument.id).toBe('batch-receipt-1')
    expect(result.issueMovements).toHaveLength(2)
    expect(result.receiptMovements).toHaveLength(1)
    expect(result.outputWarehouseItemId).toBe(OUTPUT_ITEM_ID)
    expect(result.outputQuantity).toBe(5)
    expect(result.batchNo).toBe('IMP-001')
  })

  it('requires every movement to reference one exact document line', () => {
    const missing = warehouseFixture()
    delete missing.movements[0].documentLineId
    expect(resolveConfirmedMixerBatch(missing, batchReference())).toMatchObject({
      ok: false,
      error: 'batch_issue_movement_document_lineage_missing',
    })

    const foreign = warehouseFixture()
    foreign.movements[0].documentLineId = 'foreign-line'
    expect(resolveConfirmedMixerBatch(foreign, batchReference())).toMatchObject({
      ok: false,
      error: 'batch_issue_movement_document_lineage_mismatch',
    })

    const swapped = warehouseFixture()
    swapped.movements[0].documentLineId = 'issue-line-b'
    expect(resolveConfirmedMixerBatch(swapped, batchReference())).toMatchObject({
      ok: false,
      error: 'batch_issue_movement_item_mismatch',
    })
  })

  it('requires nonempty unique document, document-line and movement IDs', () => {
    const missingDocumentId = warehouseFixture()
    missingDocumentId.documents[0].id = ''
    expect(resolveConfirmedMixerBatch(missingDocumentId, batchReference())).toMatchObject({
      ok: false,
      error: 'batch_document_id_invalid',
    })

    const duplicateDocumentId = warehouseFixture()
    duplicateDocumentId.documents[1].id = duplicateDocumentId.documents[0].id
    expect(resolveConfirmedMixerBatch(duplicateDocumentId, batchReference())).toMatchObject({
      ok: false,
      error: 'batch_document_id_invalid',
    })

    const missingLineId = warehouseFixture()
    missingLineId.documents[0].lines[0].lineId = ''
    expect(resolveConfirmedMixerBatch(missingLineId, batchReference())).toMatchObject({
      ok: false,
      error: 'batch_issue_document_line_id_missing',
    })

    const duplicateLineId = warehouseFixture()
    duplicateLineId.documents[0].lines[1].lineId =
      duplicateLineId.documents[0].lines[0].lineId
    expect(resolveConfirmedMixerBatch(duplicateLineId, batchReference())).toMatchObject({
      ok: false,
      error: 'batch_issue_document_line_id_ambiguous',
    })

    const missingMovementId = warehouseFixture()
    missingMovementId.movements[0].id = ''
    expect(resolveConfirmedMixerBatch(missingMovementId, batchReference())).toMatchObject({
      ok: false,
      error: 'batch_movement_id_missing',
    })

    const duplicateMovementId = warehouseFixture()
    duplicateMovementId.movements[1].id = duplicateMovementId.movements[0].id
    expect(resolveConfirmedMixerBatch(duplicateMovementId, batchReference())).toMatchObject({
      ok: false,
      error: 'batch_movement_id_ambiguous',
    })
  })

  it('checks movement quantities per document line instead of aggregate item totals', () => {
    const warehouse = warehouseFixture()
    warehouse.documents[0].lines[1].itemId = 'chem-a'
    warehouse.movements[1].itemId = 'chem-a'
    warehouse.movements[0].quantity = 4
    warehouse.movements[1].quantity = 1

    expect(resolveConfirmedMixerBatch(warehouse, batchReference())).toMatchObject({
      ok: false,
      error: 'batch_issue_movement_quantity_mismatch',
    })
  })

  it('allows FEFO to split one issue line while preserving its exact line total', () => {
    const warehouse = warehouseFixture()
    delete warehouse.documents[0].lines[0].locationId
    warehouse.movements[0].quantity = 1
    warehouse.movements[0].batchNo = 'CHEM-A-LOT-1'
    warehouse.movements.push({
      ...warehouse.movements[0],
      id: 'movement-issue-a-lot-2',
      quantity: 2,
      batchNo: 'CHEM-A-LOT-2',
      locationId: 'raw-a-overflow',
    })

    const result = resolveConfirmedMixerBatch(warehouse, batchReference())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.issueMovements).toHaveLength(3)
  })

  it('requires the canonical receipt to have exactly one line and one movement', () => {
    const splitReceipt = warehouseFixture()
    splitReceipt.movements[2].quantity = 2
    splitReceipt.movements.push({
      ...splitReceipt.movements[2],
      id: 'movement-receipt-extra',
      quantity: 3,
    })
    expect(resolveConfirmedMixerBatch(splitReceipt, batchReference())).toMatchObject({
      ok: false,
      error: 'batch_receipt_movement_cardinality_mismatch',
    })

    const splitDocument = warehouseFixture()
    splitDocument.documents[1].lines[0].quantity = 2
    splitDocument.documents[1].lines.push({
      ...splitDocument.documents[1].lines[0],
      lineId: 'receipt-line-extra',
      quantity: 3,
    })
    expect(resolveConfirmedMixerBatch(splitDocument, batchReference())).toMatchObject({
      ok: false,
      error: 'batch_receipt_document_line_cardinality_mismatch',
    })
  })

  it('rejects extra documents or movements carrying the same mixer run', () => {
    const extraDocument = warehouseFixture()
    ;(extraDocument.documents as Array<Record<string, unknown>>).push({
      id: 'foreign-batch-document',
      type: 'issue',
      docRole: 'other',
      status: 'posted',
      batchRunId: RUN_ID,
    })
    expect(resolveConfirmedMixerBatch(extraDocument, batchReference())).toMatchObject({
      ok: false,
      error: 'batch_document_graph_ambiguous',
    })

    const extraMovement = warehouseFixture()
    extraMovement.movements.push({
      ...extraMovement.movements[2],
      id: 'foreign-batch-movement',
      documentId: 'foreign-batch-document',
    })
    expect(resolveConfirmedMixerBatch(extraMovement, batchReference())).toMatchObject({
      ok: false,
      error: 'batch_movement_graph_ambiguous',
    })
  })

  it('allows only an exact posted production descendant during post-QC revalidation', () => {
    const warehouse = warehouseFixture()
    addExactShiftConsumption(warehouse)

    expect(resolveConfirmedMixerBatch(warehouse, batchReference())).toMatchObject({
      ok: false,
      error: 'batch_movement_graph_ambiguous',
    })
    expect(
      resolveConfirmedMixerBatch(
        warehouse,
        batchReference({
          allowDownstreamBatchEffects: true,
          allowedDownstreamShiftReportIds: ['shift-1'],
        }),
      ),
    ).toMatchObject({ ok: true, batchRunId: RUN_ID })

    ;(warehouse.movements[3] as Record<string, unknown>).documentLineId = 'foreign-line'
    expect(
      resolveConfirmedMixerBatch(
        warehouse,
        batchReference({
          allowDownstreamBatchEffects: true,
          allowedDownstreamShiftReportIds: ['shift-1'],
        }),
      ),
    ).toMatchObject({ ok: false, error: 'batch_downstream_movement_graph_invalid' })
  })

  it('never treats an orphan same-run movement as a downstream production effect', () => {
    const warehouse = warehouseFixture()
    ;(warehouse.movements as Array<Record<string, unknown>>).push({
      ...warehouse.movements[2],
      id: 'orphan-downstream-movement',
      documentId: 'missing-downstream-document',
    })

    expect(
      resolveConfirmedMixerBatch(
        warehouse,
        batchReference({ allowDownstreamBatchEffects: true }),
      ),
    ).toMatchObject({ ok: false, error: 'batch_downstream_document_ambiguous' })
  })

  it('rejects cancelled or reversed mixer effects', () => {
    const cancelledDocument = warehouseFixture()
    ;(cancelledDocument.documents[1] as Record<string, unknown>).cancelled = true
    expect(resolveConfirmedMixerBatch(cancelledDocument, batchReference())).toMatchObject({
      ok: false,
      error: 'batch_document_cancelled',
    })

    const reversed = warehouseFixture()
    ;(reversed.documents as Array<Record<string, unknown>>).push({
      id: 'batch-reversal-1',
      reversesDocumentId: 'batch-receipt-1',
    })
    expect(resolveConfirmedMixerBatch(reversed, batchReference())).toMatchObject({
      ok: false,
      error: 'batch_document_reversal_found',
    })
  })

  it('requires exact warehouse, location and batch tuples', () => {
    const wrongWarehouse = warehouseFixture()
    wrongWarehouse.movements[2].warehouseId = 'foreign-warehouse'
    expect(resolveConfirmedMixerBatch(wrongWarehouse, batchReference())).toMatchObject({
      ok: false,
      error: 'batch_receipt_movement_warehouse_mismatch',
    })

    const wrongLocation = warehouseFixture()
    wrongLocation.movements[2].locationId = 'foreign-location'
    expect(resolveConfirmedMixerBatch(wrongLocation, batchReference())).toMatchObject({
      ok: false,
      error: 'batch_receipt_movement_location_mismatch',
    })

    const wrongBatch = warehouseFixture()
    wrongBatch.movements[2].batchNo = 'FOREIGN-BATCH'
    expect(resolveConfirmedMixerBatch(wrongBatch, batchReference())).toMatchObject({
      ok: false,
      error: 'batch_receipt_movement_batch_number_mismatch',
    })
  })

  it.each([
    ['batch_issue_not_found', (warehouse) => warehouse.documents.shift()],
    [
      'batch_issue_ambiguous',
      (warehouse) => warehouse.documents.push({ ...warehouse.documents[0], id: 'batch-issue-2' }),
    ],
    ['batch_receipt_not_found', (warehouse) => warehouse.documents.pop()],
    [
      'batch_receipt_ambiguous',
      (warehouse) => warehouse.documents.push({ ...warehouse.documents[1], id: 'batch-receipt-2' }),
    ],
  ])('fails closed with %s when the posted pair is not unique', (error, mutate) => {
    const warehouse = warehouseFixture()
    mutate(warehouse)
    const result = resolveConfirmedMixerBatch(warehouse, batchReference())
    expect(result.ok).toBe(false)
    expect(result.error).toBe(error)
  })

  it('rejects an explicit receipt id that is not the resolved posted receipt', () => {
    const result = resolveConfirmedMixerBatch(
      warehouseFixture(),
      batchReference({ batchReceiptDocumentId: 'different-receipt' }),
    )
    expect(result.ok).toBe(false)
    expect(result.error).toBe('batch_receipt_document_mismatch')
  })

  it('rejects cancelled movements in the authoritative mixer graph', () => {
    const warehouse = warehouseFixture()
    ;(warehouse.movements as Array<Record<string, unknown>>).push({
      ...warehouse.movements[2],
      id: 'cancelled-old-movement',
      cancelled: true,
    })
    const result = resolveConfirmedMixerBatch(warehouse, batchReference())
    expect(result.ok).toBe(false)
    expect(result.error).toBe('batch_movement_cancelled')
  })

  it.each([
    [
      'batch_issue_order_lineage_missing',
      (warehouse) => delete warehouse.documents[0].productionOrderId,
    ],
    [
      'batch_receipt_order_mismatch',
      (warehouse) => {
        warehouse.documents[1].productionOrderId = 'other-order'
      },
    ],
    [
      'batch_issue_line_mismatch',
      (warehouse) => {
        warehouse.documents[0].productionLineId = '2'
      },
    ],
    [
      'batch_receipt_movement_line_lineage_missing',
      (warehouse) => delete warehouse.movements[2].productionLineId,
    ],
    [
      'batch_receipt_movement_batch_mismatch',
      (warehouse) => {
        warehouse.movements[2].batchRunId = 'different-run'
      },
    ],
    [
      'batch_receipt_line_batch_lineage_missing',
      (warehouse) => delete warehouse.documents[1].lines[0].batchRunId,
    ],
  ])('rejects broken authoritative lineage with %s', (error, mutate) => {
    const warehouse = warehouseFixture()
    mutate(warehouse)
    const result = resolveConfirmedMixerBatch(warehouse, batchReference())
    expect(result.ok).toBe(false)
    expect(result.error).toBe(error)
  })

  it.each([
    [
      'batch_output_item_mismatch',
      (warehouse) => {
        warehouse.documents[1].lines[0].itemId = 'some-other-output'
      },
    ],
    [
      'batch_issue_movements_missing',
      (warehouse) => {
        warehouse.movements = warehouse.movements.filter(
          (movement) => movement.documentId !== 'batch-issue-1',
        )
      },
    ],
    [
      'batch_receipt_movements_missing',
      (warehouse) => {
        warehouse.movements = warehouse.movements.filter(
          (movement) => movement.documentId !== 'batch-receipt-1',
        )
      },
    ],
    [
      'batch_receipt_movement_quantity_mismatch',
      (warehouse) => {
        warehouse.movements[2].quantity = 4
      },
    ],
    [
      'batch_document_number_mismatch',
      (warehouse) => {
        warehouse.documents[1].batchNo = 'OTHER-BATCH'
      },
    ],
    [
      'batch_receipt_movement_batch_number_mismatch',
      (warehouse) => {
        warehouse.movements[2].batchNo = 'OTHER-BATCH'
      },
    ],
    [
      'batch_receipt_document_type_mismatch',
      (warehouse) => {
        warehouse.documents[1].type = 'issue'
      },
    ],
    [
      'batch_number_missing',
      (warehouse) => delete warehouse.documents[1].lines[0].batchNo,
    ],
  ])('rejects unproved stock effects with %s', (error, mutate) => {
    const warehouse = warehouseFixture()
    mutate(warehouse)
    const result = resolveConfirmedMixerBatch(warehouse, batchReference())
    expect(result.ok).toBe(false)
    expect(result.error).toBe(error)
  })
})

describe('R3.1C applyImpregnationQcDecision', () => {
  it('uses a versioned canonical key which cannot encode the verdict', () => {
    expect(canonicalImpregnationQcDecisionKey(RUN_ID, 1)).toBe(
      'impregnation-qc:mix-cello-160-001:v1',
    )
    expect(canonicalImpregnationQcDecisionKey(RUN_ID, 2)).toBe(
      'impregnation-qc:mix-cello-160-001:v2',
    )
    expect(canonicalImpregnationQcDecisionKey('', 1)).toBe('')
    expect(canonicalImpregnationQcDecisionKey(RUN_ID, 0)).toBe('')
  })

  it('blocks a browser-claimed measured pass until server-owned lab evidence exists', () => {
    expectFailureWithoutMutation(
      productionFixture(),
      warehouseFixture(),
      measuredCommand(),
      'authoritative_lab_evidence_required',
      { allowEduManualVisual: false },
    )
  })

  it.each(['pending', 'fail'])('does not approve measured QC with labStatus=%s', (labStatus) => {
    expectFailureWithoutMutation(
      productionFixture(),
      warehouseFixture(),
      measuredCommand({ labStatus }),
      'measured_approval_requires_lab_pass',
    )
  })

  it('keeps lab pending separate from an allowed educational manual visual approval', () => {
    const result = applyImpregnationQcDecision(
      productionFixture(),
      warehouseFixture(),
      eduManualCommand({
        reason: '  EDU rehearsal: visual acceptance by responsible technologist  ',
      }),
      { uid: 'technologist-edu' },
      NOW,
      { allowEduManualVisual: true },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const row = result.production.impregnationQcDecisions[0]
    expect(row.labStatus).toBe('pending')
    expect(row.decision).toBe('approved')
    expect(row.decisionMethod).toBe('edu_manual_visual')
    expect(row.visualOk).toBe(true)
    expect(row.reason).toBe('EDU rehearsal: visual acceptance by responsible technologist')
  })

  it.each([
    [
      'edu_manual_visual_not_allowed',
      { visualOk: true, reason: 'visual acceptance' },
      { allowEduManualVisual: false },
    ],
    [
      'edu_manual_visual_requires_visual_ok',
      { visualOk: false, reason: 'visual acceptance' },
      { allowEduManualVisual: true },
    ],
    [
      'edu_manual_visual_reason_required',
      { visualOk: true, reason: '   ' },
      { allowEduManualVisual: true },
    ],
  ])('fails educational manual approval with %s', (error, overrides, options) => {
    expectFailureWithoutMutation(
      productionFixture(),
      warehouseFixture(),
      measuredCommand({
        labStatus: 'pending',
        decisionMethod: 'edu_manual_visual',
        ...overrides,
      }),
      error,
      options,
    )
  })

  it.each([
    ['production_order_not_found', { orders: [], impregnationQcDecisions: [] }, eduManualCommand()],
    [
      'production_order_ambiguous',
      {
        ...productionFixture(),
        orders: [
          ...productionFixture().orders,
          { ...productionFixture().orders[0] },
        ],
      },
      eduManualCommand(),
    ],
    [
      'production_order_not_active',
      productionFixture('draft'),
      eduManualCommand(),
    ],
    [
      'production_order_line_mismatch',
      productionFixture('active', '2'),
      eduManualCommand(),
    ],
  ])('validates the active order and exact line: %s', (error, production, command) => {
    expectFailureWithoutMutation(production, warehouseFixture(), command, error)
  })

  it('propagates exact batch-lineage failures and leaves both domains untouched', () => {
    const warehouse = warehouseFixture()
    warehouse.documents[1].productionOrderId = 'other-order'
    expectFailureWithoutMutation(
      productionFixture(),
      warehouse,
      eduManualCommand(),
      'batch_receipt_order_mismatch',
    )
  })

  it('does not create a line-ready decision from an unlinked receipt movement', () => {
    const warehouse = warehouseFixture()
    warehouse.movements[2].documentLineId = 'foreign-line'
    expectFailureWithoutMutation(
      productionFixture(),
      warehouse,
      eduManualCommand(),
      'batch_receipt_movement_document_lineage_mismatch',
    )
  })

  it('replays an identical canonical payload idempotently without a second decision', () => {
    const command = eduManualCommand({ reason: '  visual check passed  ' })
    const first = applyImpregnationQcDecision(
      productionFixture(),
      warehouseFixture(),
      command,
      { uid: 'technologist-1' },
      NOW,
      EDU_OPTIONS,
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const replay = applyImpregnationQcDecision(
      first.production,
      warehouseFixture(),
      { ...command, reason: 'visual check passed' },
      { uid: 'technologist-2' },
      '2026-09-10T11:00:00.000Z',
      EDU_OPTIONS,
    )
    expect(replay.ok).toBe(true)
    if (!replay.ok) return
    expect(replay.production).toBe(first.production)
    expect(replay.production.impregnationQcDecisions).toHaveLength(1)
    expect(replay.result.decisionId).toBe(first.result.decisionId)
    expect(replay.result.idempotent).toBe(true)
  })

  it('revalidates the current mixer graph before returning an idempotent replay', () => {
    const command = eduManualCommand()
    const warehouse = warehouseFixture()
    const first = applyImpregnationQcDecision(
      productionFixture(),
      warehouse,
      command,
      { uid: 'technologist-1' },
      NOW,
      EDU_OPTIONS,
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return

    warehouse.movements[2].documentLineId = 'foreign-line'
    const productionBefore = structuredClone(first.production)
    const warehouseBefore = structuredClone(warehouse)
    const replay = applyImpregnationQcDecision(
      first.production,
      warehouse,
      command,
      { uid: 'technologist-1' },
      '2026-09-10T11:00:00.000Z',
      EDU_OPTIONS,
    )
    expect(replay).toMatchObject({
      ok: false,
      error: 'batch_receipt_movement_document_lineage_mismatch',
    })
    expect(first.production).toEqual(productionBefore)
    expect(warehouse).toEqual(warehouseBefore)
  })

  it('replays after downstream use only when a confirmed shift proves the exact descendant', () => {
    const command = eduManualCommand()
    const warehouse = warehouseFixture()
    const first = applyImpregnationQcDecision(
      productionFixture(),
      warehouse,
      command,
      { uid: 'technologist-1' },
      NOW,
      EDU_OPTIONS,
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return
    addExactShiftConsumption(warehouse)

    const noConfirmedShift = applyImpregnationQcDecision(
      first.production,
      warehouse,
      command,
      { uid: 'technologist-1' },
      '2026-09-10T11:00:00.000Z',
      EDU_OPTIONS,
    )
    expect(noConfirmedShift).toMatchObject({
      ok: false,
      error: 'batch_movement_graph_ambiguous',
    })

    const wrongLineShift = applyImpregnationQcDecision(
      {
        ...first.production,
        shiftReports: [
          {
            id: 'shift-1',
            status: 'confirmed',
            batchRunId: RUN_ID,
            impregnationQcDecisionId: first.result.decisionId,
            productionOrderId: ORDER_ID,
            lineId: '2',
          },
        ],
      },
      warehouse,
      command,
      { uid: 'technologist-1' },
      '2026-09-10T11:00:00.000Z',
      EDU_OPTIONS,
    )
    expect(wrongLineShift).toMatchObject({
      ok: false,
      error: 'batch_movement_graph_ambiguous',
    })

    const productionAfterShift = {
      ...first.production,
      shiftReports: [
        {
          id: 'shift-1',
          status: 'confirmed',
          batchRunId: RUN_ID,
          impregnationQcDecisionId: first.result.decisionId,
          productionOrderId: ORDER_ID,
          lineId: LINE_ID,
        },
      ],
    }
    const replay = applyImpregnationQcDecision(
      productionAfterShift,
      warehouse,
      command,
      { uid: 'technologist-1' },
      '2026-09-10T11:00:00.000Z',
      EDU_OPTIONS,
    )
    expect(replay).toMatchObject({
      ok: true,
      result: { decisionId: first.result.decisionId, idempotent: true },
    })
  })

  it('revalidates a complete supersession chain before replaying an older decision', () => {
    const firstCommand = measuredCommand({
      labStatus: 'fail',
      decision: 'rejected',
      reason: 'Initial lab failure',
    })
    const first = applyImpregnationQcDecision(
      productionFixture(),
      warehouseFixture(),
      firstCommand,
      { uid: 'technologist-1' },
      NOW,
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const second = applyImpregnationQcDecision(
      first.production,
      warehouseFixture(),
      eduManualCommand({
        decisionRevision: 2,
        supersedesDecisionId: first.result.decisionId,
        supersessionReason: 'Retest accepted',
      }),
      { uid: 'technologist-2' },
      '2026-09-10T11:00:00.000Z',
      EDU_OPTIONS,
    )
    expect(second.ok).toBe(true)
    if (!second.ok) return

    const replay = applyImpregnationQcDecision(
      second.production,
      warehouseFixture(),
      firstCommand,
      { uid: 'technologist-1' },
      '2026-09-10T12:00:00.000Z',
    )
    expect(replay).toMatchObject({
      ok: true,
      result: {
        decisionId: first.result.decisionId,
        effective: false,
        lineReady: false,
        idempotent: true,
      },
    })

    const forged = structuredClone(second.production)
    forged.impregnationQcDecisions[0].supersededByDecisionId = 'forged-decision'
    expectFailureWithoutMutation(
      forged,
      warehouseFixture(),
      firstCommand,
      'impregnation_qc_supersession_history_invalid',
    )
  })

  it('returns an idempotency conflict for the same key with a changed canonical payload', () => {
    const command = eduManualCommand()
    const first = applyImpregnationQcDecision(
      productionFixture(),
      warehouseFixture(),
      command,
      { uid: 'technologist-1' },
      NOW,
      EDU_OPTIONS,
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const productionBefore = structuredClone(first.production)

    const conflict = applyImpregnationQcDecision(
      first.production,
      warehouseFixture(),
      { ...command, labStatus: 'fail' },
      { uid: 'technologist-1' },
      NOW,
      EDU_OPTIONS,
    )
    expect(conflict.ok).toBe(false)
    expect(conflict.error).toBe('impregnation_qc_idempotency_conflict')
    expect(first.production).toEqual(productionBefore)
  })

  it('validates the whole batch decision stream before replaying one revision', () => {
    const command = eduManualCommand()
    const first = applyImpregnationQcDecision(
      productionFixture(),
      warehouseFixture(),
      command,
      { uid: 'technologist-1' },
      NOW,
      EDU_OPTIONS,
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const corrupt = {
      ...first.production,
      impregnationQcDecisions: [
        ...first.production.impregnationQcDecisions,
        {
          ...first.production.impregnationQcDecisions[0],
          id: 'corrupt-v2',
          decisionId: 'corrupt-v2',
          decisionKey: canonicalImpregnationQcDecisionKey(RUN_ID, 2),
          decisionRevision: 2,
        },
      ],
    }
    expectFailureWithoutMutation(
      corrupt,
      warehouseFixture(),
      command,
      'impregnation_qc_supersession_history_invalid',
    )
  })

  it('rejects a noncanonical key before any mutation', () => {
    expectFailureWithoutMutation(
      productionFixture(),
      warehouseFixture(),
      measuredCommand({ decisionKey: `impregnation-qc:${RUN_ID}:approved` }),
      'noncanonical_decision_key',
    )
  })

  it('supersedes one effective decision atomically and exposes the new line-ready decision', () => {
    const first = applyImpregnationQcDecision(
      productionFixture(),
      warehouseFixture(),
      measuredCommand({
        labStatus: 'fail',
        decision: 'rejected',
        reason: 'Initial lab failure',
      }),
      { uid: 'technologist-1' },
      NOW,
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const secondCommand = eduManualCommand({
      decisionRevision: 2,
      supersedesDecisionId: first.result.decisionId,
      supersessionReason: 'Retest completed with corrected evidence',
      sourceQcRecordId: 'lab-record-2',
      labEvidenceFingerprint: 'sha256:lab-evidence-2',
    })
    const second = applyImpregnationQcDecision(
      first.production,
      warehouseFixture(),
      secondCommand,
      { uid: 'technologist-2' },
      '2026-09-10T11:00:00.000Z',
      EDU_OPTIONS,
    )

    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.production.impregnationQcDecisions).toHaveLength(2)
    const [oldDecision, newDecision] = second.production.impregnationQcDecisions
    expect(oldDecision).toMatchObject({
      id: first.result.decisionId,
      effective: false,
      supersededByDecisionId: second.result.decisionId,
      supersededAt: '2026-09-10T11:00:00.000Z',
    })
    expect(newDecision).toMatchObject({
      decisionRevision: 2,
      supersedesDecisionId: first.result.decisionId,
      supersessionReason: 'Retest completed with corrected evidence',
      effective: true,
      decision: 'approved',
    })
    expect(second.production.impregnationQcDecisions.filter((row) => row.effective)).toHaveLength(1)
    expect(second.result).toMatchObject({
      decisionId: newDecision.id,
      decisionKey: canonicalImpregnationQcDecisionKey(RUN_ID, 2),
      decisionRevision: 2,
      batchRunId: RUN_ID,
      batchNo: 'IMP-001',
      effective: true,
      lineReady: true,
      idempotent: false,
    })
  })

  it.each([
    [
      'impregnation_qc_supersession_required',
      () => eduManualCommand({ decisionRevision: 2 }),
    ],
    [
      'impregnation_qc_supersedes_mismatch',
      () =>
        eduManualCommand({
          decisionRevision: 2,
          supersedesDecisionId: 'different-decision',
          supersessionReason: 'Retest',
        }),
    ],
    [
      'impregnation_qc_revision_conflict',
      (decisionId) =>
        eduManualCommand({
          decisionRevision: 3,
          supersedesDecisionId: decisionId,
          supersessionReason: 'Retest',
        }),
    ],
    [
      'impregnation_qc_supersession_reason_required',
      (decisionId) =>
        eduManualCommand({ decisionRevision: 2, supersedesDecisionId: decisionId }),
    ],
  ])('fails closed on unsafe transition: %s', (error, nextCommand) => {
    const first = applyImpregnationQcDecision(
      productionFixture(),
      warehouseFixture(),
      eduManualCommand(),
      { uid: 'technologist-1' },
      NOW,
      EDU_OPTIONS,
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expectFailureWithoutMutation(
      first.production,
      warehouseFixture(),
      nextCommand(first.result.decisionId),
      error,
    )
  })

  it('blocks supersession after the effective decision was consumed by a confirmed shift', () => {
    const first = applyImpregnationQcDecision(
      productionFixture(),
      warehouseFixture(),
      eduManualCommand(),
      { uid: 'technologist-1' },
      NOW,
      EDU_OPTIONS,
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const consumed = {
      ...first.production,
      shiftReports: [
        {
          id: 'shift-1',
          status: 'confirmed',
          batchRunId: RUN_ID,
          impregnationQcDecisionId: first.result.decisionId,
        },
      ],
    }

    expectFailureWithoutMutation(
      consumed,
      warehouseFixture(),
      eduManualCommand({
        decisionRevision: 2,
        supersedesDecisionId: first.result.decisionId,
        supersessionReason: 'Should be blocked after line consumption',
      }),
      'impregnation_qc_decision_already_used_by_shift',
    )
  })

  it('replays a superseded historical revision without making it effective again', () => {
    const firstCommand = measuredCommand({
      labStatus: 'fail',
      decision: 'rejected',
      reason: 'Initial failure',
    })
    const first = applyImpregnationQcDecision(
      productionFixture(),
      warehouseFixture(),
      firstCommand,
      { uid: 'technologist-1' },
      NOW,
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = applyImpregnationQcDecision(
      first.production,
      warehouseFixture(),
      eduManualCommand({
        decisionRevision: 2,
        supersedesDecisionId: first.result.decisionId,
        supersessionReason: 'Retest passed',
      }),
      { uid: 'technologist-1' },
      '2026-09-10T11:00:00.000Z',
      EDU_OPTIONS,
    )
    expect(second.ok).toBe(true)
    if (!second.ok) return

    const replay = applyImpregnationQcDecision(
      second.production,
      warehouseFixture(),
      firstCommand,
      { uid: 'technologist-2' },
      '2026-09-10T12:00:00.000Z',
    )
    expect(replay.ok).toBe(true)
    if (!replay.ok) return
    expect(replay.production).toBe(second.production)
    expect(replay.result).toMatchObject({
      decisionId: first.result.decisionId,
      idempotent: true,
      effective: false,
      lineReady: false,
      supersededByDecisionId: second.result.decisionId,
    })
  })
})

describe('R3.1C critical production normalization', () => {
  it('preserves authoritative impregnation decisions through parse/normalize', () => {
    const decision = {
      id: 'decision-v1',
      decisionId: 'decision-v1',
      decisionKey: canonicalImpregnationQcDecisionKey(RUN_ID, 1),
      decisionRevision: 1,
      batchRunId: RUN_ID,
      decision: 'approved',
      effective: true,
    }
    const parsed = parseCriticalPayload({
      schemaVersion: 5,
      domains: {
        warehouse: {},
        production: {
          impregnationQcDecisions: [decision],
        },
      },
    })

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.payload.domains.production.impregnationQcDecisions).toEqual([decision])
  })
})
