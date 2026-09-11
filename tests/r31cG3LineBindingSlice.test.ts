import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authoritativeProductionLineBindingFingerprint } from '../src/lib/warehouse/g3LineBindingConfigCore.mjs'

const harness = vi.hoisted(() => ({ command: vi.fn() }))

vi.mock('@/lib/cloud/firebase', () => ({
  getFirebaseAuth: () => ({ currentUser: null }),
  isFirebaseConfigured: () => false,
}))

vi.mock('@/lib/production/g3ServerClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/production/g3ServerClient')>(
    '@/lib/production/g3ServerClient',
  )
  return {
    ...actual,
    isG3WebAuthoritativePath: () => true,
    isG3ProductionDomainActive: () => true,
    g3ProductionCommand: (...args: unknown[]) => harness.command(...args),
  }
})

const binding = {
  lineId: '1',
  productionWarehouseId: 'warehouse-production',
  productionLocationId: 'location-line-1',
  note: 'Physical line 1',
}
async function ack(
  overrides: Record<string, unknown> = {},
  expected = binding,
) {
  const fingerprint = await authoritativeProductionLineBindingFingerprint(expected)
  return {
    ok: true as const,
    data: {
      criticalRevision: 9,
      ...expected,
      bindingId: expected.lineId,
      bindingFingerprint: fingerprint,
      warehouse: {
        productionLineBindings: [
          { id: expected.lineId, ...expected, configurationFingerprint: fingerprint },
        ],
      },
      production: { orders: [], shiftReports: [], wipBatches: [] },
      ...overrides,
    },
  }
}

function createStateHarness() {
  let state = {
    warehouse: {
      items: [],
      locations: [],
      categories: [],
      documents: [],
      movements: [],
      invoiceRegistry: [],
      auditLog: [],
      productionLineBindings: [],
    },
    production: {
      g3ProductionDomainActive: true,
      g3CriticalRevision: 8,
      legacyMarker: 'preserved',
    },
  } as never
  const updates: unknown[] = []
  const setStore = (action: unknown, meta?: unknown) => {
    updates.push(meta)
    state = (
      typeof action === 'function'
        ? (action as (current: typeof state) => typeof state)(state)
        : action
    ) as typeof state
  }
  return { get state() { return state }, updates, setStore }
}

beforeEach(() => harness.command.mockReset())

describe('R3.1C warehouse line-binding authoritative web action', () => {
  it('mirrors only an expanded exact ack and marks the write as system-origin', async () => {
    const response = await ack()
    harness.command.mockResolvedValueOnce(response)
    const stateHarness = createStateHarness()
    const { createWarehouseSlice } = await import('@/store/slices/warehouseSlice')
    const slice = createWarehouseSlice({
      setStore: stateHarness.setStore as never,
      getStore: () => stateHarness.state as never,
    })

    const result = await slice.upsertProductionLineLocationBinding(binding)
    expect(result).toMatchObject({ ok: true, bindingFingerprint: response.data.bindingFingerprint })
    expect(harness.command).toHaveBeenCalledWith(
      expect.objectContaining({
        commandType: 'production.lineBinding.configure',
        command: binding,
      }),
    )
    const commandCall = harness.command.mock.calls[0][0]
    expect(commandCall.idempotencyKey).toContain('production-line-binding-attempt:1:')
    expect(stateHarness.state.warehouse.productionLineBindings).toEqual([
      expect.objectContaining({ id: '1', ...binding }),
    ])
    expect(stateHarness.updates).toEqual([{ origin: 'system' }])
  })

  it('fails closed without mutating on a truncated or mismatched ack', async () => {
    harness.command.mockResolvedValueOnce(await ack({ production: undefined }))
    const stateHarness = createStateHarness()
    const before = JSON.stringify(stateHarness.state)
    const { createWarehouseSlice } = await import('@/store/slices/warehouseSlice')
    const slice = createWarehouseSlice({
      setStore: stateHarness.setStore as never,
      getStore: () => stateHarness.state as never,
    })

    const result = await slice.upsertProductionLineLocationBinding(binding)
    expect(result).toEqual({
      ok: false,
      error: 'production_line_binding_config_ack_mismatch',
    })
    expect(JSON.stringify(stateHarness.state)).toBe(before)
    expect(stateHarness.updates).toEqual([])
  })

  it('uses a fresh transport key for A→B→A and accepts only monotonic exact ACKs', async () => {
    const stateHarness = createStateHarness()
    const { createWarehouseSlice } = await import('@/store/slices/warehouseSlice')
    const slice = createWarehouseSlice({
      setStore: stateHarness.setStore as never,
      getStore: () => stateHarness.state as never,
    })
    const a = binding
    const b = { ...binding, productionLocationId: 'location-line-1-b', note: 'Moved line 1' }
    harness.command
      .mockResolvedValueOnce(await ack({ criticalRevision: 9 }, a))
      .mockResolvedValueOnce(await ack({ criticalRevision: 10 }, b))
      .mockResolvedValueOnce(await ack({ criticalRevision: 11 }, a))

    expect((await slice.upsertProductionLineLocationBinding(a)).ok).toBe(true)
    expect((await slice.upsertProductionLineLocationBinding(b)).ok).toBe(true)
    expect((await slice.upsertProductionLineLocationBinding(a)).ok).toBe(true)

    const keys = harness.command.mock.calls.map(([request]) => request.idempotencyKey)
    expect(new Set(keys).size).toBe(3)
    expect(stateHarness.state.warehouse.productionLineBindings).toEqual([
      expect.objectContaining(a),
    ])
    expect(stateHarness.state.production.g3CriticalRevision).toBe(11)
  })
})
