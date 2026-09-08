/**
 * R2.9K — UI fail-closed on web when G3/G4/G5 domains are inactive.
 * Soft stock-affecting writers must not pretend success.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  G3_PRODUCTION_INACTIVE,
  G4_PACKAGING_INACTIVE,
  G5_SALES_PLANNING_INACTIVE,
  webRequiresAuthoritativeDomain,
} from '../src/lib/cloud/authoritativeWebGates'

describe('R2.9K authoritative web gates', () => {
  it('desktop soft path allowed when domain inactive', () => {
    expect(webRequiresAuthoritativeDomain(false, false)).toBe(false)
  })

  it('web requires domain when inactive', () => {
    expect(webRequiresAuthoritativeDomain(true, false)).toBe(true)
    expect(webRequiresAuthoritativeDomain(true, true)).toBe(false)
  })

  it('exports stable error codes for UI / i18n', () => {
    expect(G3_PRODUCTION_INACTIVE).toBe('g3_production_inactive')
    expect(G4_PACKAGING_INACTIVE).toBe('g4_packaging_inactive')
    expect(G5_SALES_PLANNING_INACTIVE).toBe('g5_sales_planning_inactive')
  })
})

describe('R2.9K productionSlice packaging fail-closed (web, G4 off)', () => {
  const storeRef: { current: Record<string, unknown> } = { current: {} }

  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('VITE_FST_WEB', 'true')
    storeRef.current = {
      production: {
        g4PackagingQcActive: false,
        packagingReports: [],
        finishedGoodsLots: [],
        planner: { orders: [] },
      },
      warehouse: { documents: [], movements: [], loadingShipments: [] },
      sales: { orders: [] },
      access: { users: [] },
    }
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('confirmPackagingReport refuses soft warehouse write when G4 inactive on web', async () => {
    const { createProductionSlice } = await import('../src/store/slices/productionSlice')
    const slice = createProductionSlice({
      getStore: () => storeRef.current as never,
      setStore: (updater: (s: never) => unknown) => {
        storeRef.current = updater(storeRef.current as never) as Record<string, unknown>
      },
      getActor: () => ({ uid: 'u1', name: 'T' }),
    } as never)

    const beforeDocs = (storeRef.current.warehouse as { documents: unknown[] }).documents.length
    const result = await slice.confirmPackagingReport({
      idempotencyKey: 'r29k-pack-1',
      report: {
        id: 'pr-1',
        productionOrderId: 'po-1',
        finishedProductId: 'fp-1',
        warehouseItemId: 'fg-1',
        packagingLocationId: 'loc-1',
        shiftDate: '2026-09-08',
        shift: 'day',
        outputM2: 100,
        rollCount: 2,
        wipLines: [],
        materialLines: [],
      },
    } as never)

    expect(result.ok).toBe(false)
    expect(result.error).toBe(G4_PACKAGING_INACTIVE)
    expect((storeRef.current.warehouse as { documents: unknown[] }).documents.length).toBe(beforeDocs)
  })

  it('releaseFinishedGoodsLot refuses soft release when G4 inactive on web', async () => {
    const { createProductionSlice } = await import('../src/store/slices/productionSlice')
    storeRef.current.production = {
      ...(storeRef.current.production as object),
      finishedGoodsLots: [
        {
          id: 'lot-1',
          qcStatus: 'pending',
          quantityRemaining: 100,
          finishedProductId: 'fp-1',
        },
      ],
    }
    const slice = createProductionSlice({
      getStore: () => storeRef.current as never,
      setStore: (updater: (s: never) => unknown) => {
        storeRef.current = updater(storeRef.current as never) as Record<string, unknown>
      },
      getActor: () => ({ uid: 'u1', name: 'T' }),
    } as never)

    const result = await slice.releaseFinishedGoodsLot({ lotId: 'lot-1' } as never)
    expect(result.ok).toBe(false)
    expect(result.error).toBe(G4_PACKAGING_INACTIVE)
    const lot = (storeRef.current.production as { finishedGoodsLots: { qcStatus: string }[] })
      .finishedGoodsLots[0]
    expect(lot.qcStatus).toBe('pending')
  })
})

describe('R2.9K warehouseSlice shipment fail-closed (web, G4/G5 off)', () => {
  const storeRef: { current: Record<string, unknown> } = { current: {} }

  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('VITE_FST_WEB', 'true')
    storeRef.current = {
      production: {
        g4PackagingQcActive: false,
        finishedGoodsLots: [
          {
            id: 'lot-1',
            qcStatus: 'released',
            quantityRemaining: 50,
            finishedProductId: 'fp-1',
            warehouseId: 'wh-1',
          },
        ],
      },
      warehouse: {
        documents: [],
        movements: [],
        loadingShipments: [
          {
            id: 'ship-1',
            number: 'ОТ-1',
            status: 'draft',
            warehouseId: 'wh-1',
            date: '2026-09-08',
            lines: [{ id: 'ln-1', lotId: 'lot-1', quantity: 10 }],
          },
        ],
      },
      sales: { orders: [] },
      criticalDomainMeta: {},
    }
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('postLoadingShipment refuses soft post when G4/G5 inactive on web', async () => {
    const { createWarehouseSlice } = await import('../src/store/slices/warehouseSlice')
    const slice = createWarehouseSlice({
      getStore: () => storeRef.current as never,
      setStore: (updater: (s: never) => unknown, _meta?: unknown) => {
        storeRef.current = updater(storeRef.current as never) as Record<string, unknown>
      },
      getActor: () => ({ uid: 'u1', name: 'T' }),
      patchWarehouse: (
        setStore: (u: (s: never) => unknown) => void,
        fn: (w: unknown) => unknown,
      ) => {
        setStore((s) => ({ ...s, warehouse: fn((s as { warehouse: unknown }).warehouse) }) as never)
      },
    } as never)

    const result = await slice.postLoadingShipment('ship-1')
    expect(result.ok).toBe(false)
    expect([G4_PACKAGING_INACTIVE, G5_SALES_PLANNING_INACTIVE]).toContain(result.error)
    expect((storeRef.current.warehouse as { documents: unknown[] }).documents.length).toBe(0)
    const ship = (storeRef.current.warehouse as { loadingShipments: { status: string }[] })
      .loadingShipments[0]
    expect(ship.status).toBe('draft')
  })
})
