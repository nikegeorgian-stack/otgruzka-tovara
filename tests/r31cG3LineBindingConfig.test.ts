import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyCriticalPayload } from '../server/fst/_g1CriticalHelpers.mjs'
import {
  applyProductionLineBindingConfig,
  authoritativeProductionLineBindingFingerprint,
  LINE_BINDING_CONFIG_ACCOUNTING_AMBIGUOUS,
  LINE_BINDING_CONFIG_ACCOUNTING_INACTIVE,
  LINE_BINDING_CONFIG_ACCOUNTING_NOT_FOUND,
  LINE_BINDING_CONFIG_ACK_MISMATCH,
  LINE_BINDING_CONFIG_INPUT_INVALID,
  validateProductionLineBindingAck,
} from '../src/lib/warehouse/g3LineBindingConfigCore.mjs'

const harness = vi.hoisted(() => ({
  staging: true,
  critical: null as null | Record<string, unknown>,
  principal: null as null | Record<string, unknown>,
  receipt: null as null | Record<string, unknown>,
  upsert: vi.fn(async () => undefined),
  cas: vi.fn(async () => undefined),
  insertReceipt: vi.fn(async () => undefined),
}))

vi.mock('../server/fst/_g1DataConnect.mjs', () => ({
  getG1DataConnect: vi.fn(() => ({ mocked: true })),
  getFstPrincipalAccessByUidStore: vi.fn(async () => ({
    data: { fstPrincipalAccesses: harness.principal ? [harness.principal] : [] },
  })),
  getFstCriticalStore: vi.fn(async () => ({ data: { fstCriticalStore: harness.critical } })),
  getFstCommandReceipt: vi.fn(async () => ({
    data: { fstCommandReceipt: harness.receipt },
  })),
  upsertFstCriticalStore: (...args: unknown[]) => harness.upsert(...args),
  updateFstCriticalStoreCas: (...args: unknown[]) => harness.cas(...args),
  insertFstCommandReceipt: (...args: unknown[]) => harness.insertReceipt(...args),
}))

vi.mock('../server/fst/_adminAuth.mjs', () => ({ FST_ADMIN_EMAILS: new Set<string>() }))
vi.mock('../server/fst/_dataConnectRuntime.mjs', () => ({
  isStagingIsolatedRuntime: () => harness.staging,
}))

const STORE = 'fibercell-main'
const ACTOR = { uid: 'configurator-1', email: 'configurator@example.test', claims: {} }
const COMMAND = {
  lineId: '1',
  productionWarehouseId: 'warehouse-production',
  productionLocationId: 'location-line-1',
  note: 'Physical line 1',
}

function warehouse(overrides: Record<string, unknown> = {}) {
  return {
    items: [],
    locations: [
      { id: COMMAND.productionWarehouseId, name: 'Production', active: true },
      { id: COMMAND.productionLocationId, name: 'Line 1', active: true },
    ],
    accountingByWarehouse: [
      {
        id: COMMAND.productionWarehouseId,
        warehouseId: COMMAND.productionWarehouseId,
        status: 'active',
      },
    ],
    productionLineBindings: [],
    documents: [],
    movements: [],
    auditLog: [],
    materialShortages: [],
    closedMonths: [],
    ...overrides,
  }
}

function setCritical() {
  const payload = emptyCriticalPayload()
  payload.domains.warehouse = warehouse()
  payload.domains.production = {
    recipeVersions: [],
    orders: [],
    shiftReports: [],
    wipBatches: [],
    wasteRecords: [],
    handoffs: [],
    impregnationQcDecisions: [],
    auditLog: [],
  }
  payload.domainMeta.production = { active: true, version: 1 }
  payload.domainMeta.warehouse = { active: true, version: 1 }
  harness.critical = {
    id: STORE,
    revision: 11,
    payloadJson: JSON.stringify(payload),
    fingerprint: 'fixture',
  }
}

beforeEach(() => {
  harness.staging = true
  harness.critical = null
  harness.receipt = null
  harness.principal = {
    id: `${STORE}::${ACTOR.uid}`,
    firebaseUid: ACTOR.uid,
    storeId: STORE,
    active: true,
    capabilitiesJson: JSON.stringify({
      'production.lineBinding.configure': true,
      productionLineIds: ['1'],
    }),
  }
  harness.upsert.mockClear()
  harness.cas.mockClear()
  harness.insertReceipt.mockClear()
})

describe('R3.1C authoritative production line binding configuration', () => {
  it('accepts only exact existing IDs and requires one active warehouse accounting row', () => {
    const source = warehouse()
    const applied = applyProductionLineBindingConfig(
      source as never,
      COMMAND,
      ACTOR,
      '2026-09-10T12:00:00.000Z',
    )
    expect(applied.ok).toBe(true)
    expect(source.productionLineBindings).toEqual([])

    expect(
      applyProductionLineBindingConfig(source as never, {
        ...COMMAND,
        productionWarehouseId: '',
        warehouseName: 'Production',
      }, ACTOR, '2026-09-10T12:00:00.000Z'),
    ).toMatchObject({ ok: false, error: LINE_BINDING_CONFIG_INPUT_INVALID })

    for (const [accountingByWarehouse, error] of [
      [[], LINE_BINDING_CONFIG_ACCOUNTING_NOT_FOUND],
      [[{ warehouseId: COMMAND.productionWarehouseId, status: 'uninitialized' }], LINE_BINDING_CONFIG_ACCOUNTING_INACTIVE],
      [[
        { warehouseId: COMMAND.productionWarehouseId, status: 'active' },
        { warehouseId: COMMAND.productionWarehouseId, status: 'active' },
      ], LINE_BINDING_CONFIG_ACCOUNTING_AMBIGUOUS],
    ] as const) {
      expect(
        applyProductionLineBindingConfig(
          warehouse({ accountingByWarehouse }) as never,
          COMMAND,
          ACTOR,
          '2026-09-10T12:00:00.000Z',
        ),
      ).toMatchObject({ ok: false, error })
    }
  })

  it('persists through one staging CAS and returns an expanded SHA-256 ack', async () => {
    setCritical()
    const service = await import('../server/fst/_g3ProductionService.mjs')
    const result = await service.executeG3Command({
      actor: ACTOR,
      storeId: STORE,
      idempotencyKey: 'configure-line-1-v1',
      commandType: 'production.lineBinding.configure',
      command: COMMAND,
    })

    expect(result.ok).toBe(true)
    expect(result.criticalRevision).toBe(12)
    expect(result.note).toBe(COMMAND.note)
    expect(result.bindingFingerprint).toMatch(/^line-binding:v2:[a-f0-9]{64}$/)
    expect(result.warehouse.productionLineBindings).toEqual([
      expect.objectContaining({
        id: '1',
        ...COMMAND,
        configurationFingerprint: result.bindingFingerprint,
      }),
    ])
    expect(result.production).toBeTruthy()
    expect(harness.cas).toHaveBeenCalledTimes(1)
    expect(harness.cas.mock.calls[0][1]).toMatchObject({
      id: STORE,
      expectedRevision: 11,
      revision: 12,
    })
    expect(
      await validateProductionLineBindingAck(result, COMMAND, {
        previousCriticalRevision: 11,
      }),
    ).toMatchObject({ ok: true, bindingFingerprint: result.bindingFingerprint })
  })

  it('accepts an exact reducer replay but conflicts on the same key fingerprint with changed fields', async () => {
    const { applyLineBindingConfigure } = await import(
      '../server/fst/_g3ProductionService.mjs'
    )
    const production = { orders: [], auditLog: [] }
    const first = applyLineBindingConfigure(
      production,
      warehouse(),
      COMMAND,
      ACTOR,
      '2026-09-10T12:00:00.000Z',
      { allowStagingConfiguration: true },
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const replay = applyLineBindingConfigure(
      first.production,
      first.warehouse,
      COMMAND,
      ACTOR,
      '2026-09-10T12:01:00.000Z',
      {
        allowStagingConfiguration: true,
        replayFingerprints: [first.result.bindingFingerprint],
      },
    )
    expect(replay).toMatchObject({ ok: true, result: { idempotent: true } })
    expect(replay.production).toBe(first.production)
    expect(replay.warehouse).toBe(first.warehouse)

    const conflict = applyLineBindingConfigure(
      first.production,
      first.warehouse,
      { ...COMMAND, productionLocationId: 'another-location' },
      ACTOR,
      '2026-09-10T12:01:00.000Z',
      {
        allowStagingConfiguration: true,
        replayFingerprints: [first.result.bindingFingerprint],
      },
    )
    expect(conflict).toMatchObject({
      ok: false,
      error: 'production_line_binding_config_idempotency_conflict',
    })
  })

  it('rejects production runtime and absent critical state without initializing or CAS', async () => {
    const service = await import('../server/fst/_g3ProductionService.mjs')
    harness.staging = false
    const denied = await service.executeG3Command({
      actor: ACTOR,
      storeId: STORE,
      idempotencyKey: 'configure-line-production-denied',
      commandType: 'production.lineBinding.configure',
      command: COMMAND,
    })
    expect(denied).toMatchObject({
      ok: false,
      error: 'production_line_binding_config_staging_only',
    })
    expect(harness.upsert).not.toHaveBeenCalled()
    expect(harness.cas).not.toHaveBeenCalled()

    harness.staging = true
    const absent = await service.executeG3Command({
      actor: ACTOR,
      storeId: STORE,
      idempotencyKey: 'configure-line-absent-critical',
      commandType: 'production.lineBinding.configure',
      command: COMMAND,
    })
    expect(absent).toMatchObject({ ok: false, error: 'critical_store_not_initialized' })
    expect(harness.upsert).not.toHaveBeenCalled()
    expect(harness.cas).not.toHaveBeenCalled()
  })

  it('rejects a truncated or mismatched expanded ack before mirroring', async () => {
    const fingerprint = await authoritativeProductionLineBindingFingerprint(COMMAND)
    expect(fingerprint).toBeTruthy()
    const applied = applyProductionLineBindingConfig(
      warehouse() as never,
      COMMAND,
      ACTOR,
      '2026-09-10T12:00:00.000Z',
      { fingerprint: () => String(fingerprint) },
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    const ack = {
      criticalRevision: 12,
      ...COMMAND,
      bindingId: '1',
      bindingFingerprint: applied.bindingFingerprint,
      warehouse: applied.warehouse,
      production: { orders: [] },
    }
    expect((await validateProductionLineBindingAck(ack, COMMAND, {
      previousCriticalRevision: 11,
    })).ok).toBe(true)
    expect(await validateProductionLineBindingAck({ ...ack, production: undefined }, COMMAND, {
      previousCriticalRevision: 11,
    })).toEqual({
      ok: false,
      error: LINE_BINDING_CONFIG_ACK_MISMATCH,
    })
    expect(
      await validateProductionLineBindingAck(
        { ...ack, productionLocationId: 'another-location' },
        COMMAND,
        { previousCriticalRevision: 11 },
      ),
    ).toEqual({ ok: false, error: LINE_BINDING_CONFIG_ACK_MISMATCH })
    expect(
      await validateProductionLineBindingAck(
        { ...ack, note: 'forged note' },
        COMMAND,
        { previousCriticalRevision: 11 },
      ),
    ).toEqual({ ok: false, error: LINE_BINDING_CONFIG_ACK_MISMATCH })
    expect(
      await validateProductionLineBindingAck(
        { ...ack, bindingFingerprint: `line-binding:v2:${'a'.repeat(64)}` },
        COMMAND,
        { previousCriticalRevision: 11 },
      ),
    ).toEqual({ ok: false, error: LINE_BINDING_CONFIG_ACK_MISMATCH })
    expect(
      await validateProductionLineBindingAck(
        { ...ack, criticalRevision: 11 },
        COMMAND,
        { previousCriticalRevision: 11 },
      ),
    ).toEqual({ ok: false, error: LINE_BINDING_CONFIG_ACK_MISMATCH })
    expect(
      await validateProductionLineBindingAck(
        { ...ack, criticalRevision: 11, idempotent: true },
        COMMAND,
        { previousCriticalRevision: 11 },
      ),
    ).toMatchObject({ ok: true, criticalRevision: 11, idempotent: true })
  })
})
