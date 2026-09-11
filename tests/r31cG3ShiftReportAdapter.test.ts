import { describe, expect, it } from 'vitest'
import {
  adaptAuthoritativeShiftReport,
  canonicalShiftBusinessKey,
  G3_SHIFT_ACK_INVALID,
} from '../src/lib/production/g3ShiftReportAdapter'
import type { ConfirmShiftReportInput } from '../src/lib/production/shiftReports'
import { shiftCommandFingerprint } from '../server/fst/_g3ShiftIntegrity.mjs'

const submitted: ConfirmShiftReportInput['report'] = {
  productionOrderId: 'po-1',
  lineId: 'line-1',
  shiftDate: '2026-09-10',
  shift: 'day',
  recipeNormSnapshot: {
    recipeId: 'recipe-1',
    recipeVersionId: 'recipe-version-1',
    versionNumber: 1,
    contentHash: 'content-hash-1',
    approvedBy: 'technologist',
    approvedAt: '2026-09-10T08:00:00.000Z',
    normBase: 'per_m2',
    components: [],
    snappedAt: '2026-09-10T08:00:00.000Z',
  },
  productionWarehouseId: 'line-wh',
  productionLocationId: 'line-loc',
  packagingWarehouseId: 'pack-wh',
  packagingLocationId: 'pack-loc',
  materialLines: [
    {
      lineId: 'ui-line-1',
      itemId: 'imp-1',
      unitSnapshot: 'kg',
      normQty: 5,
      actualInputQty: 5,
      wasteQty: 0.2,
      processConsumedQty: 4.8,
      deviationQty: 0,
      deviationPct: 0,
      tolerancePct: 0,
      normSource: 'fact_only',
      batchNo: 'IMP-B1',
      batchRunId: 'run-1',
    },
  ],
  wasteLines: [
    {
      lineId: 'ui-waste-1',
      itemId: 'imp-1',
      batchNo: 'IMP-B1',
      batchRunId: 'run-1',
      quantity: 0.2,
      unitSnapshot: 'kg',
      reasonCode: 'process_waste',
      comment: 'trim',
    },
  ],
  outputM2: 100,
  rollCount: 2,
  semiFinishedItemId: 'wip-1',
  semiFinishedUnitSnapshot: 'm²',
  wipContractVersion: 1,
  impregnationQcDecisionId: 'qc-1',
  batchRunId: 'run-1',
  idempotencyKey: 'client-transport-key',
}

const businessKey = canonicalShiftBusinessKey(submitted)

function commandFingerprintForRolls(outputRolls: unknown) {
  return shiftCommandFingerprint({
    orderId: 'po-1',
    lineId: 'line-1',
    shiftDate: '2026-09-10',
    shiftSlot: 'day',
    outputMp: 100,
    outputRolls,
    actualInputs: [
      {
        itemId: 'imp-1',
        quantity: 5,
        batchNo: 'IMP-B1',
        batchRunId: 'run-1',
      },
    ],
    wasteLines: [
      {
        itemId: 'imp-1',
        quantity: 0.2,
        batchNo: 'IMP-B1',
        batchRunId: 'run-1',
        reason: 'trim',
        unit: 'kg',
      },
    ],
    semiFinishedItemId: 'wip-1',
    packLocationId: 'pack-loc',
    impregnationQcDecisionId: 'qc-1',
    batchRunId: 'run-1',
  })
}

function serverReport(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sr-1',
    number: 'СО-20260910-001',
    status: 'confirmed',
    idempotencyKey: businessKey,
    commandFingerprint: commandFingerprintForRolls(2),
    orderId: 'po-1',
    productionOrderId: 'po-1',
    lineId: 'line-1',
    shiftDate: '2026-09-10',
    shiftSlot: 'day',
    shift: 'day',
    outputMp: 100,
    outputM2: 100,
    outputRolls: 2,
    rollCount: 2,
    actualInputs: [
      {
        itemId: 'imp-1',
        quantity: 5,
        batchNo: 'IMP-B1',
        batchRunId: 'run-1',
      },
    ],
    materialLines: [
      {
        ...submitted.materialLines[0],
        lineId: 'server-material-line-1',
      },
    ],
    wasteInputs: [
      {
        itemId: 'imp-1',
        quantity: 0.2,
        batchNo: 'IMP-B1',
        batchRunId: 'run-1',
        reason: 'trim',
        unit: 'kg',
      },
    ],
    wasteLines: [
      {
        lineId: 'server-waste-line-1',
        itemId: 'imp-1',
        quantity: 0.2,
        batchNo: 'IMP-B1',
        batchRunId: 'run-1',
        reasonCode: 'process_waste',
        comment: 'trim',
        unitSnapshot: 'kg',
      },
    ],
    semiFinishedItemId: 'wip-1',
    semiFinishedUnitSnapshot: 'm²',
    wipContractVersion: 1,
    impregnationQcDecisionId: 'qc-1',
    batchRunId: 'run-1',
    packLocationId: 'pack-loc',
    productionWarehouseId: 'line-wh',
    productionLocationId: 'line-loc',
    packagingWarehouseId: 'pack-wh',
    packagingLocationId: 'pack-loc',
    recipeNormSnapshot: structuredClone(submitted.recipeNormSnapshot),
    recipeVersionId: 'recipe-version-1',
    contentHash: 'content-hash-1',
    confirmedAt: '2026-09-10T10:00:00.000Z',
    confirmedBy: 'master-1',
    confirmedByName: 'Master',
    createdAt: '2026-09-10T10:00:00.000Z',
    updatedAt: '2026-09-10T10:00:00.000Z',
    consumptionDocumentId: 'issue-1',
    wipReceiptDocumentId: 'receipt-1',
    wasteTransferPairId: 'pair-1',
    scrapLocationId: 'scrap-loc',
    wipBatchId: 'wip-batch-1',
    ...overrides,
  }
}

function legacyServerReport(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sr-legacy',
    status: 'confirmed',
    idempotencyKey: 'production-shift:po-legacy:line-legacy:2026-09-09:night',
    orderId: 'po-legacy',
    lineId: 'line-legacy',
    shiftDate: '2026-09-09',
    shiftSlot: 'night',
    outputMp: 50,
    outputRolls: 1,
    actualInputs: [
      {
        itemId: 'legacy-raw',
        quantity: 5,
        batchNo: 'LEGACY-B1',
      },
    ],
    wasteLines: [],
    wipBatchId: 'legacy-wip-batch',
    semiFinishedItemId: 'legacy-wip-item',
    packLocationId: 'legacy-pack-location',
    recipeVersionId: 'legacy-recipe-version',
    contentHash: 'legacy-content-hash',
    confirmedAt: '2026-09-09T20:00:00.000Z',
    confirmedBy: 'legacy-master',
    confirmedByName: 'Legacy Master',
    createdAt: '2026-09-09T20:00:00.000Z',
    ...overrides,
  }
}

function authoritativeGraph(report: Record<string, unknown>) {
  const lineId = 'wip-line-1'
  const wipBatchId = String(report.wipBatchId)
  const receiptId = String(report.wipReceiptDocumentId)
  return {
    production: {
      orders: [
        {
          id: 'po-legacy',
          recipeNormSnapshot: {
            recipeId: 'legacy-recipe',
            recipeVersionId: 'legacy-recipe-version',
            versionNumber: 1,
            contentHash: 'legacy-content-hash',
            normBase: 'per_m2',
            components: [],
            snappedAt: '2026-09-09T19:00:00.000Z',
          },
        },
      ],
      shiftReports: [report],
      wipBatches: [
        {
          id: wipBatchId,
          shiftReportId: report.id,
          orderId: report.orderId,
          lineId: report.lineId,
          itemId: report.semiFinishedItemId,
          locationId: report.packagingLocationId,
          quantityMp: report.outputMp,
          rolls: report.outputRolls,
          isFinishedGoods: false,
          wipContractVersion: report.wipContractVersion,
          unitSnapshot: report.semiFinishedUnitSnapshot,
          impregnationQcDecisionId: report.impregnationQcDecisionId,
          batchRunId: report.batchRunId,
        },
      ],
    },
    warehouse: {
      documents: [
        {
          id: String(report.consumptionDocumentId),
          status: 'posted',
          type: 'issue',
          docRole: 'shift_consumption',
          warehouseId: report.productionWarehouseId,
          productionOrderId: report.orderId,
          productionLineId: report.lineId,
          shiftReportId: report.id,
          lines: [
            {
              lineId: 'consumption-line-1',
              itemId: 'imp-1',
              locationId: report.productionLocationId,
              batchNo: 'IMP-B1',
              batchRunId: 'run-1',
              quantity: 4.8,
            },
          ],
        },
        {
          id: receiptId,
          status: 'posted',
          type: 'receipt',
          docRole: 'wip_receipt',
          warehouseId: report.packagingWarehouseId,
          productionOrderId: report.orderId,
          productionLineId: report.lineId,
          shiftReportId: report.id,
          lines: [
            {
              lineId,
              itemId: report.semiFinishedItemId,
              locationId: report.packagingLocationId,
              batchNo: wipBatchId,
              quantity: report.outputMp,
            },
          ],
        },
        {
          id: 'waste-issue-1',
          status: 'posted',
          type: 'issue',
          docRole: 'waste_to_scrap',
          warehouseId: report.productionWarehouseId,
          productionOrderId: report.orderId,
          productionLineId: report.lineId,
          shiftReportId: report.id,
          transferPairId: report.wasteTransferPairId,
          lines: [
            {
              lineId: 'waste-issue-line-1',
              itemId: 'imp-1',
              locationId: report.productionLocationId,
              batchNo: 'IMP-B1',
              batchRunId: 'run-1',
              quantity: 0.2,
            },
          ],
        },
        {
          id: 'waste-receipt-1',
          status: 'posted',
          type: 'receipt',
          docRole: 'scrap_receipt',
          warehouseId: report.productionWarehouseId,
          productionOrderId: report.orderId,
          productionLineId: report.lineId,
          shiftReportId: report.id,
          transferPairId: report.wasteTransferPairId,
          lines: [
            {
              lineId: 'waste-receipt-line-1',
              itemId: 'imp-1',
              locationId: report.scrapLocationId,
              batchNo: 'IMP-B1',
              batchRunId: 'run-1',
              quantity: 0.2,
            },
          ],
        },
      ],
      movements: [
        {
          id: 'consumption-movement-1',
          documentId: String(report.consumptionDocumentId),
          documentLineId: 'consumption-line-1',
          type: 'issue',
          warehouseId: report.productionWarehouseId,
          locationId: report.productionLocationId,
          itemId: 'imp-1',
          batchNo: 'IMP-B1',
          batchRunId: 'run-1',
          quantity: 4.8,
          productionOrderId: report.orderId,
          productionLineId: report.lineId,
          shiftReportId: report.id,
        },
        {
          id: 'wip-movement-1',
          documentId: receiptId,
          documentLineId: lineId,
          type: 'receipt',
          warehouseId: report.packagingWarehouseId,
          locationId: report.packagingLocationId,
          itemId: report.semiFinishedItemId,
          batchNo: wipBatchId,
          quantity: report.outputMp,
          productionOrderId: report.orderId,
          productionLineId: report.lineId,
          shiftReportId: report.id,
          isWip: true,
        },
        {
          id: 'waste-issue-movement-1',
          documentId: 'waste-issue-1',
          documentLineId: 'waste-issue-line-1',
          type: 'issue',
          warehouseId: report.productionWarehouseId,
          locationId: report.productionLocationId,
          itemId: 'imp-1',
          batchNo: 'IMP-B1',
          batchRunId: 'run-1',
          quantity: 0.2,
          productionOrderId: report.orderId,
          productionLineId: report.lineId,
          shiftReportId: report.id,
        },
        {
          id: 'waste-receipt-movement-1',
          documentId: 'waste-receipt-1',
          documentLineId: 'waste-receipt-line-1',
          type: 'receipt',
          warehouseId: report.productionWarehouseId,
          locationId: report.scrapLocationId,
          itemId: 'imp-1',
          batchNo: 'IMP-B1',
          batchRunId: 'run-1',
          quantity: 0.2,
          productionOrderId: report.orderId,
          productionLineId: report.lineId,
          shiftReportId: report.id,
        },
      ],
    },
  }
}

function adapt(
  overrides: Record<string, unknown> = {},
  graphOverride: Partial<ReturnType<typeof authoritativeGraph>> = {},
  revisionOverride: { criticalRevision?: unknown; previousCriticalRevision?: unknown; idempotent?: boolean } = {},
) {
  const report = serverReport(overrides)
  const graph = authoritativeGraph(report)
  return adaptAuthoritativeShiftReport({
    serverReport: report,
    reportId: 'sr-1',
    criticalRevision: revisionOverride.criticalRevision ?? 8,
    previousCriticalRevision: revisionOverride.previousCriticalRevision ?? 7,
    idempotent: revisionOverride.idempotent,
    warehouse: graphOverride.warehouse ?? graph.warehouse,
    production: graphOverride.production ?? graph.production,
    productionOrderId: 'po-1',
    expectedBusinessKey: businessKey,
    submitted,
  })
}

function adaptWithRollCount(rollCount: number) {
  const report = serverReport({
    outputRolls: rollCount,
    rollCount,
    commandFingerprint: commandFingerprintForRolls(rollCount),
  })
  const graph = authoritativeGraph(report)
  return adaptAuthoritativeShiftReport({
    serverReport: report,
    reportId: 'sr-1',
    criticalRevision: 8,
    previousCriticalRevision: 7,
    warehouse: graph.warehouse,
    production: graph.production,
    productionOrderId: 'po-1',
    expectedBusinessKey: businessKey,
    submitted: { ...submitted, rollCount },
  })
}

describe('R3.1C G3 shift web ack adapter', () => {
  it('returns a complete UI report only after authoritative fields match', async () => {
    const result = await adapt()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.report).toMatchObject({
      id: 'sr-1',
      number: 'СО-20260910-001',
      productionOrderId: 'po-1',
      shift: 'day',
      outputM2: 100,
      rollCount: 2,
      materialLines: [expect.objectContaining({ lineId: 'server-material-line-1' })],
      consumptionDocumentId: 'issue-1',
      wipReceiptDocumentId: 'receipt-1',
      wasteTransferPairId: 'pair-1',
    })
    expect(result.authoritativeReports).toEqual([result.report])
    expect(result.report).not.toHaveProperty('orderId')
    expect(result.report).not.toHaveProperty('actualInputs')
  })

  it.each([
    ['negative', -2],
    ['fractional', 1.5],
    ['infinite', Number.POSITIVE_INFINITY],
    ['NaN', Number.NaN],
  ])('rejects a matching but invalid %s roll count in the authoritative ACK', async (_label, rollCount) => {
    expect(await adaptWithRollCount(rollCount)).toEqual({
      ok: false,
      error: G3_SHIFT_ACK_INVALID,
    })
  })

  it('accepts and preserves a legitimate zero roll count in the authoritative ACK', async () => {
    const result = await adaptWithRollCount(0)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.report.rollCount).toBe(0)
    expect(result.authoritativeReports).toEqual([result.report])
  })

  it('preserves the complete authoritative report list and correction markers', async () => {
    const current = serverReport()
    const graph = authoritativeGraph(current)
    const authoritativeOriginal = {
      ...serverReport({
        id: 'sr-original',
        number: 'СО-20260909-001',
        idempotencyKey: 'production-shift:po-1:line-1:2026-09-09:day',
        shiftDate: '2026-09-09',
        correctedAt: '2026-09-10T09:59:00.000Z',
        correctedBy: 'director-1',
        correctionOpen: true,
      }),
    }
    graph.production.shiftReports = [authoritativeOriginal, current]

    const result = await adaptAuthoritativeShiftReport({
      serverReport: current,
      reportId: 'sr-1',
      criticalRevision: 8,
      previousCriticalRevision: 7,
      warehouse: graph.warehouse,
      production: graph.production,
      productionOrderId: 'po-1',
      expectedBusinessKey: businessKey,
      submitted,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.authoritativeReports.map((row) => row.id)).toEqual([
      'sr-original',
      'sr-1',
    ])
    expect(result.authoritativeReports[0]).toMatchObject({
      correctedAt: '2026-09-10T09:59:00.000Z',
      correctedBy: 'director-1',
      correctionOpen: true,
      materialLines: [expect.objectContaining({ lineId: 'server-material-line-1' })],
    })
  })

  it('projects an authoritative pre-WIP-v1 sibling without inventing stock lineage', async () => {
    const current = serverReport()
    const legacy = legacyServerReport()
    const graph = authoritativeGraph(current)
    graph.production.shiftReports = [legacy, current]

    const result = await adaptAuthoritativeShiftReport({
      serverReport: current,
      reportId: 'sr-1',
      criticalRevision: 8,
      previousCriticalRevision: 7,
      warehouse: graph.warehouse,
      production: graph.production,
      productionOrderId: 'po-1',
      expectedBusinessKey: businessKey,
      submitted,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.authoritativeReports.map((row) => row.id)).toEqual(['sr-legacy', 'sr-1'])
    const projectedLegacy = result.authoritativeReports[0] as unknown as Record<string, unknown>
    expect(projectedLegacy).toMatchObject({
      id: 'sr-legacy',
      number: 'sr-legacy',
      productionOrderId: 'po-legacy',
      shift: 'night',
      outputM2: 50,
      rollCount: 1,
      semiFinishedItemId: 'legacy-wip-item',
      packagingLocationId: 'legacy-pack-location',
      productionLocationId: '',
      materialLines: [],
      wasteLines: [],
      legacyReadOnlyProjection: true,
      legacyWipBatchId: 'legacy-wip-batch',
      legacyActualInputs: [
        expect.objectContaining({
          itemId: 'legacy-raw',
          quantity: 5,
          batchNo: 'LEGACY-B1',
        }),
      ],
    })
    expect(projectedLegacy).not.toHaveProperty('consumptionDocumentId')
    expect(projectedLegacy).not.toHaveProperty('wipReceiptDocumentId')
    expect(result.report).toEqual(result.authoritativeReports[1])
  })

  it('blocks a malformed WIP-v1 sibling without mutating authoritative input', async () => {
    const current = serverReport()
    const malformedV1 = serverReport({
      id: 'sr-v1-sibling',
      number: 'СО-20260909-002',
      idempotencyKey: 'production-shift:po-1:line-1:2026-09-09:night',
      shiftDate: '2026-09-09',
      shiftSlot: 'night',
      shift: 'night',
      commandFingerprint: undefined,
      wipContractVersion: 1,
    })
    const graph = authoritativeGraph(current)
    graph.production.shiftReports = [malformedV1, current]
    const before = structuredClone(graph.production)

    const result = await adaptAuthoritativeShiftReport({
      serverReport: current,
      reportId: 'sr-1',
      criticalRevision: 8,
      previousCriticalRevision: 7,
      warehouse: graph.warehouse,
      production: graph.production,
      productionOrderId: 'po-1',
      expectedBusinessKey: businessKey,
      submitted,
    })

    expect(result).toEqual({ ok: false, error: G3_SHIFT_ACK_INVALID })
    expect(graph.production).toEqual(before)
  })

  it('blocks duplicate authoritative sibling IDs without mutating input', async () => {
    const current = serverReport()
    const firstLegacy = legacyServerReport()
    const secondLegacy = legacyServerReport({
      idempotencyKey: 'production-shift:po-legacy:line-legacy:2026-09-08:night',
      shiftDate: '2026-09-08',
    })
    const graph = authoritativeGraph(current)
    graph.production.shiftReports = [firstLegacy, secondLegacy, current]
    const before = structuredClone(graph.production)

    const result = await adaptAuthoritativeShiftReport({
      serverReport: current,
      reportId: 'sr-1',
      criticalRevision: 8,
      previousCriticalRevision: 7,
      warehouse: graph.warehouse,
      production: graph.production,
      productionOrderId: 'po-1',
      expectedBusinessKey: businessKey,
      submitted,
    })

    expect(result).toEqual({ ok: false, error: G3_SHIFT_ACK_INVALID })
    expect(graph.production).toEqual(before)
  })

  it('never downgrades a malformed acknowledged target to the legacy reader', async () => {
    const target = serverReport({ commandFingerprint: undefined, wipContractVersion: undefined })
    const graph = authoritativeGraph(target)
    const serverBefore = structuredClone(target)
    const productionBefore = structuredClone(graph.production)

    const result = await adaptAuthoritativeShiftReport({
      serverReport: target,
      reportId: 'sr-1',
      criticalRevision: 8,
      previousCriticalRevision: 7,
      warehouse: graph.warehouse,
      production: graph.production,
      productionOrderId: 'po-1',
      expectedBusinessKey: businessKey,
      submitted,
    })

    expect(result).toEqual({ ok: false, error: G3_SHIFT_ACK_INVALID })
    expect(target).toEqual(serverBefore)
    expect(graph.production).toEqual(productionBefore)
  })

  it.each([
    ['report id', { id: 'sr-other' }],
    ['output', { outputMp: 99 }],
    ['lot', { actualInputs: [{ itemId: 'imp-1', quantity: 5, batchNo: 'OTHER', batchRunId: 'run-1' }] }],
    ['run', { batchRunId: 'run-other' }],
    ['missing fingerprint', { commandFingerprint: undefined }],
    ['wrong route', { productionLocationId: 'other-line-location' }],
  ])('fails closed for mismatched %s', async (_label, overrides) => {
    expect(await adapt(overrides)).toEqual({ ok: false, error: G3_SHIFT_ACK_INVALID })
  })

  it('recomputes the submitted SHA-256 instead of trusting an echoed report fingerprint', async () => {
    const forgedFingerprint = shiftCommandFingerprint({
      orderId: 'po-1',
      lineId: 'line-1',
      shiftDate: '2026-09-10',
      shiftSlot: 'day',
      outputMp: 99,
      outputRolls: 2,
      actualInputs: [{ itemId: 'imp-1', quantity: 5, batchNo: 'IMP-B1', batchRunId: 'run-1' }],
      wasteLines: [{ itemId: 'imp-1', quantity: 0.2, batchNo: 'IMP-B1', batchRunId: 'run-1', reason: 'trim', unit: 'kg' }],
      semiFinishedItemId: 'wip-1',
      packLocationId: 'pack-loc',
      impregnationQcDecisionId: 'qc-1',
      batchRunId: 'run-1',
    })
    expect(
      await adapt({ outputMp: 99, commandFingerprint: forgedFingerprint }),
    ).toEqual({ ok: false, error: G3_SHIFT_ACK_INVALID })
  })

  it('requires a monotonic critical revision, allowing equality only for an exact replay', async () => {
    expect(await adapt({}, {}, { criticalRevision: 6, previousCriticalRevision: 7 })).toEqual({
      ok: false,
      error: G3_SHIFT_ACK_INVALID,
    })
    expect(await adapt({}, {}, { criticalRevision: 7, previousCriticalRevision: 7 })).toEqual({
      ok: false,
      error: G3_SHIFT_ACK_INVALID,
    })
    expect(
      (await adapt({}, {}, { criticalRevision: 7, previousCriticalRevision: 7, idempotent: true })).ok,
    ).toBe(true)
  })

  it('fails closed unless report, WIP, receipt line and movement form one exact graph', async () => {
    const report = serverReport()
    const graph = authoritativeGraph(report)
    const missingWip = { ...graph.production, wipBatches: [] }
    expect(await adapt({}, { production: missingWip })).toEqual({
      ok: false,
      error: G3_SHIFT_ACK_INVALID,
    })

    const wrongLine = structuredClone(graph.warehouse)
    wrongLine.movements[0].documentLineId = 'foreign-line'
    expect(await adapt({}, { warehouse: wrongLine })).toEqual({
      ok: false,
      error: G3_SHIFT_ACK_INVALID,
    })

    const cancelled = structuredClone(graph.warehouse)
    cancelled.movements[0].cancelled = true
    expect(await adapt({}, { warehouse: cancelled })).toEqual({
      ok: false,
      error: G3_SHIFT_ACK_INVALID,
    })

    const unexpected = structuredClone(graph.warehouse)
    unexpected.movements.push({
      ...unexpected.movements[0],
      id: 'unexpected-wip-movement',
    })
    expect(await adapt({}, { warehouse: unexpected })).toEqual({
      ok: false,
      error: G3_SHIFT_ACK_INVALID,
    })

    const duplicateBusinessKey = structuredClone(graph.production)
    duplicateBusinessKey.shiftReports.push({
      ...duplicateBusinessKey.shiftReports[0],
      id: 'second-report-for-same-business-key',
    })
    expect(await adapt({}, { production: duplicateBusinessKey })).toEqual({
      ok: false,
      error: G3_SHIFT_ACK_INVALID,
    })

    const corruptConsumption = structuredClone(graph.warehouse)
    corruptConsumption.movements.find(
      (row) => row.id === 'consumption-movement-1',
    )!.quantity = Number.NaN
    expect(await adapt({}, { warehouse: corruptConsumption })).toEqual({
      ok: false,
      error: G3_SHIFT_ACK_INVALID,
    })
  })

  it('rejects malformed or hidden waste rows instead of filtering them out', async () => {
    expect(await adapt({ wasteInputs: [{ itemId: 'imp-1', quantity: Number.NaN }] })).toEqual({
      ok: false,
      error: G3_SHIFT_ACK_INVALID,
    })
    expect(await adapt({ wasteInputs: [null] })).toEqual({
      ok: false,
      error: G3_SHIFT_ACK_INVALID,
    })
  })
})
