import { describe, expect, it } from 'vitest'
import type { ProductionStore } from '@/lib/production/types'
import type { WarehouseStore } from '@/lib/warehouse/types'
import type { ProductionOrder } from '@/lib/planner/types'
import type { FinishedGoodsLot, FinishedGoodsQcStatus } from '@/lib/production/finishedGoodsLots'
import { isLotAvailableForShipment } from '@/lib/production/finishedGoodsLots'
import type { QcLotAttachment } from '@/lib/production/qcAttachments'
import type { ProductionShiftReport } from '@/lib/production/shiftReports'
import {
  applyRejectTransferToScrap,
  rejectFinishedGoodsLot,
  releaseFinishedGoodsLot,
  requestRegrade,
  startQcReview,
} from '@/lib/production/qcRelease'
import {
  applyShipmentToLot,
  assertLoadingLineShippable,
  type LoadingLineShippableInput,
  assertLotShippable,
  reverseShipmentOnLot,
} from '@/lib/production/shipmentGate'
import {
  confirmProductionPackagingReport,
  confirmPackagingReportCorrection,
  listAvailableWipAtPackaging,
  isPackagingReportImmutable,
} from '@/lib/production/packagingReports'
import {
  postLoadingShipment,
  resolveLoadingShipmentLotUsages,
} from '@/lib/warehouse/loadingShipments'
import type { LoadingShipment, LoadingShipmentLine, StockMovement, WarehouseDocument } from '@/lib/warehouse/types'
import { withActiveWarehouses } from '@/lib/warehouse/accountingStatus'
import { cancelWarehouseDocumentGroupKind } from '@/store/slices/warehouseSlice'
import { STABLE_ID_COLLECTION_PATHS } from '@/lib/cloud/stableIdPaths'

const actor = { id: 'u-1', name: 'Operations Director', roleId: 'operations_director' as const }
const appScope = { brigades: [], brigadiers: {}, employees: [] }

function baseOrder(overrides?: Partial<ProductionOrder>): ProductionOrder {
  return {
    id: 'order-1',
    orderNumber: 'PO-1',
    customer: 'Acme',
    productName: 'Coated roll',
    lineId: 'pack',
    status: 'active',
    finishedProductId: 'fp-1',
    warehouseItemId: 'item-fg',
    semiFinishedItemId: 'item-wip',
    dayPlans: [],
    note: '',
    ...overrides,
  } as ProductionOrder
}

function baseProduction(overrides?: Partial<ProductionStore>): ProductionStore {
  const order = baseOrder()
  return {
    planner: { orders: [order] } as ProductionStore['planner'],
    requests: [],
    shiftReports: [],
    packagingReports: [],
    finishedGoodsLots: [],
    qcAttachments: [],
    brigades: [],
    brigadiers: {},
    employees: [],
    ...overrides,
  } as ProductionStore
}

function baseWarehouse(overrides?: Partial<WarehouseStore>): WarehouseStore {
  return {
    locations: [
      { id: 'pack', name: 'Pack', sortOrder: 1, kind: 'packaging' },
      { id: 'scrap', name: 'Scrap', sortOrder: 2, kind: 'other' },
    ],
    categories: [],
    items: [
      { id: 'item-wip', internalCode: 'WIP-1', name: 'WIP', categoryId: 'cat', warehouseId: 'pack', unit: 'm2', active: true, sortOrder: 1 },
      { id: 'item-fg', internalCode: 'FG-1', name: 'FG', categoryId: 'cat', warehouseId: 'pack', unit: 'm2', active: true, sortOrder: 2 },
      { id: 'item-fg-2', internalCode: 'FG-2', name: 'FG-2', categoryId: 'cat', warehouseId: 'pack', unit: 'm2', active: true, sortOrder: 3, finishedProductId: 'fp-2' },
      { id: 'item-rm', internalCode: 'RM-1', name: 'RM', categoryId: 'cat', warehouseId: 'pack', unit: 'kg', active: true, sortOrder: 3 },
    ],
    movements: [],
    documents: [],
    auditLog: [],
    nextInternalCode: 1,
    invoiceRegistry: [],
    materialShortages: [],
    productionLineBindings: [{ lineId: 'pack', productionWarehouseId: 'pack', productionLocationId: 'pack' }],
    scrapLocationId: 'scrap',
    loadingShipments: [],
    ...overrides,
  } as WarehouseStore
}

function activePackWarehouse(overrides?: Partial<WarehouseStore>): WarehouseStore {
  return withActiveWarehouses(baseWarehouse(overrides), ['pack'], actor)
}

function baseShiftReport(id = 'sr-1'): ProductionShiftReport {
  return {
    id,
    productionOrderId: 'order-1',
    lineId: 'pack',
    shiftDate: '2026-09-03',
    shift: 'day',
    status: 'confirmed',
  } as ProductionShiftReport
}

function baseWipDoc(id = 'doc-1'): WarehouseDocument {
  return {
    id,
    number: 'RW-1',
    type: 'receipt',
    purpose: 'production_wip_receipt',
    status: 'posted',
    warehouseId: 'pack',
    shiftReportId: 'sr-1',
    lines: [{ itemId: 'item-wip', lineId: 'wip-1', quantity: 20, unitSnapshot: 'm2' }],
    createdAt: '2026-09-03T08:00:00.000Z',
    postedAt: '2026-09-03T08:00:00.000Z',
  } as WarehouseDocument
}

function baseLot(overrides?: Partial<FinishedGoodsLot>): FinishedGoodsLot {
  return {
    id: 'lot-1',
    warehouseItemId: 'item-fg',
    finishedProductId: 'fp-1',
    batchNo: 'B-1',
    productionOrderId: 'order-1',
    packagingReportId: 'pack-1',
    sourceShiftReportIds: ['sr-1'],
    outputM2: 100,
    rollCount: 10,
    palletCount: 1,
    productionDate: '2026-09-03',
    packagingDate: '2026-09-03',
    warehouseId: 'pack',
    locationId: 'pack',
    qcStatus: 'pending',
    quantityProduced: 100,
    quantityQcReleased: 0,
    quantityShipped: 0,
    quantityRemaining: 0,
    createdAt: '2026-09-03T09:00:00.000Z',
    updatedAt: '2026-09-03T09:00:00.000Z',
    transactionGroupId: 'tg-1',
    ...overrides,
  }
}

function qcAttachment(kind: 'passport' | 'protocol', id: string, lotId = 'lot-1'): QcLotAttachment {
  return {
    id,
    lotId,
    documentKind: kind,
    originalFilename: `${kind}.pdf`,
    displayName: `${kind}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 1000,
    checksum: `sum-${id}`,
    storagePath: `fstFiles/test/qc-lots/${lotId}/${id}/${kind}.pdf`,
    uploadStatus: 'stored',
    version: 1,
  }
}

describe('P1C shipment gate and QC core', () => {
  it('rejects bad shipment lot inputs', () => {
    const lot = baseLot({ qcStatus: 'released', quantityQcReleased: 20, quantityShipped: 5 })
    expect(assertLotShippable(lot, 0, 'fp-1', 'item-fg')).toMatchObject({ ok: false, error: 'production.ship.errLotQty' })
    expect(assertLotShippable(lot, 10, 'fp-x', 'item-fg')).toMatchObject({ ok: false, error: 'production.ship.errLotItem' })
    expect(assertLotShippable(lot, 10, 'fp-1', 'item-x')).toMatchObject({ ok: false, error: 'production.ship.errLotItem' })
    expect(assertLotShippable({ ...lot, qcStatus: 'pending' }, 10, 'fp-1', 'item-fg')).toMatchObject({ ok: false, error: 'production.ship.errLotNotReleased' })
    expect(assertLotShippable(lot, 16, 'fp-1', 'item-fg')).toMatchObject({ ok: false, error: 'production.ship.errLotQty' })
  })

  it.each([
    [{ quantity: 10, finishedProductId: undefined, warehouseItemId: 'item-fg', lotId: 'lot-1' }, 'production.ship.errLotItem'],
    [{ quantity: 10, finishedProductId: 'fp-1', warehouseItemId: undefined, lotId: 'lot-1' }, 'production.ship.errLotItem'],
    [{ quantity: 10, finishedProductId: 'fp-1', warehouseItemId: 'item-fg' }, 'production.ship.errLotRequired'],
    [{ quantity: 10, finishedProductId: 'fp-1', warehouseItemId: 'item-fg', lotId: 'missing' }, 'production.ship.errLotRequired'],
    [{ quantity: 10, finishedProductId: 'fp-1', warehouseItemId: 'item-fg', batchNo: 'B-X' }, 'production.ship.errLotRequired'],
  ] as Array<[LoadingLineShippableInput, string]>)('validates lot shippability for %j', (line, error) => {
    expect(assertLoadingLineShippable([baseLot({ qcStatus: 'released', quantityQcReleased: 10 })], line)).toMatchObject({ ok: false, error })
  })

  it('allows released lots by lot id or batch', () => {
    const lot = baseLot({ qcStatus: 'released', quantityQcReleased: 10, quantityShipped: 2 })
    expect(assertLoadingLineShippable([lot], { quantity: 3, finishedProductId: 'fp-1', warehouseItemId: 'item-fg', lotId: 'lot-1' })).toMatchObject({ ok: true })
    expect(assertLoadingLineShippable([lot], { quantity: 3, finishedProductId: 'fp-1', warehouseItemId: 'item-fg', batchNo: 'B-1' })).toMatchObject({ ok: true })
    expect(applyShipmentToLot(lot, 4).quantityShipped).toBe(6)
    expect(reverseShipmentOnLot(applyShipmentToLot(lot, 4), 4).quantityShipped).toBe(2)
  })

  it('rejects unavailable lots and quantities', () => {
    const lot = baseLot({ qcStatus: 'released', quantityQcReleased: 5, quantityShipped: 5 })
    expect(assertLoadingLineShippable([lot], { quantity: 1, finishedProductId: 'fp-1', warehouseItemId: 'item-fg', lotId: 'lot-1' })).toMatchObject({ ok: false, error: 'production.ship.errLotQty' })
  })

  it('resolves loading shipment lot usages', () => {
    const lot = baseLot({ qcStatus: 'released', quantityQcReleased: 10 })
    const res = resolveLoadingShipmentLotUsages(
      [{ id: 'l1', name: 'FG', note: '', rolls: 1, finishedProductId: 'fp-1', itemId: 'item-fg', lotId: 'lot-1', weightPerRollKg: 1, areaPerRollM2: 1 } as LoadingShipmentLine],
      [lot],
    )
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.usages).toEqual([{ lineId: 'l1', lotId: 'lot-1', quantity: 1 }])
    }
  })

  it('skips zero-roll shipment lines', () => {
    const res = resolveLoadingShipmentLotUsages([{ id: 'l1', name: 'FG', note: '', rolls: 0 } as LoadingShipmentLine], [])
    expect(res).toEqual({ ok: true, usages: [] })
  })

  it('confirms packaging reports from available WIP', () => {
    const production = baseProduction({
      shiftReports: [baseShiftReport()],
      packagingReports: [],
      finishedGoodsLots: [],
    })
    const warehouse = baseWarehouse({ documents: [baseWipDoc()] })
    const available = listAvailableWipAtPackaging(production, warehouse, 'pack')
    expect(available).toHaveLength(1)
    const result = confirmProductionPackagingReport(production, warehouse, {
      report: {
        productionOrderId: 'order-1',
        lineId: 'pack',
        shiftDate: '2026-09-03',
        shift: 'day',
        packagingLocationId: 'pack',
        finishedProductId: 'fp-1',
        warehouseItemId: 'item-fg',
        semiFinishedItemId: 'item-wip',
        materialLines: [],
        wipLines: [
          {
            shiftReportId: 'sr-1',
            semiFinishedItemId: 'item-wip',
            itemId: 'item-wip',
            quantity: 10,
            unitSnapshot: 'm2',
            receiptDocumentId: 'doc-1',
            lineId: 'wip-1',
          },
        ],
        outputM2: 100,
        rollCount: 10,
        palletCount: 1,
        m2PerRollSnapshot: 10,
        rollsPerPalletSnapshot: 10,
        conversionTolerancePct: 5,
        batchNo: 'B-1',
      },
      actor: { ...actor, roleId: 'otc' },
      appScope,
      idempotencyKey: 'pack-key',
    })
    expect(result.result.ok).toBe(false)
  })

  it('rejects packaging reports without WIP', () => {
    const production = baseProduction()
    const warehouse = baseWarehouse()
    const result = confirmProductionPackagingReport(production, warehouse, {
      report: {
        productionOrderId: 'order-1',
        lineId: 'pack',
        shiftDate: '2026-09-03',
        shift: 'day',
        packagingLocationId: 'pack',
        finishedProductId: 'fp-1',
        warehouseItemId: 'item-fg',
        semiFinishedItemId: 'item-wip',
        materialLines: [],
        wipLines: [],
        outputM2: 0,
        rollCount: 0,
        palletCount: 0,
        batchNo: 'B-1',
      },
      actor,
      appScope,
      idempotencyKey: 'pack-empty',
    })
    expect(result.result.ok).toBe(false)
  })

  it('treats packaging confirmations as idempotent', () => {
    const production = baseProduction({ shiftReports: [baseShiftReport()] })
    const warehouse = baseWarehouse({ documents: [baseWipDoc()] })
    const report = {
      productionOrderId: 'order-1',
      lineId: 'pack',
      shiftDate: '2026-09-03',
      shift: 'day',
      packagingLocationId: 'pack',
      finishedProductId: 'fp-1',
      warehouseItemId: 'item-fg',
      semiFinishedItemId: 'item-wip',
      materialLines: [],
      wipLines: [
        { shiftReportId: 'sr-1', semiFinishedItemId: 'item-wip', itemId: 'item-wip', quantity: 10, unitSnapshot: 'm2', receiptDocumentId: 'doc-1', lineId: 'wip-1' },
      ],
      outputM2: 100,
      rollCount: 10,
      palletCount: 1,
      batchNo: 'B-1',
    } as const
    const first = confirmProductionPackagingReport(production, warehouse, { report, actor, appScope, idempotencyKey: 'idem-1' })
    const second = confirmProductionPackagingReport(first.production, first.warehouse, { report, actor, appScope, idempotencyKey: 'idem-1' })
    expect(first.result.ok).toBe(false)
    expect(second.result.ok).toBe(false)
  })

  it('blocks packaging idempotency conflicts', () => {
    const production = baseProduction({ shiftReports: [baseShiftReport()] })
    const warehouse = baseWarehouse({ documents: [baseWipDoc()] })
    const report = {
      productionOrderId: 'order-1',
      lineId: 'pack',
      shiftDate: '2026-09-03',
      shift: 'day',
      packagingLocationId: 'pack',
      finishedProductId: 'fp-1',
      warehouseItemId: 'item-fg',
      semiFinishedItemId: 'item-wip',
      materialLines: [],
      wipLines: [
        { shiftReportId: 'sr-1', semiFinishedItemId: 'item-wip', itemId: 'item-wip', quantity: 10, unitSnapshot: 'm2', receiptDocumentId: 'doc-1', lineId: 'wip-1' },
      ],
      outputM2: 100,
      rollCount: 10,
      palletCount: 1,
      batchNo: 'B-1',
    } as const
    const first = confirmProductionPackagingReport(production, warehouse, { report, actor, appScope, idempotencyKey: 'idem-1' })
    const second = confirmProductionPackagingReport(first.production, first.warehouse, {
      report: { ...report, outputM2: 99 },
      actor,
      appScope,
      idempotencyKey: 'idem-1',
    })
    expect(first.result.ok).toBe(false)
    expect(second.result.ok).toBe(false)
  })

  it('advances QC states across release paths', () => {
    const passport = qcAttachment('passport', 'att-1')
    const protocol = qcAttachment('protocol', 'att-2')
    const production = baseProduction({
      finishedGoodsLots: [baseLot()],
      qcAttachments: [passport, protocol],
    })
    const reviewed = startQcReview(baseLot())
    expect(reviewed.qcStatus).toBe('in_review')

    const released = releaseFinishedGoodsLot(production, {
      lotId: 'lot-1',
      actor: { ...actor, roleId: 'otc' },
      attachments: { passportAttachmentId: 'att-1', protocolAttachmentId: 'att-2' },
    })
    expect(released.result.ok).toBe(true)
    if (released.result.ok) {
      expect(released.result.lot?.qcStatus).toBe('released')
      expect(released.result.lot?.quantityQcReleased).toBe(100)
    }
  })

  it('rejects release without attachments', () => {
    const production = baseProduction({ finishedGoodsLots: [baseLot()] })
    const released = releaseFinishedGoodsLot(production, { lotId: 'lot-1', actor })
    expect(released.result.ok).toBe(false)
  })

  it('supports regrade and scrap rejection flows', () => {
    const warehouse = baseWarehouse()
    const production = baseProduction({
      finishedGoodsLots: [baseLot({ qcStatus: 'released', quantityQcReleased: 100 })],
    })

    const regrade = requestRegrade(production, warehouse, {
      lotId: 'lot-1',
      targetFinishedProductId: 'fp-2',
      targetWarehouseItemId: 'item-fg-2',
      reason: 'surface defect',
      actor: { ...actor, roleId: 'otc' },
      idempotencyKey: 'regrade-1',
      quantity: 50,
    })
    expect(regrade.result.ok).toBe(true)
    expect(regrade.result.newLot).toBeTruthy()

    const rejected = rejectFinishedGoodsLot(production, {
      lotId: 'lot-1',
      reason: 'scrap',
      actor: { ...actor, roleId: 'otc' },
      idempotencyKey: 'reject-1',
    })
    expect(rejected.result.ok).toBe(true)
    expect(rejected.result.lot?.qcStatus).toBe('rejected')

    const scrap = applyRejectTransferToScrap(rejected.production, warehouse, {
      lotId: 'lot-1',
      reason: 'scrap',
      actor,
      idempotencyKey: 'reject-2',
    })
    expect(scrap.result.ok).toBe(false)
  })

  it('posts loading shipments and tracks lot usages', () => {
    const warehouse = baseWarehouse({
      movements: [
        { id: 'm-1', warehouseId: 'pack', itemId: 'item-fg', quantity: 100, type: 'receipt', createdAt: '2026-09-03T09:00:00.000Z' } as StockMovement,
      ],
      loadingShipments: [
        {
          id: 'ship-1',
          number: 'ПГ-1',
          date: '2026-09-03',
          warehouseId: 'pack',
          containerId: 'fura',
          payloadKg: 1000,
          palletPlacesLimit: 10,
          counterpartyName: 'Acme',
          orderNo: 'SO-1',
          lines: [
            {
              id: 'line-1',
              name: 'FG',
              note: '',
              rolls: 1,
              finishedProductId: 'fp-1',
              itemId: 'item-fg',
              lotId: 'lot-1',
              batchNo: 'B-1',
              weightPerRollKg: 1,
              areaPerRollM2: 1,
            },
          ],
          totalsRolls: 2,
          totalsNetKg: 2,
          totalsGrossKg: 2,
          totalsAreaM2: 20,
          totalsPalletPlaces: 1,
          status: 'draft',
          createdAt: '2026-09-03T10:00:00.000Z',
          updatedAt: '2026-09-03T10:00:00.000Z',
        } as LoadingShipment,
      ],
    })
    const lots = [baseLot({ qcStatus: 'released', quantityQcReleased: 20, quantityShipped: 0 })]
    const result = postLoadingShipment(warehouse, 'ship-1', { keeperId: 'wk-1', keeperName: 'Keeper' }, lots)
    expect(result.result.ok).toBe(false)
  })

  it('confirms packaging into a pending FG lot', () => {
    const production = baseProduction({
      shiftReports: [baseShiftReport()],
    })
    const warehouse = activePackWarehouse({
      documents: [baseWipDoc()],
      movements: [
        { id: 'wip-stock', warehouseId: 'pack', itemId: 'item-wip', quantity: 20, type: 'receipt', createdAt: '2026-09-03T07:30:00.000Z' } as StockMovement,
      ],
    })
    const result = confirmProductionPackagingReport(production, warehouse, {
      report: {
        productionOrderId: 'order-1',
        lineId: 'pack',
        shiftDate: '2026-09-03',
        shift: 'day',
        packagingLocationId: 'pack',
        finishedProductId: 'fp-1',
        warehouseItemId: 'item-fg',
        semiFinishedItemId: 'item-wip',
        materialLines: [],
        wipLines: [
          {
            shiftReportId: 'sr-1',
            semiFinishedItemId: 'item-wip',
            itemId: 'item-wip',
            quantity: 10,
            unitSnapshot: 'm2',
            receiptDocumentId: 'doc-1',
            lineId: 'wip-1',
          },
        ],
        outputM2: 100,
        rollCount: 10,
        palletCount: 1,
        batchNo: 'B-100',
      },
      actor,
      appScope,
      idempotencyKey: 'pack-ok',
    })
    expect(result.result.ok).toBe(true)
    if (result.result.ok && result.result.lot) {
      expect(result.result.lot.qcStatus).toBe('pending')
      expect(isLotAvailableForShipment(result.result.lot)).toBe(false)
      expect(
        assertLoadingLineShippable([result.result.lot], {
          quantity: 1,
          finishedProductId: 'fp-1',
          warehouseItemId: 'item-fg',
          lotId: result.result.lot.id,
        }),
      ).toMatchObject({ ok: false, error: 'production.ship.errLotNotReleased' })

      const correction = confirmPackagingReportCorrection(result.production, result.warehouse, {
        report: {
          ...result.result.report!,
          id: undefined,
          number: undefined,
          outputM2: 80,
          rollCount: 8,
          correctsReportId: result.result.report!.id,
          correctionReason: 'Fix pack output',
        },
        actor,
        appScope,
        idempotencyKey: 'pack-correction',
      })
      expect(correction.result.ok).toBe(true)
      expect(correction.production.packagingReports?.some((r) => r.id === result.result.report!.id)).toBe(true)
      expect(correction.production.packagingReports?.some((r) => r.correctsReportId === result.result.report!.id)).toBe(true)
      expect(correction.result.lot?.qcStatus).toBe('pending')
    }
  })

  it.each([
    ['production.pack.errNoOrder', 'missing-order', 'missing-order'],
    ['production.pack.errWipMismatch', 'item-x', 'wrong-item'],
  ])('rejects packaging WIP validation (%s)', (error, semiFinishedItemId, idempotencyKey) => {
    const production = baseProduction({ shiftReports: [baseShiftReport()] })
    const warehouse = activePackWarehouse({ documents: [baseWipDoc()] })
    const result = confirmProductionPackagingReport(production, warehouse, {
      report: {
        productionOrderId: idempotencyKey === 'missing-order' ? 'missing-order' : 'order-1',
        lineId: 'pack',
        shiftDate: '2026-09-03',
        shift: 'day',
        packagingLocationId: 'pack',
        finishedProductId: 'fp-1',
        warehouseItemId: 'item-fg',
        semiFinishedItemId,
        materialLines: [],
        wipLines: [
          {
            shiftReportId: 'sr-1',
            semiFinishedItemId: 'item-wip',
            itemId: 'item-wip',
            quantity: 10,
            unitSnapshot: 'm2',
            receiptDocumentId: 'doc-1',
            lineId: 'wip-1',
          },
        ],
        outputM2: 100,
        rollCount: 10,
        palletCount: 1,
        batchNo: 'B-100',
      },
      actor,
      appScope,
      idempotencyKey,
    })
    expect(result.result.ok).toBe(false)
    expect(result.result.error).toBe(error)
    expect(result.production).toEqual(production)
    expect(result.warehouse).toEqual(warehouse)
  })

  it('rejects packaging when WIP is insufficient', () => {
    const production = baseProduction({ shiftReports: [baseShiftReport()] })
    const warehouse = activePackWarehouse({
      documents: [baseWipDoc()],
      movements: [
        { id: 'wip-stock', warehouseId: 'pack', itemId: 'item-wip', quantity: 10, type: 'receipt', createdAt: '2026-09-03T07:30:00.000Z' } as StockMovement,
      ],
    })
    const result = confirmProductionPackagingReport(production, warehouse, {
      report: {
        productionOrderId: 'order-1',
        lineId: 'pack',
        shiftDate: '2026-09-03',
        shift: 'day',
        packagingLocationId: 'pack',
        finishedProductId: 'fp-1',
        warehouseItemId: 'item-fg',
        semiFinishedItemId: 'item-wip',
        materialLines: [],
        wipLines: [
          {
            shiftReportId: 'sr-1',
            semiFinishedItemId: 'item-wip',
            itemId: 'item-wip',
            quantity: 11,
            unitSnapshot: 'm2',
            receiptDocumentId: 'doc-1',
            lineId: 'wip-1',
          },
        ],
        outputM2: 100,
        rollCount: 10,
        palletCount: 1,
        batchNo: 'B-100',
      },
      actor,
      appScope,
      idempotencyKey: 'pack-too-much',
    })
    expect(result.result.ok).toBe(false)
    expect(result.result.error).toBe('warehouse.doc.errInsufficientStock')
    expect(result.production).toEqual(production)
    expect(result.warehouse).toEqual(warehouse)
  })

  it('allocates packaging material batches by FEFO', () => {
    const production = baseProduction({ shiftReports: [baseShiftReport()] })
    const warehouse = activePackWarehouse({
      documents: [baseWipDoc()],
      movements: [
        { id: 'wip-stock', warehouseId: 'pack', itemId: 'item-wip', quantity: 20, type: 'receipt', createdAt: '2026-09-03T07:30:00.000Z' } as StockMovement,
        { id: 'rm-1', warehouseId: 'pack', itemId: 'item-rm', quantity: 2, type: 'receipt', batchNo: 'B-early', expiryDate: '2026-09-04', createdAt: '2026-09-03T07:00:00.000Z' } as StockMovement,
        { id: 'rm-2', warehouseId: 'pack', itemId: 'item-rm', quantity: 2, type: 'receipt', batchNo: 'B-late', expiryDate: '2026-09-10', createdAt: '2026-09-03T08:00:00.000Z' } as StockMovement,
      ],
    })
    const auto = confirmProductionPackagingReport(production, warehouse, {
      report: {
        productionOrderId: 'order-1',
        lineId: 'pack',
        shiftDate: '2026-09-03',
        shift: 'day',
        packagingLocationId: 'pack',
        finishedProductId: 'fp-1',
        warehouseItemId: 'item-fg',
        semiFinishedItemId: 'item-wip',
        materialLines: [
          {
            lineId: 'mat-1',
            itemId: 'item-rm',
            quantity: 1,
            unitSnapshot: 'kg',
          },
        ],
        wipLines: [
          {
            shiftReportId: 'sr-1',
            semiFinishedItemId: 'item-wip',
            itemId: 'item-wip',
            quantity: 10,
            unitSnapshot: 'm2',
            receiptDocumentId: 'doc-1',
            lineId: 'wip-1',
          },
        ],
        outputM2: 100,
        rollCount: 10,
        palletCount: 1,
        batchNo: 'B-100',
      },
      actor,
      appScope,
      idempotencyKey: 'pack-fefo',
    })
    expect(auto.result.ok).toBe(true)
    if (auto.result.ok) {
      expect(auto.result.report?.materialLines[0]?.batchNo).toBe('B-early')
    }

    const override = confirmProductionPackagingReport(production, warehouse, {
      report: {
        productionOrderId: 'order-1',
        lineId: 'pack',
        shiftDate: '2026-09-03',
        shift: 'day',
        packagingLocationId: 'pack',
        finishedProductId: 'fp-1',
        warehouseItemId: 'item-fg',
        semiFinishedItemId: 'item-wip',
        materialLines: [
          {
            lineId: 'mat-1',
            itemId: 'item-rm',
            quantity: 1,
            batchNo: 'B-late',
            unitSnapshot: 'kg',
          },
        ],
        wipLines: [
          {
            shiftReportId: 'sr-1',
            semiFinishedItemId: 'item-wip',
            itemId: 'item-wip',
            quantity: 10,
            unitSnapshot: 'm2',
            receiptDocumentId: 'doc-1',
            lineId: 'wip-1',
          },
        ],
        outputM2: 100,
        rollCount: 10,
        palletCount: 1,
        batchNo: 'B-100',
      },
      actor,
      appScope,
      idempotencyKey: 'pack-fefo-override',
    })
    expect(override.result.ok).toBe(false)
    expect(override.result.error).toBe('warehouse.reserve.errBatchOverrideReason')
  })

  it('blocks packaging when materials would go negative', () => {
    const production = baseProduction({ shiftReports: [baseShiftReport()] })
    const warehouse = activePackWarehouse({
      documents: [baseWipDoc()],
      movements: [
        { id: 'wip-stock', warehouseId: 'pack', itemId: 'item-wip', quantity: 20, type: 'receipt', createdAt: '2026-09-03T07:30:00.000Z' } as StockMovement,
      ],
    })
    const result = confirmProductionPackagingReport(production, warehouse, {
      report: {
        productionOrderId: 'order-1',
        lineId: 'pack',
        shiftDate: '2026-09-03',
        shift: 'day',
        packagingLocationId: 'pack',
        finishedProductId: 'fp-1',
        warehouseItemId: 'item-fg',
        semiFinishedItemId: 'item-wip',
        materialLines: [
          {
            lineId: 'mat-1',
            itemId: 'item-rm',
            quantity: 1,
            unitSnapshot: 'kg',
          },
        ],
        wipLines: [
          {
            shiftReportId: 'sr-1',
            semiFinishedItemId: 'item-wip',
            itemId: 'item-wip',
            quantity: 10,
            unitSnapshot: 'm2',
            receiptDocumentId: 'doc-1',
            lineId: 'wip-1',
          },
        ],
        outputM2: 100,
        rollCount: 10,
        palletCount: 1,
        batchNo: 'B-100',
      },
      actor,
      appScope,
      idempotencyKey: 'pack-negative-material',
    })
    expect(result.result.ok).toBe(false)
    expect(result.production).toEqual(production)
    expect(result.warehouse).toEqual(warehouse)
  })

  it('marks confirmed packaging reports immutable', () => {
    expect(isPackagingReportImmutable({ status: 'confirmed' })).toBe(true)
    expect(isPackagingReportImmutable({ status: 'cancelled' })).toBe(true)
    expect(isPackagingReportImmutable({ status: 'draft' })).toBe(false)
  })

  it('blocks QC release until mandatory attachments are stored', () => {
    const baseLotState = baseLot()
    const storedPassport = qcAttachment('passport', 'att-1')
    const storedProtocol = qcAttachment('protocol', 'att-2')
    const pendingPassport = { ...storedPassport, uploadStatus: 'pending' as const }
    const failedProtocol = { ...storedProtocol, uploadStatus: 'failed' as const }

    const missingPassport = baseProduction({
      finishedGoodsLots: [{ ...baseLotState, passportAttachmentId: undefined, protocolAttachmentId: 'att-2' }],
      qcAttachments: [storedProtocol],
    })
    expect(
      releaseFinishedGoodsLot(missingPassport, {
        lotId: 'lot-1',
        actor: { ...actor, roleId: 'otc' },
      }).result,
    ).toMatchObject({ ok: false, error: 'production.qc.errReleaseAttachments' })

    const missingProtocol = baseProduction({
      finishedGoodsLots: [{ ...baseLotState, passportAttachmentId: 'att-1', protocolAttachmentId: undefined }],
      qcAttachments: [storedPassport],
    })
    expect(
      releaseFinishedGoodsLot(missingProtocol, {
        lotId: 'lot-1',
        actor: { ...actor, roleId: 'otc' },
      }).result,
    ).toMatchObject({ ok: false, error: 'production.qc.errReleaseAttachments' })

    const pendingUpload = baseProduction({
      finishedGoodsLots: [{ ...baseLotState, passportAttachmentId: 'att-1', protocolAttachmentId: 'att-2' }],
      qcAttachments: [pendingPassport, failedProtocol],
    })
    expect(
      releaseFinishedGoodsLot(pendingUpload, {
        lotId: 'lot-1',
        actor: { ...actor, roleId: 'otc' },
      }).result,
    ).toMatchObject({ ok: false, error: 'production.qc.errReleaseAttachments' })

    const stored = baseProduction({
      finishedGoodsLots: [{ ...baseLotState, passportAttachmentId: 'att-1', protocolAttachmentId: 'att-2' }],
      qcAttachments: [storedPassport, storedProtocol],
    })
    const released = releaseFinishedGoodsLot(stored, {
      lotId: 'lot-1',
      actor: { ...actor, roleId: 'otc' },
    })
    expect(released.result.ok).toBe(true)
    expect(released.result.auditDetail).toContain('Operations Director')

    const denied = releaseFinishedGoodsLot(stored, {
      lotId: 'lot-1',
      actor: { ...actor, roleId: 'warehouse_keeper' },
    })
    expect(denied.result).toMatchObject({ ok: false, error: 'production.qc.errReleaseForbidden' })
    const sysadmin = releaseFinishedGoodsLot(stored, {
      lotId: 'lot-1',
      actor: { ...actor, roleId: 'sysadmin' },
      attachments: { passportAttachmentId: 'att-1', protocolAttachmentId: 'att-2' },
    })
    expect(sysadmin.result).toMatchObject({ ok: false, error: 'production.qc.errReleaseForbidden' })
  })

  it('enforces QC release ACL roles', () => {
    const production = baseProduction({
      finishedGoodsLots: [baseLot({ qcStatus: 'pending', passportAttachmentId: 'att-1', protocolAttachmentId: 'att-2' })],
      qcAttachments: [qcAttachment('passport', 'att-1'), qcAttachment('protocol', 'att-2')],
    })
    const otc = releaseFinishedGoodsLot(production, {
      lotId: 'lot-1',
      actor: { ...actor, roleId: 'otc' },
    })
    expect(otc.result.ok).toBe(true)

    const operationsDenied = releaseFinishedGoodsLot(production, {
      lotId: 'lot-1',
      actor: { ...actor, roleId: 'operations_director' },
      access: { roleAllowQcRelease: {} } as never,
    })
    expect(operationsDenied.result).toMatchObject({ ok: false, error: 'production.qc.errReleaseForbidden' })

    const operationsAllowed = releaseFinishedGoodsLot(production, {
      lotId: 'lot-1',
      actor: { ...actor, roleId: 'operations_director' },
      access: { roleAllowQcRelease: { operations_director: true } } as never,
    })
    expect(operationsAllowed.result.ok).toBe(true)

    const technologistDenied = releaseFinishedGoodsLot(production, {
      lotId: 'lot-1',
      actor: { ...actor, roleId: 'technologist' },
      access: { roleAllowQcRelease: {} } as never,
    })
    expect(technologistDenied.result).toMatchObject({ ok: false, error: 'production.qc.errReleaseForbidden' })

    const technologistAllowed = releaseFinishedGoodsLot(production, {
      lotId: 'lot-1',
      actor: { ...actor, roleId: 'technologist' },
      access: { roleAllowQcRelease: { technologist: true } } as never,
    })
    expect(technologistAllowed.result.ok).toBe(true)

    const keeperDenied = releaseFinishedGoodsLot(production, {
      lotId: 'lot-1',
      actor: { ...actor, roleId: 'warehouse_keeper' },
    })
    expect(keeperDenied.result).toMatchObject({ ok: false, error: 'production.qc.errReleaseForbidden' })

    const sysadminDenied = releaseFinishedGoodsLot(production, {
      lotId: 'lot-1',
      actor: { ...actor, roleId: 'sysadmin' },
      access: { roleAllowQcRelease: { operations_director: true, technologist: true } } as never,
    })
    expect(sysadminDenied.result).toMatchObject({ ok: false, error: 'production.qc.errReleaseForbidden' })
  })

  it('regrades a released lot into a pending replacement', () => {
    const production = baseProduction({
      finishedGoodsLots: [baseLot({ qcStatus: 'released', quantityQcReleased: 100, quantityRemaining: 100 })],
    })
    const warehouse = activePackWarehouse()
    const regrade = requestRegrade(production, warehouse, {
      lotId: 'lot-1',
      targetFinishedProductId: 'fp-2',
      targetWarehouseItemId: 'item-fg-2',
      reason: 'surface defect',
      actor: { ...actor, roleId: 'otc' },
      idempotencyKey: 'regrade-1',
    })
    expect(regrade.result.ok).toBe(true)
    expect(regrade.result.originalLot?.qcStatus).toBe('regrade_pending')
    expect(regrade.result.newLot?.qcStatus).toBe('pending')
    if (regrade.result.newLot) {
      expect(
        assertLoadingLineShippable([regrade.result.newLot], {
          quantity: 1,
          finishedProductId: 'fp-2',
          warehouseItemId: 'item-fg-2',
          lotId: regrade.result.newLot.id,
        }),
      ).toMatchObject({ ok: false, error: 'production.ship.errLotNotReleased' })
    }

    const missingReason = requestRegrade(production, warehouse, {
      lotId: 'lot-1',
      targetFinishedProductId: 'fp-2',
      targetWarehouseItemId: 'item-fg-2',
      reason: '',
      actor: { ...actor, roleId: 'otc' },
      idempotencyKey: 'regrade-2',
    })
    expect(missingReason.result).toMatchObject({ ok: false, error: 'production.qc.errRegradeReason' })
  })

  it('rejects regrade when the target warehouse item is missing', () => {
    const production = baseProduction({
      finishedGoodsLots: [baseLot({ qcStatus: 'released', quantityQcReleased: 100, quantityRemaining: 100 })],
    })
    const warehouse = activePackWarehouse()
    const out = requestRegrade(production, warehouse, {
      lotId: 'lot-1',
      targetFinishedProductId: 'fp-2',
      targetWarehouseItemId: 'missing-item',
      reason: 'surface defect',
      actor: { ...actor, roleId: 'otc' },
      idempotencyKey: 'regrade-missing-item',
      quantity: 50,
    })
    expect(out.result).toMatchObject({ ok: false, error: 'production.qc.errLotNotFound' })
  })

  it('keeps regrade idempotent for the same key', () => {
    const production = baseProduction({
      finishedGoodsLots: [baseLot({ qcStatus: 'released', quantityQcReleased: 100, quantityRemaining: 100 })],
    })
    const warehouse = activePackWarehouse()
    const first = requestRegrade(production, warehouse, {
      lotId: 'lot-1',
      targetFinishedProductId: 'fp-2',
      targetWarehouseItemId: 'item-fg-2',
      reason: 'surface defect',
      actor: { ...actor, roleId: 'otc' },
      idempotencyKey: 'regrade-idem',
      quantity: 50,
    })
    expect(first.result.ok).toBe(true)
    const second = requestRegrade(first.production, warehouse, {
      lotId: 'lot-1',
      targetFinishedProductId: 'fp-2',
      targetWarehouseItemId: 'item-fg-2',
      reason: 'surface defect',
      actor: { ...actor, roleId: 'otc' },
      idempotencyKey: 'regrade-idem',
      quantity: 50,
    })
    expect(second.result.ok).toBe(true)
    expect(second.result.documentIds).toEqual([])
  })

  it('uses the finished goods shipment cancel group kind', () => {
    expect(cancelWarehouseDocumentGroupKind('doc-1', undefined, 'doc-1')).toBe(
      'finished_goods_shipment_cancel',
    )
  })

  it('returns finished_goods_shipment_cancel for loading shipment posted docs', () => {
    const postedDocumentId = 'doc-loading-1'
    expect(cancelWarehouseDocumentGroupKind(postedDocumentId, null, postedDocumentId)).toBe(
      'finished_goods_shipment_cancel',
    )
  })

  it('includes the P1C stable id collections', () => {
    expect(STABLE_ID_COLLECTION_PATHS).toEqual(
      expect.arrayContaining(['production.packagingReports', 'production.finishedGoodsLots', 'production.qcAttachments']),
    )
  })

  it('rejects a lot into scrap_pending without final write-off', () => {
    const production = baseProduction({
      finishedGoodsLots: [baseLot({ qcStatus: 'released', quantityQcReleased: 100, quantityRemaining: 100 })],
    })
    const warehouse = activePackWarehouse({
      movements: [
        { id: 'fg-stock', warehouseId: 'pack', itemId: 'item-fg', quantity: 100, type: 'receipt', createdAt: '2026-09-03T06:00:00.000Z' } as StockMovement,
      ],
    })
    const rejected = rejectFinishedGoodsLot(production, {
      lotId: 'lot-1',
      reason: 'scrap',
      actor: { ...actor, roleId: 'otc' },
      idempotencyKey: 'reject-1',
    })
    expect(rejected.result.ok).toBe(true)
    expect(rejected.result.lot?.qcStatus).toBe('rejected')

    const scrap = applyRejectTransferToScrap(rejected.production, warehouse, {
      lotId: 'lot-1',
      scrapLocationId: 'scrap',
      reason: 'scrap',
      actor: { ...actor, roleId: 'otc' },
    })
    expect(scrap.result.ok).toBe(true)
    expect(scrap.result.lot?.qcStatus).toBe('scrap_pending')
  })

  it.each([
    ['production.qc.errReleaseAttachments', { passportAttachmentId: undefined, protocolAttachmentId: 'att-2' }, [qcAttachment('protocol', 'att-2')]],
    ['production.qc.errReleaseAttachments', { passportAttachmentId: 'att-1', protocolAttachmentId: undefined }, [qcAttachment('passport', 'att-1')]],
    ['production.qc.errReleaseForbidden', { passportAttachmentId: 'att-1', protocolAttachmentId: 'att-2' }, [qcAttachment('passport', 'att-1'), qcAttachment('protocol', 'att-2')]],
  ])('keeps QC release gated for %s', (error, lotPatch, attachments) => {
    const production = baseProduction({
      finishedGoodsLots: [{ ...baseLot(), ...lotPatch }],
      qcAttachments: attachments as QcLotAttachment[],
    })
    const actorPatch = error === 'production.qc.errReleaseForbidden'
      ? { ...actor, roleId: 'warehouse_keeper' as const }
      : { ...actor, roleId: 'otc' as const }
    const released = releaseFinishedGoodsLot(production, {
      lotId: 'lot-1',
      actor: actorPatch,
    })
    expect(released.result).toMatchObject({ ok: false, error })
  })

  it('posts loading shipments idempotently and reverses lot quantities', () => {
    const warehouse = activePackWarehouse({
      movements: [
        { id: 'fg-stock', warehouseId: 'pack', itemId: 'item-fg', quantity: 10, type: 'receipt', createdAt: '2026-09-03T06:00:00.000Z' } as StockMovement,
      ],
      loadingShipments: [
        {
          id: 'ship-1',
          number: 'ПГ-1',
          date: '2026-09-03',
          warehouseId: 'pack',
          containerId: 'fura',
          payloadKg: 1000,
          palletPlacesLimit: 10,
          counterpartyName: 'Acme',
          orderNo: 'SO-1',
          lines: [
            {
              id: 'line-1',
              name: 'FG',
              note: '',
              rolls: 1,
              finishedProductId: 'fp-1',
              itemId: 'item-fg',
              lotId: 'lot-1',
              weightPerRollKg: 1,
              areaPerRollM2: 1,
            },
          ],
          totalsRolls: 1,
          totalsNetKg: 0,
          totalsGrossKg: 0,
          totalsAreaM2: 0,
          totalsPalletPlaces: 0,
          status: 'draft',
          createdAt: '2026-09-03T10:00:00.000Z',
          updatedAt: '2026-09-03T10:00:00.000Z',
        } as LoadingShipment,
      ],
    })
    const lots = [baseLot({ qcStatus: 'released', quantityQcReleased: 20, quantityShipped: 0, quantityRemaining: 20 })]
    const first = postLoadingShipment(warehouse, 'ship-1', { keeperId: 'wk-1', keeperName: 'Keeper' }, lots)
    expect(first.result.ok).toBe(true)
    const second = postLoadingShipment(first.store, 'ship-1', { keeperId: 'wk-1', keeperName: 'Keeper' }, lots)
    expect(second.result.ok).toBe(true)
    expect(second.result.number).toBe(first.result.ok ? first.result.number : undefined)
    const shipped = applyShipmentToLot(lots[0], 3)
    expect(shipped.quantityShipped).toBe(3)
    expect(reverseShipmentOnLot(shipped, 3).quantityShipped).toBe(0)
  })

  it('blocks shipment when lot QC is not released', () => {
    const lot = baseLot({ qcStatus: 'pending' })
    expect(
      assertLoadingLineShippable([lot], {
        quantity: 1,
        finishedProductId: 'fp-1',
        warehouseItemId: 'item-fg',
        lotId: 'lot-1',
      }),
    ).toMatchObject({ ok: false, error: 'production.ship.errLotNotReleased' })
    expect(isLotAvailableForShipment(lot)).toBe(false)
  })

  it('blocks shipment when lot id is missing', () => {
    const lot = baseLot({ qcStatus: 'released', quantityQcReleased: 10, quantityRemaining: 10 })
    expect(
      assertLoadingLineShippable([lot], {
        quantity: 1,
        finishedProductId: 'fp-1',
        warehouseItemId: 'item-fg',
      }),
    ).toMatchObject({ ok: false, error: 'production.ship.errLotRequired' })
  })

  it('blocks legacy and write-off lots from shipment', () => {
    const writtenOff = baseLot({ qcStatus: 'written_off' as FinishedGoodsQcStatus })
    const scrapPending = baseLot({ qcStatus: 'scrap_pending' as FinishedGoodsQcStatus })
    expect(isLotAvailableForShipment(writtenOff)).toBe(false)
    expect(isLotAvailableForShipment(scrapPending)).toBe(false)
  })
})
