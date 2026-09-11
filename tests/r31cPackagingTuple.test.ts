import { describe, expect, it } from 'vitest'
import type { ProductionOrder } from '@/lib/planner/types'
import {
  confirmProductionPackagingReport,
  listAvailableWipAtPackaging,
  type ConfirmPackagingReportInput,
} from '@/lib/production/packagingReports'
import type { ProductionShiftReport } from '@/lib/production/shiftReports'
import type { ProductionStore } from '@/lib/production/types'
import { withActiveWarehouses } from '@/lib/warehouse/accountingStatus'
import type {
  StockMovement,
  WarehouseDocument,
  WarehouseStore,
} from '@/lib/warehouse/types'

const PACK_WAREHOUSE = 'pack-warehouse'
const PACK_LOCATION = 'pack-location'
const OTHER_WAREHOUSE = 'other-warehouse'
const OTHER_LOCATION = 'other-location'

const actor = {
  id: 'director-1',
  name: 'Operations Director',
  roleId: 'operations_director' as const,
}
const appScope = { brigades: [], brigadiers: {}, employees: [] }

function order(): ProductionOrder {
  return {
    id: 'order-1',
    orderNumber: 'PO-1',
    customer: 'EDU customer',
    productName: 'Celloplex 160',
    lineId: '1',
    status: 'active',
    finishedProductId: 'finished-product-1',
    warehouseItemId: 'item-fg',
    semiFinishedItemId: 'item-wip',
    dayPlans: [],
    history: [],
    createdAt: '2026-09-10T08:00:00.000Z',
    updatedAt: '2026-09-10T08:00:00.000Z',
  } as ProductionOrder
}

function shiftReport(id: string): ProductionShiftReport {
  return {
    id,
    productionOrderId: 'order-1',
    lineId: '1',
    shiftDate: '2026-09-10',
    shift: 'day',
    status: 'confirmed',
  } as ProductionShiftReport
}

function production(shiftIds: string[]): ProductionStore {
  return {
    planner: { orders: [order()] } as ProductionStore['planner'],
    requests: [],
    shiftReports: shiftIds.map(shiftReport),
    packagingReports: [],
    finishedGoodsLots: [],
  }
}

function movement(
  id: string,
  patch: Partial<StockMovement>,
): StockMovement {
  return {
    id,
    itemId: 'item-wip',
    warehouseId: PACK_WAREHOUSE,
    locationId: PACK_LOCATION,
    type: 'receipt',
    quantity: 10,
    date: '2026-09-10',
    createdAt: '2026-09-10T08:00:00.000Z',
    ...patch,
  }
}

function wipDocument(
  id: string,
  shiftReportId: string,
  warehouseId: string,
  locationId?: string,
  quantity = 10,
): WarehouseDocument {
  return {
    id,
    number: `WIP-${id}`,
    type: 'receipt',
    purpose: 'production_wip_receipt',
    docRole: 'production_wip_receipt',
    status: 'posted',
    warehouseId,
    productionOrderId: 'order-1',
    shiftReportId,
    lines: [
      {
        lineId: `${id}-line`,
        itemId: 'item-wip',
        quantity,
        unitSnapshot: 'm2',
        locationId,
      },
    ],
    createdAt: '2026-09-10T08:00:00.000Z',
    postedAt: '2026-09-10T08:00:00.000Z',
  }
}

function warehouse(overrides: Partial<WarehouseStore> = {}): WarehouseStore {
  const seed: WarehouseStore = {
    locations: [
      { id: PACK_WAREHOUSE, name: 'Packaging warehouse', sortOrder: 1, kind: 'other' },
      { id: PACK_LOCATION, name: 'Packaging line', sortOrder: 2, kind: 'packaging' },
      { id: OTHER_WAREHOUSE, name: 'Other warehouse', sortOrder: 3, kind: 'other' },
      { id: OTHER_LOCATION, name: 'Other location', sortOrder: 4, kind: 'other' },
    ],
    categories: [{ id: 'category-1', name: 'Production', sortOrder: 1 }],
    items: [
      {
        id: 'item-wip',
        internalCode: 'WIP-1',
        name: 'Post-line WIP',
        categoryId: 'category-1',
        warehouseId: PACK_WAREHOUSE,
        unit: 'm2',
        active: true,
        sortOrder: 1,
      },
      {
        id: 'item-pack',
        internalCode: 'PACK-1',
        name: 'Packaging material',
        categoryId: 'category-1',
        warehouseId: PACK_WAREHOUSE,
        unit: 'kg',
        active: true,
        sortOrder: 2,
      },
      {
        id: 'item-fg',
        internalCode: 'FG-1',
        name: 'Finished goods',
        categoryId: 'category-1',
        warehouseId: PACK_WAREHOUSE,
        unit: 'm2',
        active: true,
        sortOrder: 3,
      },
    ],
    movements: [],
    documents: [],
    auditLog: [],
    nextInternalCode: 1,
    invoiceRegistry: [],
    materialShortages: [],
    productionLineBindings: [
      {
        id: 'pack',
        lineId: 'pack',
        productionWarehouseId: PACK_WAREHOUSE,
        productionLocationId: PACK_LOCATION,
      },
    ],
    ...overrides,
  }
  return withActiveWarehouses(seed, [PACK_WAREHOUSE], actor)
}

function canonicalReport(): ConfirmPackagingReportInput['report'] {
  return {
    productionOrderId: 'order-1',
    lineId: 'pack',
    shiftDate: '2026-09-10',
    shift: 'day',
    packagingWarehouseId: PACK_WAREHOUSE,
    packagingLocationId: PACK_LOCATION,
    finishedProductId: 'finished-product-1',
    warehouseItemId: 'item-fg',
    semiFinishedItemId: 'item-wip',
    materialLines: [
      {
        lineId: 'pack-material-line',
        itemId: 'item-pack',
        quantity: 1,
        unitSnapshot: 'kg',
      },
    ],
    wipLines: [
      {
        lineId: 'wip-exact-line',
        shiftReportId: 'shift-exact',
        productionOrderId: 'order-1',
        semiFinishedItemId: 'item-wip',
        itemId: 'item-wip',
        receiptDocumentId: 'wip-exact',
        quantity: 10,
        unitSnapshot: 'm2',
      },
    ],
    outputM2: 10,
    rollCount: 1,
    palletCount: 1,
    m2PerRollSnapshot: 10,
    rollsPerPalletSnapshot: 1,
    conversionTolerancePct: 5,
    batchNo: 'FG-BATCH-1',
  }
}

describe('R3.1C local packaging warehouse/location tuple', () => {
  it('lists only exact-tuple WIP and subtracts only exact-tuple consumption', () => {
    const state = warehouse({
      documents: [
        wipDocument('wip-exact', 'shift-exact', PACK_WAREHOUSE, PACK_LOCATION, 20),
        wipDocument('wip-wrong-location', 'shift-wrong-location', PACK_WAREHOUSE, OTHER_LOCATION, 30),
        wipDocument('wip-wrong-warehouse', 'shift-wrong-warehouse', OTHER_WAREHOUSE, PACK_LOCATION, 40),
        wipDocument('wip-legacy', 'shift-legacy', PACK_LOCATION, undefined, 7),
        {
          id: 'pack-issue',
          number: 'PACK-ISSUE-1',
          type: 'issue',
          purpose: 'production_wip_pack_consumption',
          docRole: 'production_wip_pack_consumption',
          status: 'posted',
          warehouseId: PACK_WAREHOUSE,
          lines: [],
          createdAt: '2026-09-10T09:00:00.000Z',
        } as WarehouseDocument,
      ],
      movements: [
        movement('exact-used', {
          type: 'issue',
          quantity: 5,
          shiftReportId: 'shift-exact',
          documentId: 'pack-issue',
          documentLineId: 'wip-exact-line',
          productionOrderId: 'order-1',
        }),
        movement('wrong-location-used', {
          type: 'issue',
          quantity: 12,
          locationId: OTHER_LOCATION,
          shiftReportId: 'shift-exact',
          documentId: 'pack-issue',
          documentLineId: 'wip-exact-line',
          productionOrderId: 'order-1',
        }),
        movement('wrong-warehouse-used', {
          type: 'issue',
          quantity: 12,
          warehouseId: OTHER_WAREHOUSE,
          shiftReportId: 'shift-exact',
          documentId: 'pack-issue',
          documentLineId: 'wip-exact-line',
          productionOrderId: 'order-1',
        }),
      ],
    })
    const prod = production([
      'shift-exact',
      'shift-wrong-location',
      'shift-wrong-warehouse',
      'shift-legacy',
    ])

    const strict = listAvailableWipAtPackaging(
      prod,
      state,
      PACK_LOCATION,
      PACK_WAREHOUSE,
    )
    expect(strict).toHaveLength(1)
    expect(strict[0]).toMatchObject({
      receiptDocumentId: 'wip-exact',
      remainingQty: 15,
    })

    const bindingResolvedRead = listAvailableWipAtPackaging(prod, state, PACK_LOCATION)
    expect(bindingResolvedRead.map((line) => line.receiptDocumentId)).toEqual(['wip-exact'])
    expect(
      listAvailableWipAtPackaging(
        prod,
        state,
        PACK_LOCATION,
        PACK_WAREHOUSE,
        'other-order',
      ),
    ).toEqual([])
  })

  it('posts WIP, packaging materials, and FG on one exact tuple', () => {
    const state = warehouse({
      documents: [wipDocument('wip-exact', 'shift-exact', PACK_WAREHOUSE, PACK_LOCATION)],
      movements: [
        movement('wip-stock', { shiftReportId: 'shift-exact', documentId: 'wip-exact' }),
        movement('pack-stock', { itemId: 'item-pack', quantity: 2 }),
      ],
    })

    const confirmed = confirmProductionPackagingReport(
      production(['shift-exact']),
      state,
      {
        report: canonicalReport(),
        actor,
        appScope,
        idempotencyKey: 'pack-tuple-confirm',
      },
    )

    expect(confirmed.result.ok).toBe(true)
    const createdDocuments = confirmed.warehouse.documents.filter(
      (document) => document.packagingReportId === confirmed.result.report?.id,
    )
    expect(createdDocuments).toHaveLength(3)
    expect(createdDocuments.every((document) => document.warehouseId === PACK_WAREHOUSE)).toBe(true)
    expect(
      createdDocuments.every((document) =>
        document.lines.every((line) => line.locationId === PACK_LOCATION),
      ),
    ).toBe(true)

    const createdIds = new Set(createdDocuments.map((document) => document.id))
    const createdMovements = confirmed.warehouse.movements.filter((entry) =>
      createdIds.has(entry.documentId ?? ''),
    )
    expect(createdMovements).toHaveLength(3)
    expect(
      createdMovements.every(
        (entry) =>
          entry.warehouseId === PACK_WAREHOUSE && entry.locationId === PACK_LOCATION,
      ),
    ).toBe(true)
    expect(confirmed.result.report?.packagingWarehouseId).toBe(PACK_WAREHOUSE)
    expect(confirmed.result.lot).toMatchObject({
      warehouseId: PACK_WAREHOUSE,
      locationId: PACK_LOCATION,
    })
    expect(
      listAvailableWipAtPackaging(
        confirmed.production,
        confirmed.warehouse,
        PACK_LOCATION,
        PACK_WAREHOUSE,
        'order-1',
      ),
    ).toEqual([])
  })

  it('does not let stock at another physical location fund packaging', () => {
    const state = warehouse({
      documents: [wipDocument('wip-exact', 'shift-exact', PACK_WAREHOUSE, PACK_LOCATION)],
      movements: [
        movement('wip-stock', { shiftReportId: 'shift-exact', documentId: 'wip-exact' }),
        movement('pack-stock-wrong-location', {
          itemId: 'item-pack',
          quantity: 100,
          locationId: OTHER_LOCATION,
        }),
      ],
    })
    const prod = production(['shift-exact'])

    const confirmed = confirmProductionPackagingReport(prod, state, {
      report: canonicalReport(),
      actor,
      appScope,
      idempotencyKey: 'pack-wrong-location',
    })

    expect(confirmed.result).toEqual({
      ok: false,
      error: 'warehouse.doc.errInsufficientStock',
    })
    expect(confirmed.production).toBe(prod)
    expect(confirmed.warehouse).toBe(state)
  })

  it('keeps the collapsed warehouse=location fallback for legacy local rows', () => {
    const legacyId = 'pack-legacy'
    const legacy = withActiveWarehouses(
      warehouse({
        locations: [{ id: legacyId, name: 'Legacy pack', sortOrder: 1, kind: 'packaging' }],
        productionLineBindings: [
          {
            id: 'pack',
            lineId: 'pack',
            productionWarehouseId: legacyId,
            productionLocationId: legacyId,
          },
        ],
        items: warehouse().items.map((item) => ({ ...item, warehouseId: legacyId })),
        documents: [wipDocument('wip-exact', 'shift-exact', legacyId)],
        movements: [
          movement('legacy-wip-stock', {
            warehouseId: legacyId,
            locationId: undefined,
            shiftReportId: 'shift-exact',
            documentId: 'wip-exact',
          }),
          movement('legacy-pack-stock', {
            warehouseId: legacyId,
            locationId: undefined,
            itemId: 'item-pack',
            quantity: 2,
          }),
        ],
        accountingByWarehouse: [],
      }),
      [legacyId],
      actor,
    )
    const report = {
      ...canonicalReport(),
      packagingWarehouseId: undefined,
      packagingLocationId: legacyId,
    }

    const confirmed = confirmProductionPackagingReport(
      production(['shift-exact']),
      legacy,
      {
        report,
        actor,
        appScope,
        idempotencyKey: 'pack-legacy-confirm',
      },
    )

    expect(confirmed.result.ok).toBe(true)
    expect(confirmed.result.report?.packagingWarehouseId).toBe(legacyId)
    const createdDocuments = confirmed.warehouse.documents.filter(
      (document) => document.packagingReportId === confirmed.result.report?.id,
    )
    expect(createdDocuments.every((document) => document.warehouseId === legacyId)).toBe(true)
  })
})
