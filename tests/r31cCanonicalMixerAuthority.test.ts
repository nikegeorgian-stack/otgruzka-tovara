/**
 * R3.1C — a canonical mixer receipt is authorized by the frozen production
 * order recipe/output mapping. A mixer task is correlation only.
 */
import { describe, expect, it } from 'vitest'
import { validateBatchMixAuthoritativeAck } from '@/lib/formulations/batch'
import { applyBatchMixConfirmCritical } from '../server/fst/_g2BatchMixConfirm.mjs'

const DATE = '2026-09-10'
const NOW = `${DATE}T12:00:00.000Z`
const RAW_WAREHOUSE = 'raw-wh'
const LINE_WAREHOUSE = 'line-wh'
const LINE_LOCATION = 'line-location'
const ORDER_ID = 'order-v1'
const LINE_ID = 'line-1'
const RECIPE_ID = 'recipe-1'
const OUTPUT_ITEM_ID = 'impregnation-output'

function warehouse() {
  return {
    locations: [
      { id: RAW_WAREHOUSE, name: 'Raw' },
      { id: LINE_WAREHOUSE, name: 'Line warehouse' },
      { id: LINE_LOCATION, name: 'Line location' },
    ],
    categories: [],
    items: [
      { id: 'component-a', name: 'A', unit: 'kg', active: true },
      { id: 'component-b', name: 'B', unit: 'kg', active: true },
      { id: OUTPUT_ITEM_ID, name: 'Impregnation', unit: 'kg', active: true },
    ],
    documents: [],
    movements: [
      {
        id: 'seed-a',
        type: 'receipt',
        itemId: 'component-a',
        quantity: 100,
        warehouseId: RAW_WAREHOUSE,
        documentId: 'seed',
        date: DATE,
        at: `${DATE}T00:00:00.000Z`,
      },
      {
        id: 'seed-b',
        type: 'receipt',
        itemId: 'component-b',
        quantity: 100,
        warehouseId: RAW_WAREHOUSE,
        documentId: 'seed',
        date: DATE,
        at: `${DATE}T00:00:00.000Z`,
      },
    ],
    auditLog: [],
    closedMonths: [],
    productionLineBindings: [
      {
        lineId: LINE_ID,
        productionWarehouseId: LINE_WAREHOUSE,
        productionLocationId: LINE_LOCATION,
      },
    ],
    accountingByWarehouse: [
      { id: 'raw-accounting', warehouseId: RAW_WAREHOUSE, status: 'active' },
      { id: 'line-accounting', warehouseId: LINE_WAREHOUSE, status: 'active' },
    ],
  }
}

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    status: 'active',
    wipContractVersion: 1,
    lineId: LINE_ID,
    formulationRecipeId: RECIPE_ID,
    impregnationOutputItemId: OUTPUT_ITEM_ID,
    recipeNormSnapshot: {
      recipeId: RECIPE_ID,
      recipeVersionId: 'recipe-version-1',
      versionNumber: 1,
      contentHash: 'rv-canonical',
      normBase: 'per_batch',
      batchSize: 10,
      components: [
        {
          lineId: 'recipe-line-a',
          warehouseItemId: 'component-a',
          unitSnapshot: 'kg',
          normQty: 4,
          tolerancePct: 0,
        },
        {
          lineId: 'recipe-line-b',
          warehouseItemId: 'component-b',
          unitSnapshot: 'kg',
          normQty: 6,
          tolerancePct: 0,
        },
      ],
      snappedAt: NOW,
    },
    ...overrides,
  }
}

function command(overrides: Record<string, unknown> = {}) {
  return {
    batchRunId: 'batch-run-1',
    recipeId: RECIPE_ID,
    documentNumber: 'ZM-20260910-001',
    issueNumber: 'ZM-20260910-001-Р',
    receiptNumber: 'ZM-20260910-001-П',
    warehouseId: RAW_WAREHOUSE,
    date: DATE,
    productionOrderId: ORDER_ID,
    productionLineId: LINE_ID,
    issueLines: [
      { itemId: 'component-a', quantity: 8 },
      { itemId: 'component-b', quantity: 12 },
    ],
    receiptLines: [{ itemId: OUTPUT_ITEM_ID, quantity: 20 }],
    ...overrides,
  }
}

function context(canonicalOrder = order()) {
  return { enforceCanonicalLineage: true, production: { orders: [canonicalOrder] } }
}

function apply(
  wh = warehouse(),
  cmd = command(),
  canonicalOrder = order(),
) {
  return applyBatchMixConfirmCritical(
    wh,
    cmd,
    { uid: 'keeper-1', email: 'keeper@example.test' },
    NOW,
    context(canonicalOrder),
  )
}

function clientRun() {
  return {
    id: 'batch-run-1',
    documentNumber: 'ZM-20260910-001',
    status: 'pending',
    recipeId: RECIPE_ID,
    recipeCode: 'RP-1',
    recipeName: 'Recipe 1',
    targetVolumeL: 20,
    scaleFactor: 2,
    lines: [
      { componentId: 'a', name: 'A', warehouseItemId: 'component-a', consumeKg: 8 },
      { componentId: 'b', name: 'B', warehouseItemId: 'component-b', consumeKg: 12 },
    ],
    outputWarehouseItemId: OUTPUT_ITEM_ID,
    outputKg: 20,
    warehouseId: RAW_WAREHOUSE,
    mixedAt: DATE,
    mixedBy: 'mixer-1',
    mixedByName: 'Mixer',
    productionOrderId: ORDER_ID,
    productionLineId: LINE_ID,
    createdAt: NOW,
  } as const
}

function expectRejected(
  cmd: ReturnType<typeof command>,
  error: string,
  canonicalOrder = order(),
) {
  const wh = warehouse()
  const before = JSON.stringify(wh)
  const result = apply(wh, cmd, canonicalOrder)
  expect(result).toMatchObject({ ok: false, error })
  expect(JSON.stringify(wh)).toBe(before)
}

describe('R3.1C canonical mixer authority', () => {
  it('accepts an exact frozen-recipe batch without requiring a mixer task', () => {
    const result = apply()
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const issue = result.warehouse.documents.find(
      (document: { docRole?: string }) => document.docRole === 'batch_issue',
    )
    const receipt = result.warehouse.documents.find(
      (document: { docRole?: string }) => document.docRole === 'batch_receipt',
    )
    expect(issue).toMatchObject({
      recipeId: RECIPE_ID,
      productionOrderId: ORDER_ID,
      productionLineId: LINE_ID,
      warehouseId: RAW_WAREHOUSE,
    })
    expect(receipt).toMatchObject({
      recipeId: RECIPE_ID,
      productionOrderId: ORDER_ID,
      productionLineId: LINE_ID,
      warehouseId: LINE_WAREHOUSE,
    })
    expect(receipt.lines).toEqual([
      expect.objectContaining({
        itemId: OUTPUT_ITEM_ID,
        quantity: 20,
        locationId: LINE_LOCATION,
      }),
    ])
    expect(result.warehouse.movements.filter(
      (movement: { batchRunId?: string }) => movement.batchRunId === 'batch-run-1',
    )).toHaveLength(3)

    const replay = apply(result.warehouse, command(), order())
    expect(replay).toMatchObject({ ok: true, result: { idempotentHint: true } })
    expect(replay.warehouse.documents).toHaveLength(result.warehouse.documents.length)
    expect(replay.warehouse.movements).toHaveLength(result.warehouse.movements.length)
  })

  it('rejects a new staging batch with no order/line lineage and writes nothing', () => {
    const wh = warehouse()
    const before = JSON.stringify(wh)
    const unlinked = command({
      productionOrderId: undefined,
      productionLineId: undefined,
    })

    const result = applyBatchMixConfirmCritical(
      wh,
      unlinked,
      { uid: 'keeper-1', email: 'keeper@example.test' },
      NOW,
      { enforceCanonicalLineage: true, production: { orders: [order()] } },
    )

    expect(result).toMatchObject({ ok: false, error: 'mixer_lineage_incomplete' })
    expect(JSON.stringify(wh)).toBe(before)
  })

  it('requires a complete revisioned client ack with exact docs, movements and fingerprint', () => {
    const result = apply()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const cmd = command()
    const ack = {
      ...result.result,
      criticalRevision: 8,
      warehouse: result.warehouse,
    }
    expect(
      validateBatchMixAuthoritativeAck(clientRun() as never, cmd as never, ack),
    ).toEqual({
      ok: true,
      issueDocumentId: result.result.issueDocumentId,
      receiptDocumentId: result.result.receiptDocumentId,
    })

    expect(
      validateBatchMixAuthoritativeAck(clientRun() as never, cmd as never, {
        ...ack,
        criticalRevision: 0,
      }),
    ).toMatchObject({ ok: false, error: 'batch_mix_authoritative_ack_invalid' })
    expect(
      validateBatchMixAuthoritativeAck(
        clientRun() as never,
        cmd as never,
        ack,
        8,
      ),
    ).toMatchObject({ ok: false, error: 'batch_mix_authoritative_ack_invalid' })
    expect(
      validateBatchMixAuthoritativeAck(
        clientRun() as never,
        cmd as never,
        { ...ack, idempotent: true },
        8,
      ),
    ).toMatchObject({ ok: true })
    expect(
      validateBatchMixAuthoritativeAck(clientRun() as never, cmd as never, {
        ...ack,
        commandFingerprint: 'stale-fingerprint',
      }),
    ).toMatchObject({ ok: false, error: 'batch_mix_authoritative_ack_invalid' })

    const missingMovement = structuredClone(ack)
    missingMovement.warehouse.movements.pop()
    expect(
      validateBatchMixAuthoritativeAck(clientRun() as never, cmd as never, missingMovement),
    ).toMatchObject({ ok: false, error: 'batch_mix_authoritative_ack_invalid' })

    const wrongLineage = structuredClone(ack)
    const issue = wrongLineage.warehouse.documents.find(
      (document: { docRole?: string }) => document.docRole === 'batch_issue',
    )
    issue.productionOrderId = 'order-stale'
    expect(
      validateBatchMixAuthoritativeAck(clientRun() as never, cmd as never, wrongLineage),
    ).toMatchObject({ ok: false, error: 'batch_mix_authoritative_ack_invalid' })

    const wrongIssueWarehouse = structuredClone(ack)
    wrongIssueWarehouse.warehouse.movements.find(
      (movement: { type?: string }) => movement.type === 'issue',
    ).warehouseId = 'wrong-source'
    expect(
      validateBatchMixAuthoritativeAck(
        clientRun() as never,
        cmd as never,
        wrongIssueWarehouse,
      ),
    ).toMatchObject({ ok: false, error: 'batch_mix_authoritative_ack_invalid' })

    const wrongIssueLine = structuredClone(ack)
    wrongIssueLine.warehouse.movements.find(
      (movement: { type?: string }) => movement.type === 'issue',
    ).documentLineId = 'wrong-document-line'
    expect(
      validateBatchMixAuthoritativeAck(clientRun() as never, cmd as never, wrongIssueLine),
    ).toMatchObject({ ok: false, error: 'batch_mix_authoritative_ack_invalid' })

    const wrongReceiptTuple = structuredClone(ack)
    const receiptMovement = wrongReceiptTuple.warehouse.movements.find(
      (movement: { documentId?: string }) =>
        movement.documentId === result.result.receiptDocumentId,
    )
    receiptMovement.documentLineId = 'wrong-document-line'
    receiptMovement.batchNo = 'stale-batch'
    expect(
      validateBatchMixAuthoritativeAck(
        clientRun() as never,
        cmd as never,
        wrongReceiptTuple,
      ),
    ).toMatchObject({ ok: false, error: 'batch_mix_authoritative_ack_invalid' })

    const unexpectedCancellation = structuredClone(ack)
    const sourceReceiptMovement = ack.warehouse.movements.find(
      (movement: { documentId?: string }) =>
        movement.documentId === result.result.receiptDocumentId,
    )
    unexpectedCancellation.warehouse.movements.push({
      ...structuredClone(sourceReceiptMovement),
      id: 'cancel-movement',
      type: 'unreserve',
      documentId: result.result.receiptDocumentId,
      batchRunId: 'batch-run-1',
    })
    expect(
      validateBatchMixAuthoritativeAck(
        clientRun() as never,
        cmd as never,
        unexpectedCancellation,
      ),
    ).toMatchObject({ ok: false, error: 'batch_mix_authoritative_ack_invalid' })

    const cancelledExpectedMovement = structuredClone(ack)
    cancelledExpectedMovement.warehouse.movements.find(
      (movement: { documentId?: string }) =>
        movement.documentId === result.result.issueDocumentId,
    ).cancelled = true
    expect(
      validateBatchMixAuthoritativeAck(
        clientRun() as never,
        cmd as never,
        cancelledExpectedMovement,
      ),
    ).toMatchObject({ ok: false, error: 'batch_mix_authoritative_ack_invalid' })

    const nonFiniteReceiptMovement = structuredClone(ack)
    nonFiniteReceiptMovement.warehouse.movements.find(
      (movement: { documentId?: string }) =>
        movement.documentId === result.result.receiptDocumentId,
    ).quantity = Number.NaN
    expect(
      validateBatchMixAuthoritativeAck(
        clientRun() as never,
        cmd as never,
        nonFiniteReceiptMovement,
      ),
    ).toMatchObject({ ok: false, error: 'batch_mix_authoritative_ack_invalid' })
  })

  it('rejects a recipe other than the order recipe', () => {
    expectRejected(command({ recipeId: 'recipe-wrong' }), 'mixer_recipe_mismatch')
  })

  it('requires an active order and its exact frozen production line', () => {
    expectRejected(
      command(),
      'production_order_not_active',
      order({ status: 'draft' }),
    )
    expectRejected(
      command({ productionLineId: 'line-2' }),
      'production_order_line_mismatch',
    )
  })

  it('rejects a receipt item other than the frozen impregnation output', () => {
    expectRejected(
      command({ receiptLines: [{ itemId: 'output-wrong', quantity: 20 }] }),
      'mixer_output_item_mismatch',
    )
  })

  it('rejects missing or extra formulation components', () => {
    expectRejected(
      command({
        issueLines: [
          { itemId: 'component-a', quantity: 8 },
          { itemId: 'component-extra', quantity: 12 },
        ],
      }),
      'mixer_components_mismatch',
    )
  })

  it('rejects aggregate component quantities that do not match scaled norms', () => {
    expectRejected(
      command({
        issueLines: [
          { itemId: 'component-a', quantity: 8 },
          { itemId: 'component-b', quantity: 11.999 },
        ],
      }),
      'mixer_component_quantity_mismatch',
    )
  })

  it('rejects duplicate receipt lines and duplicate persisted receipt documents', () => {
    expectRejected(
      command({
        receiptLines: [
          { itemId: OUTPUT_ITEM_ID, quantity: 10 },
          { itemId: OUTPUT_ITEM_ID, quantity: 10 },
        ],
      }),
      'mixer_receipt_line_invalid',
    )

    const first = apply()
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const receipt = first.warehouse.documents.find(
      (document: { docRole?: string }) => document.docRole === 'batch_receipt',
    )
    first.warehouse.documents.push({ ...structuredClone(receipt), id: 'duplicate-receipt' })
    const duplicate = apply(first.warehouse, command(), order())
    expect(duplicate).toMatchObject({ ok: false, error: 'duplicate_batch_receipt_docs' })
  })

  it('replays only an exact active document-line-movement graph and payload', () => {
    const first = apply()
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const missingMovement = structuredClone(first.warehouse)
    missingMovement.movements = missingMovement.movements.filter(
      (movement: { documentId?: string }) =>
        movement.documentId !== first.result.receiptDocumentId,
    )
    expect(apply(missingMovement)).toMatchObject({
      ok: false,
      error: 'batch_mix_existing_state_mismatch',
    })

    const wrongDocumentLine = structuredClone(first.warehouse)
    wrongDocumentLine.movements.find(
      (movement: { documentId?: string }) =>
        movement.documentId === first.result.receiptDocumentId,
    ).documentLineId = 'wrong-line'
    expect(apply(wrongDocumentLine)).toMatchObject({
      ok: false,
      error: 'batch_mix_existing_state_mismatch',
    })

    const cancelledMovement = structuredClone(first.warehouse)
    cancelledMovement.movements.find(
      (movement: { documentId?: string }) =>
        movement.documentId === first.result.issueDocumentId,
    ).cancelled = true
    expect(apply(cancelledMovement)).toMatchObject({
      ok: false,
      error: 'batch_mix_existing_state_mismatch',
    })

    const nonFiniteMovement = structuredClone(first.warehouse)
    nonFiniteMovement.movements.find(
      (movement: { documentId?: string }) =>
        movement.documentId === first.result.receiptDocumentId,
    ).quantity = Number.NaN
    expect(apply(nonFiniteMovement)).toMatchObject({
      ok: false,
      error: 'batch_mix_existing_state_mismatch',
    })

    const extraMovement = structuredClone(first.warehouse)
    const receiptMovement = extraMovement.movements.find(
      (movement: { documentId?: string }) =>
        movement.documentId === first.result.receiptDocumentId,
    )
    extraMovement.movements.push({ ...receiptMovement, id: 'unexpected-movement' })
    expect(apply(extraMovement)).toMatchObject({
      ok: false,
      error: 'batch_mix_existing_state_mismatch',
    })

    const nonFiniteDocument = structuredClone(first.warehouse)
    nonFiniteDocument.documents.find(
      (document: { id?: string }) => document.id === first.result.receiptDocumentId,
    ).lines[0].quantity = Number.NaN
    expect(apply(nonFiniteDocument)).toMatchObject({
      ok: false,
      error: 'batch_mix_existing_state_mismatch',
    })

    const nonPositiveMovement = structuredClone(first.warehouse)
    nonPositiveMovement.movements.find(
      (movement: { documentId?: string }) =>
        movement.documentId === first.result.issueDocumentId,
    ).quantity = 0
    expect(apply(nonPositiveMovement)).toMatchObject({
      ok: false,
      error: 'batch_mix_existing_state_mismatch',
    })

    expect(apply(first.warehouse, command({ comment: 'changed payload' }))).toMatchObject({
      ok: false,
      error: 'batch_mix_replay_conflict',
    })
  })

  it('rejects an order with no frozen impregnation output mapping', () => {
    expectRejected(
      command(),
      'impregnation_output_mapping_required',
      order({ impregnationOutputItemId: undefined }),
    )
  })
})
