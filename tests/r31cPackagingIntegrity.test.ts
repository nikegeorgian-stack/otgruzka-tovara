import { describe, expect, it } from 'vitest'

import {
  canonicalPackagingCommandFingerprint,
  isCanonicalPackagingOrder,
  resolveCanonicalPackBinding,
  validateCanonicalFinishedGoodsMapping,
  validateCanonicalPackagingCorrectionBoundary,
  validateCanonicalPackagingWipLineage,
} from '../server/fst/_g4PackagingIntegrity.mjs'
import { comparePackagingActualToNorm } from '../server/fst/_g5PackagingBomHelpers.mjs'
import { computePackagingSnapshotRequirements } from '@/lib/planner/g5PackagingBom'
import { resolveG3ProductionDomainActive } from '@/lib/production/g4OverlayState'
import {
  isG4PackagingQcActive,
  mirrorG4Ack,
  resolveAuthoritativePackagingOverlay,
} from '@/lib/production/g4ServerClient'
import { mergeActivePackagingOrders } from '@/lib/production/packagingOrderSelection'
import type { ProductionOrder } from '@/lib/planner/types'

const ORDER_C = 'po-c'
const ORDER_B = 'po-b'
const REPORT_C = 'sr-c'
const BATCH_C = 'wip-c'
const RECEIPT_C = 'wh-wip-c'
const WIP_ITEM = 'wip-celloplex-160'
const FG_ITEM = 'fg-celloplex-160'
const FINISHED_PRODUCT = 'fp-celloplex-160'
const PACK_WH = 'pack-wh'
const PACK_LOC = 'pack-loc'

function canonicalFixture() {
  const order = {
    id: ORDER_C,
    status: 'active',
    semiFinishedItemId: WIP_ITEM,
    wipContractVersion: 1,
  }
  const production = {
    shiftReports: [
      {
        id: REPORT_C,
        status: 'confirmed',
        orderId: ORDER_C,
        wipBatchId: BATCH_C,
        semiFinishedItemId: WIP_ITEM,
        packLocationId: PACK_LOC,
        outputMp: 24,
        wipContractVersion: 1,
      },
    ],
    wipBatches: [
      {
        id: BATCH_C,
        orderId: ORDER_C,
        shiftReportId: REPORT_C,
        itemId: WIP_ITEM,
        quantityMp: 24,
        locationId: PACK_LOC,
        unitSnapshot: 'm2',
        isFinishedGoods: false,
        wipContractVersion: 1,
      },
    ],
  }
  const warehouse = {
    documents: [
      {
        id: RECEIPT_C,
        status: 'posted',
        type: 'receipt',
        purpose: 'production_receipt',
        docRole: 'wip_receipt',
        warehouseId: PACK_WH,
        productionOrderId: ORDER_C,
        shiftReportId: REPORT_C,
        isWip: true,
        lines: [
          {
            lineId: 'receipt-line-c',
            itemId: WIP_ITEM,
            quantity: 24,
            unitSnapshot: 'm2',
            locationId: PACK_LOC,
            batchNo: BATCH_C,
          },
        ],
      },
    ],
    movements: [
      {
        id: 'mov-wip-c',
        documentId: RECEIPT_C,
        type: 'receipt',
        warehouseId: PACK_WH,
        locationId: PACK_LOC,
        itemId: WIP_ITEM,
        quantity: 24,
        batchNo: BATCH_C,
        productionOrderId: ORDER_C,
        shiftReportId: REPORT_C,
        isWip: true,
      },
    ],
  }
  const binding = {
    packagingWarehouseId: PACK_WH,
    packagingLocationId: PACK_LOC,
  }
  const wipLines = [
    {
      lineId: 'receipt-line-c',
      productionOrderId: ORDER_C,
      shiftReportId: REPORT_C,
      receiptDocumentId: RECEIPT_C,
      semiFinishedItemId: WIP_ITEM,
      itemId: WIP_ITEM,
      quantity: 24,
      unitSnapshot: 'm2',
      wipBatchId: BATCH_C,
    },
  ]
  return { order, production, warehouse, binding, wipLines, outputM2: 24 }
}

describe('R3.1C canonical packaging lineage', () => {
  it('accepts only the exact selected order → shift → WIP receipt chain', () => {
    const fixture = canonicalFixture()
    expect(isCanonicalPackagingOrder(fixture.order)).toBe(true)
    expect(validateCanonicalPackagingWipLineage(fixture)).toMatchObject({
      ok: true,
      canonical: true,
      orderId: ORDER_C,
      sourceShiftReportIds: [REPORT_C],
      sourceWipBatchIds: [BATCH_C],
    })
  })

  it('rejects contaminated B or another order before any packaging mutation', () => {
    const fixture = canonicalFixture()
    const contaminated = {
      ...fixture,
      wipLines: fixture.wipLines.map((line) => ({
        ...line,
        productionOrderId: ORDER_B,
      })),
    }
    expect(validateCanonicalPackagingWipLineage(contaminated)).toMatchObject({
      ok: false,
      error: 'wip_order_mismatch',
      status: 409,
    })
  })

  it('rejects an orphan line and a forged output larger than the exact WIP', () => {
    const fixture = canonicalFixture()
    expect(
      validateCanonicalPackagingWipLineage({
        ...fixture,
        wipLines: fixture.wipLines.map((line) => ({
          ...line,
          receiptDocumentId: undefined,
        })),
      }),
    ).toMatchObject({ ok: false, error: 'canonical_wip_lineage_required' })
    expect(validateCanonicalPackagingWipLineage({ ...fixture, outputM2: 48 })).toMatchObject({
      ok: false,
      error: 'wip_output_quantity_mismatch',
    })
  })

  it('keeps pre-contract legacy orders on the compatibility path', () => {
    const fixture = canonicalFixture()
    expect(
      validateCanonicalPackagingWipLineage({
        ...fixture,
        order: { ...fixture.order, wipContractVersion: undefined },
        wipLines: [],
      }),
    ).toEqual({ ok: true, canonical: false })
  })
})

describe('R3.1C canonical finished-goods identity', () => {
  const order = {
    id: ORDER_C,
    status: 'active',
    finishedProductId: FINISHED_PRODUCT,
    warehouseItemId: FG_ITEM,
    semiFinishedItemId: WIP_ITEM,
    wipContractVersion: 1,
  }
  const command = {
    finishedProductId: FINISHED_PRODUCT,
    warehouseItemId: FG_ITEM,
  }
  const masterData = {
    items: [{ id: FG_ITEM, active: true, baseUnit: 'm2' }],
    finishedProducts: [{ id: FINISHED_PRODUCT, active: true, baseUnit: 'м²' }],
  }

  it('uses only the exact authoritative order mapping', () => {
    expect(
      validateCanonicalFinishedGoodsMapping({
        order,
        command,
        warehouse: {},
        masterData,
        masterDataActive: true,
      }),
    ).toMatchObject({
      ok: true,
      canonical: true,
      finishedProductId: FINISHED_PRODUCT,
      warehouseItemId: FG_ITEM,
      unitSnapshot: 'm2',
    })

    expect(
      validateCanonicalFinishedGoodsMapping({
        order,
        command: { ...command, warehouseItemId: 'forged-fg-item' },
        warehouse: {},
        masterData,
        masterDataActive: true,
      }),
    ).toMatchObject({ ok: false, error: 'finished_goods_item_mismatch', status: 409 })
  })

  it('fails closed for a missing, inactive, or non-area FG item', () => {
    for (const items of [
      [],
      [{ id: FG_ITEM, active: false, baseUnit: 'm2' }],
    ]) {
      expect(
        validateCanonicalFinishedGoodsMapping({
          order,
          command,
          warehouse: {},
          masterData: { ...masterData, items },
          masterDataActive: true,
        }),
      ).toMatchObject({ ok: false, error: 'finished_goods_item_unavailable' })
    }
    expect(
      validateCanonicalFinishedGoodsMapping({
        order,
        command,
        warehouse: {},
        masterData: {
          ...masterData,
          items: [{ id: FG_ITEM, active: true, baseUnit: 'pcs' }],
        },
        masterDataActive: true,
      }),
    ).toMatchObject({ ok: false, error: 'finished_goods_item_area_unit_required' })
  })
})

describe('R3.1C canonical packaging route', () => {
  const binding = {
    id: 'pack',
    lineId: 'pack',
    packagingWarehouseId: PACK_WH,
    packagingLocationId: PACK_LOC,
    finishedGoodsWarehouseId: PACK_WH,
    finishedGoodsLocationId: 'fg-loc',
  }
  const warehouse = {
    productionLineBindings: [binding],
    locations: [
      { id: PACK_WH, active: true },
      { id: PACK_LOC, active: true },
      { id: 'fg-loc', active: true },
    ],
    accountingByWarehouse: [{ warehouseId: PACK_WH, status: 'active' }],
  }

  it('requires exactly one fully configured authoritative route', () => {
    expect(resolveCanonicalPackBinding(warehouse, {}, { strict: true })).toMatchObject({
      ok: true,
      packagingWarehouseId: PACK_WH,
      packagingLocationId: PACK_LOC,
      fgLocationId: 'fg-loc',
    })
    expect(
      resolveCanonicalPackBinding(
        { ...warehouse, productionLineBindings: [binding, { ...binding, id: 'packing' }] },
        {},
        { strict: true },
      ),
    ).toMatchObject({ ok: false, error: 'canonical_pack_binding_ambiguous' })
  })

  it('fails closed on missing locations or missing/ambiguous/inactive accounting', () => {
    expect(
      resolveCanonicalPackBinding(
        { ...warehouse, locations: warehouse.locations.filter((row) => row.id !== 'fg-loc') },
        {},
        { strict: true },
      ),
    ).toMatchObject({ ok: false, error: 'pack_location_unavailable' })
    expect(
      resolveCanonicalPackBinding(
        { ...warehouse, accountingByWarehouse: [] },
        {},
        { strict: true },
      ),
    ).toMatchObject({ ok: false, error: 'pack_accounting_not_configured' })
    expect(
      resolveCanonicalPackBinding(
        {
          ...warehouse,
          accountingByWarehouse: [
            { warehouseId: PACK_WH, status: 'active' },
            { warehouseId: PACK_WH, status: 'active' },
          ],
        },
        { warehouseId: PACK_WH },
        { strict: true },
      ),
    ).toMatchObject({ ok: false, error: 'pack_accounting_ambiguous' })
    expect(
      resolveCanonicalPackBinding(
        { ...warehouse, accountingByWarehouse: [{ warehouseId: PACK_WH, status: 'inactive' }] },
        {},
        { strict: true },
      ),
    ).toMatchObject({ ok: false, error: 'pack_accounting_inactive' })
  })
})

describe('R3.1C canonical correction boundary', () => {
  const report = { id: 'pk-c', finishedGoodsLotId: 'lot-c', wipContractVersion: 1 }
  const lot = {
    id: 'lot-c',
    packagingReportId: 'pk-c',
    qcStatus: 'pending',
    lotRevision: 1,
    quantityQcReleased: 0,
    quantityShipped: 0,
    currentDecisionId: null,
    history: [{ type: 'created' }],
  }
  const base = {
    production: { finishedGoodsLots: [lot], qcDecisions: [] },
    warehouse: { documents: [], movements: [], loadingShipments: [] },
    report,
    lot,
  }

  it('allows a pristine pending lot and blocks every downstream transition', () => {
    expect(validateCanonicalPackagingCorrectionBoundary(base)).toMatchObject({ ok: true })
    for (const qcStatus of [
      'in_review',
      'released',
      'regrade_pending',
      'scrap_pending',
      'written_off',
    ]) {
      expect(
        validateCanonicalPackagingCorrectionBoundary({ ...base, lot: { ...lot, qcStatus } }),
      ).toMatchObject({ ok: false, error: 'packaging_correction_downstream_started' })
    }
  })

  it('blocks child lots, QC decisions, and shipment ledgers', () => {
    expect(
      validateCanonicalPackagingCorrectionBoundary({
        ...base,
        production: {
          finishedGoodsLots: [lot, { id: 'child', parentLotId: lot.id }],
          qcDecisions: [],
        },
      }),
    ).toMatchObject({ ok: false, error: 'packaging_correction_downstream_started' })
    expect(
      validateCanonicalPackagingCorrectionBoundary({
        ...base,
        production: {
          finishedGoodsLots: [lot],
          qcDecisions: [{ id: 'decision', finishedGoodsLotId: lot.id }],
        },
      }),
    ).toMatchObject({ ok: false, error: 'packaging_correction_downstream_started' })
    expect(
      validateCanonicalPackagingCorrectionBoundary({
        ...base,
        warehouse: {
          documents: [],
          movements: [],
          loadingShipments: [{ id: 'shipment', finishedGoodsLotId: lot.id }],
        },
      }),
    ).toMatchObject({ ok: false, error: 'packaging_correction_downstream_started' })
  })
})

describe('R3.1C packaging command fingerprints', () => {
  it('uses canonical-key SHA-256 while preserving array semantics', () => {
    const first = canonicalPackagingCommandFingerprint('packaging.report.confirm', {
      productionOrderId: ORDER_C,
      outputM2: 24,
      nested: { z: 2, a: 1 },
      wipLines: [{ itemId: WIP_ITEM, quantity: 24 }],
    })
    const reorderedKeys = canonicalPackagingCommandFingerprint('packaging.report.confirm', {
      wipLines: [{ quantity: 24, itemId: WIP_ITEM }],
      nested: { a: 1, z: 2 },
      outputM2: 24,
      productionOrderId: ORDER_C,
    })
    const changed = canonicalPackagingCommandFingerprint('packaging.report.confirm', {
      productionOrderId: ORDER_C,
      outputM2: 25,
      nested: { a: 1, z: 2 },
      wipLines: [{ itemId: WIP_ITEM, quantity: 24 }],
    })
    expect(first).toMatch(/^g4-packaging:v1:sha256:[a-f0-9]{64}$/)
    expect(reorderedKeys).toBe(first)
    expect(changed).not.toBe(first)
  })
})

describe('R3.1C complete packaging BOM consumption', () => {
  const snapshot = {
    packagingBomId: 'bom-c',
    version: 1,
    contentHash: 'hash-c',
    baseOutputQty: 10,
    components: [
      { itemId: 'box', quantity: 2, unit: 'pcs' },
      { itemId: 'pallet', quantity: 1, unit: 'pcs' },
    ],
  }

  it('client and server agree on the complete immutable snapshot explosion', () => {
    const requirements = computePackagingSnapshotRequirements(snapshot, 20)
    expect(requirements).toEqual([
      expect.objectContaining({ itemId: 'box', normQty: 4, unit: 'pcs' }),
      expect.objectContaining({ itemId: 'pallet', normQty: 2, unit: 'pcs' }),
    ])
    expect(
      comparePackagingActualToNorm(
        snapshot,
        20,
        requirements.map((line) => ({
          itemId: line.itemId,
          unitSnapshot: line.unit,
          quantity: line.normQty,
        })),
        { requireComplete: true },
      ),
    ).toMatchObject({ ok: true })
  })

  it('rejects omitted boxes or pallets only for the canonical strict contract', () => {
    const omittedPallet = [{ itemId: 'box', unitSnapshot: 'pcs', quantity: 4 }]
    expect(
      comparePackagingActualToNorm(snapshot, 20, omittedPallet, { requireComplete: true }),
    ).toMatchObject({
      ok: false,
      error: 'packaging_material_bom_incomplete',
      itemId: 'pallet',
      expected: 2,
      actual: 0,
    })
    expect(comparePackagingActualToNorm(snapshot, 20, omittedPallet)).toMatchObject({ ok: true })
  })
})

describe('R3.1C G4 acknowledgement state', () => {
  it('preserves active G3 across a legacy G4 ack and honors an explicit server flag', () => {
    const active = { g3ProductionDomainActive: true }
    expect(resolveG3ProductionDomainActive(active, undefined)).toBe(true)
    expect(resolveG3ProductionDomainActive(active, true)).toBe(true)
    expect(resolveG3ProductionDomainActive(active, false)).toBe(false)
  })

  it('requires both explicit domain flags before applying authoritative G4 state', () => {
    const legacyProduction = {
      g3ProductionDomainActive: true,
      g4PackagingQcActive: true,
      g4CriticalRevision: 40,
      packagingReports: [{ id: 'legacy-report' }],
      finishedGoodsLots: [{ id: 'legacy-lot' }],
      qcDecisions: [{ id: 'legacy-decision' }],
    }
    const criticalProduction = {
      orders: [],
      packagingReports: [{ id: 'critical-report', wipLines: [], materialLines: [] }],
      finishedGoodsLots: [{ id: 'critical-lot', qcStatus: 'pending' }],
      qcDecisions: [],
    }
    const criticalWarehouse = {
      documents: [],
      movements: [],
      loadingShipments: [],
      productionLineBindings: [],
    }

    for (const flags of [
      { packagingQcActive: true, productionActive: undefined },
      { packagingQcActive: undefined, productionActive: true },
      { packagingQcActive: true, productionActive: false },
    ]) {
      const blocked = resolveAuthoritativePackagingOverlay({
        legacyProduction,
        criticalProduction,
        criticalWarehouse,
        legacyWarehouse: { documents: [], movements: [] } as never,
        criticalRevision: 41,
        ...flags,
      })
      expect(blocked).toMatchObject({
        packagingQcActive: false,
        authoritativeBlocked: true,
      })
      expect(blocked.production).toMatchObject({
        g4PackagingQcActive: false,
        packagingReports: [],
        finishedGoodsLots: [],
        qcDecisions: [],
      })
    }

    const accepted = resolveAuthoritativePackagingOverlay({
      legacyProduction,
      criticalProduction,
      criticalWarehouse,
      legacyWarehouse: { documents: [], movements: [] } as never,
      criticalRevision: 41,
      packagingQcActive: true,
      productionActive: true,
    })
    expect(accepted).toMatchObject({
      source: 'fst_critical_store',
      packagingQcActive: true,
      production: {
        g3ProductionDomainActive: true,
        g4PackagingQcActive: true,
        packagingReports: [{ id: 'critical-report' }],
      },
    })
  })

  it('does not infer G4 activation from a revision or mirror an ack with missing flags', () => {
    expect(isG4PackagingQcActive({ g4CriticalRevision: 99 })).toBe(false)
    const mirrored = mirrorG4Ack(
      { documents: [], movements: [] } as never,
      {
        g3ProductionDomainActive: true,
        g4PackagingQcActive: true,
        packagingReports: [{ id: 'soft-report' }],
        finishedGoodsLots: [{ id: 'soft-lot' }],
      },
      {
        criticalRevision: 100,
        production: {
          orders: [],
          packagingReports: [{ id: 'server-report', wipLines: [], materialLines: [] }],
          finishedGoodsLots: [],
          qcDecisions: [],
        },
        warehouse: { documents: [], movements: [], loadingShipments: [] },
      },
    )
    expect(mirrored.production).toMatchObject({
      g4PackagingQcActive: false,
      packagingReports: [],
      finishedGoodsLots: [],
      g4AuthoritativeBlocked: true,
    })
  })

  it('activation/reload selects packaging metadata from the exact authoritative order', () => {
    const plannerOrders = [
      {
        id: ORDER_B,
        orderNumber: 'B',
        status: 'active',
        lineId: '1',
      },
      {
        id: ORDER_C,
        orderNumber: 'C',
        status: 'active',
        lineId: '1',
      },
    ] as ProductionOrder[]
    const packagingBomSnapshot = {
      packagingBomId: 'bom-c',
      version: 1,
      contentHash: 'hash-c',
      components: [{ itemId: 'box', quantity: 1, unit: 'pcs' }],
    }
    const merged = mergeActivePackagingOrders(
      plannerOrders,
      [
        {
          id: ORDER_C,
          orderNumber: 'C',
          status: 'active',
          lineId: '1',
          finishedProductId: 'fg-c',
          warehouseItemId: 'fg-item-c',
          semiFinishedItemId: WIP_ITEM,
          wipContractVersion: 1,
          packagingBomRequired: false,
          packagingBomSnapshot,
        },
      ],
      true,
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      id: ORDER_C,
      finishedProductId: 'fg-c',
      warehouseItemId: 'fg-item-c',
      semiFinishedItemId: WIP_ITEM,
      wipContractVersion: 1,
      packagingBomRequired: false,
      packagingBomSnapshot,
    })
  })
})
