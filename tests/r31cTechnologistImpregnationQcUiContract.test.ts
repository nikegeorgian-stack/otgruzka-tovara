import { describe, expect, it } from 'vitest'
import {
  collectConfirmedImpregnationMixerBatches,
  impregnationQcDecisionKey,
  isEduManualVisualUiEnabled,
  resolveImpregnationQcDecisionStream,
} from '../src/lib/technologist/types'

function fixture() {
  const formulations = {
    batchRuns: [
      {
        id: 'run-1',
        documentNumber: 'ЗМ-20260910-001',
        status: 'confirmed',
        mixTaskId: 'task-1',
        productionOrderId: 'order-1',
        productionLineId: '1',
        recipeId: 'recipe-1',
        recipeCode: 'РП-0003',
        recipeName: 'Celloplex 160',
        outputWarehouseItemId: 'impregnation-1',
        outputKg: 537.8,
        issueDocumentId: 'issue-1',
        receiptDocumentId: 'receipt-1',
        mixedAt: '2026-09-10',
        confirmedAt: '2026-09-10T10:00:00.000Z',
      },
    ],
  }
  const warehouse = {
    documents: [
      {
        id: 'issue-1',
        type: 'issue',
        purpose: 'production',
        status: 'posted',
        docRole: 'batch_issue',
        warehouseId: 'raw-warehouse',
        batchRunId: 'run-1',
        productionOrderId: 'order-1',
        productionLineId: '1',
        lines: [
          {
            lineId: 'issue-line-1',
            itemId: 'chemistry-1',
            quantity: 537.8,
            locationId: 'raw-location-1',
            batchRunId: 'run-1',
            productionOrderId: 'order-1',
            productionLineId: '1',
          },
        ],
      },
      {
        id: 'receipt-1',
        type: 'receipt',
        purpose: 'production',
        status: 'posted',
        docRole: 'batch_receipt',
        warehouseId: 'line-warehouse',
        batchRunId: 'run-1',
        productionOrderId: 'order-1',
        productionLineId: '1',
        batchNo: 'ЗМ-20260910-001',
        lines: [
          {
            lineId: 'receipt-line-1',
            itemId: 'impregnation-1',
            quantity: 537.8,
            batchNo: 'ЗМ-20260910-001',
            locationId: 'line-location-1',
            batchRunId: 'run-1',
            productionOrderId: 'order-1',
            productionLineId: '1',
          },
        ],
      },
    ],
    movements: [
      {
        id: 'movement-issue-1',
        documentId: 'issue-1',
        documentLineId: 'issue-line-1',
        type: 'issue',
        itemId: 'chemistry-1',
        quantity: 537.8,
        warehouseId: 'raw-warehouse',
        locationId: 'raw-location-1',
        batchRunId: 'run-1',
        productionOrderId: 'order-1',
        productionLineId: '1',
      },
      {
        id: 'movement-receipt-1',
        documentId: 'receipt-1',
        documentLineId: 'receipt-line-1',
        type: 'receipt',
        itemId: 'impregnation-1',
        quantity: 537.8,
        warehouseId: 'line-warehouse',
        locationId: 'line-location-1',
        batchRunId: 'run-1',
        productionOrderId: 'order-1',
        productionLineId: '1',
        batchNo: 'ЗМ-20260910-001',
      },
    ],
  }
  const orders = [
    {
      id: 'order-1',
      orderNumber: 'ЗП-2026-003',
      status: 'active',
      lineId: '1',
    },
  ]
  return { formulations, warehouse, orders }
}

function collect(input: ReturnType<typeof fixture>) {
  return collectConfirmedImpregnationMixerBatches(
    input.formulations as unknown as Parameters<
      typeof collectConfirmedImpregnationMixerBatches
    >[0],
    input.warehouse as unknown as Parameters<
      typeof collectConfirmedImpregnationMixerBatches
    >[1],
    input.orders as unknown as Parameters<typeof collectConfirmedImpregnationMixerBatches>[2],
  )
}

describe('R3.1C technologist impregnation QC selection', () => {
  it('projects only the exact confirmed mixer lineage and canonical batch number', () => {
    const rows = collect(fixture())
    expect(rows).toEqual([
      expect.objectContaining({
        batchRunId: 'run-1',
        batchNo: 'ЗМ-20260910-001',
        batchIssueDocumentId: 'issue-1',
        batchReceiptDocumentId: 'receipt-1',
        productionOrderId: 'order-1',
        productionOrderNumber: 'ЗП-2026-003',
        productionLineId: '1',
        outputWarehouseItemId: 'impregnation-1',
        outputQuantity: 537.8,
        recipeId: 'recipe-1',
      }),
    ])
  })

  it('does not offer a batch whose mixer graph contains a cancelled movement', () => {
    const input = fixture()
    ;(input.warehouse.movements as Array<Record<string, unknown>>).push({
      ...input.warehouse.movements[1],
      id: 'cancelled-old-receipt',
      type: 'issue',
      quantity: 999,
      cancelled: true,
    })
    expect(collect(input)).toEqual([])
  })

  it('allows an exact FEFO split of one issue document line', () => {
    const input = fixture()
    const issueLine = input.warehouse.documents[0].lines[0] as Record<string, unknown>
    const issueMovements = input.warehouse.movements as Array<Record<string, unknown>>
    delete issueLine.locationId
    issueMovements[0].quantity = 200
    issueMovements[0].batchNo = 'CHEM-LOT-1'
    issueMovements.push({
      ...issueMovements[0],
      id: 'movement-issue-2',
      quantity: 337.8,
      batchNo: 'CHEM-LOT-2',
      locationId: 'raw-location-2',
    })

    expect(collect(input)).toHaveLength(1)
  })

  it('checks issue quantities by document line instead of aggregate item totals', () => {
    const input = fixture()
    const issueLines = input.warehouse.documents[0].lines as Array<Record<string, unknown>>
    const issueMovements = input.warehouse.movements as Array<Record<string, unknown>>
    issueLines[0].quantity = 300
    issueLines.push({
      ...issueLines[0],
      lineId: 'issue-line-2',
      quantity: 237.8,
    })
    issueMovements[0].quantity = 237.8
    issueMovements.push({
      ...issueMovements[0],
      id: 'movement-issue-2',
      documentLineId: 'issue-line-2',
      quantity: 300,
    })

    expect(collect(input)).toEqual([])
  })

  it.each([
    [
      'free mix without order lineage',
      (input: ReturnType<typeof fixture>) => {
        input.formulations.batchRuns[0].productionOrderId = ''
      },
    ],
    [
      'pending mix',
      (input: ReturnType<typeof fixture>) => {
        input.formulations.batchRuns[0].status = 'pending'
      },
    ],
    [
      'inactive production order',
      (input: ReturnType<typeof fixture>) => {
        input.orders[0].status = 'draft'
      },
    ],
    [
      'receipt for another output item',
      (input: ReturnType<typeof fixture>) => {
        input.warehouse.documents[1].lines[0].itemId = 'finished-product-1'
      },
    ],
    [
      'duplicate posted receipt',
      (input: ReturnType<typeof fixture>) => {
        input.warehouse.documents.push({
          ...input.warehouse.documents[1],
          id: 'receipt-duplicate',
        })
      },
    ],
    [
      'missing receipt movements',
      (input: ReturnType<typeof fixture>) => {
        input.warehouse.movements = input.warehouse.movements.filter(
          (movement) => movement.documentId !== 'receipt-1',
        )
      },
    ],
    [
      'movement from another line',
      (input: ReturnType<typeof fixture>) => {
        input.warehouse.movements[1].productionLineId = '2'
      },
    ],
    [
      'movement from another batch run',
      (input: ReturnType<typeof fixture>) => {
        input.warehouse.movements[1].batchRunId = 'run-other'
      },
    ],
    [
      'document line without order lineage',
      (input: ReturnType<typeof fixture>) => {
        input.warehouse.documents[1].lines[0].productionOrderId = ''
      },
    ],
    [
      'wrong receipt document type',
      (input: ReturnType<typeof fixture>) => {
        input.warehouse.documents[1].type = 'issue'
      },
    ],
    [
      'movement quantity does not match receipt',
      (input: ReturnType<typeof fixture>) => {
        input.warehouse.movements[1].quantity = 500
      },
    ],
    [
      'mixer output does not match receipt',
      (input: ReturnType<typeof fixture>) => {
        input.formulations.batchRuns[0].outputKg = 500
      },
    ],
    [
      'duplicate mixer run id',
      (input: ReturnType<typeof fixture>) => {
        input.formulations.batchRuns.push({ ...input.formulations.batchRuns[0] })
      },
    ],
    [
      'duplicate production order id',
      (input: ReturnType<typeof fixture>) => {
        input.orders.push({ ...input.orders[0] })
      },
    ],
    [
      'conflicting free-text batch number',
      (input: ReturnType<typeof fixture>) => {
        input.warehouse.documents[1].lines[0].batchNo = 'B-ORPHAN'
      },
    ],
    [
      'conflicting receipt document batch number',
      (input: ReturnType<typeof fixture>) => {
        input.warehouse.documents[1].batchNo = 'B-ORPHAN'
      },
    ],
    [
      'receipt movement without canonical batch number',
      (input: ReturnType<typeof fixture>) => {
        input.warehouse.movements[1].batchNo = ''
      },
    ],
    [
      'movement without document-line lineage',
      (input: ReturnType<typeof fixture>) => {
        delete (input.warehouse.movements[0] as Record<string, unknown>).documentLineId
      },
    ],
    [
      'movement linked to a foreign document line',
      (input: ReturnType<typeof fixture>) => {
        input.warehouse.movements[0].documentLineId = 'foreign-line'
      },
    ],
    [
      'empty item identity on a document line and its movement',
      (input: ReturnType<typeof fixture>) => {
        input.warehouse.documents[0].lines[0].itemId = ''
        input.warehouse.movements[0].itemId = ''
      },
    ],
    [
      'duplicate movement id',
      (input: ReturnType<typeof fixture>) => {
        input.warehouse.movements[1].id = input.warehouse.movements[0].id
      },
    ],
    [
      'movement without an id',
      (input: ReturnType<typeof fixture>) => {
        input.warehouse.movements[0].id = ''
      },
    ],
    [
      'document line without an id',
      (input: ReturnType<typeof fixture>) => {
        input.warehouse.documents[0].lines[0].lineId = ''
      },
    ],
    [
      'duplicate document-line id across the selected pair',
      (input: ReturnType<typeof fixture>) => {
        input.warehouse.documents[1].lines[0].lineId = 'issue-line-1'
        input.warehouse.movements[1].documentLineId = 'issue-line-1'
      },
    ],
    [
      'split receipt movements',
      (input: ReturnType<typeof fixture>) => {
        const movements = input.warehouse.movements as Array<Record<string, unknown>>
        movements[1].quantity = 200
        movements.push({
          ...movements[1],
          id: 'movement-receipt-2',
          quantity: 337.8,
        })
      },
    ],
    [
      'movement from another warehouse',
      (input: ReturnType<typeof fixture>) => {
        input.warehouse.movements[1].warehouseId = 'foreign-warehouse'
      },
    ],
    [
      'movement from another location',
      (input: ReturnType<typeof fixture>) => {
        input.warehouse.movements[1].locationId = 'foreign-location'
      },
    ],
    [
      'issue movement from another source batch',
      (input: ReturnType<typeof fixture>) => {
        ;(input.warehouse.documents[0].lines[0] as Record<string, unknown>).batchNo =
          'CHEM-LOT-1'
        ;(input.warehouse.movements[0] as Record<string, unknown>).batchNo = 'CHEM-LOT-2'
      },
    ],
    [
      'foreign same-run movement outside the selected document pair',
      (input: ReturnType<typeof fixture>) => {
        ;(input.warehouse.movements as Array<Record<string, unknown>>).push({
          ...input.warehouse.movements[0],
          id: 'movement-foreign',
          documentId: 'document-foreign',
        })
      },
    ],
    [
      'cancelled mixer document',
      (input: ReturnType<typeof fixture>) => {
        ;(input.warehouse.documents[0] as Record<string, unknown>).cancelled = true
      },
    ],
    [
      'reversal of a selected mixer document',
      (input: ReturnType<typeof fixture>) => {
        ;(input.warehouse.documents as Array<Record<string, unknown>>).push({
          id: 'reversal-1',
          reversesDocumentId: 'receipt-1',
        })
      },
    ],
    [
      'cancellation reference to a selected mixer document',
      (input: ReturnType<typeof fixture>) => {
        ;(input.warehouse.documents as Array<Record<string, unknown>>).push({
          id: 'cancellation-1',
          cancelledDocumentId: 'issue-1',
        })
      },
    ],
    [
      'non-production mixer document',
      (input: ReturnType<typeof fixture>) => {
        input.warehouse.documents[0].purpose = 'writeoff'
      },
    ],
  ])('does not offer %s for an authoritative decision', (_label, mutate) => {
    const input = fixture()
    mutate(input)
    expect(collect(input)).toEqual([])
  })
})

function authoritativeDecision(overrides: Record<string, unknown> = {}) {
  return {
    id: 'decision-v1',
    decisionId: 'decision-v1',
    decisionKey: impregnationQcDecisionKey('run-1', 1),
    decisionRevision: 1,
    decision: 'approved',
    labStatus: 'pass',
    decisionMethod: 'measured',
    productionOrderId: 'order-1',
    productionLineId: '1',
    batchRunId: 'run-1',
    batchNo: 'ЗМ-20260910-001',
    batchIssueDocumentId: 'issue-1',
    batchReceiptDocumentId: 'receipt-1',
    outputWarehouseItemId: 'impregnation-1',
    outputQuantity: 537.8,
    effective: true,
    ...overrides,
  }
}

describe('R3.1C authoritative QC decision stream projection', () => {
  it('derives a verdict-independent canonical stream key', () => {
    expect(impregnationQcDecisionKey('run-1', 1)).toBe('impregnation-qc:run-1:v1')
    expect(impregnationQcDecisionKey('run-1', 2)).toBe('impregnation-qc:run-1:v2')
    expect(impregnationQcDecisionKey('run-1', -1)).toBe('')
  })

  it('starts at v1 only when the loaded authoritative stream is empty', () => {
    const batch = collect(fixture())[0]
    expect(resolveImpregnationQcDecisionStream([], batch)).toEqual({
      ok: true,
      current: null,
      nextRevision: 1,
    })
  })

  it('derives v2 from one exact effective v1', () => {
    const batch = collect(fixture())[0]
    expect(resolveImpregnationQcDecisionStream([authoritativeDecision()] as never, batch)).toMatchObject({
      ok: true,
      currentDecisionId: 'decision-v1',
      nextRevision: 2,
    })
  })

  it('accepts one complete supersession chain and derives the next revision', () => {
    const batch = collect(fixture())[0]
    const v1 = authoritativeDecision({
      effective: false,
      supersededByDecisionId: 'decision-v2',
    })
    const v2 = authoritativeDecision({
      id: 'decision-v2',
      decisionId: 'decision-v2',
      decisionKey: impregnationQcDecisionKey('run-1', 2),
      decisionRevision: 2,
      supersedesDecisionId: 'decision-v1',
      supersessionReason: 'Retest passed',
    })
    expect(resolveImpregnationQcDecisionStream([v2, v1] as never, batch)).toMatchObject({
      ok: true,
      currentDecisionId: 'decision-v2',
      nextRevision: 3,
    })
  })

  it.each([
    [
      'impregnation_qc_revision_history_invalid',
      [authoritativeDecision({ decisionRevision: 2, decisionKey: impregnationQcDecisionKey('run-1', 2) })],
    ],
    [
      'impregnation_qc_decision_key_history_invalid',
      [authoritativeDecision({ decisionKey: 'impregnation-qc:run-1:approved' })],
    ],
    [
      'impregnation_qc_decision_lineage_history_invalid',
      [authoritativeDecision({ outputQuantity: undefined })],
    ],
    [
      'impregnation_qc_effective_decision_missing',
      [authoritativeDecision({ effective: false, supersededByDecisionId: 'missing-v2' })],
    ],
    [
      'impregnation_qc_current_decision_id_missing',
      [authoritativeDecision({ id: undefined, decisionId: undefined })],
    ],
    [
      'impregnation_qc_supersession_history_invalid',
      [
        authoritativeDecision({ effective: false, supersededByDecisionId: 'decision-v2' }),
        authoritativeDecision({
          id: 'decision-v2',
          decisionId: 'decision-v2',
          decisionKey: impregnationQcDecisionKey('run-1', 2),
          decisionRevision: 2,
          supersedesDecisionId: 'decision-v1',
          supersessionReason: '',
        }),
      ],
    ],
    [
      'impregnation_qc_decision_id_history_ambiguous',
      [
        authoritativeDecision({
          effective: false,
          supersededByDecisionId: 'decision-v1',
        }),
        authoritativeDecision({
          decisionKey: impregnationQcDecisionKey('run-1', 2),
          decisionRevision: 2,
          supersedesDecisionId: 'decision-v1',
          supersessionReason: 'Retest passed',
        }),
      ],
    ],
    [
      'impregnation_qc_decision_status_history_invalid',
      [authoritativeDecision({ decision: 'unknown' })],
    ],
  ])('fails closed for malformed authoritative history: %s', (error, history) => {
    const batch = collect(fixture())[0]
    expect(resolveImpregnationQcDecisionStream(history as never, batch)).toEqual({
      ok: false,
      error,
    })
  })
})

describe('R3.1C educational visual approval UI gate', () => {
  it('opens only when explicitly requested for the exact staging project', () => {
    expect(isEduManualVisualUiEnabled('otgruzka-tovara-stg', true)).toBe(true)
    expect(isEduManualVisualUiEnabled('otgruzka-tovara-stg', false)).toBe(false)
    expect(isEduManualVisualUiEnabled('otgruzka-tovara', true)).toBe(false)
    expect(isEduManualVisualUiEnabled('another-stg', true)).toBe(false)
    expect(isEduManualVisualUiEnabled(undefined, true)).toBe(false)
  })
})
