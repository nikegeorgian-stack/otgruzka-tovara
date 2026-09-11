/** R3.1C — G3 freezes an authoritative impregnation output item on v1 orders. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyCriticalPayload } from '../server/fst/_g1CriticalHelpers.mjs'

const harness = vi.hoisted(() => ({
  critical: null as null | Record<string, unknown>,
  updateCas: vi.fn(async () => undefined),
  insertReceipt: vi.fn(async () => undefined),
}))

vi.mock('../server/fst/_g1DataConnect.mjs', () => ({
  getG1DataConnect: vi.fn(() => ({ mocked: true })),
  getFstPrincipalAccessByUidStore: vi.fn(async () => ({
    data: {
      fstPrincipalAccesses: [
        {
          id: 'fibercell-main::planner-1',
          firebaseUid: 'planner-1',
          storeId: 'fibercell-main',
          active: true,
          capabilitiesJson: JSON.stringify({ 'production.order.confirm': true }),
        },
      ],
    },
  })),
  getFstCriticalStore: vi.fn(async () => ({
    data: { fstCriticalStore: harness.critical },
  })),
  getFstCommandReceipt: vi.fn(async () => ({
    data: { fstCommandReceipt: null },
  })),
  upsertFstCriticalStore: vi.fn(async () => undefined),
  updateFstCriticalStoreCas: (...args: unknown[]) => harness.updateCas(...args),
  insertFstCommandReceipt: (...args: unknown[]) => harness.insertReceipt(...args),
}))

vi.mock('../server/fst/_adminAuth.mjs', () => ({
  FST_ADMIN_EMAILS: new Set<string>(),
}))

vi.mock('../server/fst/_dataConnectRuntime.mjs', () => ({
  isStagingIsolatedRuntime: () => true,
}))

const NOW = '2026-09-10T12:00:00.000Z'

function setCritical(
  impregnationOutputItemId: string | undefined,
  includeItem = true,
  orderWarehouseItemId = 'finished-item-1',
) {
  const payload = emptyCriticalPayload()
  payload.domainMeta.production = { active: true, version: 1 }
  payload.domainMeta.warehouse = { active: true, version: 1 }
  payload.domainMeta.masterData = { active: true, version: 1 }
  payload.domains.masterData.finishedProducts = [
    {
      id: 'finished-product-1',
      name: 'Celloplex 160',
      warehouseItemId: 'finished-item-1',
      baseUnit: 'm2',
      packagingBomRequired: false,
      active: true,
    },
  ]
  payload.domains.masterData.items = [
    { id: 'raw-item-1', name: 'Mesh', baseUnit: 'roll', active: true },
    { id: 'wip-item-1', name: 'Line WIP', baseUnit: 'm2', active: true },
    { id: 'finished-item-1', name: 'FG', baseUnit: 'm2', active: true },
    { id: 'chemical-1', name: 'Chemical', baseUnit: 'kg', active: true },
  ]
  payload.domains.production.recipeVersions = [
    {
      id: 'recipe-version-1',
      recipeId: 'recipe-1',
      versionNumber: 1,
      status: 'approved',
      normBase: 'per_batch',
      batchSize: 10,
      contentHash: 'rv-1',
      approvedAt: NOW,
      components: [
        {
          lineId: 'component-line-1',
          warehouseItemId: 'chemical-1',
          unitSnapshot: 'kg',
          normQty: 10,
          tolerancePct: 0,
        },
      ],
    },
  ]
  payload.domains.production.orders = [
    {
      id: 'order-1',
      orderNumber: 'PO-1',
      status: 'draft',
      wipContractVersion: 1,
      finishedProductId: 'finished-product-1',
      warehouseItemId: orderWarehouseItemId,
      semiFinishedItemId: 'wip-item-1',
      rawMaterialItemId: 'raw-item-1',
      rawMaterialQty: 2,
      formulationRecipeId: 'recipe-1',
      impregnationOutputItemId,
      lineId: '1',
      totalQtyMp: 100,
      startDate: '2026-09-10',
      endDate: '2026-09-10',
      priority: 'normal',
      history: [],
    },
  ]
  payload.domains.warehouse.items = [
    { id: 'raw-item-1', name: 'Mesh', unit: 'roll', active: true },
    { id: 'wip-item-1', name: 'Line WIP', unit: 'm2', active: true },
    { id: 'finished-item-1', name: 'FG', unit: 'm2', active: true },
    { id: 'chemical-1', name: 'Chemical', unit: 'kg', active: true },
    ...(includeItem
      ? [{ id: 'impregnation-item-1', name: 'Impregnation', unit: 'kg', active: true }]
      : []),
  ]
  payload.domains.warehouse.locations = [{ id: 'raw-wh', name: 'Raw' }]
  payload.domains.warehouse.movements = [
    {
      id: 'raw-stock',
      documentId: 'raw-receipt',
      type: 'receipt',
      itemId: 'raw-item-1',
      quantity: 2,
      warehouseId: 'raw-wh',
      date: '2026-09-10',
      at: NOW,
    },
  ]
  harness.critical = {
    id: 'fibercell-main',
    revision: 7,
    payloadJson: JSON.stringify(payload),
    fingerprint: 'fixture',
  }
}

async function confirm() {
  const service = await import('../server/fst/_g3ProductionService.mjs')
  return service.executeG3Command({
    actor: { uid: 'planner-1', email: 'planner@example.test', claims: {} },
    storeId: 'fibercell-main',
    idempotencyKey: 'confirm-order-1',
    commandType: 'production.order.confirm',
    command: { orderId: 'order-1', rawWarehouseId: 'raw-wh' },
  })
}

beforeEach(() => {
  harness.critical = null
  harness.updateCas.mockClear()
  harness.insertReceipt.mockClear()
})

describe('R3.1C G3 impregnation output mapping', () => {
  it('preserves the validated output item on the activated frozen order', async () => {
    setCritical('impregnation-item-1')

    const result = await confirm()

    expect(result.ok, JSON.stringify(result)).toBe(true)
    expect(result.production.orders[0]).toMatchObject({
      status: 'active',
      wipContractVersion: 1,
      impregnationOutputItemId: 'impregnation-item-1',
      packagingBomRequired: false,
      recipeNormSnapshot: {
        recipeId: 'recipe-1',
        recipeVersionId: 'recipe-version-1',
      },
    })
    expect(harness.updateCas).toHaveBeenCalledTimes(1)
  })

  it('requires a distinct mass-unit mixer output before any reservation write', async () => {
    setCritical('impregnation-item-1')
    const nonMassPayload = JSON.parse(String(harness.critical?.payloadJson))
    nonMassPayload.domains.warehouse.items.find(
      (item: { id: string }) => item.id === 'impregnation-item-1',
    ).unit = 'm2'
    harness.critical = {
      ...harness.critical,
      payloadJson: JSON.stringify(nonMassPayload),
    }

    const nonMass = await confirm()
    expect(nonMass).toMatchObject({
      ok: false,
      error: 'impregnation_output_mass_unit_required',
    })
    expect(harness.updateCas).not.toHaveBeenCalled()

    setCritical('wip-item-1')
    const sameAsWip = await confirm()
    expect(sameAsWip).toMatchObject({
      ok: false,
      error: 'impregnation_output_must_differ_from_wip_and_finished_goods',
    })
    expect(harness.updateCas).not.toHaveBeenCalled()

    setCritical('finished-item-1')
    const sameAsFinishedGoods = await confirm()
    expect(sameAsFinishedGoods).toMatchObject({
      ok: false,
      error: 'impregnation_output_must_differ_from_wip_and_finished_goods',
    })
    expect(harness.updateCas).not.toHaveBeenCalled()
  })

  it('fails without mutating when the mapping is missing or unavailable', async () => {
    setCritical(undefined)
    const missing = await confirm()
    expect(missing).toMatchObject({
      ok: false,
      error: 'impregnation_output_mapping_required',
    })
    expect(harness.updateCas).not.toHaveBeenCalled()

    setCritical('impregnation-item-1', false)
    const unavailable = await confirm()
    expect(unavailable).toMatchObject({
      ok: false,
      error: 'impregnation_output_item_unavailable',
    })
    expect(harness.updateCas).not.toHaveBeenCalled()
  })

  it('rejects a forged finished-product warehouse item before reserving stock', async () => {
    setCritical('impregnation-item-1', true, 'forged-finished-item')

    const result = await confirm()

    expect(result).toMatchObject({
      ok: false,
      error: 'finished_goods_mapping_mismatch',
    })
    expect(harness.updateCas).not.toHaveBeenCalled()
  })

  it('rejects an ambiguous WIP item identity before reserving stock', async () => {
    setCritical('impregnation-item-1')
    const ambiguousPayload = JSON.parse(String(harness.critical?.payloadJson))
    ambiguousPayload.domains.masterData.items.push({
      id: 'wip-item-1',
      name: 'Duplicate Line WIP',
      baseUnit: 'm2',
      active: true,
    })
    harness.critical = {
      ...harness.critical,
      payloadJson: JSON.stringify(ambiguousPayload),
    }

    const result = await confirm()

    expect(result).toMatchObject({ ok: false, error: 'wip_item_ambiguous' })
    expect(harness.updateCas).not.toHaveBeenCalled()
    expect(harness.insertReceipt).not.toHaveBeenCalled()
  })
})
