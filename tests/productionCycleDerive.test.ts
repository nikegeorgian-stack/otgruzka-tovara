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
