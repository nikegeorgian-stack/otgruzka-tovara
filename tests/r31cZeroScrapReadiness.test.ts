import { describe, expect, it } from 'vitest'
import type { RecipeNormSnapshot } from '@/lib/formulations/recipeApproval'
import type { ProductionOrder } from '@/lib/planner/types'
import {
  confirmProductionShiftReport,
  confirmShiftReportCorrection,
  type ConfirmShiftReportInput,
} from '@/lib/production/shiftReports'
import type { ProductionStore } from '@/lib/production/types'
import { withActiveWarehouses } from '@/lib/warehouse/accountingStatus'
import { normalizeWarehouse } from '@/lib/warehouse/init'
import {
  LINE_LOCATION_MISSING,
  LINE_LOCATION_NOT_CONFIGURED,
  upsertProductionLineBinding,
} from '@/lib/warehouse/productionLineLocationConfig'
import {
  resolveShiftWasteRouting,
  SHIFT_SCRAP_LOCATION_INVALID,
  SHIFT_WASTE_QUANTITY_INVALID,
} from '@/lib/warehouse/productionShiftConsumption'
import type { StockMovement, WarehouseStore } from '@/lib/warehouse/types'

const appScope = {
  brigades: [],
  brigadiers: {},
  employees: [],
}

const actor = {
  id: 'director-1',
  name: 'Operations Director',
  roleId: 'operations_director' as const,
}

const lineRoute = {
  productionWarehouseId: 'line-location',
  productionLocationId: 'line-location',
}

const snapshot: RecipeNormSnapshot = {
  recipeId: 'recipe-1',
  recipeVersionId: 'recipe-version-1',
  versionNumber: 1,
  contentHash: 'recipe-content-1',
  normBase: 'per_m2',
  components: [
    {
      lineId: 'component-1',
      warehouseItemId: 'item-raw',
      itemCodeSnapshot: 'RM-1',
      itemNameSnapshot: 'Raw material',
      unitSnapshot: 'kg',
      normQty: 1,
      tolerancePct: 10,
    },
  ],
  snappedAt: '2026-09-10T08:00:00.000Z',
}

const order: ProductionOrder = {
  id: 'order-1',
  orderNumber: 'PO-1',
  customer: 'EDU customer',
  productName: 'Celloplex 160',
  category: 'ratl1',
  totalQtyMp: 100,
  startDate: '2026-09-10',
  endDate: '2026-09-11',
  lineId: '1',
  priority: 'normal',
  status: 'active',
  planMode: 'even',
  recalcMode: 'auto',
  rawMaterialItemId: 'item-raw',
  semiFinishedItemId: 'item-wip',
  m2PerRoll: 2,
  recipeNormSnapshot: snapshot,
  dayPlans: [],
  history: [],
  createdAt: '2026-09-10T08:00:00.000Z',
  updatedAt: '2026-09-10T08:00:00.000Z',
}

function makeProduction(): ProductionStore {
  return {
    requests: [],
    planner: { orders: [order], nextOrderSeq: 2 },
    shiftReports: [],
  }
}

function makeWarehouse(options: { withScrap?: boolean; activeScrap?: boolean } = {}): WarehouseStore {
  const withScrap = options.withScrap ?? false
  const locations: WarehouseStore['locations'] = [
    { id: 'line-location', name: 'Line 1', sortOrder: 1, kind: 'wip' },
    { id: 'pack-location', name: 'Pack', sortOrder: 2, kind: 'packaging' },
    ...(withScrap
      ? [{ id: 'scrap-location', name: 'Scrap', sortOrder: 3, kind: 'other' as const }]
      : []),
  ]
  const seedMovement: StockMovement = {
    id: 'line-seed',
    itemId: 'item-raw',
    warehouseId: 'line-location',
    type: 'receipt',
    quantity: 20,
    date: '2026-09-10',
    productionOrderId: order.id,
    batchNo: 'BATCH-1',
    createdAt: '2026-09-10T08:00:00.000Z',
  }
  let warehouse: WarehouseStore = {
    locations,
    categories: [
      { id: 'category-raw', name: 'Raw', sortOrder: 1 },
      { id: 'category-wip', name: 'WIP', sortOrder: 2 },
    ],
    items: [
      {
        id: 'item-raw',
        internalCode: 'RM-1',
        name: 'Raw material',
        categoryId: 'category-raw',
        warehouseId: 'line-location',
        unit: 'kg',
        active: true,
        sortOrder: 1,
      },
      {
        id: 'item-wip',
        internalCode: 'WIP-1',
        name: 'Semi-finished',
        categoryId: 'category-wip',
        warehouseId: 'pack-location',
        unit: 'm2',
        active: true,
        sortOrder: 2,
      },
    ],
    movements: [seedMovement],
    documents: [],
    invoiceRegistry: [],
    auditLog: [],
    itemHistories: {},
    productionLineBindings: [],
    ...(withScrap ? { scrapLocationId: 'scrap-location' } : {}),
  }
  warehouse = withActiveWarehouses(warehouse, [
    'line-location',
    'pack-location',
    ...(withScrap && options.activeScrap !== false ? ['scrap-location'] : []),
  ])
  warehouse = upsertProductionLineBinding(warehouse, {
    lineId: '1',
    productionWarehouseId: 'line-location',
    productionLocationId: 'line-location',
  })
  warehouse = upsertProductionLineBinding(warehouse, {
    lineId: 'pack',
    productionWarehouseId: 'pack-location',
    productionLocationId: 'pack-location',
  })
  return warehouse
}

function reportInput(options: {
  wasteQty?: number
  scrapLocationId?: string
  wasteLines?: ConfirmShiftReportInput['report']['wasteLines']
  idempotencyKey?: string
} = {}): ConfirmShiftReportInput {
  const wasteQty = options.wasteQty ?? 0
  const idempotencyKey = options.idempotencyKey ?? 'shift-confirm-1'
  return {
    report: {
      productionOrderId: order.id,
      lineId: '1',
      shiftDate: '2026-09-10',
      shift: 'day',
      recipeNormSnapshot: snapshot,
      productionLocationId: 'line-location',
      packagingLocationId: 'pack-location',
      scrapLocationId: options.scrapLocationId,
      materialLines: [
        {
          lineId: 'material-1',
          itemId: 'item-raw',
          itemCodeSnapshot: 'RM-1',
          itemNameSnapshot: 'Raw material',
          unitSnapshot: 'kg',
          normQty: 10,
          actualInputQty: 10,
          wasteQty,
          processConsumedQty: 10 - wasteQty,
          deviationQty: 0,
          deviationPct: 0,
          tolerancePct: 10,
          batchNo: 'BATCH-1',
          batchOverrideReason: 'confirmed source batch',
        },
      ],
      wasteLines:
        options.wasteLines ??
        (wasteQty > 0
          ? [
              {
                lineId: 'waste-1',
                itemId: 'item-raw',
                batchNo: 'BATCH-1',
                quantity: wasteQty,
                unitSnapshot: 'kg',
                reasonCode: 'process_waste',
              },
            ]
          : []),
      outputM2: 10,
      rollCount: 5,
      m2PerRollSnapshot: 2,
      conversionTolerancePct: 5,
      semiFinishedItemId: 'item-wip',
      idempotencyKey,
    },
    productionOrder: order,
    actor,
    appScope,
    idempotencyKey,
    transactionGroupId: `${idempotencyKey}:group`,
  }
}

function stockBalance(store: WarehouseStore, itemId: string, warehouseId: string): number {
  return store.movements.reduce((total, movement) => {
    if (movement.itemId !== itemId || movement.warehouseId !== warehouseId) return total
    if (movement.type === 'receipt') return total + Math.abs(movement.quantity)
    if (movement.type === 'issue') return total - Math.abs(movement.quantity)
    return total
  }, 0)
}

describe('R3.1C zero-scrap readiness', () => {
  it('does not require or retain a scrap location when every waste row is zero', () => {
    const warehouse = makeWarehouse()
    const rows = [
      { id: 'zero', quantity: 0 },
      { id: 'epsilon', quantity: 1e-9 },
    ]

    expect(resolveShiftWasteRouting(warehouse, rows, 'missing-location')).toEqual({
      ok: true,
      wasteLines: [],
      scrapLocationId: undefined,
    })
  })

  it('requires an existing active scrap location only for positive waste', () => {
    const missing = makeWarehouse()
    expect(resolveShiftWasteRouting(missing, [{ quantity: 1 }], undefined, lineRoute)).toEqual({
      ok: false,
      error: SHIFT_SCRAP_LOCATION_INVALID,
    })
    expect(resolveShiftWasteRouting(missing, [{ quantity: 1 }], 'unknown', lineRoute)).toEqual({
      ok: false,
      error: SHIFT_SCRAP_LOCATION_INVALID,
    })

    const inactive = makeWarehouse({ withScrap: true, activeScrap: false })
    expect(resolveShiftWasteRouting(inactive, [{ quantity: 1 }], undefined, lineRoute)).toEqual({
      ok: false,
      error: 'warehouse_not_initialized',
    })

    const active = makeWarehouse({ withScrap: true })
    expect(resolveShiftWasteRouting(active, [{ quantity: 1 }], undefined, lineRoute)).toEqual({
      ok: true,
      wasteLines: [{ quantity: 1 }],
      scrapLocationId: 'scrap-location',
    })
  })

  it('rejects invalid waste quantities instead of treating them as zero', () => {
    const warehouse = makeWarehouse()
    expect(resolveShiftWasteRouting(warehouse, [{ quantity: -1 }], undefined, lineRoute)).toEqual({
      ok: false,
      error: SHIFT_WASTE_QUANTITY_INVALID,
    })
    expect(
      resolveShiftWasteRouting(warehouse, [{ quantity: Number.NaN }], undefined, lineRoute),
    ).toEqual({
      ok: false,
      error: SHIFT_WASTE_QUANTITY_INVALID,
    })
  })

  it('confirms zero waste without scrap setup and filters zero rows', () => {
    const production = makeProduction()
    const warehouse = makeWarehouse()
    const input = reportInput({
      scrapLocationId: 'missing-location',
      wasteLines: [
        {
          lineId: 'zero-waste',
          itemId: 'item-raw',
          quantity: 0,
          unitSnapshot: 'kg',
          reasonCode: '',
        },
      ],
    })

    const confirmed = confirmProductionShiftReport(production, warehouse, input)

    expect(confirmed.result.ok).toBe(true)
    expect(confirmed.result.report?.scrapLocationId).toBeUndefined()
    expect(confirmed.result.report?.wasteLines).toEqual([])
    expect(confirmed.result.report?.wasteTransferPairId).toBeUndefined()
    expect(
      confirmed.warehouse.documents.filter(
        (document) => document.purpose === 'production_waste_transfer',
      ),
    ).toEqual([])
    expect(stockBalance(confirmed.warehouse, 'item-raw', 'line-location')).toBe(10)
    expect(stockBalance(confirmed.warehouse, 'item-wip', 'pack-location')).toBe(10)
  })

  it('rejects positive waste without scrap before changing either store', () => {
    const production = makeProduction()
    const warehouse = makeWarehouse()
    const confirmed = confirmProductionShiftReport(
      production,
      warehouse,
      reportInput({ wasteQty: 2 }),
    )

    expect(confirmed.result).toEqual({ ok: false, error: SHIFT_SCRAP_LOCATION_INVALID })
    expect(confirmed.production).toBe(production)
    expect(confirmed.warehouse).toBe(warehouse)
  })

  it('removes actual input exactly once while routing positive waste', () => {
    const warehouse = makeWarehouse({ withScrap: true })
    const confirmed = confirmProductionShiftReport(
      makeProduction(),
      warehouse,
      reportInput({ wasteQty: 2, scrapLocationId: 'scrap-location' }),
    )

    expect(confirmed.result.ok).toBe(true)
    expect(stockBalance(warehouse, 'item-raw', 'line-location')).toBe(20)
    expect(stockBalance(confirmed.warehouse, 'item-raw', 'line-location')).toBe(10)
    expect(stockBalance(confirmed.warehouse, 'item-raw', 'scrap-location')).toBe(2)

    const consumption = confirmed.warehouse.documents.find(
      (document) => document.purpose === 'production_consumption',
    )
    const wasteIssue = confirmed.warehouse.documents.find(
      (document) =>
        document.purpose === 'production_waste_transfer' &&
        document.docRole === 'production_waste_issue',
    )
    expect(consumption?.lines[0]?.quantity).toBe(8)
    expect(wasteIssue?.lines[0]?.quantity).toBe(2)
    expect((consumption?.lines[0]?.quantity ?? 0) + (wasteIssue?.lines[0]?.quantity ?? 0)).toBe(10)
  })

  it('keeps missing and dangling line bindings blocked before warehouse writes', () => {
    const production = makeProduction()
    const warehouse = makeWarehouse()
    const withoutLine = {
      ...warehouse,
      productionLineBindings: warehouse.productionLineBindings?.filter(
        (binding) => binding.lineId !== '1',
      ),
    }
    const missing = confirmProductionShiftReport(production, withoutLine, reportInput())
    expect(missing.result).toEqual({ ok: false, error: LINE_LOCATION_NOT_CONFIGURED })
    expect(missing.warehouse).toBe(withoutLine)

    const dangling = upsertProductionLineBinding(warehouse, {
      lineId: '1',
      productionWarehouseId: 'line-location',
      productionLocationId: 'unknown-location',
    })
    const unresolved = confirmProductionShiftReport(production, dangling, reportInput())
    expect(unresolved.result).toEqual({ ok: false, error: LINE_LOCATION_MISSING })
    expect(unresolved.warehouse).toBe(dangling)
  })

  it('prevalidates positive-waste corrections before creating reversal documents', () => {
    const first = confirmProductionShiftReport(
      makeProduction(),
      makeWarehouse(),
      reportInput({ idempotencyKey: 'original-zero-waste' }),
    )
    expect(first.result.ok).toBe(true)
    const original = first.result.report
    if (!original) throw new Error('original shift report missing')

    const correctionInput = reportInput({ wasteQty: 2, idempotencyKey: 'correction-needs-scrap' })
    const beforeDocuments = first.warehouse.documents.length
    const beforeMovements = first.warehouse.movements.length
    const failed = confirmShiftReportCorrection(first.production, first.warehouse, {
      ...correctionInput,
      report: {
        ...correctionInput.report,
        id: undefined,
        number: undefined,
      },
      originalReportId: original.id,
      correctionReason: 'recount with waste',
    })

    expect(failed.result).toEqual({ ok: false, error: SHIFT_SCRAP_LOCATION_INVALID })
    expect(failed.production).toBe(first.production)
    expect(failed.warehouse).toBe(first.warehouse)
    expect(failed.warehouse.documents).toHaveLength(beforeDocuments)
    expect(failed.warehouse.movements).toHaveLength(beforeMovements)
    expect(
      failed.warehouse.documents.some(
        (document) => document.basisType === 'production_shift_report_correction',
      ),
    ).toBe(false)
  })

  it('replays a zero-waste correction without a second reversal or post', () => {
    const first = confirmProductionShiftReport(
      makeProduction(),
      makeWarehouse(),
      reportInput({ idempotencyKey: 'original-for-replay' }),
    )
    expect(first.result.ok).toBe(true)
    const original = first.result.report
    if (!original) throw new Error('original shift report missing')

    const correctionInput = reportInput({ idempotencyKey: 'correction-replay' })
    const request = {
      ...correctionInput,
      report: {
        ...correctionInput.report,
        id: undefined,
        number: undefined,
        scrapLocationId: undefined,
        wasteLines: [],
      },
      originalReportId: original.id,
      correctionReason: 'verified recount',
    }
    const corrected = confirmShiftReportCorrection(first.production, first.warehouse, request)
    expect(corrected.result.ok).toBe(true)
    expect(corrected.result.report?.scrapLocationId).toBeUndefined()
    expect(corrected.result.report?.wasteLines).toEqual([])

    const counts = {
      reports: corrected.production.shiftReports?.length,
      documents: corrected.warehouse.documents.length,
      movements: corrected.warehouse.movements.length,
      audit: corrected.warehouse.auditLog.length,
    }
    const replayed = confirmShiftReportCorrection(corrected.production, corrected.warehouse, request)

    expect(replayed.result.ok).toBe(true)
    expect(replayed.result.idempotent).toBe(true)
    expect(replayed.production.shiftReports).toHaveLength(counts.reports ?? 0)
    expect(replayed.warehouse.documents).toHaveLength(counts.documents)
    expect(replayed.warehouse.movements).toHaveLength(counts.movements)
    expect(replayed.warehouse.auditLog).toHaveLength(counts.audit)

    const conflicting = confirmShiftReportCorrection(corrected.production, corrected.warehouse, {
      ...request,
      report: { ...request.report, outputM2: 12 },
    })
    expect(conflicting.result).toEqual({
      ok: false,
      error: 'production.shift.errIdempotencyConflict',
    })
    expect(conflicting.production).toBe(corrected.production)
    expect(conflicting.warehouse).toBe(corrected.warehouse)
  })

  it('preserves the configured scrap location while normalizing persisted state', () => {
    const warehouse = makeWarehouse({ withScrap: true })
    expect(normalizeWarehouse(warehouse).scrapLocationId).toBe('scrap-location')
  })
})
