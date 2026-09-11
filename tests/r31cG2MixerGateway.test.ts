/** R3.1C — strict G2 mixer receipts re-enter canonical state validation. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyCriticalPayload } from '../server/fst/_g1CriticalHelpers.mjs'
import { batchMixCommandFingerprint } from '@/lib/formulations/batchMixFingerprint.mjs'

const harness = vi.hoisted(() => ({
  critical: null as null | Record<string, unknown>,
  receipts: new Map<string, Record<string, unknown>>(),
  updateCas: vi.fn(async () => undefined),
  upsertCritical: vi.fn(async () => undefined),
}))

vi.mock('../server/fst/_g1DataConnect.mjs', () => ({
  getG1DataConnect: vi.fn(() => ({ mocked: true })),
  getFstPrincipalAccessByUidStore: vi.fn(async () => ({
    data: {
      fstPrincipalAccesses: [
        {
          id: 'fibercell-main::keeper-1',
          firebaseUid: 'keeper-1',
          storeId: 'fibercell-main',
          active: true,
          capabilitiesJson: JSON.stringify({ 'warehouse.document.post': true }),
        },
      ],
    },
  })),
  getFstCriticalStore: vi.fn(async () => ({ data: { fstCriticalStore: harness.critical } })),
  getFstCommandReceipt: vi.fn(async (_dc: unknown, vars: { id: string }) => ({
    data: { fstCommandReceipt: harness.receipts.get(vars.id) ?? null },
  })),
  upsertFstCriticalStore: (...args: unknown[]) => harness.upsertCritical(...args),
  upsertFstPrincipalAccess: vi.fn(async () => undefined),
  updateFstCriticalStoreCas: (...args: unknown[]) => harness.updateCas(...args),
  insertFstCommandReceipt: vi.fn(async (_dc: unknown, row: Record<string, unknown>) => {
    harness.receipts.set(String(row.id), row)
  }),
}))

vi.mock('../server/fst/_adminAuth.mjs', () => ({
  FST_ADMIN_EMAILS: new Set<string>(),
}))

vi.mock('../server/fst/_dataConnectRuntime.mjs', () => ({
  isStagingIsolatedRuntime: () => true,
}))

const DATE = '2026-09-10'
const KEY = 'warehouse::batch_mix::batch-run-1::confirm'

function command(overrides: Record<string, unknown> = {}) {
  return {
    batchRunId: 'batch-run-1',
    recipeId: 'recipe-1',
    documentNumber: 'ZM-20260910-001',
    warehouseId: 'raw-wh',
    date: DATE,
    productionOrderId: 'order-1',
    productionLineId: 'line-1',
    issueLines: [
      { itemId: 'component-a', quantity: 8 },
      { itemId: 'component-b', quantity: 12 },
    ],
    receiptLines: [{ itemId: 'impregnation-output', quantity: 20 }],
    ...overrides,
  }
}

function setCritical() {
  const payload = emptyCriticalPayload()
  payload.domainMeta.warehouse = { active: true, version: 1 }
  payload.domainMeta.production = { active: true, version: 1 }
  payload.domains.warehouse.locations = [
    { id: 'raw-wh' },
    { id: 'line-wh' },
    { id: 'line-location' },
  ]
  payload.domains.warehouse.items = [
    { id: 'component-a', name: 'A', unit: 'kg', active: true },
    { id: 'component-b', name: 'B', unit: 'kg', active: true },
    { id: 'impregnation-output', name: 'Output', unit: 'kg', active: true },
  ]
  payload.domains.warehouse.productionLineBindings = [
    {
      lineId: 'line-1',
      productionWarehouseId: 'line-wh',
      productionLocationId: 'line-location',
    },
  ]
  payload.domains.warehouse.movements = [
    {
      id: 'seed-a',
      documentId: 'seed',
      type: 'receipt',
      itemId: 'component-a',
      quantity: 100,
      warehouseId: 'raw-wh',
      date: DATE,
      at: `${DATE}T00:00:00.000Z`,
    },
    {
      id: 'seed-b',
      documentId: 'seed',
      type: 'receipt',
      itemId: 'component-b',
      quantity: 100,
      warehouseId: 'raw-wh',
      date: DATE,
      at: `${DATE}T00:00:00.000Z`,
    },
  ]
  payload.domains.production.orders = [
    {
      id: 'order-1',
      status: 'active',
      wipContractVersion: 1,
      lineId: 'line-1',
      formulationRecipeId: 'recipe-1',
      impregnationOutputItemId: 'impregnation-output',
      recipeNormSnapshot: {
        recipeId: 'recipe-1',
        recipeVersionId: 'recipe-version-1',
        versionNumber: 1,
        contentHash: 'rv-1',
        normBase: 'per_batch',
        batchSize: 10,
        components: [
          { lineId: 'a', warehouseItemId: 'component-a', normQty: 4, unitSnapshot: 'kg' },
          { lineId: 'b', warehouseItemId: 'component-b', normQty: 6, unitSnapshot: 'kg' },
        ],
      },
    },
  ]
  harness.critical = {
    id: 'fibercell-main',
    revision: 7,
    payloadJson: JSON.stringify(payload),
    fingerprint: 'fixture',
  }
}

async function execute(cmd = command(), key = KEY) {
  const service = await import('../server/fst/_g2WarehouseService.mjs')
  return service.executeG2Command({
    actor: { uid: 'keeper-1', email: 'keeper@example.test', claims: {} },
    storeId: 'fibercell-main',
    idempotencyKey: key,
    commandType: 'warehouse.batchMix.confirm',
    command: cmd,
  })
}

beforeEach(() => {
  harness.receipts.clear()
  harness.updateCas.mockReset()
  harness.upsertCritical.mockClear()
  harness.updateCas.mockImplementation(async (_dc: unknown, vars: Record<string, unknown>) => {
    harness.critical = {
      ...harness.critical,
      revision: vars.revision,
      payloadJson: vars.payloadJson,
      fingerprint: vars.fingerprint,
    }
  })
  setCritical()
})

describe('R3.1C G2 canonical mixer gateway', () => {
  it('revalidates an exact receipt replay without a second CAS', async () => {
    const first = await execute()
    expect(first.ok).toBe(true)
    expect(harness.updateCas).toHaveBeenCalledTimes(1)

    const replay = await execute()
    expect(replay).toMatchObject({ ok: true, idempotent: true, criticalRevision: 8 })
    expect(harness.updateCas).toHaveBeenCalledTimes(1)
  })

  it('rejects changed payload and cross-command key collisions', async () => {
    const first = await execute()
    expect(first.ok).toBe(true)
    harness.updateCas.mockClear()

    const changed = await execute(
      command({
        issueLines: [
          { itemId: 'component-a', quantity: 8 },
          { itemId: 'component-b', quantity: 11.999 },
        ],
      }),
    )
    expect(changed).toMatchObject({ ok: false, error: 'batch_mix_idempotency_conflict' })
    expect(harness.updateCas).not.toHaveBeenCalled()

    harness.receipts.set('cross-command-key', {
      id: 'cross-command-key',
      storeId: 'fibercell-main',
      commandType: 'warehouse.transfer.post',
      resultJson: JSON.stringify({ unrelated: true }),
      criticalRevisionAfter: 8,
    })
    const collision = await execute(command(), 'cross-command-key')
    expect(collision).toMatchObject({ ok: false, error: 'batch_mix_idempotency_conflict' })
    expect(harness.updateCas).not.toHaveBeenCalled()
  })

  it('rejects a stale receipt whose claimed docs are absent', async () => {
    const cmd = command()
    harness.receipts.set(KEY, {
      id: KEY,
      storeId: 'fibercell-main',
      commandType: 'warehouse.batchMix.confirm',
      resultJson: JSON.stringify({ commandFingerprint: batchMixCommandFingerprint(cmd) }),
      criticalRevisionAfter: 7,
    })

    const result = await execute(cmd)

    expect(result).toMatchObject({ ok: false, error: 'batch_mix_receipt_state_mismatch' })
    expect(harness.updateCas).not.toHaveBeenCalled()
  })

  it('rejects a new unlinked staging batch without writing', async () => {
    const result = await execute(
      command({ productionOrderId: undefined, productionLineId: undefined }),
    )
    expect(result).toMatchObject({ ok: false, error: 'mixer_lineage_incomplete' })
    expect(harness.updateCas).not.toHaveBeenCalled()
  })

  it('does not initialize an absent critical store for a batch confirm', async () => {
    harness.critical = null

    const result = await execute()

    expect(result).toMatchObject({ ok: false, error: 'critical_store_not_found' })
    expect(harness.upsertCritical).not.toHaveBeenCalled()
    expect(harness.updateCas).not.toHaveBeenCalled()
  })
})
