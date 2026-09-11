import { describe, expect, it, vi } from 'vitest'
import {
  aggregateShiftActualInputs,
  canonicalShiftBusinessKey,
  shiftCommandFingerprint,
  shiftLineStockBalance,
  shiftStockLineage,
} from '../server/fst/_g3ShiftIntegrity.mjs'
import {
  LINE_BINDING_ACCOUNTING_DUPLICATE,
  LINE_BINDING_ACCOUNTING_INACTIVE,
  LINE_BINDING_ACCOUNTING_MISSING,
} from '../src/lib/production/lineReadinessCore.mjs'

vi.mock('../server/fst/_g1DataConnect.mjs', () => ({
  getFstCommandReceipt: vi.fn(),
  getFstCriticalStore: vi.fn(),
  getFstPrincipalAccessByUidStore: vi.fn(),
  getG1DataConnect: vi.fn(),
  insertFstCommandReceipt: vi.fn(),
  updateFstCriticalStoreCas: vi.fn(),
  upsertFstCriticalStore: vi.fn(),
}))

vi.mock('../server/fst/_adminAuth.mjs', () => ({
  FST_ADMIN_EMAILS: new Set<string>(),
}))

vi.mock('../server/fst/_dataConnectRuntime.mjs', () => ({
  isStagingIsolatedRuntime: () => true,
}))

const baseCommand = {
  orderId: 'po-1',
  lineId: 'line-1',
  shiftDate: '2026-09-10',
  shiftSlot: 'day',
  outputMp: 100,
  outputRolls: 2,
  semiFinishedItemId: 'wip-1',
  packLocationId: 'pack-loc',
  impregnationQcDecisionId: 'qc-1',
  batchRunId: 'run-1',
  actualInputs: [
    {
      itemId: 'raw-1',
      quantity: 4,
      batchNo: 'RAW-B1',
      expiryDate: '2027-01-01',
    },
    {
      itemId: 'imp-1',
      quantity: 8,
      batchNo: 'IMP-B1',
      batchRunId: 'run-1',
    },
  ],
  wasteLines: [
    {
      itemId: 'raw-1',
      quantity: 0.2,
      batchNo: 'RAW-B1',
      expiryDate: '2027-01-01',
      reason: 'trim',
      unit: 'kg',
    },
  ],
}

describe('R3.1C G3 shift integrity', () => {
  it('aggregates duplicate demand for one exact stock tuple before balance comparison', () => {
    const requests = aggregateShiftActualInputs([
      {
        itemId: 'imp-1',
        batchNo: 'IMP-B1',
        expiryDate: '2026-12-01',
        batchRunId: 'run-1',
        quantity: 6,
      },
      {
        itemId: 'imp-1',
        batchNo: 'IMP-B1',
        expiryDate: '2026-12-01',
        batchRunId: 'run-1',
        quantity: 5,
      },
    ])

    expect(requests).toEqual([
      {
        itemId: 'imp-1',
        batchNo: 'IMP-B1',
        expiryDate: '2026-12-01',
        batchRunId: 'run-1',
        quantity: 11,
      },
    ])
    expect(
      shiftLineStockBalance(
        [
          {
            itemId: 'imp-1',
            batchNo: 'IMP-B1',
            expiryDate: '2026-12-01',
            batchRunId: 'run-1',
            warehouseId: 'line-wh',
            locationId: 'line-loc',
            productionOrderId: 'po-1',
            productionLineId: 'line-1',
            type: 'receipt',
            quantity: 10,
          },
        ],
        requests[0],
        {
          productionOrderId: 'po-1',
          productionLineId: 'line-1',
          productionWarehouseId: 'line-wh',
          productionLocationId: 'line-loc',
          requireProductionLineId: true,
          exactLineage: true,
        },
      ),
    ).toBe(10)
    expect(requests[0].quantity).toBeGreaterThan(10)
  })

  it('does not combine or spend a sibling mixer run', () => {
    const requests = aggregateShiftActualInputs([
      { itemId: 'imp-1', batchNo: 'B1', batchRunId: 'run-1', quantity: 3 },
      { itemId: 'imp-1', batchNo: 'B1', batchRunId: 'run-2', quantity: 4 },
    ])
    expect(requests).toHaveLength(2)
    expect(
      shiftLineStockBalance(
        [
          {
            itemId: 'imp-1',
            batchNo: 'B1',
            batchRunId: 'run-2',
            warehouseId: 'line-wh',
            locationId: 'line-loc',
            productionOrderId: 'po-1',
            productionLineId: 'line-1',
            type: 'receipt',
            quantity: 99,
          },
        ],
        requests.find((row) => row.batchRunId === 'run-1'),
        {
          productionOrderId: 'po-1',
          productionLineId: 'line-1',
          productionWarehouseId: 'line-wh',
          productionLocationId: 'line-loc',
          requireProductionLineId: true,
          exactLineage: true,
        },
      ),
    ).toBe(0)
  })

  it('fingerprints all material effects while ignoring transport keys', () => {
    const baseline = shiftCommandFingerprint(baseCommand)
    expect(baseline).toMatch(/^[a-f0-9]{64}$/)
    expect(
      shiftCommandFingerprint({ ...baseCommand, reportKey: 'another-transport-key' }),
    ).toBe(baseline)

    for (const changed of [
      { outputRolls: 3 },
      { wasteLines: [{ ...baseCommand.wasteLines[0], quantity: 0.3 }] },
      { wasteLines: [{ ...baseCommand.wasteLines[0], reason: 'damage' }] },
      { correctionReason: 'corrected count' },
      {
        actualInputs: [
          baseCommand.actualInputs[0],
          { ...baseCommand.actualInputs[1], batchRunId: 'run-2' },
        ],
      },
    ]) {
      expect(shiftCommandFingerprint({ ...baseCommand, ...changed })).not.toBe(baseline)
    }
  })

  it('uses one business key per order/line/date/shift and preserves waste lineage', () => {
    expect(canonicalShiftBusinessKey(baseCommand)).toBe(
      'production-shift:po-1:line-1:2026-09-10:day',
    )
    expect(
      shiftStockLineage({
        batchNo: 'B1',
        expiryDate: '2027-01-01',
        batchRunId: 'run-1',
      }),
    ).toEqual({
      batchNo: 'B1',
      expiryDate: '2027-01-01',
      batchRunId: 'run-1',
    })
  })
})

function shiftFixture() {
  return {
    production: {
      orders: [
        {
          id: 'po-1',
          status: 'active',
          lineId: 'line-1',
          finishedProductId: 'fg-1',
          recipeNormSnapshot: {
            recipeVersionId: 'rv-1',
            contentHash: 'hash-1',
            components: [],
          },
        },
      ],
      shiftReports: [],
      wipBatches: [],
      wasteRecords: [],
      auditLog: [],
    },
    warehouse: {
      documents: [],
      movements: [
        {
          id: 'line-stock',
          documentId: 'handoff-1',
          warehouseId: 'line-wh',
          locationId: 'line-loc',
          itemId: 'raw-1',
          quantity: 10,
          type: 'receipt',
          productionOrderId: 'po-1',
          productionLineId: 'line-1',
          batchNo: 'B1',
          expiryDate: '2027-01-01',
          batchRunId: 'run-1',
        },
      ],
      productionLineBindings: [
        {
          lineId: 'line-1',
          productionWarehouseId: 'line-wh',
          productionLocationId: 'line-loc',
        },
        {
          lineId: 'pack',
          productionWarehouseId: 'pack-wh',
          productionLocationId: 'pack-loc',
        },
      ],
      scrapLocationId: 'scrap-loc',
      closedMonths: [],
      auditLog: [],
      materialShortages: [],
    },
  }
}

function shiftCommand(overrides: Record<string, unknown> = {}) {
  return {
    orderId: 'po-1',
    lineId: 'line-1',
    shiftDate: '2026-09-10',
    shiftSlot: 'day',
    outputMp: 100,
    outputRolls: 2,
    actualInputs: [
      {
        itemId: 'raw-1',
        quantity: 10,
        batchNo: 'B1',
        expiryDate: '2027-01-01',
        batchRunId: 'run-1',
      },
    ],
    wasteLines: [],
    semiFinishedItemId: 'wip-1',
    packLocationId: 'pack-loc',
    ...overrides,
  }
}

const shiftDraftBaseCommand = {
  orderId: 'po-draft',
  lineId: 'line-1',
  shiftDate: '2026-09-10',
  shiftSlot: 'day',
  outputMp: 0,
  outputRolls: 0,
  actualInputs: [],
  wasteLines: [],
}

function correctionDraftProduction() {
  return {
    shiftReports: [
      {
        id: 'sr-original',
        status: 'confirmed',
        orderId: 'po-draft',
        lineId: 'line-1',
        shiftDate: '2026-09-10',
        shiftSlot: 'day',
        outputMp: 10,
        outputRolls: 1,
        actualInputs: [],
        wasteLines: [],
        semiFinishedItemId: 'wip-1',
        packLocationId: 'pack-loc',
      },
    ],
    auditLog: [],
  }
}

describe('R3.1C G3 shift draft validation', () => {
  it.each([
    ['negative output', { outputMp: -1 }, 'invalid_output'],
    ['non-finite output', { outputMp: Number.POSITIVE_INFINITY }, 'invalid_output'],
    ['negative rolls', { outputRolls: -2 }, 'invalid_output_rolls'],
    ['fractional rolls', { outputRolls: 1.5 }, 'invalid_output_rolls'],
    ['non-finite rolls', { outputRolls: 'Infinity' }, 'invalid_output_rolls'],
    ['non-array actuals', { actualInputs: null }, 'invalid_actual_input'],
    ['malformed actual', { actualInputs: [null] }, 'invalid_actual_input'],
    [
      'non-finite actual',
      { actualInputs: [{ itemId: 'raw-1', quantity: Number.NaN }] },
      'invalid_actual_input',
    ],
    [
      'negative actual',
      { actualInputs: [{ itemId: 'raw-1', quantity: -1 }] },
      'invalid_actual_input',
    ],
    [
      'duplicate actual tuple',
      {
        actualInputs: [
          { itemId: 'raw-1', quantity: 1, batchNo: 'B1' },
          { itemId: 'raw-1', quantity: 2, batchNo: 'B1' },
        ],
      },
      'duplicate_actual_input',
    ],
    ['non-array waste', { wasteLines: {} }, 'invalid_waste_line'],
    [
      'non-finite waste',
      { wasteLines: [{ itemId: 'raw-1', quantity: Number.NaN, reason: 'trim' }] },
      'invalid_waste_line',
    ],
    [
      'negative waste',
      { wasteLines: [{ itemId: 'raw-1', quantity: -1, reason: 'trim' }] },
      'invalid_waste_line',
    ],
    [
      'duplicate waste tuple',
      {
        wasteLines: [
          { itemId: 'raw-1', quantity: 1, batchNo: 'B1', reason: 'trim' },
          { itemId: 'raw-1', quantity: 2, batchNo: 'B1', reason: 'damage' },
        ],
      },
      'duplicate_waste_line',
    ],
  ])('rejects %s before changing a shift draft', async (_label, overrides, error) => {
    const { applyShiftDraftSave } = await import('../server/fst/_g3ProductionService.mjs')
    const production = { shiftReports: [], auditLog: [] }
    const before = structuredClone(production)

    const result = applyShiftDraftSave(
      production,
      { ...shiftDraftBaseCommand, ...overrides },
      { uid: 'master-1' },
      '2026-09-10T10:00:00.000Z',
    )

    expect(result).toMatchObject({ ok: false, error })
    expect(production).toEqual(before)
  })

  it('accepts explicit finite zero values in an editable shift draft', async () => {
    const { applyShiftDraftSave } = await import('../server/fst/_g3ProductionService.mjs')
    const production = { shiftReports: [], auditLog: [] }
    const result = applyShiftDraftSave(
      production,
      {
        ...shiftDraftBaseCommand,
        actualInputs: [{ itemId: 'raw-1', quantity: 0, batchNo: 'B1' }],
        wasteLines: [{ itemId: 'raw-1', quantity: 0, batchNo: 'B1' }],
      },
      { uid: 'master-1' },
      '2026-09-10T10:00:00.000Z',
    )

    expect(result.ok).toBe(true)
    expect(result.production.shiftReports[0]).toMatchObject({
      outputMp: 0,
      outputRolls: 0,
      actualInputs: [{ itemId: 'raw-1', quantity: 0, batchNo: 'B1' }],
      wasteLines: [{ itemId: 'raw-1', quantity: 0, batchNo: 'B1' }],
    })
  })

  it.each([
    ['null output', { outputMp: null }, 'invalid_output'],
    ['fractional rolls', { outputRolls: 1.5 }, 'invalid_output_rolls'],
    ['explicit null actuals', { actualInputs: null }, 'invalid_actual_input'],
    [
      'duplicate actual tuple',
      {
        actualInputs: [
          { itemId: 'raw-1', quantity: 1, batchNo: 'B1' },
          { itemId: 'raw-1', quantity: 1, batchNo: 'B1' },
        ],
      },
      'duplicate_actual_input',
    ],
    [
      'non-finite waste',
      { wasteLines: [{ itemId: 'raw-1', quantity: Number.NaN, reason: 'trim' }] },
      'invalid_waste_line',
    ],
  ])('rejects %s before changing a correction draft', async (_label, overrides, error) => {
    const { applyShiftCreateCorrection } = await import(
      '../server/fst/_g3ProductionService.mjs'
    )
    const production = correctionDraftProduction()
    const before = structuredClone(production)

    const result = applyShiftCreateCorrection(
      production,
      {
        originalReportId: 'sr-original',
        correctionReason: 'fix count',
        ...overrides,
      },
      { uid: 'director-1' },
      '2026-09-10T10:00:00.000Z',
    )

    expect(result).toMatchObject({ ok: false, error })
    expect(production).toEqual(before)
  })

  it('accepts explicit finite zero values in a correction draft', async () => {
    const { applyShiftCreateCorrection } = await import(
      '../server/fst/_g3ProductionService.mjs'
    )
    const production = correctionDraftProduction()
    const result = applyShiftCreateCorrection(
      production,
      {
        originalReportId: 'sr-original',
        correctionReason: 'reset draft values',
        outputMp: 0,
        outputRolls: 0,
        actualInputs: [{ itemId: 'raw-1', quantity: 0 }],
        wasteLines: [{ itemId: 'raw-1', quantity: 0 }],
      },
      { uid: 'director-1' },
      '2026-09-10T10:00:00.000Z',
    )

    expect(result.ok).toBe(true)
    expect(result.production.shiftReports.at(-1)).toMatchObject({
      status: 'correction_draft',
      outputMp: 0,
      outputRolls: 0,
      actualInputs: [{ itemId: 'raw-1', quantity: 0 }],
      wasteLines: [{ itemId: 'raw-1', quantity: 0 }],
    })
  })
})

function canonicalShiftFixture() {
  const order = {
    id: 'po-canonical',
    status: 'active',
    wipContractVersion: 1,
    lineId: 'line-1',
    totalQtyMp: 100,
    finishedProductId: 'product-fg',
    warehouseItemId: 'item-fg',
    semiFinishedItemId: 'item-wip',
    rawMaterialItemId: 'item-raw',
    rawMaterialQty: 20,
    reservationDocumentId: 'reservation-1',
    recipeNormSnapshot: {
      recipeId: 'recipe-1',
      recipeVersionId: 'rv-1',
      contentHash: 'hash-1',
      components: [],
    },
  }
  const reservation = {
    id: 'reservation-1',
    type: 'reservation',
    purpose: 'production_reservation',
    docRole: 'production_reservation',
    status: 'posted',
    warehouseId: 'raw-wh',
    productionOrderId: order.id,
    lines: [
      {
        lineId: 'reservation-line',
        itemId: 'item-raw',
        quantity: 20,
        locationId: 'raw-loc',
      },
    ],
  }
  const handoffIssue = {
    id: 'handoff-issue',
    type: 'issue',
    purpose: 'production_issue',
    docRole: 'transfer_issue',
    status: 'posted',
    warehouseId: 'raw-wh',
    transferPairId: 'handoff-pair',
    productionOrderId: order.id,
    productionLineId: order.lineId,
    reservationDocumentId: reservation.id,
    lines: [
      {
        lineId: 'handoff-issue-line',
        itemId: 'item-raw',
        quantity: 20,
        batchNo: 'RAW-B1',
        expiryDate: '2027-01-01',
        locationId: 'raw-loc',
        productionOrderId: order.id,
        productionLineId: order.lineId,
      },
    ],
  }
  const handoffReceipt = {
    id: 'handoff-receipt',
    type: 'receipt',
    purpose: 'production_receipt',
    docRole: 'transfer_receipt',
    status: 'posted',
    warehouseId: 'line-wh',
    transferPairId: 'handoff-pair',
    productionOrderId: order.id,
    productionLineId: order.lineId,
    reservationDocumentId: reservation.id,
    lines: [
      {
        lineId: 'handoff-receipt-line',
        itemId: 'item-raw',
        quantity: 20,
        batchNo: 'RAW-B1',
        expiryDate: '2027-01-01',
        locationId: 'line-loc',
        productionOrderId: order.id,
        productionLineId: order.lineId,
      },
    ],
  }
  const mixerIssue = {
    id: 'mixer-issue',
    type: 'issue',
    purpose: 'production',
    docRole: 'batch_issue',
    status: 'posted',
    warehouseId: 'line-wh',
    batchRunId: 'mixer-run-1',
    productionOrderId: order.id,
    productionLineId: order.lineId,
    lines: [
      {
        lineId: 'mixer-issue-line',
        itemId: 'chemical-1',
        quantity: 5,
        locationId: 'line-loc',
        batchRunId: 'mixer-run-1',
        productionOrderId: order.id,
        productionLineId: order.lineId,
      },
    ],
  }
  const mixerReceipt = {
    id: 'mixer-receipt',
    type: 'receipt',
    purpose: 'production',
    docRole: 'batch_receipt',
    status: 'posted',
    warehouseId: 'line-wh',
    batchRunId: 'mixer-run-1',
    batchNo: 'IMP-B1',
    productionOrderId: order.id,
    productionLineId: order.lineId,
    lines: [
      {
        lineId: 'mixer-receipt-line',
        itemId: 'item-impregnation',
        quantity: 20,
        batchNo: 'IMP-B1',
        locationId: 'line-loc',
        batchRunId: 'mixer-run-1',
        productionOrderId: order.id,
        productionLineId: order.lineId,
      },
    ],
  }
  const documents = [reservation, handoffIssue, handoffReceipt, mixerIssue, mixerReceipt]
  const movements = [
    {
      id: 'reservation-movement',
      documentId: reservation.id,
      documentLineId: 'reservation-line',
      type: 'reserve',
      warehouseId: 'raw-wh',
      locationId: 'raw-loc',
      itemId: 'item-raw',
      quantity: 20,
      productionOrderId: order.id,
    },
    {
      id: 'handoff-issue-movement',
      documentId: handoffIssue.id,
      documentLineId: 'handoff-issue-line',
      type: 'issue',
      warehouseId: 'raw-wh',
      locationId: 'raw-loc',
      itemId: 'item-raw',
      quantity: 20,
      batchNo: 'RAW-B1',
      expiryDate: '2027-01-01',
      productionOrderId: order.id,
      productionLineId: order.lineId,
      reservationDocumentId: reservation.id,
      transferPairId: 'handoff-pair',
      consumesReserve: true,
    },
    {
      id: 'handoff-receipt-movement',
      documentId: handoffReceipt.id,
      documentLineId: 'handoff-receipt-line',
      type: 'receipt',
      warehouseId: 'line-wh',
      locationId: 'line-loc',
      itemId: 'item-raw',
      quantity: 20,
      batchNo: 'RAW-B1',
      expiryDate: '2027-01-01',
      productionOrderId: order.id,
      productionLineId: order.lineId,
      reservationDocumentId: reservation.id,
      transferPairId: 'handoff-pair',
    },
    {
      id: 'mixer-issue-movement',
      documentId: mixerIssue.id,
      documentLineId: 'mixer-issue-line',
      type: 'issue',
      warehouseId: 'line-wh',
      locationId: 'line-loc',
      itemId: 'chemical-1',
      quantity: 5,
      batchRunId: 'mixer-run-1',
      productionOrderId: order.id,
      productionLineId: order.lineId,
    },
    {
      id: 'mixer-receipt-movement',
      documentId: mixerReceipt.id,
      documentLineId: 'mixer-receipt-line',
      type: 'receipt',
      warehouseId: 'line-wh',
      locationId: 'line-loc',
      itemId: 'item-impregnation',
      quantity: 20,
      batchNo: 'IMP-B1',
      batchRunId: 'mixer-run-1',
      productionOrderId: order.id,
      productionLineId: order.lineId,
    },
  ]
  return {
    production: {
      orders: [order],
      shiftReports: [],
      wipBatches: [],
      wasteRecords: [],
      handoffs: [
        {
          id: 'handoff-1',
          orderId: order.id,
          lineId: order.lineId,
          transferPairId: handoffIssue.transferPairId,
          issueDocumentId: handoffIssue.id,
          receiptDocumentId: handoffReceipt.id,
          reservationDocumentId: reservation.id,
        },
      ],
      impregnationQcDecisions: [
        {
          id: 'qc-1',
          decisionRevision: 1,
          decision: 'approved',
          effective: true,
          productionOrderId: order.id,
          productionLineId: order.lineId,
          batchRunId: 'mixer-run-1',
          batchReceiptDocumentId: mixerReceipt.id,
          outputWarehouseItemId: 'item-impregnation',
        },
      ],
      auditLog: [],
    },
    warehouse: {
      documents,
      movements,
      items: [
        { id: 'item-wip', name: 'WIP', baseUnit: 'm2', active: true },
        { id: 'item-fg', name: 'FG', baseUnit: 'm2', active: true },
        { id: 'item-raw', name: 'Raw', baseUnit: 'roll', active: true },
        { id: 'item-impregnation', name: 'Impregnation', baseUnit: 'kg', active: true },
      ],
      locations: [
        { id: 'raw-wh', name: 'Raw warehouse' },
        { id: 'raw-loc', name: 'Raw location' },
        { id: 'line-wh', name: 'Line warehouse' },
        { id: 'line-loc', name: 'Line location' },
        { id: 'pack-wh', name: 'Pack warehouse' },
        { id: 'pack-loc', name: 'Pack location' },
        { id: 'scrap-loc', name: 'Scrap location' },
      ],
      accountingByWarehouse: [
        { id: 'line-accounting', warehouseId: 'line-wh', status: 'active' },
        { id: 'pack-accounting', warehouseId: 'pack-wh', status: 'active' },
        { id: 'scrap-accounting', warehouseId: 'scrap-loc', status: 'active' },
      ],
      productionLineBindings: [
        {
          id: 'line-binding',
          lineId: 'line-1',
          productionWarehouseId: 'line-wh',
          productionLocationId: 'line-loc',
        },
        {
          id: 'pack-binding',
          lineId: 'pack',
          productionWarehouseId: 'pack-wh',
          productionLocationId: 'pack-loc',
        },
      ],
      scrapLocationId: 'scrap-loc',
      closedMonths: [],
      auditLog: [],
      materialShortages: [],
    },
  }
}

function canonicalShiftCommand(overrides: Record<string, unknown> = {}) {
  return {
    orderId: 'po-canonical',
    lineId: 'line-1',
    shiftDate: '2026-09-10',
    shiftSlot: 'day',
    outputMp: 40,
    outputRolls: 2,
    actualInputs: [
      {
        itemId: 'item-raw',
        quantity: 4,
        batchNo: 'RAW-B1',
        expiryDate: '2027-01-01',
      },
      {
        itemId: 'item-impregnation',
        quantity: 5,
        batchNo: 'IMP-B1',
        batchRunId: 'mixer-run-1',
      },
    ],
    wasteLines: [],
    semiFinishedItemId: 'item-wip',
    packLocationId: 'pack-loc',
    impregnationQcDecisionId: 'qc-1',
    batchRunId: 'mixer-run-1',
    ...overrides,
  }
}

describe('R3.1C authoritative shift reducer', () => {
  it('rejects an approved QC revision after a newer rejected decision supersedes it', async () => {
    const { resolveApprovedImpregnationQc } = await import(
      '../server/fst/_g3ProductionService.mjs'
    )
    const v1 = {
      id: 'qc-v1',
      decisionRevision: 1,
      decision: 'approved',
      effective: false,
      supersededByDecisionId: 'qc-v2',
      productionOrderId: 'po-1',
      productionLineId: 'line-1',
      batchRunId: 'run-1',
    }
    const v2 = {
      id: 'qc-v2',
      decisionRevision: 2,
      decision: 'rejected',
      effective: true,
      supersedesDecisionId: 'qc-v1',
      productionOrderId: 'po-1',
      productionLineId: 'line-1',
      batchRunId: 'run-1',
    }
    const production = { impregnationQcDecisions: [v1, v2] }
    const order = { id: 'po-1', lineId: 'line-1', wipContractVersion: 1 }

    expect(
      resolveApprovedImpregnationQc(
        production,
        {},
        { impregnationQcDecisionId: 'qc-v1', batchRunId: 'run-1' },
        order,
        { enforceCanonicalLineage: true },
      ),
    ).toMatchObject({ ok: false, error: 'impregnation_qc_decision_not_current' })
    expect(
      resolveApprovedImpregnationQc(
        production,
        {},
        { impregnationQcDecisionId: 'qc-v2', batchRunId: 'run-1' },
        order,
        { enforceCanonicalLineage: true },
      ),
    ).toMatchObject({ ok: false, error: 'impregnation_qc_not_approved' })
  })

  it('rejects duplicate rows whose aggregate exceeds the one physical lot', async () => {
    const { applyShiftConfirm } = await import('../server/fst/_g3ProductionService.mjs')
    const fixture = shiftFixture()
    const before = JSON.stringify(fixture)
    const result = applyShiftConfirm(
      fixture.production,
      fixture.warehouse,
      shiftCommand({
        actualInputs: [
          { itemId: 'raw-1', quantity: 6, batchNo: 'B1', expiryDate: '2027-01-01', batchRunId: 'run-1' },
          { itemId: 'raw-1', quantity: 5, batchNo: 'B1', expiryDate: '2027-01-01', batchRunId: 'run-1' },
        ],
      }),
      { uid: 'master-1', email: 'master@example.test' },
      '2026-09-10T10:00:00.000Z',
    )

    expect(result).toMatchObject({ ok: false, error: 'insufficient_line_material' })
    expect(JSON.stringify(fixture)).toBe(before)
  })

  it.each([
    ['negative', -2],
    ['fractional', 1.5],
    ['infinite string', 'Infinity'],
    ['NaN', Number.NaN],
  ])('rejects a %s output roll count before any mutation', async (_label, outputRolls) => {
    const { applyShiftConfirm } = await import('../server/fst/_g3ProductionService.mjs')
    const fixture = shiftFixture()
    const productionBefore = structuredClone(fixture.production)
    const warehouseBefore = structuredClone(fixture.warehouse)

    const result = applyShiftConfirm(
      fixture.production,
      fixture.warehouse,
      shiftCommand({ outputRolls }),
      { uid: 'master-1', email: 'master@example.test' },
      '2026-09-10T10:00:00.000Z',
    )

    expect(result).toMatchObject({ ok: false, error: 'invalid_output_rolls' })
    expect(fixture.production).toEqual(productionBefore)
    expect(fixture.warehouse).toEqual(warehouseBefore)
  })

  it('preserves a legitimate zero output roll count', async () => {
    const { applyShiftConfirm } = await import('../server/fst/_g3ProductionService.mjs')
    const fixture = shiftFixture()

    const result = applyShiftConfirm(
      fixture.production,
      fixture.warehouse,
      shiftCommand({ outputRolls: 0 }),
      { uid: 'master-1', email: 'master@example.test' },
      '2026-09-10T10:00:00.000Z',
    )

    expect(result.ok).toBe(true)
    expect(result.production.shiftReports[0]).toMatchObject({
      outputRolls: 0,
      rollCount: 0,
    })
    expect(result.production.wipBatches[0]).toMatchObject({ rolls: 0 })
  })

  it('replays the identical business command but rejects a changed payload', async () => {
    const { applyShiftConfirm } = await import('../server/fst/_g3ProductionService.mjs')
    const fixture = shiftFixture()
    const command = shiftCommand()
    const first = applyShiftConfirm(
      fixture.production,
      fixture.warehouse,
      command,
      { uid: 'master-1', email: 'master@example.test' },
      '2026-09-10T10:00:00.000Z',
    )
    expect(first.ok).toBe(true)
    expect(first.production.shiftReports[0]).toMatchObject({
      number: 'СО-20260910-001',
      productionOrderId: 'po-1',
      shift: 'day',
      outputM2: 100,
      rollCount: 2,
      productionWarehouseId: 'line-wh',
      productionLocationId: 'line-loc',
      packagingWarehouseId: 'pack-wh',
      packagingLocationId: 'pack-loc',
    })
    expect(first.production.shiftReports[0].materialLines).toHaveLength(1)

    const replay = applyShiftConfirm(
      first.production,
      first.warehouse,
      command,
      { uid: 'master-1', email: 'master@example.test' },
      '2026-09-10T10:01:00.000Z',
    )
    expect(replay).toMatchObject({
      ok: true,
      result: { reportId: first.result.reportId, idempotent: true },
    })
    expect(replay.production).toBe(first.production)
    expect(replay.warehouse).toBe(first.warehouse)

    const conflict = applyShiftConfirm(
      first.production,
      first.warehouse,
      shiftCommand({ outputRolls: 3 }),
      { uid: 'master-1', email: 'master@example.test' },
      '2026-09-10T10:02:00.000Z',
    )
    expect(conflict).toMatchObject({ ok: false, error: 'shift_idempotency_conflict' })

    const ambiguousProduction = structuredClone(first.production)
    ambiguousProduction.shiftReports.push({
      ...ambiguousProduction.shiftReports[0],
      id: 'duplicate-business-key-report',
    })
    expect(
      applyShiftConfirm(
        ambiguousProduction,
        first.warehouse,
        command,
        { uid: 'master-1', email: 'master@example.test' },
        '2026-09-10T10:03:00.000Z',
      ),
    ).toMatchObject({ ok: false, error: 'shift_idempotency_ambiguous' })
  })

  it('copies batch, expiry, run, and production line to both waste documents and movements', async () => {
    const { applyShiftConfirm } = await import('../server/fst/_g3ProductionService.mjs')
    const fixture = shiftFixture()
    const result = applyShiftConfirm(
      fixture.production,
      fixture.warehouse,
      shiftCommand({
        wasteLines: [
          {
            itemId: 'raw-1',
            quantity: 2,
            batchNo: 'B1',
            expiryDate: '2027-01-01',
            batchRunId: 'run-1',
            reason: 'trim',
            unit: 'kg',
          },
        ],
      }),
      { uid: 'master-1', email: 'master@example.test' },
      '2026-09-10T10:00:00.000Z',
    )
    expect(result.ok).toBe(true)

    const wasteDocs = result.warehouse.documents.filter((row: { docRole?: string }) =>
      ['waste_to_scrap', 'scrap_receipt'].includes(String(row.docRole)),
    )
    expect(wasteDocs).toHaveLength(2)
    for (const document of wasteDocs) {
      expect(document).toMatchObject({ productionLineId: 'line-1' })
      expect(document.lines[0]).toMatchObject({
        batchNo: 'B1',
        expiryDate: '2027-01-01',
        batchRunId: 'run-1',
      })
    }
    const wasteDocumentIds = new Set(wasteDocs.map((row: { id: string }) => row.id))
    const wasteMovements = result.warehouse.movements.filter((row: { documentId: string }) =>
      wasteDocumentIds.has(row.documentId),
    )
    expect(wasteMovements).toHaveLength(2)
    for (const movement of wasteMovements) {
      expect(movement).toMatchObject({
        batchNo: 'B1',
        expiryDate: '2027-01-01',
        batchRunId: 'run-1',
        productionLineId: 'line-1',
      })
    }
  })

  it('requires one exact posted reservation handoff and the frozen raw tuple', async () => {
    const { applyShiftConfirm } = await import('../server/fst/_g3ProductionService.mjs')
    const actor = { uid: 'master-1', email: 'master@example.test' }
    const now = '2026-09-10T10:00:00.000Z'
    const context = { enforceCanonicalLineage: true }

    const valid = canonicalShiftFixture()
    const accepted = applyShiftConfirm(
      valid.production,
      valid.warehouse,
      canonicalShiftCommand(),
      actor,
      now,
      context,
    )
    expect(accepted.ok, JSON.stringify(accepted)).toBe(true)
    expect(accepted.production.shiftReports[0]).toMatchObject({
      rawMaterialItemId: 'item-raw',
      reservationDocumentId: 'reservation-1',
      materialHandoffIds: ['handoff-1'],
      materialHandoffTransferPairIds: ['handoff-pair'],
    })

    for (const [label, mutate, command, error] of [
      [
        'missing handoff',
        (fixture: ReturnType<typeof canonicalShiftFixture>) => {
          fixture.production.handoffs = []
        },
        canonicalShiftCommand(),
        'shift_material_handoff_required',
      ],
      [
        'orphan handoff',
        (fixture: ReturnType<typeof canonicalShiftFixture>) => {
          fixture.production.handoffs[0].receiptDocumentId = 'missing-receipt'
        },
        canonicalShiftCommand(),
        'shift_material_handoff_invalid',
      ],
      [
        'wrong handoff reservation',
        (fixture: ReturnType<typeof canonicalShiftFixture>) => {
          fixture.production.handoffs[0].reservationDocumentId = 'another-reservation'
        },
        canonicalShiftCommand(),
        'shift_material_handoff_required',
      ],
      [
        'duplicate handoff',
        (fixture: ReturnType<typeof canonicalShiftFixture>) => {
          fixture.production.handoffs.push({
            ...fixture.production.handoffs[0],
            id: 'duplicate-handoff',
          })
        },
        canonicalShiftCommand(),
        'shift_material_handoff_ambiguous',
      ],
      [
        'missing raw input',
        (fixture: ReturnType<typeof canonicalShiftFixture>) => void fixture,
        canonicalShiftCommand({
          actualInputs: [canonicalShiftCommand().actualInputs[1]],
        }),
        'shift_raw_material_input_required',
      ],
      [
        'wrong raw lot',
        (fixture: ReturnType<typeof canonicalShiftFixture>) => void fixture,
        canonicalShiftCommand({
          actualInputs: [
            {
              ...canonicalShiftCommand().actualInputs[0],
              batchNo: 'NOT-HANDED-OFF',
            },
            canonicalShiftCommand().actualInputs[1],
          ],
        }),
        'shift_raw_material_input_not_handed_off',
      ],
    ] as const) {
      const fixture = canonicalShiftFixture()
      mutate(fixture)
      const before = JSON.stringify(fixture)
      const rejected = applyShiftConfirm(
        fixture.production,
        fixture.warehouse,
        command,
        actor,
        now,
        context,
      )
      expect(rejected, label).toMatchObject({ ok: false, error })
      expect(JSON.stringify(fixture), `${label} mutated input`).toBe(before)
    }
  })

  it('rejects corrupted reservation/source movement proof and ignores orphan stock receipts', async () => {
    const { applyShiftConfirm } = await import('../server/fst/_g3ProductionService.mjs')
    const actor = { uid: 'master-1', email: 'master@example.test' }
    const context = { enforceCanonicalLineage: true }

    for (const mutate of [
      (fixture: ReturnType<typeof canonicalShiftFixture>) => {
        fixture.warehouse.movements.find((row) => row.id === 'reservation-movement')!.quantity = 19
      },
      (fixture: ReturnType<typeof canonicalShiftFixture>) => {
        fixture.warehouse.movements.find((row) => row.id === 'handoff-issue-movement')!.locationId = 'wrong-location'
      },
      (fixture: ReturnType<typeof canonicalShiftFixture>) => {
        delete fixture.warehouse.movements.find((row) => row.id === 'handoff-receipt-movement')!.documentLineId
      },
      (fixture: ReturnType<typeof canonicalShiftFixture>) => {
        fixture.warehouse.documents.find((row) => row.id === 'reservation-1')!.lines[0].quantity = 19
        fixture.warehouse.movements.find((row) => row.id === 'reservation-movement')!.quantity = 19
      },
      (fixture: ReturnType<typeof canonicalShiftFixture>) => {
        fixture.warehouse.movements.push({
          id: 'corrupt-line-ledger',
          documentId: 'corrupt-ledger-document',
          type: 'issue',
          warehouseId: 'line-wh',
          locationId: 'line-loc',
          itemId: 'item-raw',
          quantity: Number.NaN,
          batchNo: 'RAW-B1',
          expiryDate: '2027-01-01',
          productionOrderId: 'po-canonical',
          productionLineId: 'line-1',
        })
      },
    ]) {
      const fixture = canonicalShiftFixture()
      mutate(fixture)
      const before = JSON.stringify(fixture)
      const rejected = applyShiftConfirm(
        fixture.production,
        fixture.warehouse,
        canonicalShiftCommand(),
        actor,
        '2026-09-10T10:00:00.000Z',
        context,
      )
      expect(rejected).toMatchObject({ ok: false, error: 'shift_material_handoff_invalid' })
      expect(JSON.stringify(fixture)).toBe(before)
    }

    const inflated = canonicalShiftFixture()
    inflated.warehouse.movements.push({
      id: 'orphan-raw-receipt',
      documentId: 'orphan-document',
      type: 'receipt',
      warehouseId: 'line-wh',
      locationId: 'line-loc',
      itemId: 'item-raw',
      quantity: 999,
      batchNo: 'RAW-B1',
      expiryDate: '2027-01-01',
      productionOrderId: 'po-canonical',
      productionLineId: 'line-1',
    })
    const rejected = applyShiftConfirm(
      inflated.production,
      inflated.warehouse,
      canonicalShiftCommand({
        actualInputs: [
          { ...canonicalShiftCommand().actualInputs[0], quantity: 21 },
          canonicalShiftCommand().actualInputs[1],
        ],
      }),
      actor,
      '2026-09-10T10:00:00.000Z',
      context,
    )
    expect(rejected).toMatchObject({ ok: false, error: 'insufficient_line_material' })

    const forged = canonicalShiftFixture()
    forged.warehouse.documents.push({
      id: 'forged-reversal-document',
      type: 'issue',
      purpose: 'production_issue',
      docRole: 'shift_correction_reversal',
      status: 'posted',
      warehouseId: 'line-wh',
      productionOrderId: 'po-canonical',
      productionLineId: 'line-1',
      reversesDocumentId: 'missing-source-document',
      lines: [],
    })
    forged.warehouse.movements.push({
      id: 'forged-reversal-movement',
      documentId: 'forged-reversal-document',
      type: 'receipt',
      warehouseId: 'line-wh',
      locationId: 'line-loc',
      itemId: 'item-raw',
      quantity: 4,
      batchNo: 'RAW-B1',
      expiryDate: '2027-01-01',
      productionOrderId: 'po-canonical',
      productionLineId: 'line-1',
      reversesMovementId: 'missing-source-movement',
    })
    const forgedBefore = JSON.stringify(forged)
    const forgedRejected = applyShiftConfirm(
      forged.production,
      forged.warehouse,
      canonicalShiftCommand(),
      actor,
      '2026-09-10T10:00:00.000Z',
      context,
    )
    expect(forgedRejected).toMatchObject({
      ok: false,
      error: 'shift_material_handoff_invalid',
    })
    expect(JSON.stringify(forged)).toBe(forgedBefore)
  })

  it('requires one active accounting row for every strict production route', async () => {
    const { applyShiftConfirm } = await import('../server/fst/_g3ProductionService.mjs')
    const cases = [
      [[], LINE_BINDING_ACCOUNTING_MISSING],
      [
        [
          { id: 'line-a', warehouseId: 'line-wh', status: 'active' },
          { id: 'line-b', warehouseId: 'line-wh', status: 'active' },
          { id: 'pack-a', warehouseId: 'pack-wh', status: 'active' },
        ],
        LINE_BINDING_ACCOUNTING_DUPLICATE,
      ],
      [
        [
          { id: 'line-a', warehouseId: 'line-wh', status: 'reconciling' },
          { id: 'pack-a', warehouseId: 'pack-wh', status: 'active' },
        ],
        LINE_BINDING_ACCOUNTING_INACTIVE,
      ],
    ] as const
    for (const [accountingByWarehouse, error] of cases) {
      const fixture = canonicalShiftFixture()
      fixture.warehouse.accountingByWarehouse = structuredClone(accountingByWarehouse) as typeof fixture.warehouse.accountingByWarehouse
      const before = JSON.stringify(fixture)
      const result = applyShiftConfirm(
        fixture.production,
        fixture.warehouse,
        canonicalShiftCommand(),
        { uid: 'master-1', email: 'master@example.test' },
        '2026-09-10T10:00:00.000Z',
        { enforceCanonicalLineage: true },
      )
      expect(result).toMatchObject({ ok: false, error })
      expect(JSON.stringify(fixture)).toBe(before)
    }
  })

  it('caps aggregate effective output and keeps exact replay read-only', async () => {
    const { applyShiftConfirm } = await import('../server/fst/_g3ProductionService.mjs')
    const actor = { uid: 'master-1', email: 'master@example.test' }
    const context = { enforceCanonicalLineage: true }
    const fixture = canonicalShiftFixture()
    fixture.production.shiftReports.push({
      id: 'prior-shift',
      idempotencyKey: 'prior-key',
      status: 'confirmed',
      orderId: 'po-canonical',
      outputMp: 61,
      shiftDate: '2026-09-09',
      shiftSlot: 'night',
    })
    const before = JSON.stringify(fixture)
    const exceeded = applyShiftConfirm(
      fixture.production,
      fixture.warehouse,
      canonicalShiftCommand({ outputMp: 40 }),
      actor,
      '2026-09-10T10:00:00.000Z',
      context,
    )
    expect(exceeded).toMatchObject({
      ok: false,
      error: 'shift_output_exceeds_order_quantity',
    })
    expect(JSON.stringify(fixture)).toBe(before)

    const replayFixture = canonicalShiftFixture()
    const first = applyShiftConfirm(
      replayFixture.production,
      replayFixture.warehouse,
      canonicalShiftCommand(),
      actor,
      '2026-09-10T10:00:00.000Z',
      context,
    )
    expect(first.ok).toBe(true)
    const replay = applyShiftConfirm(
      first.production,
      first.warehouse,
      canonicalShiftCommand(),
      actor,
      '2026-09-10T10:01:00.000Z',
      context,
    )
    expect(replay).toMatchObject({ ok: true, result: { idempotent: true } })
    expect(replay.production).toBe(first.production)
    expect(replay.warehouse).toBe(first.warehouse)
  })

  it('excludes only the corrected report from the aggregate output cap', async () => {
    const { applyShiftConfirm, applyShiftConfirmCorrection } = await import(
      '../server/fst/_g3ProductionService.mjs'
    )
    const actor = { uid: 'master-1', email: 'master@example.test' }
    const context = { enforceCanonicalLineage: true }
    const fixture = canonicalShiftFixture()
    fixture.production.shiftReports.push({
      id: 'prior-60',
      idempotencyKey: 'prior-60-key',
      status: 'confirmed',
      orderId: 'po-canonical',
      outputMp: 60,
      shiftDate: '2026-09-09',
      shiftSlot: 'night',
    })
    const first = applyShiftConfirm(
      fixture.production,
      fixture.warehouse,
      canonicalShiftCommand(),
      actor,
      '2026-09-10T10:00:00.000Z',
      context,
    )
    expect(first.ok, JSON.stringify(first)).toBe(true)
    const beforeProduction = JSON.stringify(first.production)
    const beforeWarehouse = JSON.stringify(first.warehouse)
    const tooHigh = applyShiftConfirmCorrection(
      first.production,
      first.warehouse,
      {
        originalReportId: first.result.reportId,
        correctionReason: 'recount 41',
        outputMp: 41,
        reportKey: 'correction-output-41',
      },
      actor,
      '2026-09-10T11:00:00.000Z',
      context,
    )
    expect(tooHigh).toMatchObject({
      ok: false,
      error: 'shift_output_exceeds_order_quantity',
    })
    expect(JSON.stringify(first.production)).toBe(beforeProduction)
    expect(JSON.stringify(first.warehouse)).toBe(beforeWarehouse)

    const corrected = applyShiftConfirmCorrection(
      first.production,
      first.warehouse,
      {
        originalReportId: first.result.reportId,
        correctionReason: 'verified 40',
        outputMp: 40,
        reportKey: 'correction-output-40',
      },
      actor,
      '2026-09-10T11:00:00.000Z',
      context,
    )
    expect(corrected.ok, JSON.stringify(corrected)).toBe(true)
    const replay = applyShiftConfirmCorrection(
      corrected.production,
      corrected.warehouse,
      {
        originalReportId: first.result.reportId,
        correctionReason: 'verified 40',
        outputMp: 40,
        reportKey: 'correction-output-40',
      },
      actor,
      '2026-09-10T11:01:00.000Z',
      context,
    )
    expect(replay).toMatchObject({ ok: true, result: { idempotent: true } })
    expect(replay.production).toBe(corrected.production)
    expect(replay.warehouse).toBe(corrected.warehouse)
  })

  it.each([
    ['partial consumption / same output', 1, 40, 'batchNo'],
    ['full consumption / higher output', 40, 50, 'sourceWipBatchId'],
    ['corrupt non-finite consumption', Number.NaN, 40, 'sourceWipBatchId'],
  ])('blocks strict correction after %s', async (_label, consumed, correctedOutput, lineageField) => {
    const { applyShiftConfirm, applyShiftConfirmCorrection } = await import(
      '../server/fst/_g3ProductionService.mjs'
    )
    const actor = { uid: 'master-1', email: 'master@example.test' }
    const context = { enforceCanonicalLineage: true }
    const fixture = canonicalShiftFixture()
    const first = applyShiftConfirm(
      fixture.production,
      fixture.warehouse,
      canonicalShiftCommand(),
      actor,
      '2026-09-10T10:00:00.000Z',
      context,
    )
    expect(first.ok).toBe(true)
    const wipBatchId = first.result.wipBatchId
    const warehouse = structuredClone(first.warehouse)
    warehouse.documents.push({
      id: 'pack-consumption',
      status: 'posted',
      docRole: 'production_wip_pack_consumption',
      productionOrderId: 'po-canonical',
      productionLineId: 'line-1',
      lines: [],
    })
    warehouse.movements.push({
      id: 'pack-consumption-movement',
      documentId: 'pack-consumption',
      type: 'issue',
      warehouseId: 'pack-wh',
      locationId: 'pack-loc',
      itemId: 'item-wip',
      quantity: consumed,
      [lineageField]: wipBatchId,
      productionOrderId: 'po-canonical',
      productionLineId: 'line-1',
      isWip: true,
    })
    const beforeProduction = JSON.stringify(first.production)
    const beforeWarehouse = JSON.stringify(warehouse)
    const corrected = applyShiftConfirmCorrection(
      first.production,
      warehouse,
      {
        originalReportId: first.result.reportId,
        correctionReason: 'verified recount',
        outputMp: correctedOutput,
        reportKey: `correction-${consumed}-${correctedOutput}`,
      },
      actor,
      '2026-09-10T11:00:00.000Z',
      context,
    )
    expect(corrected).toMatchObject({ ok: false, error: 'wip_already_consumed' })
    expect(JSON.stringify(first.production)).toBe(beforeProduction)
    expect(JSON.stringify(warehouse)).toBe(beforeWarehouse)
  })

  it('requires exactly one original WIP and replaces the old active waste projection', async () => {
    const { applyShiftConfirm, applyShiftConfirmCorrection } = await import(
      '../server/fst/_g3ProductionService.mjs'
    )
    const actor = { uid: 'master-1', email: 'master@example.test' }
    const context = { enforceCanonicalLineage: true }
    const fixture = canonicalShiftFixture()
    const originalCommand = canonicalShiftCommand({
      wasteLines: [
        {
          itemId: 'item-raw',
          quantity: 1,
          batchNo: 'RAW-B1',
          expiryDate: '2027-01-01',
          reason: 'trim',
          unit: 'roll',
        },
      ],
    })
    const first = applyShiftConfirm(
      fixture.production,
      fixture.warehouse,
      originalCommand,
      actor,
      '2026-09-10T10:00:00.000Z',
      context,
    )
    expect(first.ok, JSON.stringify(first)).toBe(true)

    const duplicateWipProduction = structuredClone(first.production)
    duplicateWipProduction.wipBatches.push({
      ...duplicateWipProduction.wipBatches[0],
      id: 'duplicate-wip',
    })
    const duplicateBefore = JSON.stringify(duplicateWipProduction)
    const duplicateRejected = applyShiftConfirmCorrection(
      duplicateWipProduction,
      first.warehouse,
      {
        originalReportId: first.result.reportId,
        correctionReason: 'duplicate must block',
      },
      actor,
      '2026-09-10T11:00:00.000Z',
      context,
    )
    expect(duplicateRejected).toMatchObject({
      ok: false,
      error: 'shift_correction_wip_batch_not_unique',
    })
    expect(JSON.stringify(duplicateWipProduction)).toBe(duplicateBefore)

    for (const mutate of [
      (production: typeof first.production) => {
        production.wipBatches = []
      },
      (production: typeof first.production) => {
        production.wipBatches[0].shiftReportId = 'foreign-report'
      },
      (production: typeof first.production) => {
        delete production.wipBatches[0].wipContractVersion
      },
    ]) {
      const invalidProduction = structuredClone(first.production)
      mutate(invalidProduction)
      const before = JSON.stringify(invalidProduction)
      const rejected = applyShiftConfirmCorrection(
        invalidProduction,
        first.warehouse,
        {
          originalReportId: first.result.reportId,
          correctionReason: 'invalid WIP must block',
        },
        actor,
        '2026-09-10T11:00:00.000Z',
        context,
      )
      expect(rejected.ok).toBe(false)
      expect(JSON.stringify(invalidProduction)).toBe(before)
    }

    const corrected = applyShiftConfirmCorrection(
      first.production,
      first.warehouse,
      {
        originalReportId: first.result.reportId,
        correctionReason: 'correct waste quantity',
        wasteLines: [
          {
            itemId: 'item-raw',
            quantity: 0.5,
            batchNo: 'RAW-B1',
            expiryDate: '2027-01-01',
            reason: 'trim verified',
            unit: 'roll',
          },
        ],
      },
      actor,
      '2026-09-10T11:00:00.000Z',
      context,
    )
    expect(corrected.ok, JSON.stringify(corrected)).toBe(true)
    expect(corrected.production.wasteRecords).toHaveLength(1)
    expect(corrected.production.wasteRecords[0]).toMatchObject({
      shiftReportId: corrected.result.reportId,
      quantity: 0.5,
    })
    expect(
      corrected.production.wasteRecords.some(
        (record: { shiftReportId?: string }) => record.shiftReportId === first.result.reportId,
      ),
    ).toBe(false)
  })
})
