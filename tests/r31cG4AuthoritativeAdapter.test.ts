import { describe, expect, it } from 'vitest'

import {
  adaptAuthoritativeG4ProductionDomain,
  G4_AUTHORITATIVE_STATE_INCOMPLETE,
  mirrorG4Ack,
  resolveAuthoritativePackagingOverlay,
  type G4ProductionDomain,
} from '@/lib/production/g4ServerClient'

const criticalProduction: G4ProductionDomain = {
  orders: [{ id: 'po-c', semiFinishedItemId: 'sf-c' }],
  packagingReports: [
    {
      id: 'report-c',
      number: 'УП-20260910-001',
      status: 'confirmed',
      productionOrderId: 'po-c',
      lineId: 'pack',
      reportDate: '2026-09-10',
      shiftSlot: 'night',
      outputM2: 160,
      outputRolls: 8,
      outputPallets: 2,
      lotNumber: 'LOT-20260910-001',
      finishedGoodsLotId: 'lot-c',
      wipLines: [
        {
          lineId: 'wip-line-c',
          itemId: 'sf-c',
          wipBatchId: 'WIP-C',
          quantity: 160,
        },
      ],
      materialLines: [],
      createdAt: '2026-09-10T20:00:00.000Z',
      confirmedAt: '2026-09-10T20:01:00.000Z',
      updatedAt: '2026-09-10T20:01:00.000Z',
    },
  ],
  finishedGoodsLots: [
    {
      id: 'lot-c',
      lotNumber: 'LOT-20260910-001',
      packagingReportId: 'report-c',
      productionOrderId: 'po-c',
      qcStatus: 'released',
      quantityProduced: 160,
      outputRolls: 8,
      outputPallets: 2,
      lotRevision: 2,
      currentDecisionId: 'decision-c',
      producedAt: '2026-09-10',
      createdAt: '2026-09-10T20:01:00.000Z',
      updatedAt: '2026-09-10T20:05:00.000Z',
    },
  ],
  qcDecisions: [
    {
      id: 'decision-c',
      lotId: 'lot-c',
      lotRevision: 2,
      status: 'released',
    },
  ],
}

function expectUiShape(production: Record<string, unknown>) {
  const reports = production.packagingReports as Record<string, unknown>[]
  const lots = production.finishedGoodsLots as Record<string, unknown>[]
  const selectedShift = reports.filter(
    (report) =>
      report.productionOrderId === 'po-c' &&
      report.shiftDate === '2026-09-10' &&
      report.shift === 'night',
  )
  expect(selectedShift).toHaveLength(1)
  expect(selectedShift[0]).toMatchObject({
    number: 'УП-20260910-001',
    batchNo: 'LOT-20260910-001',
    semiFinishedItemId: 'sf-c',
    rollCount: 8,
    palletCount: 2,
  })
  expect((selectedShift[0].wipLines as Record<string, unknown>[])[0]).toMatchObject({
    semiFinishedItemId: 'sf-c',
    batchNo: 'WIP-C',
  })
  expect(lots).toHaveLength(1)
  expect(lots[0]).toMatchObject({
    batchNo: 'LOT-20260910-001',
    outputM2: 160,
    rollCount: 8,
    palletCount: 2,
    packagingDate: '2026-09-10',
    serverQcDecisionId: 'decision-c',
    serverQcDecisionStatus: 'released',
    serverQcDecisionRevision: 2,
  })
}

describe('R3.1C centralized G4 authoritative adapter', () => {
  it('normalizes the authoritative login pull for selected shift and OTC batch', () => {
    const overlay = resolveAuthoritativePackagingOverlay({
      legacyProduction: {},
      criticalProduction,
      criticalWarehouse: { documents: [], movements: [], loadingShipments: [] },
      criticalRevision: 12,
      packagingQcActive: true,
      productionActive: true,
    })
    expect(overlay.source).toBe('fst_critical_store')
    expectUiShape(overlay.production)
  })

  it('uses the same adapter for a mutation ACK mirror', () => {
    const mirrored = mirrorG4Ack(
      {} as never,
      {},
      {
        production: criticalProduction,
        warehouse: { documents: [], movements: [], loadingShipments: [] },
        criticalRevision: 13,
        packagingQcActive: true,
        productionActive: true,
      },
    )
    expectUiShape(mirrored.production)
  })

  it('never treats a released lot without its exact decision revision as released authority', () => {
    const forged = structuredClone(criticalProduction)
    ;(forged.qcDecisions as Record<string, unknown>[])[0].lotRevision = 1
    const overlay = resolveAuthoritativePackagingOverlay({
      legacyProduction: {},
      criticalProduction: forged,
      criticalWarehouse: { documents: [], movements: [], loadingShipments: [] },
      criticalRevision: 14,
      packagingQcActive: true,
      productionActive: true,
    })
    expect(
      (overlay.production.finishedGoodsLots as Record<string, unknown>[])[0]
        .serverQcDecisionStatus,
    ).toBe('authoritative_decision_mismatch')
  })

  it('blocks active G4 when a required container, row, nested line, or ID is malformed', () => {
    const cases: Array<{
      name: string
      production?: G4ProductionDomain
      warehouse?: Record<string, unknown>
    }> = [
      {
        name: 'missing report container',
        production: { ...structuredClone(criticalProduction), packagingReports: undefined },
      },
      {
        name: 'string lot container',
        production: {
          ...structuredClone(criticalProduction),
          finishedGoodsLots: 'malformed' as unknown as unknown[],
        },
      },
      {
        name: 'array used as a report row',
        production: {
          ...structuredClone(criticalProduction),
          packagingReports: [
            ...(structuredClone(criticalProduction.packagingReports) as unknown[]),
            [],
          ],
        },
      },
      {
        name: 'duplicate report ID',
        production: {
          ...structuredClone(criticalProduction),
          packagingReports: [
            ...(structuredClone(criticalProduction.packagingReports) as unknown[]),
            structuredClone((criticalProduction.packagingReports as unknown[])[0]),
          ],
        },
      },
      {
        name: 'malformed report line container',
        production: (() => {
          const value = structuredClone(criticalProduction)
          ;(value.packagingReports as Record<string, unknown>[])[0].wipLines = 'malformed'
          return value
        })(),
      },
      {
        name: 'duplicate nested report line ID',
        production: (() => {
          const value = structuredClone(criticalProduction)
          const report = (value.packagingReports as Record<string, unknown>[])[0]
          const line = (report.wipLines as Record<string, unknown>[])[0]
          report.wipLines = [line, { ...line }]
          return value
        })(),
      },
      { name: 'null warehouse documents', warehouse: { documents: null } },
      { name: 'array used as a movement row', warehouse: { movements: [[]] } },
      {
        name: 'malformed document lines',
        warehouse: { documents: [{ id: 'doc-c', lines: 'malformed' }] },
      },
      {
        name: 'duplicate loading ID',
        warehouse: {
          loadingShipments: [
            { id: 'shipment-c', lines: [] },
            { id: 'shipment-c', lines: [] },
          ],
        },
      },
    ]

    for (const testCase of cases) {
      const warehouse = {
        documents: [],
        movements: [],
        loadingShipments: [],
        ...testCase.warehouse,
      }
      const overlay = resolveAuthoritativePackagingOverlay({
        legacyProduction: {
          packagingReports: [{ id: 'soft-report' }],
          finishedGoodsLots: [{ id: 'soft-lot' }],
        },
        criticalProduction: testCase.production ?? structuredClone(criticalProduction),
        criticalWarehouse: warehouse as never,
        legacyWarehouse: { documents: [], movements: [], loadingShipments: [] } as never,
        criticalRevision: 15,
        packagingQcActive: true,
        productionActive: true,
      })
      expect(overlay, testCase.name).toMatchObject({
        source: G4_AUTHORITATIVE_STATE_INCOMPLETE,
        packagingQcActive: false,
        authoritativeBlocked: true,
        production: {
          packagingReports: [],
          finishedGoodsLots: [],
          g4PackagingQcActive: false,
          g4AuthoritativeBlocked: true,
        },
      })
    }
  })

  it('adapts an explicit legacy-shaped row without dropping it or erasing aliases', () => {
    const result = adaptAuthoritativeG4ProductionDomain({
      orders: [{ id: 'po-legacy', semiFinishedItemId: 'sf-legacy' }],
      packagingReports: [
        {
          id: 'report-legacy',
          productionOrderId: 'po-legacy',
          shiftDate: '2026-09-09',
          shift: 'day',
          batchNo: 'LOT-LEGACY',
          rollCount: 7,
          palletCount: 1,
          wipLines: [
            {
              id: 'legacy-wip-line',
              semiFinishedItemId: 'sf-legacy',
              batchNo: 'WIP-LEGACY',
            },
          ],
          materialLines: [],
        },
      ],
      finishedGoodsLots: [
        {
          id: 'lot-legacy',
          packagingReportId: 'report-legacy',
          batchNo: 'LOT-LEGACY',
          outputM2: 160,
          rollCount: 7,
          palletCount: 1,
          productionDate: '2026-09-09',
          packagingDate: '2026-09-09',
          qcStatus: 'pending',
        },
      ],
      qcDecisions: [],
    })
    expect(result).toMatchObject({
      ok: true,
      production: {
        packagingReports: [
          {
            id: 'report-legacy',
            shiftDate: '2026-09-09',
            shift: 'day',
            batchNo: 'LOT-LEGACY',
            rollCount: 7,
            palletCount: 1,
            wipLines: [
              {
                lineId: 'legacy-wip-line',
                semiFinishedItemId: 'sf-legacy',
                batchNo: 'WIP-LEGACY',
              },
            ],
          },
        ],
        finishedGoodsLots: [
          {
            id: 'lot-legacy',
            batchNo: 'LOT-LEGACY',
            outputM2: 160,
            rollCount: 7,
            palletCount: 1,
            packagingDate: '2026-09-09',
          },
        ],
      },
    })
  })

  it('marks a malformed mutation mirror blocked instead of trusting its active flags', () => {
    const malformed = structuredClone(criticalProduction)
    malformed.finishedGoodsLots = [null] as unknown as unknown[]
    const mirrored = mirrorG4Ack(
      { documents: [], movements: [], loadingShipments: [] } as never,
      {
        packagingReports: [{ id: 'local-report' }],
        finishedGoodsLots: [{ id: 'local-lot' }],
      },
      {
        production: malformed,
        warehouse: { documents: [], movements: [], loadingShipments: [] },
        criticalRevision: 16,
        packagingQcActive: true,
        productionActive: true,
      },
    )
    expect(mirrored).toMatchObject({
      source: G4_AUTHORITATIVE_STATE_INCOMPLETE,
      authoritativeBlocked: true,
      production: {
        g4PackagingQcActive: false,
        g4AuthoritativeBlocked: true,
        packagingReports: [],
        finishedGoodsLots: [],
      },
    })
  })
})
