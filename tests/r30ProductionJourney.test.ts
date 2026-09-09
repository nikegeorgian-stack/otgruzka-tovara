/**
 * R3.0 — Production journey UX safety gate.
 * Pure derivation from existing store fields; no writes / no schema changes.
 */
import { describe, expect, it } from 'vitest'
import { createDefaultStore } from '@/lib/storage'
import type { AppStore } from '@/lib/types'
import type { AccessStore, AppUser } from '@/lib/access/types'
import { DEFAULT_ROLE_VIEWS } from '@/lib/access/roles'
import { ROUTABLE_VIEWS, viewToHash } from '@/lib/nav/viewRouting'
import { ProductionJourneyPanel } from '@/components/productionCycle'
import {
  PRODUCTION_CYCLE_STAGE_IDS,
  PRODUCTION_CYCLE_STAGE_META,
  clearProductionCycleContext,
  deriveProductionJourney,
  displayCycleRef,
  loadProductionCycleContext,
  mergeProductionCycleContext,
  roleCanReachStageView,
  saveProductionCycleContext,
} from '@/lib/productionCycle'
import { ru } from '@/i18n/ru'
import { en } from '@/i18n/en'
import { ka } from '@/i18n/ka'
import type { ProductionOrder } from '@/lib/planner/types'
import type { SalesOrder } from '@/lib/sales/types'

function baseStore(): AppStore {
  return createDefaultStore() as AppStore
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
    ...partial,
  }
}

describe('R3.0 productionJourney fail-safes', () => {
  it('empty / missing G2–G5 domains does not throw', () => {
    const empty = {} as AppStore
    expect(() => deriveProductionJourney(empty, {})).not.toThrow()
    expect(deriveProductionJourney(empty, {})).toBeNull()

    const dangling = deriveProductionJourney(empty, {
      salesOrderId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    })
    expect(dangling).not.toBeNull()
    expect(dangling!.subject.title).toBe('aaaaaaaa…')
    expect(dangling!.outcome).toBe('in_progress')
    expect(dangling!.stages).toHaveLength(PRODUCTION_CYCLE_STAGE_IDS.length)
  })

  it('store without sales/production/warehouse/procurement still derives', () => {
    const store = {
      version: 6,
      sales: undefined,
      production: undefined,
      warehouse: undefined,
      procurement: undefined,
      formulations: undefined,
      technologistQc: undefined,
      finishedProducts: undefined,
    } as unknown as AppStore
    const snap = deriveProductionJourney(store, { productionOrderId: 'missing-po' })
    expect(snap).not.toBeNull()
    expect(snap!.nextAction).not.toBeNull()
    expect(snap!.stages.every((s) => s.state === 'cancelled' || s.state === 'done' || s.state === 'current' || s.state === 'blocked' || s.state === 'waiting')).toBe(
      true,
    )
  })

  it('legacy rows without names/dates/links use technical fallback only', () => {
    let store = baseStore()
    const longId = 'fgl-4b6d5547-2138-4ee0-b23b-c91d87b2b060'
    const po = productionOrder({
      id: longId,
      orderNumber: '',
      productName: '',
      customer: '',
      salesOrderId: undefined,
      packagingRecipeId: undefined,
      formulationRecipeId: undefined,
    })
    store = {
      ...store,
      production: {
        ...store.production,
        planner: { ...store.production.planner, orders: [po] },
      },
    }
    const snap = deriveProductionJourney(store, { productionOrderId: longId })!
    expect(snap.subject.title).toBe('fgl-4b6d…')
    expect(snap.subject.title).not.toBe(longId)
    expect(displayCycleRef('', longId)).toBe('fgl-4b6d…')
    expect(displayCycleRef('ЗК-2026-001', 'uuid-ignore')).toBe('ЗК-2026-001')
    expect(displayCycleRef('', 'po-legacy')).toBe('po-legacy') // short ids kept whole
  })

  it('multiple active orders: selected sales order keeps its linked ЗП', () => {
    let store = baseStore()
    store = {
      ...store,
      sales: {
        ...store.sales,
        orders: [
          salesOrder({ id: 'so-a', orderNumber: 'ЗК-A' }),
          salesOrder({ id: 'so-b', orderNumber: 'ЗК-B' }),
        ],
      },
      production: {
        ...store.production,
        planner: {
          ...store.production.planner,
          orders: [
            productionOrder({ id: 'po-a', orderNumber: 'ЗП-A', salesOrderId: 'so-a' }),
            productionOrder({ id: 'po-b', orderNumber: 'ЗП-B', salesOrderId: 'so-b' }),
          ],
        },
      },
    }
    const a = deriveProductionJourney(store, { salesOrderId: 'so-a' })!
    const b = deriveProductionJourney(store, { salesOrderId: 'so-b' })!
    expect(a.subject.title).toBe('ЗК-A')
    expect(a.subject.productionOrderNumber).toBe('ЗП-A')
    expect(b.subject.title).toBe('ЗК-B')
    expect(b.subject.productionOrderNumber).toBe('ЗП-B')
    expect(a.anchors.productionOrderId).toBe('po-a')
    expect(b.anchors.productionOrderId).toBe('po-b')
  })

  it('completed and cancelled outcomes', () => {
    let store = baseStore()
    store = {
      ...store,
      sales: {
        ...store.sales,
        orders: [
          salesOrder({
            id: 'so-c',
            orderNumber: 'ЗК-C',
            status: 'cancelled',
            commercialStatus: 'cancelled',
          }),
        ],
      },
    }
    const cancelled = deriveProductionJourney(store, { salesOrderId: 'so-c' })!
    expect(cancelled.outcome).toBe('cancelled')
    expect(cancelled.nextAction).toBeNull()
    expect(cancelled.stages.every((s) => s.state === 'cancelled')).toBe(true)

    store = {
      ...store,
      sales: {
        ...store.sales,
        orders: [
          salesOrder({
            id: 'so-done',
            orderNumber: 'ЗК-DONE',
            status: 'completed',
            commercialStatus: 'completed',
            fulfillmentStatus: 'shipped',
          }),
        ],
      },
      production: {
        ...store.production,
        planner: {
          ...store.production.planner,
          orders: [productionOrder({ id: 'po-d', orderNumber: 'ЗП-D', salesOrderId: 'so-done' })],
        },
        packagingReports: [
          {
            id: 'pr-1',
            number: 'УП-1',
            status: 'confirmed',
            productionOrderId: 'po-d',
            lineId: 'pack',
            shiftDate: '2026-09-08',
            shift: 'day',
            packagingLocationId: 'loc',
            finishedProductId: 'fp-1',
            warehouseItemId: 'wh',
            semiFinishedItemId: 'wip',
            materialLines: [],
            wipLines: [],
            outputM2: 1,
            rollCount: 1,
            palletCount: 1,
            batchNo: 'B',
            createdAt: '2026-09-08T10:00:00.000Z',
            updatedAt: '2026-09-08T10:00:00.000Z',
            idempotencyKey: 'ik',
          },
        ],
        finishedGoodsLots: [
          {
            id: 'lot-1',
            warehouseItemId: 'wh',
            finishedProductId: 'fp-1',
            batchNo: 'B-1',
            productionOrderId: 'po-d',
            packagingReportId: 'pr-1',
            sourceShiftReportIds: [],
            outputM2: 1,
            rollCount: 1,
            palletCount: 1,
            packagingDate: '2026-09-08',
            warehouseId: 'w1',
            locationId: 'l1',
            qcStatus: 'released',
            serverQcDecisionStatus: 'released',
            quantityProduced: 1,
            quantityQcReleased: 1,
            quantityShipped: 1,
            quantityRemaining: 0,
            createdAt: '2026-09-08T10:00:00.000Z',
            updatedAt: '2026-09-08T10:00:00.000Z',
            transactionGroupId: 'tg',
          },
        ],
        shiftReports: [
          {
            id: 'sr-1',
            number: 'СМ-1',
            status: 'confirmed',
            productionOrderId: 'po-d',
            lineId: 'line1',
            shiftDate: '2026-09-08',
            shift: 'day',
            recipeNormSnapshot: {} as never,
            productionLocationId: 'p',
            packagingLocationId: 'pk',
            scrapLocationId: 's',
            materialLines: [],
            wasteLines: [],
            outputM2: 1,
            rollCount: 1,
            semiFinishedItemId: 'wip',
            createdAt: '2026-09-08T10:00:00.000Z',
            updatedAt: '2026-09-08T10:00:00.000Z',
            idempotencyKey: 'ik',
          },
        ],
      },
      warehouse: {
        ...store.warehouse,
        loadingShipments: [
          {
            id: 'ls-1',
            number: 'ПГ-1',
            date: '2026-09-08',
            warehouseId: 'w1',
            containerId: 'c45',
            payloadKg: 1,
            palletPlacesLimit: 1,
            counterpartyName: 'X',
            orderNo: 'ЗК-DONE',
            salesOrderId: 'so-done',
            lines: [],
            totalsRolls: 0,
            totalsNetKg: 0,
            totalsGrossKg: 0,
            totalsAreaM2: 0,
            status: 'posted',
            createdAt: '2026-09-08T10:00:00.000Z',
            updatedAt: '2026-09-08T10:00:00.000Z',
          },
        ],
      },
    }
    const done = deriveProductionJourney(store, { salesOrderId: 'so-done' })!
    expect(done.outcome).toBe('completed')
    expect(done.currentStageId).toBeNull()
    expect(done.stages.every((s) => s.state === 'done')).toBe(true)
  })

  it('unknown UUID yields safe snapshot, not crash', () => {
    const store = baseStore()
    const snap = deriveProductionJourney(store, {
      salesOrderId: '00000000-0000-4000-8000-000000000099',
    })
    expect(snap).not.toBeNull()
    expect(snap!.subject.title).toMatch(/00000000/)
    expect(snap!.stages.find((s) => s.id === 'sales')?.evidence.done).toBe(false)
  })

  it('user without role cannot navigate forbidden views', () => {
    const store = baseStore()
    store.access = { ...store.access, roleViews: { ...DEFAULT_ROLE_VIEWS } }
    expect(roleCanReachStageView(store.access, 'mixer', 'otc')).toBe(false)
    expect(roleCanReachStageView(store.access, 'mixer', 'mixer')).toBe(true)

    const mixerUser: AppUser = {
      id: 'u1',
      login: 'm',
      displayName: 'M',
      roleId: 'mixer',
      active: true,
      passwordHash: 'x',
      passwordSalt: 'y',
    }
    const snap = deriveProductionJourney(
      store,
      { salesOrderId: 'missing' },
      { access: store.access as AccessStore, user: mixerUser },
    )!
    expect(snap.nextAction?.canNavigate).toBe(false)
  })
})

describe('R3.0 productionJourney contracts', () => {
  it('is pure derivation (no store mutation)', () => {
    const store = baseStore()
    store.sales = {
      ...store.sales,
      orders: [salesOrder({ id: 'so-1', orderNumber: 'ЗК-1' })],
    }
    const before = JSON.stringify(store.sales.orders)
    deriveProductionJourney(store, { salesOrderId: 'so-1' })
    expect(JSON.stringify(store.sales.orders)).toBe(before)
  })

  it('stage views use existing routable hashes', () => {
    for (const id of PRODUCTION_CYCLE_STAGE_IDS) {
      const viewId = PRODUCTION_CYCLE_STAGE_META[id].viewId
      expect(ROUTABLE_VIEWS).toContain(viewId)
      expect(viewToHash(viewId)).toBe(`#/${viewId}`)
    }
  })

  it('forbidden next action is not canNavigate', () => {
    const store = baseStore()
    const cook: AppUser = {
      id: 'cook',
      login: 'cook',
      displayName: 'Cook',
      roleId: 'cook',
      active: true,
      passwordHash: 'x',
      passwordSalt: 'y',
    }
    const snap = deriveProductionJourney(
      {
        ...store,
        sales: { ...store.sales, orders: [salesOrder({ id: 'so-1', orderNumber: 'ЗК-1' })] },
        access: { ...store.access, roleViews: { ...DEFAULT_ROLE_VIEWS } },
      },
      { salesOrderId: 'so-1' },
      { access: { ...store.access, roleViews: { ...DEFAULT_ROLE_VIEWS } }, user: cook },
    )!
    expect(snap.nextAction).not.toBeNull()
    expect(snap.nextAction!.canNavigate).toBe(false)
  })

  it('context persists across interface switch', () => {
    clearProductionCycleContext()
    saveProductionCycleContext({ salesOrderId: 'so-keep', lotId: 'lot-1' })
    const loaded = loadProductionCycleContext()
    expect(loaded?.salesOrderId).toBe('so-keep')
    const merged = mergeProductionCycleContext(loaded, { productionOrderId: 'po-1' })
    expect(merged).toEqual({
      salesOrderId: 'so-keep',
      lotId: 'lot-1',
      productionOrderId: 'po-1',
    })
    clearProductionCycleContext()
  })

  it('RU/EN/KA productionCycle keys are complete and aligned', () => {
    const ruKeys = Object.keys(ru).filter((k) => k.startsWith('productionCycle.')).sort()
    const enKeys = Object.keys(en).filter((k) => k.startsWith('productionCycle.')).sort()
    const kaKeys = Object.keys(ka).filter((k) => k.startsWith('productionCycle.')).sort()
    expect(ruKeys.length).toBeGreaterThan(50)
    expect(enKeys).toEqual(ruKeys)
    expect(kaKeys).toEqual(ruKeys)
  })
})

describe('R3.0 ProductionJourneyPanel / App wiring smoke', () => {
  it('exports a renderable panel component', () => {
    expect(typeof ProductionJourneyPanel).toBe('function')
  })

  it('App wires ProductionJourneyPanel (no full mount)', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const src = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
    expect(src).toContain('ProductionJourneyPanel')
    expect(src).toContain("from '@/components/productionCycle'")
  })
})
