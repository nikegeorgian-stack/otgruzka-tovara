/**
 * Soft g4PackagingQcActive can lag while SQL packagingQc is active.
 * Web QC release must still succeed when G4 server ack is ok.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

describe('R2.9L QC release with stale soft G4 flag', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('VITE_FST_WEB', 'true')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('releaseFinishedGoodsLot uses G4 server when soft flag is false', async () => {
    vi.doMock('../src/lib/production/g4ServerClient', async () => {
      const actual = await vi.importActual<typeof import('../src/lib/production/g4ServerClient')>(
        '../src/lib/production/g4ServerClient',
      )
      return {
        ...actual,
        isG4WebAuthoritativePath: () => true,
        isG4PackagingQcActive: () => false,
        g4ProductionCommand: async () => ({
          ok: true as const,
          data: {
            ok: true as const,
            criticalRevision: 22,
            packagingQcActive: true,
            productionActive: true,
            finishedGoodsLotId: 'lot-stale',
            production: {
              finishedGoodsLots: [
                {
                  id: 'lot-stale',
                  qcStatus: 'released',
                  quantityProduced: 12.5,
                  quantityRemaining: 12.5,
                },
              ],
              qcDecisions: [{ id: 'dec-1', status: 'released' }],
              packagingReports: [],
            },
            warehouse: { documents: [], movements: [], loadingShipments: [] },
          },
        }),
        mirrorG4Ack: actual.mirrorG4Ack,
      }
    })

    const storeRef: { current: Record<string, unknown> } = {
      current: {
        production: {
          g4PackagingQcActive: false,
          finishedGoodsLots: [
            {
              id: 'lot-stale',
              qcStatus: 'pending',
              quantityProduced: 12.5,
              quantityRemaining: 12.5,
              finishedProductId: 'fp-1',
            },
          ],
        },
        warehouse: { documents: [], movements: [], loadingShipments: [] },
        access: { users: [] },
      },
    }

    const { createProductionSlice } = await import('../src/store/slices/productionSlice')
    const slice = createProductionSlice({
      getStore: () => storeRef.current as never,
      setStore: (updater: (s: never) => unknown) => {
        storeRef.current = updater(storeRef.current as never) as Record<string, unknown>
      },
      getActor: () => ({ uid: 'u1', name: 'T' }),
    } as never)

    const result = await slice.releaseFinishedGoodsLot({ lotId: 'lot-stale' } as never)
    expect(result.ok).toBe(true)
    const lot = (storeRef.current.production as { finishedGoodsLots: { qcStatus: string }[] })
      .finishedGoodsLots[0]
    expect(lot.qcStatus).toBe('released')
  })
})
