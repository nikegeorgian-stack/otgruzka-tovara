import { describe, expect, it, beforeEach } from 'vitest'
import { createDefaultStore } from '@/lib/storage'
import type { AppStore } from '@/lib/types'
import type { AccessStore, AppUser } from '@/lib/access/types'
import { DEFAULT_ROLE_VIEWS } from '@/lib/access/roles'
import {
  clearProductionCycleContext,
  deriveProductionCycle,
  loadProductionCycleContext,
  mergeProductionCycleContext,
  roleCanReachStageView,
  saveProductionCycleContext,
  resolveCurrentProductionCycleStage,
} from '@/lib/productionCycle'
import type { ProductionOrder } from '@/lib/planner/types'
import type { SalesOrder } from '@/lib/sales/types'
import type { FinishedGoodsLot } from '@/lib/production/finishedGoodsLots'
import type { ProductionPackagingReport } from '@/lib/production/packagingReports'
import type { LoadingShipment } from '@/lib/warehouse/types'

function baseStore(): AppStore {
  return createDefaultStore() as AppStore
}

function withAccess(store: AppStore, roleViews = DEFAULT_ROLE_VIEWS): AppStore {
  return {
    ...store,
    access: {
      ...store.access,
      roleViews: { ...roleViews },
    },
  }
}

function salesOrder(partial: Partial<SalesOrder> & Pick<SalesOrder, 'id' | 'orderNumber'>): SalesOrder {
  const now = '2026-09-08T10:00:00.000Z'
  return {
    customer: 'Celloplex',
    status: 'confirmed',
    commercialStatus: 'confirmed',
    fulfillmentStatus: 'unplanned',
    priority: 'normal',
    orderDate: '2026-09-08',
    lines: [
      {
        id: 'line-1',
        finishedProductId: 'fp-1',
        productName: 'Celloplex 75',
        category: 'ratl1',
        qtyMp: 12.5,
        qtyAreaM2: 12.5,
        productionOrderIds: [],
      },
    ],
    history: [],
    createdAt: now,
    updatedAt: now,
    ...partial,
  }
}

function productionOrder(
  partial: Partial<ProductionOrder> & Pick<ProductionOrder, 'id' | 'orderNumber'>,
): ProductionOrder {
  const now = '2026-09-08T10:00:00.000Z'
  return {
    customer: 'Celloplex',
    productName: 'Celloplex 75',
    finishedProductId: 'fp-1',
    category: 'ratl1',
    totalQtyMp: 12.5,
    startDate: '2026-09-01',
    endDate: '2026-09-10',
    lineId: 'line1',
    priority: 'normal',
    status: 'active',
    planMode: 'even',
    recalcMode: 'auto',
    dayPlans: [],
    history: [],
    createdAt: now,
    updatedAt: now,
    packagingRecipeId: 'pack-1',
    formulationRecipeId: 'form-1',
    ...partial,
  }
}

function lot(partial: Partial<FinishedGoodsLot> & Pick<FinishedGoodsLot, 'id' | 'batchNo' | 'productionOrderId'>): FinishedGoodsLot {
  const now = '2026-09-08T10:00:00.000Z'
  return {
    warehouseItemId: 'wh-fg-1',
    finishedProductId: 'fp-1',
    packagingReportId: 'pack-rep-1',
    sourceShiftReportIds: [],
    outputM2: 12.5,
    rollCount: 1,
    palletCount: 1,
    packagingDate: '2026-09-08',
    warehouseId: 'wh-1',
    locationId: 'loc-1',
    qcStatus: 'pending',
    quantityProduced: 12.5,
    quantityQcReleased: 0,
    quantityShipped: 0,
    quantityRemaining: 0,
    createdAt: now,
    updatedAt: now,
    transactionGroupId: 'tg-1',
    ...partial,
  }
}

function packagingReport(
  partial: Partial<ProductionPackagingReport> & Pick<ProductionPackagingReport, 'id' | 'number' | 'productionOrderId'>,
): ProductionPackagingReport {
  const now = '2026-09-08T10:00:00.000Z'
  return {
    status: 'confirmed',
    lineId: 'pack',
    shiftDate: '2026-09-08',
    shift: 'day',
    packagingLocationId: 'loc-pack',
    finishedProductId: 'fp-1',
    warehouseItemId: 'wh-fg-1',
    semiFinishedItemId: 'wh-wip-1',
    materialLines: [],
    wipLines: [],
    outputM2: 12.5,
    rollCount: 1,
    palletCount: 1,
    batchNo: 'B-1',
    createdAt: now,
    updatedAt: now,
    confirmedAt: now,
    idempotencyKey: 'ik-1',
    ...partial,
  }
}

function loading(
  partial: Partial<LoadingShipment> & Pick<LoadingShipment, 'id' | 'number' | 'salesOrderId'>,
): LoadingShipment {
  return {
    date: '2026-09-08',
    warehouseId: 'wh-1',
    containerId: 'c45',
    payloadKg: 1000,
    palletPlacesLimit: 20,
    counterpartyName: 'Celloplex',
    orderNo: 'ЗК-2026-001',
    lines: [],
    totalsRolls: 0,
    totalsNetKg: 0,
    totalsGrossKg: 0,
    totalsAreaM2: 0,
    status: 'draft',
    createdAt: '2026-09-08T10:00:00.000Z',
    updatedAt: '2026-09-08T10:00:00.000Z',
    ...partial,
  }
}

function canonicalWipStore(): AppStore {
  const store = baseStore()
  const now = '2026-09-10T12:00:00.000Z'
  const po = productionOrder({
    id: 'po-c',
    orderNumber: 'ЗП-2026-C',
    salesOrderId: 'so-c',
    salesLineId: 'line-c',
    lineId: '1',
    formulationRecipeId: 'recipe-c',
    impregnationOutputItemId: 'imp-c',
    semiFinishedItemId: 'wip-c',
    warehouseItemId: 'fg-item-c',
    rawMaterialItemId: 'raw-c',
    finishedProductId: 'fp-c',
    wipContractVersion: 1,
    recipeNormSnapshot: {
      recipeId: 'recipe-c',
      recipeVersionId: 'recipe-version-c',
      versionNumber: 1,
      contentHash: 'recipe-hash-c',
      normBase: 'per_batch',
      batchSize: 10,
      components: [],
      snappedAt: now,
    },
  })
  const order = salesOrder({
    id: 'so-c',
    orderNumber: 'ЗК-2026-001',
    status: 'completed',
    commercialStatus: 'completed',
    fulfillmentStatus: 'shipped',
    lines: [
      {
        id: 'line-c',
        finishedProductId: 'fp-c',
        productName: 'Celloplex 160',
        category: 'cat4',
        qtyMp: 12.5,
        qtyAreaM2: 12.5,
        productionOrderIds: ['po-c'],
      },
    ],
  })
  const report = {
    id: 'shift-c',
    number: 'СМ-2026-C',
    status: 'confirmed' as const,
    productionOrderId: 'po-c',
    lineId: '1' as const,
    shiftDate: '2026-09-10',
    shift: 'day' as const,
    recipeNormSnapshot: po.recipeNormSnapshot!,
    productionLocationId: 'line-loc-c',
    packagingLocationId: 'pack-loc-c',
    materialLines: [
      {
        lineId: 'shift-input-c',
        itemId: 'imp-c',
        unitSnapshot: 'kg',
        normQty: 10,
        actualInputQty: 10,
        wasteQty: 0,
        processConsumedQty: 10,
        deviationQty: 0,
        deviationPct: 0,
        tolerancePct: 1,
        batchNo: 'B-C',
        batchRunId: 'run-c',
      },
    ],
    wasteLines: [],
    outputM2: 12.5,
    rollCount: 1,
    semiFinishedItemId: 'wip-c',
    wipContractVersion: 1 as const,
    impregnationQcDecisionId: 'qc-c',
    batchRunId: 'run-c',
    wipReceiptDocumentId: 'shift-receipt-c',
    createdAt: now,
    updatedAt: now,
    confirmedAt: now,
    idempotencyKey: 'shift-key-c',
  }
  const pack = packagingReport({
    id: 'pack-c',
    number: 'УП-2026-C',
    productionOrderId: 'po-c',
    finishedProductId: 'fp-c',
    warehouseItemId: 'fg-item-c',
    semiFinishedItemId: 'wip-c',
    wipContractVersion: 1,
    sourceShiftReportIds: ['shift-c'],
    wipLines: [
      {
        lineId: 'pack-wip-c',
        shiftReportId: 'shift-c',
        productionOrderId: 'po-c',
        semiFinishedItemId: 'wip-c',
        itemId: 'wip-c',
        receiptDocumentId: 'shift-receipt-c',
        quantity: 12.5,
        unitSnapshot: 'm2',
      },
    ],
    finishedGoodsLotId: 'lot-c',
  })
  ;(pack as ProductionPackagingReport & { documentIds?: string[] }).documentIds = [
    'fg-receipt-c',
  ]
  const finishedLot = lot({
    id: 'lot-c',
    batchNo: 'FG-C',
    productionOrderId: 'po-c',
    packagingReportId: 'pack-c',
    finishedProductId: 'fp-c',
    warehouseItemId: 'fg-item-c',
    wipContractVersion: 1,
    sourceShiftReportIds: ['shift-c'],
    qcStatus: 'released',
    serverQcDecisionId: 'fg-qc-c',
    serverQcDecisionStatus: 'released',
    quantityQcReleased: 12.5,
    quantityShipped: 12.5,
    quantityRemaining: 0,
  })
  const shipment = loading({
    id: 'shipment-c',
    number: 'ПГ-2026-C',
    salesOrderId: 'so-c',
    salesLineId: 'line-c',
    status: 'posted',
    finishedGoodsLotId: 'lot-c',
    finishedProductId: 'fp-c',
    warehouseItemId: 'fg-item-c',
    warehouseId: 'wh-1',
    locationId: 'loc-1',
    lotNumber: 'FG-C',
    quantity: 12.5,
    documentIds: ['shipment-doc-c'],
  })
  const document = (
    id: string,
    type: 'receipt' | 'issue' | 'reservation',
    extra: Record<string, unknown>,
  ) => ({
    id,
    type,
    number: id,
    date: '2026-09-10',
    warehouseId: 'wh-c',
    status: 'posted',
    lines: [],
    source: 'json',
    ...extra,
  })

  return {
    ...store,
    sales: { ...store.sales, orders: [order] },
    procurement: {
      ...store.procurement,
      orders: [
        {
          id: 'purchase-c',
          orderNumber: 'ЗЗ-2026-001',
          counterpartyId: 'supplier-c',
          scope: 'domestic',
          category: 'raw_materials',
          status: 'received',
          orderDate: '2026-09-10',
          lines: [
            {
              id: 'purchase-line-c',
              warehouseItemId: 'raw-c',
              name: 'Raw C',
              quantity: 10,
              unit: 'kg',
              receivedQty: 10,
            },
          ],
          legs: [],
          milestones: [],
          statusHistory: [],
          attachments: [],
          warehouseDocumentIds: ['procurement-receipt-c'],
          createdAt: now,
          updatedAt: now,
        },
      ],
    },
    formulations: {
      ...store.formulations,
      mixTasks: [
        {
          id: 'task-c',
          taskNumber: 'ЗД-2026-C',
          recipeId: 'recipe-c',
          recipeCode: 'РП-C',
          recipeName: 'Impregnation C',
          targetVolumeL: 10,
          plannedDate: '2026-09-10',
          lineId: '1',
          status: 'done',
          sourceOrderId: 'po-c',
          batchRunId: 'run-c',
          createdAt: now,
          updatedAt: now,
        },
      ],
      batchRuns: [
        {
          id: 'run-c',
          documentNumber: 'B-C',
          mixTaskId: 'task-c',
          productionOrderId: 'po-c',
          productionLineId: '1',
          status: 'confirmed',
          recipeId: 'recipe-c',
          recipeCode: 'РП-C',
          recipeName: 'Impregnation C',
          targetVolumeL: 10,
          scaleFactor: 1,
          lines: [],
          outputWarehouseItemId: 'imp-c',
          outputKg: 10,
          warehouseId: 'wh-c',
          mixedAt: '2026-09-10',
          mixedBy: 'mixer-c',
          mixedByName: 'Mixer C',
          issueDocumentId: 'batch-issue-c',
          receiptDocumentId: 'batch-receipt-c',
          confirmedAt: now,
          createdAt: now,
        },
      ],
    },
    production: {
      ...store.production,
      planner: { ...store.production.planner, orders: [po] },
      impregnationQcDecisions: [
        {
          id: 'qc-c',
          decisionKey: 'impregnation-qc:run-c:v1',
          decisionRevision: 1,
          decision: 'approved',
          labStatus: 'pending',
          decisionMethod: 'edu_manual_visual',
          visualOk: true,
          productionOrderId: 'po-c',
          productionLineId: '1',
          batchRunId: 'run-c',
          batchNo: 'B-C',
          batchIssueDocumentId: 'batch-issue-c',
          batchReceiptDocumentId: 'batch-receipt-c',
          outputWarehouseItemId: 'imp-c',
          outputQuantity: 10,
          effective: true,
        },
      ],
      shiftReports: [report],
      packagingReports: [pack],
      finishedGoodsLots: [finishedLot],
    },
    warehouse: {
      ...store.warehouse,
      documents: [
        document('procurement-receipt-c', 'receipt', {
          purchaseOrderId: 'purchase-c',
          purpose: 'purchase',
          docRole: 'procurement_receipt',
          lines: [{ lineId: 'proc-line-c', itemId: 'raw-c', quantity: 10 }],
        }),
        document('handoff-issue-c', 'issue', {
          purpose: 'production_issue',
          docRole: 'transfer_issue',
          transferPairId: 'handoff-pair-c',
          productionOrderId: 'po-c',
          productionLineId: '1',
          lines: [
            {
              lineId: 'handoff-issue-line-c',
              itemId: 'raw-c',
              quantity: 10,
              productionOrderId: 'po-c',
              productionLineId: '1',
            },
          ],
        }),
        document('handoff-receipt-c', 'receipt', {
          purpose: 'production_receipt',
          docRole: 'transfer_receipt',
          transferPairId: 'handoff-pair-c',
          productionOrderId: 'po-c',
          productionLineId: '1',
          lines: [
            {
              lineId: 'handoff-receipt-line-c',
              itemId: 'raw-c',
              quantity: 10,
              productionOrderId: 'po-c',
              productionLineId: '1',
            },
          ],
        }),
        document('batch-issue-c', 'issue', {
          docRole: 'batch_issue',
          batchRunId: 'run-c',
          productionOrderId: 'po-c',
          productionLineId: '1',
          lines: [{ lineId: 'batch-issue-line-c', itemId: 'chem-c', quantity: 10 }],
        }),
        document('batch-receipt-c', 'receipt', {
          docRole: 'batch_receipt',
          batchRunId: 'run-c',
          productionOrderId: 'po-c',
          productionLineId: '1',
          lines: [
            {
              lineId: 'batch-receipt-line-c',
              itemId: 'imp-c',
              quantity: 10,
              batchRunId: 'run-c',
              productionOrderId: 'po-c',
              productionLineId: '1',
            },
          ],
        }),
        document('shift-receipt-c', 'receipt', {
          docRole: 'production_wip_receipt',
          productionOrderId: 'po-c',
          productionLineId: '1',
          shiftReportId: 'shift-c',
        }),
        document('fg-receipt-c', 'receipt', {
          docRole: 'production_fg_receipt',
          productionOrderId: 'po-c',
          packagingReportId: 'pack-c',
          finishedGoodsLotId: 'lot-c',
        }),
        document('shipment-doc-c', 'issue', {
          docRole: 'finished_goods_shipment',
          warehouseId: 'wh-1',
          shipmentId: 'shipment-c',
          salesOrderId: 'so-c',
          salesLineId: 'line-c',
          finishedGoodsLotId: 'lot-c',
          lines: [
            {
              lineId: 'shipment-doc-line-c',
              itemId: 'fg-item-c',
              quantity: 12.5,
              batchNo: 'FG-C',
              locationId: 'loc-1',
            },
          ],
        }),
      ] as AppStore['warehouse']['documents'],
      movements: [
        {
          id: 'shipment-movement-c',
          itemId: 'fg-item-c',
          warehouseId: 'wh-1',
          locationId: 'loc-1',
          type: 'issue',
          quantity: 12.5,
          batchNo: 'FG-C',
          date: '2026-09-10',
          documentId: 'shipment-doc-c',
          shipmentId: 'shipment-c',
          salesOrderId: 'so-c',
          salesLineId: 'line-c',
          finishedGoodsLotId: 'lot-c',
          createdAt: now,
        },
      ],
      loadingShipments: [shipment],
    },
  }
}

describe('productionCycle derive — current stage & next action', () => {
  it('starts at production_order when sales confirmed but no ЗП', () => {
    let store = baseStore()
    store = {
      ...store,
      sales: {
        ...store.sales,
        orders: [salesOrder({ id: 'so-1', orderNumber: 'ЗК-2026-001' })],
      },
    }
    const snap = deriveProductionCycle(store, { salesOrderId: 'so-1' })
    expect(snap).not.toBeNull()
    expect(snap!.subject.title).toBe('ЗК-2026-001')
    expect(snap!.currentStageId).toBe('recipe')
    // without PO, recipe missing → current is recipe (first incomplete)
    expect(snap!.nextAction?.stageId).toBe('recipe')
    expect(snap!.nextAction?.actionKey).toBe('productionCycle.action.recipe')
    // Confirmed ЗК already done; later stages wait / earlier recipe is current
    expect(snap!.stages.find((s) => s.id === 'sales')?.state).toBe('done')
    expect(snap!.stages.find((s) => s.id === 'loading')?.state).toBe('waiting')
  })

  it('with PO+recipe advances past recipe; sales already done', () => {
    let store = baseStore()
    const po = productionOrder({
      id: 'po-1',
      orderNumber: 'ЗП-2026-010',
      salesOrderId: 'so-1',
    })
    store = {
      ...store,
      sales: {
        ...store.sales,
        orders: [salesOrder({ id: 'so-1', orderNumber: 'ЗК-2026-001' })],
      },
      production: {
        ...store.production,
        planner: { ...store.production.planner, orders: [po] },
      },
    }
    const current = resolveCurrentProductionCycleStage(store, { salesOrderId: 'so-1' })
    // procurement/receipt may be first incomplete after recipe+PO
    expect(['procurement', 'receipt', 'material_issue', 'mixer', 'impregnation', 'line']).toContain(
      current,
    )
    const snap = deriveProductionCycle(store, { salesOrderId: 'so-1' })!
    expect(snap.stages.find((s) => s.id === 'recipe')?.state).toBe('done')
    expect(snap.stages.find((s) => s.id === 'production_order')?.state).toBe('done')
    expect(snap.stages.find((s) => s.id === 'sales')?.evidence.refLabel).toBe('ЗК-2026-001')
    expect(snap.subject.productionOrderNumber).toBe('ЗП-2026-010')
  })

  it('packaging confirmed + pending OTC → current/blocked at otc', () => {
    let store = baseStore()
    const po = productionOrder({ id: 'po-1', orderNumber: 'ЗП-1', salesOrderId: 'so-1' })
    store = {
      ...store,
      sales: {
        ...store.sales,
        orders: [salesOrder({ id: 'so-1', orderNumber: 'ЗК-1' })],
      },
      production: {
        ...store.production,
        planner: { ...store.production.planner, orders: [po] },
        packagingReports: [packagingReport({ id: 'pr-1', number: 'УП-1', productionOrderId: 'po-1' })],
        finishedGoodsLots: [
          lot({ id: 'lot-1', batchNo: 'BATCH-9', productionOrderId: 'po-1', qcStatus: 'pending' }),
        ],
        shiftReports: [
          {
            id: 'sr-1',
            number: 'СМ-1',
            status: 'confirmed',
            productionOrderId: 'po-1',
            lineId: 'line1',
            shiftDate: '2026-09-08',
            shift: 'day',
            recipeNormSnapshot: {} as never,
            productionLocationId: 'loc-p',
            packagingLocationId: 'loc-pack',
            scrapLocationId: 'loc-s',
            materialLines: [],
            wasteLines: [],
            outputM2: 12.5,
            rollCount: 1,
            semiFinishedItemId: 'wip-1',
            createdAt: '2026-09-08T10:00:00.000Z',
            updatedAt: '2026-09-08T10:00:00.000Z',
            idempotencyKey: 'ik',
          },
        ],
      },
    }
    const snap = deriveProductionCycle(store, { salesOrderId: 'so-1' })!
    expect(snap.stages.find((s) => s.id === 'packaging')?.state).toBe('done')
    expect(snap.currentStageId).toBe('otc')
    expect(snap.nextAction?.blocked).toBe(true)
    expect(snap.nextAction?.missingConditionKey).toBe('productionCycle.missing.otcPending')
    expect(snap.stages.find((s) => s.id === 'otc')?.evidence.refLabel).toBe('BATCH-9')
  })
})

describe('productionCycle role rights', () => {
  it('warehouse_keeper can reach warehouse stages but not mixer', () => {
    const store = withAccess(baseStore())
    expect(roleCanReachStageView(store.access, 'warehouse_keeper', 'loading')).toBe(true)
    expect(roleCanReachStageView(store.access, 'warehouse_keeper', 'mixer')).toBe(false)
    expect(roleCanReachStageView(store.access, 'mixer', 'mixer')).toBe(true)
    expect(roleCanReachStageView(store.access, 'otc', 'otc')).toBe(true)
    expect(roleCanReachStageView(store.access, 'sales_dispatcher', 'sales')).toBe(true)
  })

  it('nextAction.canNavigate follows canAccessView for persona', () => {
    let store = withAccess(baseStore())
    store = {
      ...store,
      sales: {
        ...store.sales,
        orders: [salesOrder({ id: 'so-1', orderNumber: 'ЗК-1', status: 'draft', commercialStatus: 'draft' })],
      },
    }
    const access = store.access as AccessStore
    const mixerUser: AppUser = {
      id: 'u-mixer',
      login: 'mixer',
      displayName: 'Mixer',
      roleId: 'mixer',
      active: true,
      passwordHash: 'x',
      passwordSalt: 'y',
    }
    const snap = deriveProductionCycle(store, { salesOrderId: 'so-1' }, { access, user: mixerUser })!
    // first incomplete is recipe (no PO) — mixer cannot open technologist
    expect(snap.nextAction?.stageId).toBe('recipe')
    expect(snap.nextAction?.canNavigate).toBe(false)
    expect(snap.nextAction?.viewId).toBe('technologist')
  })
})

describe('productionCycle blocked conditions', () => {
  it('draft loading blocks shipment with document number', () => {
    let store = baseStore()
    const po = productionOrder({ id: 'po-1', orderNumber: 'ЗП-1', salesOrderId: 'so-1' })
    store = {
      ...store,
      sales: {
        ...store.sales,
        orders: [
          salesOrder({
            id: 'so-1',
            orderNumber: 'ЗК-1',
            status: 'confirmed',
            fulfillmentStatus: 'ready_to_ship',
          }),
        ],
      },
      production: {
        ...store.production,
        planner: { ...store.production.planner, orders: [po] },
        packagingReports: [packagingReport({ id: 'pr-1', number: 'УП-1', productionOrderId: 'po-1' })],
        finishedGoodsLots: [
          lot({
            id: 'lot-1',
            batchNo: 'B-1',
            productionOrderId: 'po-1',
            qcStatus: 'released',
            serverQcDecisionStatus: 'released',
            quantityQcReleased: 12.5,
            quantityRemaining: 12.5,
          }),
        ],
        shiftReports: [
          {
            id: 'sr-1',
            number: 'СМ-1',
            status: 'confirmed',
            productionOrderId: 'po-1',
            lineId: 'line1',
            shiftDate: '2026-09-08',
            shift: 'day',
            recipeNormSnapshot: {} as never,
            productionLocationId: 'loc-p',
            packagingLocationId: 'loc-pack',
            scrapLocationId: 'loc-s',
            materialLines: [],
            wasteLines: [],
            outputM2: 12.5,
            rollCount: 1,
            semiFinishedItemId: 'wip-1',
            createdAt: '2026-09-08T10:00:00.000Z',
            updatedAt: '2026-09-08T10:00:00.000Z',
            idempotencyKey: 'ik',
          },
        ],
      },
      warehouse: {
        ...store.warehouse,
        loadingShipments: [loading({ id: 'ls-1', number: 'ПГ-1', salesOrderId: 'so-1', status: 'draft' })],
      },
    }
    const snap = deriveProductionCycle(store, { salesOrderId: 'so-1' })!
    expect(snap.currentStageId).toBe('shipment')
    expect(snap.nextAction?.blocked).toBe(true)
    expect(snap.nextAction?.missingConditionParams?.doc).toBe('ПГ-1')
  })
})

describe('productionCycle context persistence', () => {
  beforeEach(() => {
    clearProductionCycleContext()
  })

  it('saves and reloads selected order across interface switch', () => {
    saveProductionCycleContext({ salesOrderId: 'so-keep', productionOrderId: 'po-keep' })
    const loaded = loadProductionCycleContext()
    expect(loaded).toEqual({ salesOrderId: 'so-keep', productionOrderId: 'po-keep' })
    const merged = mergeProductionCycleContext(loaded, { lotId: 'lot-1' })
    expect(merged).toEqual({
      salesOrderId: 'so-keep',
      productionOrderId: 'po-keep',
      lotId: 'lot-1',
    })
  })
})

describe('productionCycle completed & cancelled', () => {
  it('does not let a posted shipment hide missing upstream evidence', () => {
    const store = {
      ...baseStore(),
      sales: {
        ...baseStore().sales,
        orders: [
          salesOrder({
            id: 'so-shortcut',
            orderNumber: 'ЗК-shortcut',
            status: 'completed',
            commercialStatus: 'completed',
            fulfillmentStatus: 'shipped',
          }),
        ],
      },
      warehouse: {
        ...baseStore().warehouse,
        loadingShipments: [
          loading({
            id: 'ls-shortcut',
            number: 'ПГ-shortcut',
            salesOrderId: 'so-shortcut',
            status: 'posted',
          }),
        ],
      },
    }

    const snap = deriveProductionCycle(store, { salesOrderId: 'so-shortcut' })!
    expect(snap.outcome).toBe('in_progress')
    expect(snap.currentStageId).toBe('recipe')
    expect(snap.stages.find((stage) => stage.id === 'recipe')?.state).toBe('current')
    expect(snap.stages.find((stage) => stage.id === 'shipment')?.state).toBe('done')
  })

  it('does not infer canonical mixer/QC evidence from downstream documents', () => {
    const base = baseStore()
    const po = productionOrder({
      id: 'po-v1',
      orderNumber: 'ЗП-v1',
      salesOrderId: 'so-v1',
      wipContractVersion: 1,
    })
    const store = {
      ...base,
      sales: {
        ...base.sales,
        orders: [
          salesOrder({
            id: 'so-v1',
            orderNumber: 'ЗК-v1',
            status: 'completed',
            commercialStatus: 'completed',
            fulfillmentStatus: 'shipped',
          }),
        ],
      },
      production: {
        ...base.production,
        planner: { ...base.production.planner, orders: [po] },
        shiftReports: [
          {
            id: 'sr-v1',
            number: 'СМ-v1',
            status: 'confirmed' as const,
            productionOrderId: 'po-v1',
            lineId: 'line1' as const,
            shiftDate: '2026-09-08',
            shift: 'day' as const,
            recipeNormSnapshot: {} as never,
            productionLocationId: 'loc-p',
            packagingLocationId: 'loc-pack',
            materialLines: [],
            wasteLines: [],
            outputM2: 12.5,
            rollCount: 1,
            semiFinishedItemId: 'wip-1',
            wipContractVersion: 1 as const,
            createdAt: '2026-09-08T10:00:00.000Z',
            updatedAt: '2026-09-08T10:00:00.000Z',
            idempotencyKey: 'ik-v1',
          },
        ],
        packagingReports: [
          packagingReport({ id: 'pr-v1', number: 'УП-v1', productionOrderId: 'po-v1' }),
        ],
        finishedGoodsLots: [
          lot({
            id: 'lot-v1',
            batchNo: 'B-v1',
            productionOrderId: 'po-v1',
            qcStatus: 'released',
            serverQcDecisionStatus: 'released',
            quantityQcReleased: 12.5,
            quantityShipped: 12.5,
            quantityRemaining: 0,
          }),
        ],
      },
      warehouse: {
        ...base.warehouse,
        loadingShipments: [
          loading({ id: 'ls-v1', number: 'ПГ-v1', salesOrderId: 'so-v1', status: 'posted' }),
        ],
      },
    }

    const snap = deriveProductionCycle(store, { salesOrderId: 'so-v1' })!
    expect(snap.outcome).toBe('in_progress')
    expect(snap.stages.find((stage) => stage.id === 'mixer')?.evidence.done).toBe(false)
    expect(snap.stages.find((stage) => stage.id === 'impregnation')?.evidence.done).toBe(false)
  })

  it('resolves a late sales order through its explicit production-order link', () => {
    const base = baseStore()
    const po = productionOrder({ id: 'po-linked', orderNumber: 'ЗП-linked' })
    const order = salesOrder({
      id: 'so-linked',
      orderNumber: 'ЗК-linked',
      lines: [
        {
          id: 'line-linked',
          finishedProductId: 'fp-1',
          productName: 'Celloplex 75',
          category: 'ratl1',
          qtyMp: 12.5,
          productionOrderIds: ['po-linked'],
        },
      ],
    })
    const store = {
      ...base,
      sales: { ...base.sales, orders: [order] },
      production: {
        ...base.production,
        planner: { ...base.production.planner, orders: [po] },
      },
    }

    const snap = deriveProductionCycle(store, { salesOrderId: 'so-linked' })!
    expect(snap.anchors.productionOrderId).toBe('po-linked')
    expect(snap.subject.productionOrderNumber).toBe('ЗП-linked')
  })

  it('posted shipment marks cycle completed', () => {
    let store = baseStore()
    const po = productionOrder({ id: 'po-1', orderNumber: 'ЗП-1', salesOrderId: 'so-1' })
    store = {
      ...store,
      sales: {
        ...store.sales,
        orders: [
          salesOrder({
            id: 'so-1',
            orderNumber: 'ЗК-1',
            status: 'completed',
            commercialStatus: 'completed',
            fulfillmentStatus: 'shipped',
          }),
        ],
      },
      production: {
        ...store.production,
        planner: { ...store.production.planner, orders: [po] },
        packagingReports: [packagingReport({ id: 'pr-1', number: 'УП-1', productionOrderId: 'po-1' })],
        finishedGoodsLots: [
          lot({
            id: 'lot-1',
            batchNo: 'B-1',
            productionOrderId: 'po-1',
            qcStatus: 'released',
            serverQcDecisionStatus: 'released',
            quantityQcReleased: 12.5,
            quantityShipped: 12.5,
            quantityRemaining: 0,
          }),
        ],
        shiftReports: [
          {
            id: 'sr-1',
            number: 'СМ-1',
            status: 'confirmed',
            productionOrderId: 'po-1',
            lineId: 'line1',
            shiftDate: '2026-09-08',
            shift: 'day',
            recipeNormSnapshot: {} as never,
            productionLocationId: 'loc-p',
            packagingLocationId: 'loc-pack',
            scrapLocationId: 'loc-s',
            materialLines: [],
            wasteLines: [],
            outputM2: 12.5,
            rollCount: 1,
            semiFinishedItemId: 'wip-1',
            createdAt: '2026-09-08T10:00:00.000Z',
            updatedAt: '2026-09-08T10:00:00.000Z',
            idempotencyKey: 'ik',
          },
        ],
      },
      warehouse: {
        ...store.warehouse,
        loadingShipments: [loading({ id: 'ls-1', number: 'ПГ-1', salesOrderId: 'so-1', status: 'posted' })],
      },
    }
    const snap = deriveProductionCycle(store, { salesOrderId: 'so-1' })!
    expect(snap.outcome).toBe('completed')
    expect(snap.currentStageId).toBeNull()
    expect(snap.stages.every((s) => s.state === 'done')).toBe(true)
    expect(snap.stages.find((s) => s.id === 'shipment')?.state).toBe('done')
  })

  it('cancelled sales order marks cycle cancelled', () => {
    let store = baseStore()
    store = {
      ...store,
      sales: {
        ...store.sales,
        orders: [
          salesOrder({
            id: 'so-1',
            orderNumber: 'ЗК-X',
            status: 'cancelled',
            commercialStatus: 'cancelled',
          }),
        ],
      },
    }
    const snap = deriveProductionCycle(store, { salesOrderId: 'so-1' })!
    expect(snap.outcome).toBe('cancelled')
    expect(snap.stages.every((s) => s.state === 'cancelled')).toBe(true)
    expect(snap.nextAction).toBeNull()
  })
})

describe('productionCycle WIP-v1 exact authoritative lineage', () => {
  const stageDone = (store: AppStore, stageId: string) =>
    deriveProductionCycle(store, { salesOrderId: 'so-c', productionOrderId: 'po-c' })!
      .stages.find((stage) => stage.id === stageId)?.evidence.done

  it('completes only the full exact PO → batch → QC → shift → pack → lot → sales-line → shipment chain', () => {
    const snap = deriveProductionCycle(canonicalWipStore(), {
      salesOrderId: 'so-c',
      productionOrderId: 'po-c',
      lotId: 'lot-c',
    })!

    expect(snap.outcome).toBe('completed')
    expect(snap.currentStageId).toBeNull()
    expect(snap.stages.map((stage) => [stage.id, stage.evidence.done])).toEqual(
      snap.stages.map((stage) => [stage.id, true]),
    )
    expect(snap.stages.find((stage) => stage.id === 'mixer')?.evidence.refLabel).toBe(
      'ЗД-2026-C',
    )
    expect(snap.stages.find((stage) => stage.id === 'shipment')?.evidence.refLabel).toBe(
      'ПГ-2026-C',
    )
  })

  it('does not accept a completed mixer task merely because it uses the same recipe', () => {
    const store = canonicalWipStore()
    store.formulations.mixTasks![0]!.sourceOrderId = 'po-unrelated'

    expect(stageDone(store, 'recipe')).toBe(true)
    expect(stageDone(store, 'mixer')).toBe(false)
    expect(stageDone(store, 'impregnation')).toBe(false)
    expect(deriveProductionCycle(store, { productionOrderId: 'po-c' })!.outcome).toBe(
      'in_progress',
    )
  })

  it('does not accept a generic posted expense as the production-order handoff', () => {
    const store = canonicalWipStore()
    store.warehouse.documents = store.warehouse.documents.filter(
      (document) => document.transferPairId !== 'handoff-pair-c',
    )
    store.warehouse.documents.push({
      id: 'generic-issue-c',
      type: 'issue',
      number: 'РС-generic-c',
      date: '2026-09-10',
      warehouseId: 'wh-c',
      purpose: 'production_issue',
      docRole: 'production_issue',
      productionOrderId: 'po-c',
      productionLineId: '1',
      status: 'posted',
      lines: [{ lineId: 'generic-line-c', itemId: 'raw-c', quantity: 10 }],
      source: 'json',
    })

    expect(stageDone(store, 'material_issue')).toBe(false)
    expect(deriveProductionCycle(store, { productionOrderId: 'po-c' })!.outcome).toBe(
      'in_progress',
    )
  })

  it('does not accept soft QC even when recipe and batch text look related', () => {
    const store = canonicalWipStore()
    store.production.impregnationQcDecisions = []
    store.technologistQc.impregnationQc = [
      {
        id: 'soft-qc-c',
        recipeId: 'recipe-c',
        recipeCode: 'РП-C',
        batchNumber: 'B-C',
        visualOk: true,
        gravimetric: { m0: null, m1: null, m2: null },
        nvTolerancePp: 1,
        computed: {
          nvPct: null,
          absDeviationPp: null,
          relDeviation: null,
          status: 'pass',
          summary: 'pass',
        },
        createdAt: '2026-09-10T12:00:00.000Z',
      },
    ]

    expect(stageDone(store, 'mixer')).toBe(true)
    expect(stageDone(store, 'impregnation')).toBe(false)
    expect(stageDone(store, 'line')).toBe(false)
  })

  it('does not accept a posted shipment for another lot, even under the same sales order', () => {
    const store = canonicalWipStore()
    const shipment = store.warehouse.loadingShipments![0]!
    shipment.finishedGoodsLotId = 'lot-unrelated'
    const shipmentDocument = store.warehouse.documents.find(
      (document) => document.id === 'shipment-doc-c',
    )!
    shipmentDocument.finishedGoodsLotId = 'lot-unrelated'
    store.warehouse.movements[0]!.finishedGoodsLotId = 'lot-unrelated'
    store.production.finishedGoodsLots!.push(
      lot({
        id: 'lot-unrelated',
        batchNo: 'FG-UNRELATED',
        productionOrderId: 'po-unrelated',
        packagingReportId: 'pack-unrelated',
        finishedProductId: 'fp-c',
        warehouseItemId: 'fg-item-c',
        qcStatus: 'released',
        serverQcDecisionId: 'fg-qc-unrelated',
        serverQcDecisionStatus: 'released',
        quantityQcReleased: 12.5,
        quantityShipped: 12.5,
        quantityRemaining: 0,
      }),
    )

    expect(stageDone(store, 'otc')).toBe(true)
    expect(stageDone(store, 'loading')).toBe(false)
    expect(stageDone(store, 'shipment')).toBe(false)
    expect(deriveProductionCycle(store, { productionOrderId: 'po-c' })!.outcome).toBe(
      'in_progress',
    )
  })

  it.each([
    ['recipe', (store: AppStore) => { store.production.planner.orders[0]!.recipeNormSnapshot = undefined }],
    ['procurement', (store: AppStore) => { store.procurement.orders = [] }],
    [
      'receipt',
      (store: AppStore) => {
        store.warehouse.documents = store.warehouse.documents.filter(
          (document) => document.id !== 'procurement-receipt-c',
        )
      },
    ],
    [
      'production_order',
      (store: AppStore) => {
        store.production.planner.orders[0]!.status = 'draft'
      },
    ],
    [
      'material_issue',
      (store: AppStore) => {
        store.warehouse.documents = store.warehouse.documents.filter(
          (document) => document.transferPairId !== 'handoff-pair-c',
        )
      },
    ],
    ['mixer', (store: AppStore) => { store.formulations.mixTasks = [] }],
    ['impregnation', (store: AppStore) => { store.production.impregnationQcDecisions = [] }],
    ['line', (store: AppStore) => { store.production.shiftReports = [] }],
    ['packaging', (store: AppStore) => { store.production.packagingReports = [] }],
    ['otc', (store: AppStore) => { store.production.finishedGoodsLots = [] }],
    [
      'sales',
      (store: AppStore) => {
        store.sales.orders[0]!.lines[0]!.productionOrderIds = []
      },
    ],
    ['loading', (store: AppStore) => { store.warehouse.loadingShipments = [] }],
    [
      'shipment',
      (store: AppStore) => {
        store.warehouse.loadingShipments![0]!.status = 'draft'
      },
    ],
  ])('keeps the cycle in progress when exact %s evidence is missing', (stageId, remove) => {
    const store = canonicalWipStore()
    remove(store)

    const snap = deriveProductionCycle(store, {
      salesOrderId: 'so-c',
      productionOrderId: 'po-c',
    })!
    expect(snap.outcome).toBe('in_progress')
    expect(snap.stages.find((stage) => stage.id === stageId)?.evidence.done).toBe(false)
  })
})
