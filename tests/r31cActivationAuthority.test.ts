/** R3.1C — production activation transport and authoritative mirror invariants. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  latestDraft: undefined as Record<string, unknown> | undefined,
  failNextConfirm: false,
  mismatchConfirm: false,
}))

vi.mock('@/lib/production/g3ServerClient', () => ({
  isG3WebAuthoritativePath: () => true,
  isG3ProductionDomainActive: (production: Record<string, unknown>) =>
    production?.g3ProductionDomainActive === true,
  g3ProductionCommand: vi.fn(async (input: Record<string, unknown>) => {
    harness.calls.push(structuredClone(input))
    const command = input.command as Record<string, unknown>
    if (input.commandType === 'production.order.draft.save') {
      const { orderId, ...fields } = command
      harness.latestDraft = {
        id: orderId,
        ...fields,
        status: 'draft',
        wipContractVersion: 1,
      }
      return {
        ok: true,
        data: {
          criticalRevision: 10,
          warehouse: {},
          production: { orders: [harness.latestDraft] },
        },
      }
    }
    if (input.commandType === 'production.order.confirm') {
      if (harness.failNextConfirm) {
        harness.failNextConfirm = false
        return { ok: false, error: 'temporary_confirm_failure', message: 'failed' }
      }
      const active = {
        ...harness.latestDraft,
        status: 'active',
        recipeNormSnapshot: {
          recipeId: harness.latestDraft?.formulationRecipeId,
          recipeVersionId: 'recipe-version-1',
          versionNumber: 1,
          contentHash: 'rv-1',
          normBase: 'per_batch',
          batchSize: 10,
          components: [],
          snappedAt: '2026-09-10T12:00:00.000Z',
        },
        reservationDocumentId: 'reservation-authoritative',
        ...(harness.mismatchConfirm ? { totalQtyMp: 999 } : {}),
      }
      return {
        ok: true,
        data: {
          criticalRevision: 11,
          warehouse: {},
          production: { orders: [active] },
        },
      }
    }
    throw new Error(`unexpected command ${String(input.commandType)}`)
  }),
  mirrorG3Ack: (
    warehouse: Record<string, unknown>,
    production: Record<string, unknown>,
    ack: Record<string, unknown>,
  ) => ({
    warehouse,
    production: {
      ...production,
      g3Orders: (ack.production as { orders?: unknown[] } | undefined)?.orders ?? [],
      g3ProductionDomainActive: true,
    },
  }),
}))

function appStore() {
  return {
    production: {
      g3ProductionDomainActive: true,
      planner: {
        nextOrderSeq: 2,
        orders: [
          {
            id: 'order-1',
            orderNumber: 'PO-1',
            customer: 'Customer A',
            finishedProductId: 'finished-product-1',
            productName: 'Celloplex 160',
            warehouseItemId: 'finished-item-1',
            semiFinishedItemId: 'wip-item-1',
            rawMaterialItemId: 'raw-item-1',
            category: 'ratl1',
            totalQtyMp: 100,
            startDate: '2026-09-10',
            endDate: '2026-09-10',
            lineId: '1',
            priority: 'normal',
            status: 'draft',
            planMode: 'even',
            recalcMode: 'auto',
            orderedRolls: 2,
            formulationRecipeId: 'recipe-1',
            dayPlans: [],
            history: [],
            createdAt: '2026-09-10T00:00:00.000Z',
            updatedAt: '2026-09-10T00:00:00.000Z',
          },
        ],
      },
    },
    formulations: {
      recipes: [
        {
          id: 'recipe-1',
          active: true,
          outputWarehouseItemId: 'impregnation-item-1',
        },
      ],
    },
    warehouse: {
      items: [
        {
          id: 'raw-item-1',
          active: true,
          warehouseId: 'raw-warehouse-1',
        },
      ],
      documents: [],
      movements: [],
    },
  }
}

beforeEach(() => {
  harness.calls = []
  harness.latestDraft = undefined
  harness.failNextConfirm = false
  harness.mismatchConfirm = false
})

describe('R3.1C canonical activation authority', () => {
  it('uses a new payload-bound key after edit and mirrors the exact active order', async () => {
    const store = appStore()
    const { createProductionSlice } = await import('@/store/slices/productionSlice')
    const slice = createProductionSlice({
      getStore: () => store as never,
      setStore: (updater: (state: never) => unknown) => {
        Object.assign(store, updater(store as never))
      },
      getActor: () => ({ uid: 'planner-1', name: 'Planner' }),
    } as never)

    harness.failNextConfirm = true
    const first = await slice.activateProductionOrder('order-1')
    expect(first).toMatchObject({ ok: false, error: 'temporary_confirm_failure' })

    store.production.planner.orders[0]!.customer = 'Customer B'
    const second = await slice.activateProductionOrder('order-1')
    expect(second).toEqual({ ok: true })

    const draftCalls = harness.calls.filter(
      (call) => call.commandType === 'production.order.draft.save',
    )
    expect(draftCalls).toHaveLength(2)
    expect(draftCalls[0]!.idempotencyKey).not.toBe(draftCalls[1]!.idempotencyKey)
    const confirmCalls = harness.calls.filter(
      (call) => call.commandType === 'production.order.confirm',
    )
    expect(confirmCalls[0]!.idempotencyKey).not.toBe(confirmCalls[1]!.idempotencyKey)

    const mirrored = store.production.planner.orders[0]!
    expect(mirrored).toMatchObject({
      id: 'order-1',
      status: 'active',
      customer: 'Customer B',
      wipContractVersion: 1,
      impregnationOutputItemId: 'impregnation-item-1',
      reservationDocumentId: 'reservation-authoritative',
    })
  })

  it('does not mark the planner row active when the confirm ack differs', async () => {
    const store = appStore()
    const { createProductionSlice } = await import('@/store/slices/productionSlice')
    const slice = createProductionSlice({
      getStore: () => store as never,
      setStore: (updater: (state: never) => unknown) => {
        Object.assign(store, updater(store as never))
      },
      getActor: () => ({ uid: 'planner-1', name: 'Planner' }),
    } as never)
    harness.mismatchConfirm = true

    const result = await slice.activateProductionOrder('order-1')

    expect(result).toEqual({
      ok: false,
      error: 'production_order_ack_mismatch',
      messageKey: 'production_order_ack_mismatch',
    })
    expect(store.production.planner.orders[0]!.status).toBe('draft')
  })
})
