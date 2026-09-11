/**
 * Soft g4PackagingQcActive can lag while SQL packagingQc is active.
 * Web QC release must still succeed when G4 server ack is ok.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { g4CriticalMutationCommandFingerprint } from '@/lib/production/g4CriticalMutationIntegrityCore.mjs'

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
    const command = { lotId: 'lot-stale', finishedGoodsLotId: 'lot-stale' }
    const commandFingerprint = g4CriticalMutationCommandFingerprint('qc.release', command)
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
            touchesWarehouse: false,
            commandFingerprint,
            finishedGoodsLotId: 'lot-stale',
            qcStatus: 'released',
            decisionId: 'dec-1',
            passportAttachmentId: 'passport-1',
            protocolAttachmentId: 'protocol-1',
            production: {
              orders: [],
              finishedGoodsLots: [
                {
                  id: 'lot-stale',
                  qcStatus: 'released',
                  quantityProduced: 12.5,
                  quantityQcReleased: 12.5,
                  quantityShipped: 0,
                  quantityRemaining: 12.5,
                  lotRevision: 2,
                  currentDecisionId: 'dec-1',
                  releaseCommandFingerprint: commandFingerprint,
                },
              ],
              qcDecisions: [
                {
                  id: 'dec-1',
                  lotId: 'lot-stale',
                  lotRevision: 2,
                  status: 'released',
                  commandFingerprint,
                  passportAttachmentId: 'passport-1',
                  protocolAttachmentId: 'protocol-1',
                },
              ],
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

  it('does not mirror a successful HTTP response with an incomplete QC ACK', async () => {
    vi.doMock('../src/lib/production/g4ServerClient', async () => {
      const actual = await vi.importActual<typeof import('../src/lib/production/g4ServerClient')>(
        '../src/lib/production/g4ServerClient',
      )
      return {
        ...actual,
        isG4WebAuthoritativePath: () => true,
        isG4PackagingQcActive: () => true,
        g4ProductionCommand: async () => ({
          ok: true as const,
          data: {
            ok: true as const,
            criticalRevision: 22,
            packagingQcActive: true,
            productionActive: true,
            finishedGoodsLotId: 'lot-stale',
            production: {
              finishedGoodsLots: [{ id: 'lot-stale', qcStatus: 'released' }],
              qcDecisions: [],
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
          g4PackagingQcActive: true,
          g4CriticalRevision: 21,
          finishedGoodsLots: [
            {
              id: 'lot-stale',
              qcStatus: 'pending',
              quantityProduced: 12.5,
              quantityRemaining: 0,
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

    const before = JSON.stringify(storeRef.current)
    const result = await slice.releaseFinishedGoodsLot({ lotId: 'lot-stale' } as never)
    expect(result).toEqual({ ok: false, error: 'g4_critical_ack_invalid' })
    expect(JSON.stringify(storeRef.current)).toBe(before)
  })

  it('startQcReview returns the server failure and leaves the lot pending', async () => {
    vi.doMock('../src/lib/production/g4ServerClient', async () => {
      const actual = await vi.importActual<typeof import('../src/lib/production/g4ServerClient')>(
        '../src/lib/production/g4ServerClient',
      )
      return {
        ...actual,
        isG4WebAuthoritativePath: () => true,
        g4ProductionCommand: async () => ({
          ok: false as const,
          error: 'network',
          message: 'unavailable',
        }),
      }
    })
    const storeRef: { current: Record<string, unknown> } = {
      current: {
        production: {
          g4PackagingQcActive: true,
          finishedGoodsLots: [{ id: 'lot-stale', qcStatus: 'pending' }],
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

    const result = await slice.startQcReview('lot-stale')
    expect(result).toEqual({ ok: false, error: 'network' })
    expect(
      (storeRef.current.production as { finishedGoodsLots: { qcStatus: string }[] })
        .finishedGoodsLots[0].qcStatus,
    ).toBe('pending')
  })
})
