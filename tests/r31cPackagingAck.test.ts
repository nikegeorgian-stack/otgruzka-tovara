import { describe, expect, it } from 'vitest'

import {
  computePackagingCommandFingerprint,
  G4_PACKAGING_ACK_INVALID,
  validatePackagingMutationAck,
} from '@/lib/production/g4PackagingAck'

async function fixture() {
  const command = {
    reportKey: 'pack::po-c::2026-09-10::day::wip-c',
    productionOrderId: 'po-c',
    orderId: 'po-c',
    lineId: 'pack',
    reportDate: '2026-09-10',
    date: '2026-09-10',
    shiftSlot: 'day',
    finishedProductId: 'fp-c',
    warehouseItemId: 'fg-c',
    packagingWarehouseId: 'pack-wh',
    packagingLocationId: 'pack-loc',
    finishedGoodsWarehouseId: 'pack-wh',
    finishedGoodsLocationId: 'fg-loc',
    outputM2: 20,
    outputMp: 20,
    outputRolls: 2,
    outputPallets: 1,
    wipLines: [
      {
        lineId: 'wip-receipt-line-c',
        productionOrderId: 'po-c',
        shiftReportId: 'shift-c',
        receiptDocumentId: 'wip-receipt-c',
        semiFinishedItemId: 'sf-c',
        itemId: 'sf-c',
        quantity: 20,
        unitSnapshot: 'm2',
        batchNo: 'wip-c',
      },
    ],
    materialLines: [
      { lineId: 'box-c', itemId: 'box', quantity: 2, unitSnapshot: 'pcs' },
      { lineId: 'pallet-c', itemId: 'pallet', quantity: 1, unitSnapshot: 'pcs' },
    ],
  }
  const fingerprint = await computePackagingCommandFingerprint(
    'packaging.report.confirm',
    command,
  )
  const report = {
    id: 'report-c',
    number: 'УП-20260910-001',
    idempotencyKey: command.reportKey,
    idempotencyFingerprint: fingerprint,
    status: 'confirmed',
    productionOrderId: 'po-c',
    lineId: 'pack',
    reportDate: '2026-09-10',
    shiftSlot: 'day',
    finishedProductId: 'fp-c',
    warehouseItemId: 'fg-c',
    packagingWarehouseId: 'pack-wh',
    packagingLocationId: 'pack-loc',
    finishedGoodsWarehouseId: 'pack-wh',
    finishedGoodsLocationId: 'fg-loc',
    outputM2: 20,
    outputRolls: 2,
    outputPallets: 1,
    lotNumber: 'FG-20260910-001',
    wipLines: [
      {
        lineId: 'wip-receipt-line-c',
        productionOrderId: 'po-c',
        shiftReportId: 'shift-c',
        receiptDocumentId: 'wip-receipt-c',
        itemId: 'sf-c',
        quantity: 20,
        unitSnapshot: 'm2',
        wipBatchId: 'wip-c',
      },
    ],
    materialLines: [
      { lineId: 'box-c', itemId: 'box', quantity: 2, unitSnapshot: 'pcs' },
      { lineId: 'pallet-c', itemId: 'pallet', quantity: 1, unitSnapshot: 'pcs' },
    ],
    documentIds: ['doc-wip', 'doc-material', 'doc-fg'],
    finishedGoodsLotId: 'lot-c',
    updatedAt: '2026-09-10T10:00:00.000Z',
  }
  const lot = {
    id: 'lot-c',
    lotNumber: 'FG-20260910-001',
    packagingReportId: 'report-c',
    productionOrderId: 'po-c',
    finishedProductId: 'fp-c',
    warehouseItemId: 'fg-c',
    qcStatus: 'pending',
    outputRolls: 2,
    outputPallets: 1,
    quantityProduced: 20,
    updatedAt: '2026-09-10T10:00:00.000Z',
  }
  const documents = [
    {
      id: 'doc-wip',
      status: 'posted',
      type: 'issue',
      purpose: 'production_issue',
      docRole: 'production_wip_pack_consumption',
      warehouseId: 'pack-wh',
      date: '2026-09-10',
      productionOrderId: 'po-c',
      packagingReportId: 'report-c',
      finishedGoodsLotId: 'lot-c',
      lines: [
        {
          itemId: 'sf-c',
          lineId: 'doc-wip-line',
          quantity: 20,
          batchNo: 'wip-c',
          locationId: 'pack-loc',
          sourceDocumentId: 'wip-receipt-c',
          sourceDocumentLineId: 'wip-receipt-line-c',
          sourceShiftReportId: 'shift-c',
          sourceWipBatchId: 'wip-c',
          unitSnapshot: 'm2',
        },
      ],
    },
    {
      id: 'doc-material',
      status: 'posted',
      type: 'issue',
      purpose: 'production_issue',
      docRole: 'packaging_material_consumption',
      warehouseId: 'pack-wh',
      date: '2026-09-10',
      productionOrderId: 'po-c',
      packagingReportId: 'report-c',
      finishedGoodsLotId: 'lot-c',
      lines: [
        {
          lineId: 'doc-box-line',
          itemId: 'box',
          quantity: 2,
          batchNo: 'BOX-1',
          locationId: 'pack-loc',
          unitSnapshot: 'pcs',
        },
        {
          lineId: 'doc-pallet-line',
          itemId: 'pallet',
          quantity: 1,
          batchNo: 'PALLET-1',
          locationId: 'pack-loc',
          unitSnapshot: 'pcs',
        },
      ],
    },
    {
      id: 'doc-fg',
      status: 'posted',
      type: 'receipt',
      purpose: 'production_receipt',
      docRole: 'production_fg_receipt',
      warehouseId: 'pack-wh',
      date: '2026-09-10',
      productionOrderId: 'po-c',
      packagingReportId: 'report-c',
      finishedGoodsLotId: 'lot-c',
      lines: [
        {
          lineId: 'doc-fg-line',
          itemId: 'fg-c',
          quantity: 20,
          batchNo: 'FG-20260910-001',
          locationId: 'fg-loc',
          unitSnapshot: 'm2',
        },
      ],
    },
  ]
  const movements = documents.flatMap((document) =>
    document.lines.map((line, index) => ({
      id: `mov-${document.id}-${index}`,
      documentId: document.id,
      documentLineId: line.lineId,
      warehouseId: document.warehouseId,
      date: document.date,
      type: document.type,
      productionOrderId: 'po-c',
      packagingReportId: 'report-c',
      finishedGoodsLotId: 'lot-c',
      ...line,
    })),
  )
  const ack = {
    criticalRevision: 91,
    packagingQcActive: true,
    productionActive: true,
    idempotencyFingerprint: fingerprint,
    reportId: 'report-c',
    reportNumber: 'УП-20260910-001',
    finishedGoodsLotId: 'lot-c',
    lotNumber: 'FG-20260910-001',
    quantityProduced: 20,
    production: {
      orders: [{ id: 'po-c' }],
      packagingReports: [report],
      finishedGoodsLots: [lot],
      qcDecisions: [],
    },
    warehouse: { documents, movements, loadingShipments: [] },
  }
  return { command, ack }
}

describe('R3.1C G4 packaging ACK validation', () => {
  it('accepts the exact report, lot, documents, movements, and fingerprint', async () => {
    const input = await fixture()
    expect(
      await validatePackagingMutationAck({
        ...input,
        previousCriticalRevision: 90,
      }),
    ).toMatchObject({
      ok: true,
      criticalRevision: 91,
      report: { id: 'report-c' },
      lot: { id: 'lot-c' },
    })
  })

  it('rejects malformed, stale, duplicate, or wrong-effect ACKs', async () => {
    const mutations: Array<
      (ack: Awaited<ReturnType<typeof fixture>>['ack']) => void
    > = [
      (ack) => { ack.criticalRevision = 0 },
      (ack) => { ack.packagingQcActive = false },
      (ack) => { ack.productionActive = false },
      (ack) => { ack.idempotencyFingerprint = 'wrong' },
      (ack) => { ack.production.packagingReports.push({ ...ack.production.packagingReports[0] }) },
      (ack) => { ack.production.finishedGoodsLots[0].warehouseItemId = 'forged' },
      (ack) => { ack.production.packagingReports[0].outputRolls = -1 },
      (ack) => { ack.production.packagingReports[0].outputPallets = 1.5 },
      (ack) => { ack.production.finishedGoodsLots[0].outputRolls = 'Infinity' },
      (ack) => { ack.production.finishedGoodsLots[0].outputPallets = 'NaN' },
      (ack) => { ack.warehouse.documents[2].lines[0].quantity = 19 },
      (ack) => { ack.warehouse.movements.pop() },
      (ack) => { ack.warehouse.documents[0].warehouseId = 'wrong-wh' },
      (ack) => { ack.warehouse.movements[0].locationId = 'wrong-loc' },
      (ack) => { ack.warehouse.movements[0].documentLineId = 'wrong-line' },
      (ack) => {
        ack.warehouse.movements.push({
          ...ack.warehouse.movements[0],
          id: 'unexpected-movement',
          documentId: 'unexpected-document',
        })
      },
    ]
    for (const mutate of mutations) {
      const input = await fixture()
      mutate(input.ack)
      expect(
        await validatePackagingMutationAck({
          ...input,
          previousCriticalRevision: 90,
        }),
      ).toMatchObject({ ok: false, error: G4_PACKAGING_ACK_INVALID })
    }
  })

  it('accepts an exact timeout replay at the current revision but rejects a stale response', async () => {
    const replay = await fixture()
    replay.ack.idempotent = true
    expect(
      await validatePackagingMutationAck({
        ...replay,
        previousCriticalRevision: replay.ack.criticalRevision,
      }),
    ).toMatchObject({ ok: true })

    const stale = await fixture()
    expect(
      await validatePackagingMutationAck({
        ...stale,
        previousCriticalRevision: stale.ack.criticalRevision + 1,
      }),
    ).toMatchObject({ ok: false, reason: 'revision_stale' })
  })

  it('recomputes the expected fingerprint and rejects a changed submitted payload', async () => {
    const changed = await fixture()
    changed.command.outputM2 = 21
    expect(
      await validatePackagingMutationAck({
        ...changed,
        previousCriticalRevision: 90,
      }),
    ).toMatchObject({
      ok: false,
      error: G4_PACKAGING_ACK_INVALID,
      reason: 'fingerprint_mismatch',
    })
  })

  it.each([
    ['outputRolls', -1],
    ['outputRolls', 1.5],
    ['outputRolls', 'Infinity'],
    ['outputRolls', 'NaN'],
    ['outputPallets', -1],
    ['outputPallets', 1.5],
    ['outputPallets', 'Infinity'],
    ['outputPallets', 'NaN'],
  ] as const)('rejects an invalid submitted %s=%s even when its fingerprint matches', async (field, value) => {
    const input = await fixture()
    ;(input.command as Record<string, unknown>)[field] = value
    const fingerprint = await computePackagingCommandFingerprint(
      'packaging.report.confirm',
      input.command,
    )
    input.ack.idempotencyFingerprint = fingerprint
    input.ack.production.packagingReports[0].idempotencyFingerprint = fingerprint
    ;(input.ack.production.packagingReports[0] as Record<string, unknown>)[field] = value
    ;(input.ack.production.finishedGoodsLots[0] as Record<string, unknown>)[field] = value

    expect(
      await validatePackagingMutationAck({
        ...input,
        previousCriticalRevision: 90,
      }),
    ).toMatchObject({
      ok: false,
      error: G4_PACKAGING_ACK_INVALID,
      reason: 'command_output_counts_invalid',
    })
  })

  it.each([
    -1,
    0,
    'Infinity',
    'NaN',
    '',
  ] as const)('rejects invalid submitted outputM2=%s even with a matching fingerprint', async (value) => {
    const input = await fixture()
    ;(input.command as Record<string, unknown>).outputM2 = value
    const fingerprint = await computePackagingCommandFingerprint(
      'packaging.report.confirm',
      input.command,
    )
    input.ack.idempotencyFingerprint = fingerprint
    input.ack.production.packagingReports[0].idempotencyFingerprint = fingerprint

    expect(
      await validatePackagingMutationAck({
        ...input,
        previousCriticalRevision: 90,
      }),
    ).toMatchObject({
      ok: false,
      error: G4_PACKAGING_ACK_INVALID,
      reason: 'command_output_invalid',
    })
  })

  it('fails closed on malformed authoritative containers and rows without mirroring', async () => {
    const cases: Array<{
      name: string
      mutate: (ack: Record<string, unknown>) => void
    }> = []
    for (const [domain, key] of [
      ['production', 'packagingReports'],
      ['production', 'finishedGoodsLots'],
      ['warehouse', 'documents'],
      ['warehouse', 'movements'],
      ['warehouse', 'loadingShipments'],
    ] as const) {
      cases.push(
        {
          name: `${domain}.${key}=null`,
          mutate: (ack) => {
            ;(ack[domain] as Record<string, unknown>)[key] = null
          },
        },
        {
          name: `${domain}.${key}=string`,
          mutate: (ack) => {
            ;(ack[domain] as Record<string, unknown>)[key] = 'malformed'
          },
        },
        {
          name: `${domain}.${key}=array-row`,
          mutate: (ack) => {
            const owner = ack[domain] as Record<string, unknown>
            owner[key] = [...(owner[key] as unknown[]), []]
          },
        },
      )
    }

    for (const testCase of cases) {
      const input = await fixture()
      const ack = input.ack as unknown as Record<string, unknown>
      testCase.mutate(ack)
      let mirrorCalls = 0
      const validate = () =>
        validatePackagingMutationAck({
          ...input,
          previousCriticalRevision: 90,
        })
      await expect(validate(), testCase.name).resolves.toMatchObject({
        ok: false,
        error: G4_PACKAGING_ACK_INVALID,
        reason: 'authoritative_shape_invalid',
      })
      const result = await validate()
      if (result.ok) mirrorCalls += 1
      expect(mirrorCalls, testCase.name).toBe(0)
    }
  })

  it('fails closed on malformed related report/document lines and never throws', async () => {
    const cases: Array<{
      name: string
      mutate: (ack: Record<string, unknown>) => void
    }> = [
      ...[null, 'malformed', [[]]].map((value) => ({
        name: `report.wipLines=${JSON.stringify(value)}`,
        mutate: (ack: Record<string, unknown>) => {
          const production = ack.production as Record<string, unknown>
          const report = (production.packagingReports as Record<string, unknown>[])[0]
          report.wipLines = value
        },
      })),
      ...[null, 'malformed', [[]]].map((value) => ({
        name: `document.lines=${JSON.stringify(value)}`,
        mutate: (ack: Record<string, unknown>) => {
          const warehouse = ack.warehouse as Record<string, unknown>
          const document = (warehouse.documents as Record<string, unknown>[])[0]
          document.lines = value
        },
      })),
    ]

    for (const testCase of cases) {
      const input = await fixture()
      testCase.mutate(input.ack as unknown as Record<string, unknown>)
      const result = await validatePackagingMutationAck({
        ...input,
        previousCriticalRevision: 90,
      })
      expect(result, testCase.name).toMatchObject({
        ok: false,
        error: G4_PACKAGING_ACK_INVALID,
        reason: 'authoritative_shape_invalid',
      })
    }
  })
})
