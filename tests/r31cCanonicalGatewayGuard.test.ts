import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyCriticalPayload } from '../server/fst/_g1CriticalHelpers.mjs'
import { applyProductionRequestPost } from '../server/fst/_g3RequestPost.mjs'
import {
  CANONICAL_ORDER_REPLAN_REQUIRED,
  LEGACY_REQUEST_POST_NEW_WRITE_FORBIDDEN,
} from '../server/fst/_g3CanonicalLineage.mjs'
import {
  applyImpregnationQcDecision,
  canonicalImpregnationQcDecisionKey,
} from '../server/fst/_g3ImpregnationQc.mjs'

const harness = vi.hoisted(() => ({
  staging: true,
  critical: null as null | Record<string, unknown>,
  receipt: null as null | Record<string, unknown>,
  principal: null as null | Record<string, unknown>,
  upsertCritical: vi.fn(async () => undefined),
  updateCas: vi.fn(async () => undefined),
  insertReceipt: vi.fn(async () => undefined),
}))

vi.mock('../server/fst/_g1DataConnect.mjs', () => ({
  getG1DataConnect: vi.fn(() => ({ mocked: true })),
  getFstPrincipalAccessByUidStore: vi.fn(async () => ({
    data: { fstPrincipalAccesses: harness.principal ? [harness.principal] : [] },
  })),
  getFstCriticalStore: vi.fn(async () => ({
    data: { fstCriticalStore: harness.critical },
  })),
  getFstCommandReceipt: vi.fn(async () => ({
    data: { fstCommandReceipt: harness.receipt },
  })),
  upsertFstCriticalStore: (...args: unknown[]) => harness.upsertCritical(...args),
  updateFstCriticalStoreCas: (...args: unknown[]) => harness.updateCas(...args),
  insertFstCommandReceipt: (...args: unknown[]) => harness.insertReceipt(...args),
}))

vi.mock('../server/fst/_adminAuth.mjs', () => ({
  FST_ADMIN_EMAILS: new Set<string>(),
}))

vi.mock('../server/fst/_dataConnectRuntime.mjs', () => ({
  isStagingIsolatedRuntime: () => harness.staging,
}))

const STORE = 'fibercell-main'
const REQUEST = 'legacy-complete'
const ORDER = 'order-1'
const RAW_WAREHOUSE = 'raw-wh'
const LINE_WAREHOUSE = 'line-wh'
const PACK_WAREHOUSE = 'pack-wh'
const LINE_LOCATION = 'line-location'
const PACK_LOCATION = 'pack-location'
const DATE = '2026-09-10'
const NOW = `${DATE}T12:00:00.000Z`
const ACTOR = { uid: 'keeper-1', email: 'keeper@example.test', claims: {} }

function grant(lineIds = ['*']) {
  harness.principal = {
    id: `${STORE}::${ACTOR.uid}`,
    firebaseUid: ACTOR.uid,
    storeId: STORE,
    active: true,
    capabilitiesJson: JSON.stringify({
      'production.request.post': true,
      'production.order.confirm': true,
      'production.material.issue': true,
      'production.material.return': true,
      'production.impregnationQc.decide': true,
      productionLineIds: lineIds,
    }),
  }
}

function baseWarehouse() {
  return {
    items: [],
    locations: [
      { id: RAW_WAREHOUSE },
      { id: LINE_WAREHOUSE },
      { id: PACK_WAREHOUSE },
      { id: LINE_LOCATION },
      { id: PACK_LOCATION },
    ],
    documents: [],
    movements: [],
    auditLog: [],
    materialShortages: [],
    closedMonths: [],
    accountingByWarehouse: [
      { id: LINE_WAREHOUSE, warehouseId: LINE_WAREHOUSE, status: 'active' },
      { id: PACK_WAREHOUSE, warehouseId: PACK_WAREHOUSE, status: 'active' },
    ],
    productionLineBindings: [
      {
        lineId: 'line-1',
        productionWarehouseId: LINE_WAREHOUSE,
        productionLocationId: LINE_LOCATION,
      },
      {
        lineId: 'pack',
        productionWarehouseId: PACK_WAREHOUSE,
        productionLocationId: PACK_LOCATION,
      },
    ],
  }
}

function baseProduction() {
  return {
    recipeVersions: [],
    orders: [
      {
        id: ORDER,
        status: 'active',
        lineId: 'line-1',
        finishedProductId: 'finished-good',
        semiFinishedItemId: 'semi-finished',
      },
    ],
    shiftReports: [],
    wipBatches: [],
    finishedGoodsLots: [],
    wasteRecords: [],
    handoffs: [],
    auditLog: [],
  }
}

function requestCommand(overrides: Record<string, unknown> = {}) {
  return {
    requestId: REQUEST,
    lineId: 'line-1',
    orderId: ORDER,
    shiftDate: DATE,
    shiftSlot: 'day',
    outputMp: 10,
    outputRolls: 1,
    semiFinishedItemId: 'semi-finished',
    warehouseItemId: 'semi-finished',
    consumeLines: [],
    productionWarehouseId: LINE_WAREHOUSE,
    productionLocationId: LINE_LOCATION,
    packWarehouseId: PACK_WAREHOUSE,
    packLocationId: PACK_LOCATION,
    ...overrides,
  }
}

function setCritical(production: Record<string, unknown>, warehouse: Record<string, unknown>) {
  const payload = emptyCriticalPayload()
  payload.domains.production = production
  payload.domains.warehouse = warehouse
  payload.domainMeta.production = { active: true, version: 1 }
  payload.domainMeta.warehouse = { active: true, version: 1 }
  harness.critical = {
    id: STORE,
    revision: 7,
    payloadJson: JSON.stringify(payload),
    fingerprint: 'test-fingerprint',
  }
}

function setCompletedRequest() {
  const applied = applyProductionRequestPost(
    baseProduction(),
    baseWarehouse(),
    requestCommand(),
    ACTOR,
    NOW,
  )
  expect(applied.ok).toBe(true)
  setCritical(applied.production, applied.warehouse)
}

function qcReplayFixture() {
  const batchRunId = 'mix-run-qc-1'
  const batchNo = 'B-IMP-QC-1'
  const outputItemId = 'impregnation-output'
  const issueDocumentId = 'mix-issue-qc-1'
  const receiptDocumentId = 'mix-receipt-qc-1'
  const warehouse = baseWarehouse()
  warehouse.documents.push(
    {
      id: issueDocumentId,
      type: 'issue',
      purpose: 'production',
      status: 'posted',
      docRole: 'batch_issue',
      warehouseId: RAW_WAREHOUSE,
      batchRunId,
      productionOrderId: ORDER,
      productionLineId: 'line-1',
      lines: [
        {
          lineId: 'mix-issue-line-qc-1',
          itemId: 'component-qc-1',
          quantity: 2,
          locationId: RAW_WAREHOUSE,
          batchRunId,
          productionOrderId: ORDER,
          productionLineId: 'line-1',
        },
      ],
    },
    {
      id: receiptDocumentId,
      type: 'receipt',
      purpose: 'production',
      status: 'posted',
      docRole: 'batch_receipt',
      warehouseId: LINE_WAREHOUSE,
      batchRunId,
      batchNo,
      productionOrderId: ORDER,
      productionLineId: 'line-1',
      lines: [
        {
          lineId: 'mix-receipt-line-qc-1',
          itemId: outputItemId,
          quantity: 2,
          batchNo,
          locationId: LINE_LOCATION,
          batchRunId,
          productionOrderId: ORDER,
          productionLineId: 'line-1',
        },
      ],
    },
  )
  warehouse.movements.push(
    {
      id: 'mix-issue-movement-qc-1',
      documentId: issueDocumentId,
      documentLineId: 'mix-issue-line-qc-1',
      type: 'issue',
      itemId: 'component-qc-1',
      quantity: 2,
      warehouseId: RAW_WAREHOUSE,
      locationId: RAW_WAREHOUSE,
      batchRunId,
      productionOrderId: ORDER,
      productionLineId: 'line-1',
    },
    {
      id: 'mix-receipt-movement-qc-1',
      documentId: receiptDocumentId,
      documentLineId: 'mix-receipt-line-qc-1',
      type: 'receipt',
      itemId: outputItemId,
      quantity: 2,
      warehouseId: LINE_WAREHOUSE,
      locationId: LINE_LOCATION,
      batchNo,
      batchRunId,
      productionOrderId: ORDER,
      productionLineId: 'line-1',
    },
  )
  const production = baseProduction()
  const command = {
    decisionKey: canonicalImpregnationQcDecisionKey(batchRunId, 1),
    decisionRevision: 1,
    productionOrderId: ORDER,
    productionLineId: 'line-1',
    batchRunId,
    batchReceiptDocumentId: receiptDocumentId,
    outputWarehouseItemId: outputItemId,
    labStatus: 'pending',
    decision: 'approved',
    decisionMethod: 'edu_manual_visual',
    visualOk: true,
    reason: 'EDU staging visual acceptance',
  }
  const applied = applyImpregnationQcDecision(
    production,
    warehouse,
    command,
    ACTOR,
    NOW,
    { allowEduManualVisual: true },
  )
  expect(applied.ok).toBe(true)
  if (!applied.ok) throw new Error(applied.error)
  return { command, production: applied.production, warehouse }
}

beforeEach(() => {
  harness.staging = true
  harness.critical = null
  harness.receipt = null
  harness.principal = null
  harness.upsertCritical.mockClear()
  harness.updateCas.mockClear()
  harness.insertReceipt.mockClear()
  grant()
})

describe('R3.1C staging gateway canonical lineage guards', () => {
  it('rejects EDU manual visual approval outside the isolated staging runtime without CAS', async () => {
    const fixture = qcReplayFixture()
    fixture.production.impregnationQcDecisions = []
    setCritical(fixture.production, fixture.warehouse)
    harness.staging = false

    const service = await import('../server/fst/_g3ProductionService.mjs')
    const result = await service.executeG3Command({
      actor: ACTOR,
      storeId: STORE,
      idempotencyKey: 'qc-production-runtime-denied',
      commandType: 'production.impregnationQc.decide',
      command: fixture.command,
    })

    expect(result.ok).toBe(false)
    expect(result.error).toBe('edu_manual_visual_not_allowed')
    expect(harness.updateCas).not.toHaveBeenCalled()
    expect(harness.upsertCritical).not.toHaveBeenCalled()
    expect(harness.insertReceipt).not.toHaveBeenCalled()
  })

  it('returns an exact issue/return ack and preserves the source handoff lot lineage', async () => {
    const warehouse = baseWarehouse()
    warehouse.locations.push({ id: 'other-raw' })
    warehouse.documents.push({
      id: 'reservation-1',
      type: 'reservation',
      status: 'posted',
      purpose: 'production_reservation',
      docRole: 'production_reservation',
      productionOrderId: ORDER,
      warehouseId: RAW_WAREHOUSE,
      lines: [
        {
          lineId: 'reservation-line-1',
          itemId: 'raw-roll',
          quantity: 5,
          locationId: RAW_WAREHOUSE,
        },
      ],
    })
    warehouse.movements.push(
      {
        id: 'raw-receipt-1',
        type: 'receipt',
        warehouseId: RAW_WAREHOUSE,
        itemId: 'raw-roll',
        quantity: 5,
        batchNo: 'RAW-BATCH-1',
        expiryDate: '2027-09-10',
        locationId: RAW_WAREHOUSE,
        at: NOW,
      },
      {
        id: 'reservation-movement-1',
        documentId: 'reservation-1',
        documentLineId: 'reservation-line-1',
        type: 'reserve',
        productionOrderId: ORDER,
        warehouseId: RAW_WAREHOUSE,
        itemId: 'raw-roll',
        quantity: 5,
        locationId: RAW_WAREHOUSE,
        at: NOW,
      },
    )
    const production = baseProduction()
    production.orders[0] = {
      ...production.orders[0],
      wipContractVersion: 1,
      rawMaterialItemId: 'raw-roll',
      reservationDocumentId: 'reservation-1',
    }
    const service = await import('../server/fst/_g3ProductionService.mjs')

    for (const [suffix, mutate] of [
      [
        'extra-line',
        (candidate: ReturnType<typeof baseWarehouse>) => {
          const reservation = candidate.documents.find((row) => row.id === 'reservation-1')!
          reservation.lines.push({
            lineId: 'unexpected-reservation-line',
            itemId: 'unexpected-item',
            quantity: 1,
            locationId: RAW_WAREHOUSE,
          })
          candidate.movements.push({
            id: 'unexpected-reservation-movement',
            documentId: 'reservation-1',
            documentLineId: 'unexpected-reservation-line',
            type: 'reserve',
            productionOrderId: ORDER,
            warehouseId: RAW_WAREHOUSE,
            locationId: RAW_WAREHOUSE,
            itemId: 'unexpected-item',
            quantity: 1,
            at: NOW,
          })
        },
      ],
      [
        'duplicate-movement',
        (candidate: ReturnType<typeof baseWarehouse>) => {
          candidate.movements.push({
            ...candidate.movements.find((row) => row.id === 'reservation-movement-1')!,
            id: 'duplicate-reservation-movement',
          })
        },
      ],
      [
        'non-finite-movement',
        (candidate: ReturnType<typeof baseWarehouse>) => {
          candidate.movements.find((row) => row.id === 'reservation-movement-1')!.quantity =
            Number.NaN
        },
      ],
    ] as const) {
      const corruptWarehouse = structuredClone(warehouse)
      mutate(corruptWarehouse)
      setCritical(production, corruptWarehouse)
      const rejected = await service.executeG3Command({
        actor: ACTOR,
        storeId: STORE,
        idempotencyKey: `canonical-handoff-${suffix}`,
        commandType: 'production.material.issueToLine',
        command: {
          orderId: ORDER,
          lineId: 'line-1',
          rawWarehouseId: RAW_WAREHOUSE,
          reservationDocumentId: 'reservation-1',
          lines: [{ itemId: 'raw-roll', quantity: 5 }],
        },
      })
      expect(rejected.ok, suffix).toBe(false)
      expect(harness.updateCas, suffix).not.toHaveBeenCalled()
    }

    setCritical(production, warehouse)
    const issued = await service.executeG3Command({
      actor: ACTOR,
      storeId: STORE,
      idempotencyKey: 'canonical-handoff-issue-1',
      commandType: 'production.material.issueToLine',
      command: {
        orderId: ORDER,
        lineId: 'line-1',
        rawWarehouseId: RAW_WAREHOUSE,
        reservationDocumentId: 'reservation-1',
        lines: [{ itemId: 'raw-roll', quantity: 5 }],
      },
    })

    expect(issued.ok).toBe(true)
    expect(issued).toMatchObject({
      orderId: ORDER,
      lineId: 'line-1',
      reservationDocumentId: 'reservation-1',
    })
    expect(issued.transferPairId).toBeTruthy()
    expect(issued.documentIds).toHaveLength(2)
    expect(new Set(issued.documentIds).size).toBe(2)
    const issuePair = issued.warehouse.documents.filter(
      (document: { transferPairId?: string }) =>
        document.transferPairId === issued.transferPairId,
    )
    expect(issuePair).toHaveLength(2)
    expect(issuePair[0]).toMatchObject({
      id: issued.documentIds[0],
      type: 'issue',
      purpose: 'production_issue',
      docRole: 'transfer_issue',
      productionOrderId: ORDER,
      productionLineId: 'line-1',
      reservationDocumentId: 'reservation-1',
    })
    expect(issuePair[1]).toMatchObject({
      id: issued.documentIds[1],
      type: 'receipt',
      purpose: 'production_receipt',
      docRole: 'transfer_receipt',
      productionOrderId: ORDER,
      productionLineId: 'line-1',
      reservationDocumentId: 'reservation-1',
    })
    expect(
      issued.production.handoffs.filter(
        (handoff: { transferPairId?: string }) =>
          handoff.transferPairId === issued.transferPairId,
      ),
    ).toEqual([
      expect.objectContaining({
        orderId: ORDER,
        lineId: 'line-1',
        issueDocumentId: issued.documentIds[0],
        receiptDocumentId: issued.documentIds[1],
        reservationDocumentId: 'reservation-1',
      }),
    ])

    const warehouseAfterIssue = { ...warehouse, ...issued.warehouse }
    setCritical(issued.production, warehouseAfterIssue)
    harness.receipt = {
      id: 'canonical-handoff-issue-1',
      storeId: STORE,
      commandType: 'production.material.issueToLine',
      resultJson: JSON.stringify({ staleTransportShortcut: true }),
      criticalRevisionAfter: 2,
    }
    harness.updateCas.mockClear()
    harness.insertReceipt.mockClear()
    const exactIssueReplay = await service.executeG3Command({
      actor: ACTOR,
      storeId: STORE,
      idempotencyKey: 'canonical-handoff-issue-1',
      commandType: 'production.material.issueToLine',
      command: {
        orderId: ORDER,
        lineId: 'line-1',
        rawWarehouseId: RAW_WAREHOUSE,
        reservationDocumentId: 'reservation-1',
        lines: [{ itemId: 'raw-roll', quantity: 5 }],
      },
    })
    expect(exactIssueReplay).toMatchObject({
      ok: true,
      idempotent: true,
      transferPairId: issued.transferPairId,
      commandFingerprint: issued.commandFingerprint,
    })
    expect(exactIssueReplay.staleTransportShortcut).toBeUndefined()
    expect(harness.updateCas).not.toHaveBeenCalled()
    expect(harness.insertReceipt).not.toHaveBeenCalled()

    const issueCommand = {
      orderId: ORDER,
      lineId: 'line-1',
      rawWarehouseId: RAW_WAREHOUSE,
      reservationDocumentId: 'reservation-1',
      lines: [{ itemId: 'raw-roll', quantity: 5 }],
    }
    for (const [label, changed] of [
      ['quantity', { ...issueCommand, lines: [{ itemId: 'raw-roll', quantity: 4 }] }],
      ['warehouse', { ...issueCommand, rawWarehouseId: 'other-raw' }],
      [
        'batch',
        { ...issueCommand, lines: [{ itemId: 'raw-roll', quantity: 5, batchNo: 'OTHER' }] },
      ],
      [
        'expiry',
        { ...issueCommand, lines: [{ itemId: 'raw-roll', quantity: 5, expiryDate: '2028-01-01' }] },
      ],
      ['reason', { ...issueCommand, reason: 'changed reason' }],
    ] as const) {
      const conflict = await service.executeG3Command({
        actor: ACTOR,
        storeId: STORE,
        idempotencyKey: 'canonical-handoff-issue-1',
        commandType: 'production.material.issueToLine',
        command: changed,
      })
      expect(conflict, label).toMatchObject({
        ok: false,
        error: 'material_handoff_idempotency_conflict',
      })
      expect(harness.updateCas, label).not.toHaveBeenCalled()
      expect(harness.insertReceipt, label).not.toHaveBeenCalled()
    }
    const commandTypeCollision = await service.executeG3Command({
      actor: ACTOR,
      storeId: STORE,
      idempotencyKey: 'canonical-handoff-issue-1',
      commandType: 'production.material.returnFromLine',
      command: {
        orderId: ORDER,
        lineId: 'line-1',
        rawWarehouseId: RAW_WAREHOUSE,
        reason: 'unused',
        lines: [
          {
            itemId: 'raw-roll',
            quantity: 1,
            batchNo: 'RAW-BATCH-1',
            expiryDate: '2027-09-10',
          },
        ],
      },
    })
    expect(commandTypeCollision).toMatchObject({
      ok: false,
      error: 'material_handoff_idempotency_conflict',
    })
    expect(harness.updateCas).not.toHaveBeenCalled()

    harness.receipt = null
    setCritical(issued.production, warehouseAfterIssue)
    const returned = await service.executeG3Command({
      actor: ACTOR,
      storeId: STORE,
      idempotencyKey: 'canonical-handoff-return-1',
      commandType: 'production.material.returnFromLine',
      command: {
        orderId: ORDER,
        lineId: 'line-1',
        rawWarehouseId: RAW_WAREHOUSE,
        reason: 'unused material',
        lines: [
          {
            itemId: 'raw-roll',
            quantity: 2,
            batchNo: 'RAW-BATCH-1',
            expiryDate: '2027-09-10',
          },
        ],
      },
    })

    expect(returned.ok, JSON.stringify(returned)).toBe(true)
    expect(returned).toMatchObject({ orderId: ORDER, lineId: 'line-1' })
    expect(returned.transferPairId).toBeTruthy()
    expect(returned.documentIds).toHaveLength(2)
    expect(returned.sourceTransferPairIds).toEqual([issued.transferPairId])
    const returnPair = returned.warehouse.documents.filter(
      (document: { transferPairId?: string }) =>
        document.transferPairId === returned.transferPairId,
    )
    expect(returnPair).toHaveLength(2)
    expect(returnPair).toEqual([
      expect.objectContaining({
        id: returned.documentIds[0],
        type: 'issue',
        purpose: 'production_material_return',
        docRole: 'transfer_issue',
        productionOrderId: ORDER,
        productionLineId: 'line-1',
        returnReason: 'unused material',
        sourceTransferPairIds: [issued.transferPairId],
      }),
      expect.objectContaining({
        id: returned.documentIds[1],
        type: 'receipt',
        purpose: 'production_material_return',
        docRole: 'transfer_receipt',
        productionOrderId: ORDER,
        productionLineId: 'line-1',
        returnReason: 'unused material',
        sourceTransferPairIds: [issued.transferPairId],
      }),
    ])
    const returnMovements = returned.warehouse.movements.filter(
      (movement: { documentId?: string }) => returned.documentIds.includes(movement.documentId),
    )
    expect(returnMovements).toHaveLength(2)
    expect(returnMovements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          documentId: returned.documentIds[0],
          type: 'issue',
          warehouseId: LINE_WAREHOUSE,
          locationId: LINE_LOCATION,
          productionOrderId: ORDER,
          productionLineId: 'line-1',
          batchNo: 'RAW-BATCH-1',
          expiryDate: '2027-09-10',
          quantity: 2,
        }),
        expect.objectContaining({
          documentId: returned.documentIds[1],
          type: 'receipt',
          warehouseId: RAW_WAREHOUSE,
          productionOrderId: ORDER,
          productionLineId: 'line-1',
          batchNo: 'RAW-BATCH-1',
          expiryDate: '2027-09-10',
          quantity: 2,
        }),
      ]),
    )
    expect(
      returned.production.handoffs.find(
        (handoff: { transferPairId?: string }) =>
          handoff.transferPairId === returned.transferPairId,
      ),
    ).toMatchObject({
      kind: 'return',
      orderId: ORDER,
      lineId: 'line-1',
      issueDocumentId: returned.documentIds[0],
      receiptDocumentId: returned.documentIds[1],
      sourceTransferPairIds: [issued.transferPairId],
    })

    const warehouseAfterReturn = {
      ...warehouseAfterIssue,
      ...returned.warehouse,
    }
    setCritical(returned.production, warehouseAfterReturn)
    harness.receipt = {
      id: 'canonical-handoff-return-1',
      storeId: STORE,
      commandType: 'production.material.returnFromLine',
      resultJson: JSON.stringify({ staleTransportShortcut: true }),
      criticalRevisionAfter: 2,
    }
    harness.updateCas.mockClear()
    harness.insertReceipt.mockClear()
    const exactReturnReplay = await service.executeG3Command({
      actor: ACTOR,
      storeId: STORE,
      idempotencyKey: 'canonical-handoff-return-1',
      commandType: 'production.material.returnFromLine',
      command: {
        orderId: ORDER,
        lineId: 'line-1',
        rawWarehouseId: RAW_WAREHOUSE,
        reason: 'unused material',
        lines: [
          {
            itemId: 'raw-roll',
            quantity: 2,
            batchNo: 'RAW-BATCH-1',
            expiryDate: '2027-09-10',
          },
        ],
      },
    })
    expect(exactReturnReplay, JSON.stringify(exactReturnReplay)).toMatchObject({
      ok: true,
      idempotent: true,
      transferPairId: returned.transferPairId,
      commandFingerprint: returned.commandFingerprint,
      reason: 'unused material',
    })
    expect(exactReturnReplay.staleTransportShortcut).toBeUndefined()
    expect(harness.updateCas).not.toHaveBeenCalled()
    expect(harness.insertReceipt).not.toHaveBeenCalled()

    setCritical(issued.production, warehouseAfterIssue)
    harness.receipt = null
    for (const [idempotencyKey, lines, rawWarehouseId, expectedError] of [
      [
        'canonical-return-duplicate-overdraw',
        [
          { itemId: 'raw-roll', quantity: 3, batchNo: 'RAW-BATCH-1', expiryDate: '2027-09-10' },
          { itemId: 'raw-roll', quantity: 3, batchNo: 'RAW-BATCH-1', expiryDate: '2027-09-10' },
        ],
        RAW_WAREHOUSE,
        'return_exceeds_remaining',
      ],
      [
        'canonical-return-wrong-lot',
        [{ itemId: 'raw-roll', quantity: 1, batchNo: 'FORGED-BATCH', expiryDate: '2027-09-10' }],
        RAW_WAREHOUSE,
        'return_exceeds_remaining',
      ],
      [
        'canonical-return-negative',
        [{ itemId: 'raw-roll', quantity: -1, batchNo: 'RAW-BATCH-1', expiryDate: '2027-09-10' }],
        RAW_WAREHOUSE,
        'invalid_line',
      ],
      [
        'canonical-return-wrong-source',
        [{ itemId: 'raw-roll', quantity: 1, batchNo: 'RAW-BATCH-1', expiryDate: '2027-09-10' }],
        'other-raw',
        'return_source_handoff_not_found',
      ],
    ] as const) {
      const rejected = await service.executeG3Command({
        actor: ACTOR,
        storeId: STORE,
        idempotencyKey,
        commandType: 'production.material.returnFromLine',
        command: {
          orderId: ORDER,
          lineId: 'line-1',
          rawWarehouseId,
          reason: 'invalid return must not post',
          lines,
        },
      })
      expect(rejected.ok).toBe(false)
      expect(rejected.error).toBe(expectedError)
    }
  })

  it('revalidates an exact QC replay against the current decision and performs no CAS', async () => {
    const fixture = qcReplayFixture()
    setCritical(fixture.production, fixture.warehouse)
    harness.receipt = {
      id: 'qc-transport-attempt-1',
      storeId: STORE,
      commandType: 'production.impregnationQc.decide',
      resultJson: JSON.stringify({ staleReceiptShortcut: true }),
      criticalRevisionAfter: 2,
    }

    const service = await import('../server/fst/_g3ProductionService.mjs')
    const result = await service.executeG3Command({
      actor: ACTOR,
      storeId: STORE,
      idempotencyKey: 'qc-transport-attempt-1',
      commandType: 'production.impregnationQc.decide',
      command: fixture.command,
    })

    expect(result.ok).toBe(true)
    expect(result.idempotent).toBe(true)
    expect(result.staleReceiptShortcut).toBeUndefined()
    expect(result.criticalRevision).toBe(7)
    expect(result.touchesWarehouse).toBe(false)
    expect(result.production.impregnationQcDecisions).toHaveLength(1)
    expect(harness.updateCas).not.toHaveBeenCalled()
    expect(harness.upsertCritical).not.toHaveBeenCalled()
    expect(harness.insertReceipt).not.toHaveBeenCalled()
  })

  it('does not let a stale QC transport receipt bypass a corrupted mixer graph', async () => {
    const fixture = qcReplayFixture()
    fixture.warehouse.movements[1].documentLineId = 'foreign-line'
    setCritical(fixture.production, fixture.warehouse)
    harness.receipt = {
      id: 'qc-transport-stale-graph',
      storeId: STORE,
      commandType: 'production.impregnationQc.decide',
      resultJson: JSON.stringify({ staleReceiptShortcut: true }),
      criticalRevisionAfter: 2,
    }

    const service = await import('../server/fst/_g3ProductionService.mjs')
    const result = await service.executeG3Command({
      actor: ACTOR,
      storeId: STORE,
      idempotencyKey: 'qc-transport-stale-graph',
      commandType: 'production.impregnationQc.decide',
      command: fixture.command,
    })

    expect(result).toMatchObject({
      ok: false,
      error: 'batch_receipt_movement_document_lineage_mismatch',
    })
    expect(harness.updateCas).not.toHaveBeenCalled()
    expect(harness.upsertCritical).not.toHaveBeenCalled()
    expect(harness.insertReceipt).not.toHaveBeenCalled()
  })

  it('does not let a stale QC transport receipt bypass a forged current-decision state', async () => {
    const fixture = qcReplayFixture()
    fixture.production.impregnationQcDecisions[0].effective = false
    setCritical(fixture.production, fixture.warehouse)
    harness.receipt = {
      id: 'qc-transport-stale-decision',
      storeId: STORE,
      commandType: 'production.impregnationQc.decide',
      resultJson: JSON.stringify({ staleReceiptShortcut: true }),
      criticalRevisionAfter: 2,
    }

    const service = await import('../server/fst/_g3ProductionService.mjs')
    const result = await service.executeG3Command({
      actor: ACTOR,
      storeId: STORE,
      idempotencyKey: 'qc-transport-stale-decision',
      commandType: 'production.impregnationQc.decide',
      command: fixture.command,
    })

    expect(result).toMatchObject({
      ok: false,
      error: 'impregnation_qc_effective_decision_missing',
    })
    expect(harness.updateCas).not.toHaveBeenCalled()
    expect(harness.upsertCritical).not.toHaveBeenCalled()
    expect(harness.insertReceipt).not.toHaveBeenCalled()
  })

  it('rejects a changed QC payload even when its transport receipt already exists', async () => {
    const fixture = qcReplayFixture()
    setCritical(fixture.production, fixture.warehouse)
    harness.receipt = {
      id: 'qc-transport-attempt-conflict',
      storeId: STORE,
      commandType: 'production.impregnationQc.decide',
      resultJson: JSON.stringify({ staleReceiptShortcut: true }),
      criticalRevisionAfter: 2,
    }

    const service = await import('../server/fst/_g3ProductionService.mjs')
    const result = await service.executeG3Command({
      actor: ACTOR,
      storeId: STORE,
      idempotencyKey: 'qc-transport-attempt-conflict',
      commandType: 'production.impregnationQc.decide',
      command: { ...fixture.command, reason: 'different payload' },
    })

    expect(result.ok).toBe(false)
    expect(result.error).toBe('impregnation_qc_idempotency_conflict')
    expect(harness.updateCas).not.toHaveBeenCalled()
    expect(harness.upsertCritical).not.toHaveBeenCalled()
    expect(harness.insertReceipt).not.toHaveBeenCalled()
  })

  it('does not initialize a missing critical store for a new legacy request', async () => {
    const service = await import('../server/fst/_g3ProductionService.mjs')
    const result = await service.executeG3Command({
      actor: ACTOR,
      storeId: STORE,
      idempotencyKey: `prod-req-post:${REQUEST}`,
      commandType: 'production.request.post',
      command: requestCommand(),
    })

    expect(result.ok).toBe(false)
    expect(result.error).toBe(LEGACY_REQUEST_POST_NEW_WRITE_FORBIDDEN)
    expect(result.reason).toBe('critical_store_absent')
    expect(harness.upsertCritical).not.toHaveBeenCalled()
    expect(harness.updateCas).not.toHaveBeenCalled()
    expect(harness.insertReceipt).not.toHaveBeenCalled()
  })

  it('ignores a stale receipt, validates current graph, and returns without CAS', async () => {
    setCompletedRequest()
    harness.receipt = {
      id: `prod-req-post:${REQUEST}`,
      storeId: STORE,
      commandType: 'production.request.post',
      resultJson: JSON.stringify({ requestId: REQUEST, stale: true, warehouse: { documents: [] } }),
      criticalRevisionAfter: 1,
    }
    const service = await import('../server/fst/_g3ProductionService.mjs')
    const result = await service.executeG3Command({
      actor: ACTOR,
      storeId: STORE,
      idempotencyKey: `prod-req-post:${REQUEST}`,
      commandType: 'production.request.post',
      command: requestCommand(),
    })

    expect(result.ok).toBe(true)
    expect(result.stale).toBeUndefined()
    expect(result.canonicalReplayVerified).toBe(true)
    expect(result.criticalRevision).toBe(7)
    expect(result.warehouse.documents.length).toBeGreaterThan(0)
    expect(harness.updateCas).not.toHaveBeenCalled()
    expect(harness.upsertCritical).not.toHaveBeenCalled()
    expect(harness.insertReceipt).not.toHaveBeenCalled()
  })

  it('authorizes replay against the persisted report line, not a client line claim', async () => {
    setCompletedRequest()
    grant(['other-line'])
    const service = await import('../server/fst/_g3ProductionService.mjs')
    const result = await service.executeG3Command({
      actor: ACTOR,
      storeId: STORE,
      idempotencyKey: `prod-req-post:${REQUEST}`,
      commandType: 'production.request.post',
      command: requestCommand({ lineId: 'other-line' }),
    })

    expect(result.ok).toBe(false)
    expect(result.error).toBe('forbidden_line_scope')
    expect(harness.updateCas).not.toHaveBeenCalled()
    expect(harness.insertReceipt).not.toHaveBeenCalled()
  })

  it('ignores receipts for tagged order changes and never runs the legacy reserve mutation', async () => {
    const warehouse = baseWarehouse()
    warehouse.documents.push({
      id: 'reservation-1',
      type: 'reservation',
      status: 'posted',
      purpose: 'production_reservation',
      docRole: 'production_reservation',
      productionOrderId: ORDER,
      warehouseId: RAW_WAREHOUSE,
      lines: [{ lineId: 'reservation-line', itemId: 'raw-roll', quantity: 5 }],
    })
    warehouse.movements.push({
      id: 'reservation-movement',
      documentId: 'reservation-1',
      documentLineId: 'reservation-line',
      type: 'reserve',
      productionOrderId: ORDER,
      warehouseId: RAW_WAREHOUSE,
      itemId: 'raw-roll',
      quantity: 5,
    })
    const production = baseProduction()
    production.orders[0] = {
      ...production.orders[0],
      status: 'active',
      wipContractVersion: 1,
      totalQtyMp: 100,
      rawMaterialItemId: 'raw-roll',
      rawMaterialQty: 5,
      recipeNormSnapshot: { recipeVersionId: 'recipe-v1', components: [] },
      reservationDocumentId: 'reservation-1',
    }
    setCritical(production, warehouse)
    harness.receipt = {
      id: 'change-existing-receipt',
      storeId: STORE,
      commandType: 'production.order.change',
      resultJson: JSON.stringify({ orderId: ORDER, status: 'active', totalQtyMp: 101 }),
      criticalRevisionAfter: 6,
    }
    const service = await import('../server/fst/_g3ProductionService.mjs')

    const changed = await service.executeG3Command({
      actor: ACTOR,
      storeId: STORE,
      idempotencyKey: 'change-existing-receipt',
      commandType: 'production.order.change',
      command: { orderId: ORDER, rawWarehouseId: RAW_WAREHOUSE, totalQtyMp: 101 },
    })
    expect(changed.ok).toBe(false)
    expect(changed.error).toBe(CANONICAL_ORDER_REPLAN_REQUIRED)

    harness.receipt = null
    const unchanged = await service.executeG3Command({
      actor: ACTOR,
      storeId: STORE,
      idempotencyKey: 'change-proven-noop',
      commandType: 'production.order.change',
      command: { orderId: ORDER, rawWarehouseId: RAW_WAREHOUSE, totalQtyMp: 100 },
    })
    expect(unchanged.ok).toBe(true)
    expect(unchanged.canonicalLineagePreserved).toBe(true)
    expect(unchanged.criticalRevision).toBe(7)
    expect(harness.updateCas).not.toHaveBeenCalled()
    expect(harness.upsertCritical).not.toHaveBeenCalled()
    expect(harness.insertReceipt).not.toHaveBeenCalled()
  })
})
