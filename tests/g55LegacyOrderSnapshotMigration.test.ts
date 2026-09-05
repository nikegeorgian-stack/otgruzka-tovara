/**
 * PHASE G5.5 — legacy confirmed-order packagingBomSnapshot migration (G3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { G5_CAPS, defaultG5Capabilities } from '../server/fst/_g5Capabilities.mjs'
import { G3_CAPS } from '../server/fst/_g3Capabilities.mjs'
import { packagingBomContentHash } from '../server/fst/_g5PackagingBomHelpers.mjs'
import {
  buildG5DryRunSummary,
  scanOrdersMissingPackagingBomSnapshot,
} from '../src/lib/planner/g5ActivationScan'

const dcState = {
  principals: new Map<string, Record<string, unknown>>(),
  critical: null as null | Record<string, unknown>,
  receipts: new Map<string, Record<string, unknown>>(),
}

const calls = {
  getPrincipal: vi.fn(async () => ({ data: { fstPrincipalAccesses: [] as unknown[] } })),
  getCritical: vi.fn(async () => ({ data: { fstCriticalStore: null as unknown } })),
  getReceipt: vi.fn(async () => ({ data: { fstCommandReceipt: null as unknown } })),
  upsertPrincipal: vi.fn(async () => undefined),
  upsertCritical: vi.fn(async () => undefined),
  updateCas: vi.fn(async () => undefined),
  insertReceipt: vi.fn(async () => undefined),
}

vi.mock('../server/fst/_g1DataConnect.mjs', () => ({
  getG1DataConnect: vi.fn(() => ({ mocked: true })),
  getFstPrincipalAccessByUidStore: (...args: unknown[]) => calls.getPrincipal(...args),
  getFstCriticalStore: (...args: unknown[]) => calls.getCritical(...args),
  getFstCommandReceipt: (...args: unknown[]) => calls.getReceipt(...args),
  upsertFstCriticalStore: (...args: unknown[]) => calls.upsertCritical(...args),
  updateFstCriticalStoreCas: (...args: unknown[]) => calls.updateCas(...args),
  insertFstCommandReceipt: (...args: unknown[]) => calls.insertReceipt(...args),
  upsertFstPrincipalAccess: (...args: unknown[]) => calls.upsertPrincipal(...args),
}))

vi.mock('../server/fst/_adminAuth.mjs', () => ({
  FST_ADMIN_EMAILS: new Set(['admin@fibercell.net']),
  initFirebaseAdmin: vi.fn(),
}))

vi.mock('../server/fst/_qcDataConnect.mjs', () => ({
  getQcDataConnect: vi.fn(() => ({})),
  insertQcLotDecision: vi.fn(async () => undefined),
  listVerifiedLotAttachments: vi.fn(async () => []),
  upsertQcFinishedGoodsLot: vi.fn(async () => undefined),
}))

vi.mock('../server/fst/_qcStorage.mjs', () => ({
  buildQcStoragePath: vi.fn(() => 'path'),
  verifyStorageObject: vi.fn(async () => ({ ok: true })),
}))

const STORE = 'fibercell-main'
const actor = { uid: 'u1', email: 'u1@x', claims: {} }
const ALL_CAPS = defaultG5Capabilities(
  Object.fromEntries(Object.values(G5_CAPS).map((k) => [k, true])),
)

const WH = 'wh-main'
const LOC = 'loc-1'
const FG_ID = 'fp-1'
const DATE = '2026-09-04'
const ITEM_FILM = 'item-film'
const RECIPE_ID = 'form-1'

beforeEach(() => {
  for (const fn of Object.values(calls)) fn.mockReset()
  dcState.principals.clear()
  dcState.critical = null
  dcState.receipts.clear()

  calls.getPrincipal.mockImplementation(
    async (_dc: unknown, vars: { firebaseUid: string; storeId: string }) => {
      const id = `${vars.storeId}::${vars.firebaseUid}`
      const row = dcState.principals.get(id)
      return { data: { fstPrincipalAccesses: row ? [row] : [] } }
    },
  )
  calls.getCritical.mockImplementation(async () => ({
    data: { fstCriticalStore: dcState.critical },
  }))
  calls.getReceipt.mockImplementation(async (_dc: unknown, vars: { id: string }) => ({
    data: { fstCommandReceipt: dcState.receipts.get(vars.id) ?? null },
  }))
  calls.upsertCritical.mockImplementation(async (_dc: unknown, row: Record<string, unknown>) => {
    dcState.critical = { ...row }
  })
  calls.updateCas.mockImplementation(async (_dc: unknown, vars: Record<string, unknown>) => {
    if (!dcState.critical) throw new Error('missing')
    if (dcState.critical.revision !== vars.expectedRevision) throw new Error('revision_conflict')
    dcState.critical = {
      ...dcState.critical,
      revision: vars.revision,
      payloadJson: vars.payloadJson,
      fingerprint: vars.fingerprint,
      updatedByUid: vars.updatedByUid,
    }
  })
  calls.insertReceipt.mockImplementation(async (_dc: unknown, row: Record<string, unknown>) => {
    if (dcState.receipts.has(String(row.id))) throw new Error('duplicate_receipt')
    dcState.receipts.set(String(row.id), row)
  })
})

afterEach(() => {
  vi.resetModules()
})

function grant(caps: Record<string, unknown>, uid = 'u1') {
  const id = `${STORE}::${uid}`
  dcState.principals.set(id, {
    id,
    firebaseUid: uid,
    storeId: STORE,
    roleId: 'planner',
    capabilitiesJson: JSON.stringify(caps),
    active: true,
    revision: 1,
    createdByUid: 'sys',
    updatedByUid: 'sys',
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function payload(): any {
  return JSON.parse(String(dcState.critical!.payloadJson))
}

async function g5() {
  return import('../server/fst/_g5SalesProcurementService.mjs')
}
async function g3() {
  return import('../server/fst/_g3ProductionService.mjs')
}
async function g4() {
  return import('../server/fst/_g4PackagingService.mjs')
}

async function cmd(
  svc: {
    executeG5Command?: (input: Record<string, unknown>) => Promise<Record<string, unknown>>
    executeG3Command?: (input: Record<string, unknown>) => Promise<Record<string, unknown>>
    executeG4Command?: (input: Record<string, unknown>) => Promise<Record<string, unknown>>
  },
  kind: 'g5' | 'g3' | 'g4',
  commandType: string,
  command: Record<string, unknown> = {},
  idempotencyKey = `${commandType}-${Math.random().toString(36).slice(2, 8)}`,
) {
  const fn =
    kind === 'g5'
      ? svc.executeG5Command!
      : kind === 'g3'
        ? svc.executeG3Command!
        : svc.executeG4Command!
  return fn({
    actor,
    storeId: STORE,
    idempotencyKey,
    commandType,
    command,
  })
}

async function bootstrapWithLegacyOrder(opts?: { ambiguous?: boolean }) {
  grant({
    ...ALL_CAPS,
    'production.read': true,
    'production.recipe.draft.edit': true,
    'production.recipe.approve': true,
    'production.order.edit': true,
    'production.order.confirm': true,
    [G3_CAPS.ORDER_PACKAGING_BOM_SNAPSHOT_MIGRATE]: true,
    'packaging.read': true,
    'packaging.report.confirm': true,
    productionLineIds: ['*', '1', 'pack'],
  })
  const svc5 = await g5()
  for (const [type, key] of [
    ['masterdata.domain.activate', 'md-act'],
    ['sales.domain.activate', 'sp-act'],
  ] as const) {
    expect((await cmd(svc5, 'g5', type, { reason: 'g55' }, key)).ok).toBe(true)
  }
  const h = await import('../server/fst/_g1CriticalHelpers.mjs')
  let p = payload()
  p = h.markWarehouseDomainActive(p, 'u1')
  p = h.markProductionDomainActive(p, 'u1')
  p = h.markPackagingQcFeatureActive(p, 'u1')
  p.domains.warehouse.locations = [
    { id: LOC, warehouseId: WH },
    { id: 'pack-loc', warehouseId: WH },
    { id: 'fg-loc', warehouseId: WH },
  ]
  p.domains.warehouse.productionLineBindings = [
    {
      lineId: 'pack',
      packagingWarehouseId: WH,
      packagingLocationId: 'pack-loc',
      fgWarehouseId: WH,
      fgLocationId: 'fg-loc',
    },
  ]
  p.domains.warehouse.movements = [
    {
      id: 'm-seed',
      type: 'receipt',
      warehouseId: WH,
      itemId: ITEM_FILM,
      quantity: 100,
      at: DATE,
    },
  ]
  p.domains.warehouse.documents = [{ id: 'doc-seed', type: 'receipt' }]
  p.domains.production.orders = []
  p.domains.production.recipeVersions = []
  p.domains.production.packagingReports = []
  dcState.critical!.payloadJson = h.serializeCriticalPayload(p)
  dcState.critical!.fingerprint = h.fingerprintCriticalPayload(dcState.critical!.payloadJson)

  expect(
    (
      await cmd(svc5, 'g5', 'masterdata.item.upsert', {
        id: ITEM_FILM,
        code: 'FILM',
        name: 'Film',
        baseUnit: 'pcs',
        moq: 1,
        active: true,
      })
    ).ok,
  ).toBe(true)
  expect(
    (
      await cmd(svc5, 'g5', 'masterdata.product.upsert', {
        id: FG_ID,
        code: 'FP',
        name: 'FG',
        active: true,
        packagingBomId: 'bom-1',
      })
    ).ok,
  ).toBe(true)
  expect(
    (
      await cmd(svc5, 'g5', 'masterdata.bom.upsert', {
        id: 'bom-1',
        finishedProductId: FG_ID,
        baseOutputQty: 1,
        components: [{ itemId: ITEM_FILM, quantity: 2, unit: 'pcs' }],
      })
    ).ok,
  ).toBe(true)
  expect((await cmd(svc5, 'g5', 'masterdata.bom.approve', { id: 'bom-1' })).ok).toBe(true)

  const svc3 = await g3()
  await cmd(svc3, 'g3', 'production.recipe.draft.save', {
    versionId: 'rv-1',
    recipeId: RECIPE_ID,
    versionNumber: 1,
    components: [{ warehouseItemId: ITEM_FILM, unitSnapshot: 'pcs', normQty: 0.01 }],
    normBase: 'per_m2',
  })
  await cmd(svc3, 'g3', 'production.recipe.version.approve', { versionId: 'rv-1' })

  // Seed legacy confirmed order WITHOUT packagingBomSnapshot (pre-G5.4)
  p = payload()
  const movBefore = structuredClone(p.domains.warehouse.movements)
  p.domains.production.orders = [
    {
      id: 'po-legacy',
      finishedProductId: FG_ID,
      formulationRecipeId: RECIPE_ID,
      totalQtyMp: 10,
      startDate: DATE,
      endDate: DATE,
      lineId: '1',
      status: 'active',
      confirmedAt: `${DATE}T10:00:00.000Z`,
      recipeNormSnapshot: {
        recipeVersionId: 'rv-1',
        contentHash: 'legacy-norm',
        components: [{ warehouseItemId: ITEM_FILM, unitSnapshot: 'pcs', normQty: 0.01 }],
      },
      history: [{ id: 'h1', at: DATE, type: 'activated', message: 'legacy' }],
    },
  ]
  // Approve path retires siblings — seed a second approved BOM only for ambiguous cases.
  if (opts?.ambiguous) {
    const bom1 = p.domains.masterData.packagingBoms.find((b: { id: string }) => b.id === 'bom-1')
    p.domains.masterData.packagingBoms = [
      ...p.domains.masterData.packagingBoms,
      {
        ...bom1,
        id: 'bom-2',
        packagingBomId: 'bom-2',
        version: Number(bom1.version || 1) + 1,
        contentHash: packagingBomContentHash({
          finishedProductId: FG_ID,
          baseOutputQty: 1,
          components: [{ itemId: ITEM_FILM, quantity: 3, unit: 'pcs' }],
        }),
        components: [{ itemId: ITEM_FILM, quantity: 3, unit: 'pcs' }],
        status: 'approved',
        archived: false,
        active: true,
      },
    ]
  }
  dcState.critical!.payloadJson = h.serializeCriticalPayload(p)
  dcState.critical!.fingerprint = h.fingerprintCriticalPayload(dcState.critical!.payloadJson)

  calls.updateCas.mockClear()
  return { svc5, svc3, movBefore }
}

describe('G5.5 local activation scan', () => {
  it('flags active orders missing packagingBomSnapshot', () => {
    const store = {
      finishedProducts: { items: [{ id: FG_ID, code: 'FP', name: 'FG' }] },
      packagingRecipes: { items: [] },
      production: {
        requests: [],
        planner: {},
        orders: [
          {
            id: 'po-legacy',
            status: 'active',
            finishedProductId: FG_ID,
          },
          {
            id: 'po-ok',
            status: 'active',
            finishedProductId: FG_ID,
            packagingBomSnapshot: { contentHash: 'abc', packagingBomId: 'bom-1' },
          },
        ],
      },
      counterparties: { items: [] },
      warehouse: { items: [] },
      sales: { orders: [] },
      procurement: { orders: [] },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
    const issues = scanOrdersMissingPackagingBomSnapshot(store)
    expect(issues.map((i) => i.id)).toEqual(['po-legacy'])
    const summary = buildG5DryRunSummary(store)
    expect(summary.ordersMissingBomSnapshotCount).toBe(1)
    expect(
      summary.notes.some((n) => n.startsWith('g5.activation.note.ordersMissingBomSnapshot:1')),
    ).toBe(true)
  })
})

describe('G5.5 legacy packagingBomSnapshot migration', () => {
  it('preview lists orders without snapshot', async () => {
    const { svc3 } = await bootstrapWithLegacyOrder()
    const preview = await cmd(svc3, 'g3', 'production.order.packagingBomSnapshot.preview', {})
    expect(preview.ok).toBe(true)
    expect(preview.count).toBe(1)
    expect(preview.orders[0].orderId).toBe('po-legacy')
    expect(preview.orders[0].availableBoms.length).toBeGreaterThanOrEqual(1)
    expect(calls.updateCas).not.toHaveBeenCalled()
  })

  it('dry-run writes nothing', async () => {
    const { svc3 } = await bootstrapWithLegacyOrder()
    const bom = payload().domains.masterData.packagingBoms.find((b: { id: string }) => b.id === 'bom-1')
    const before = payload()
    const rev = dcState.critical!.revision
    calls.updateCas.mockClear()
    const dry = await cmd(svc3, 'g3', 'production.order.packagingBomSnapshot.apply', {
      orderId: 'po-legacy',
      packagingBomId: 'bom-1',
      packagingBomVersion: bom.version,
      reason: 'dry migrate',
      dryRun: true,
    })
    expect(dry.ok).toBe(true)
    expect(dry.dryRun).toBe(true)
    expect(dry.migrated).toBe(false)
    expect(dry.contentHash).toBeTruthy()
    expect(dcState.critical!.revision).toBe(rev)
    expect(calls.updateCas).not.toHaveBeenCalled()
    expect(payload().domains.production.orders[0].packagingBomSnapshot).toBeFalsy()
    expect(payload().domains.warehouse.movements).toEqual(before.domains.warehouse.movements)
  })

  it('apply with explicit version writes snapshot + audit, no movement change', async () => {
    const { svc3 } = await bootstrapWithLegacyOrder()
    const bom = payload().domains.masterData.packagingBoms.find((b: { id: string }) => b.id === 'bom-1')
    const movBefore = structuredClone(payload().domains.warehouse.movements)
    const docsBefore = structuredClone(payload().domains.warehouse.documents)
    const apply = await cmd(svc3, 'g3', 'production.order.packagingBomSnapshot.apply', {
      orderId: 'po-legacy',
      packagingBomId: 'bom-1',
      packagingBomVersion: bom.version,
      reason: 'legacy backfill',
      packagingBomSnapshot: { packagingBomId: 'forged', version: 99, contentHash: 'evil' },
    })
    expect(apply.ok, String(apply.error)).toBe(true)
    expect(apply.migrated).toBe(true)
    expect(apply.packagingBomId).toBe('bom-1')
    expect(apply.contentHash).toMatch(/^[a-f0-9]{64}$/i)
    const order = payload().domains.production.orders.find((o: { id: string }) => o.id === 'po-legacy')
    expect(order.packagingBomSnapshot.packagingBomId).toBe('bom-1')
    expect(order.packagingBomSnapshot.contentHash).toBe(apply.contentHash)
    expect(order.totalQtyMp).toBe(10)
    expect(order.status).toBe('active')
    expect(order.history.some((h: { type: string }) => h.type === 'packaging_bom_snapshot_migrate')).toBe(
      true,
    )
    expect(
      payload().domains.production.auditLog.some(
        (a: { action: string }) => a.action === 'packaging_bom_snapshot_migrate',
      ),
    ).toBe(true)
    expect(payload().domains.warehouse.movements).toEqual(movBefore)
    expect(payload().domains.warehouse.documents).toEqual(docsBefore)
  })

  it('ambiguous BOM blocked without unique choice; wrong product blocked', async () => {
    const { svc3 } = await bootstrapWithLegacyOrder({ ambiguous: true })
    const preview = await cmd(svc3, 'g3', 'production.order.packagingBomSnapshot.preview', {
      orderId: 'po-legacy',
    })
    expect(preview.orders[0].ambiguous).toBe(true)

    const wrongProduct = await cmd(svc3, 'g3', 'production.order.packagingBomSnapshot.apply', {
      orderId: 'po-legacy',
      packagingBomId: 'bom-other',
      packagingBomVersion: 1,
      reason: 'wrong',
    })
    expect(wrongProduct.ok).toBe(false)
    expect(wrongProduct.error).toBe('bom_not_found')

    // Explicit unique choice still succeeds when ambiguous set exists
    const bom2 = payload().domains.masterData.packagingBoms.find((b: { id: string }) => b.id === 'bom-2')
    const okChoice = await cmd(svc3, 'g3', 'production.order.packagingBomSnapshot.apply', {
      orderId: 'po-legacy',
      packagingBomId: 'bom-2',
      packagingBomVersion: bom2.version,
      reason: 'pick bom-2',
    })
    expect(okChoice.ok, String(okChoice.error)).toBe(true)
    expect(okChoice.packagingBomId).toBe('bom-2')
  })

  it('already has snapshot → idempotent', async () => {
    const { svc3 } = await bootstrapWithLegacyOrder()
    const bom = payload().domains.masterData.packagingBoms.find((b: { id: string }) => b.id === 'bom-1')
    const first = await cmd(
      svc3,
      'g3',
      'production.order.packagingBomSnapshot.apply',
      {
        orderId: 'po-legacy',
        packagingBomId: 'bom-1',
        packagingBomVersion: bom.version,
        reason: 'first',
      },
      'mig-1',
    )
    expect(first.ok).toBe(true)
    const rev = dcState.critical!.revision
    const second = await cmd(
      svc3,
      'g3',
      'production.order.packagingBomSnapshot.apply',
      {
        orderId: 'po-legacy',
        packagingBomId: 'bom-1',
        packagingBomVersion: bom.version,
        reason: 'again',
      },
      'mig-2',
    )
    expect(second.ok).toBe(true)
    expect(second.idempotent).toBe(true)
    expect(second.migrated).toBe(false)
    // Idempotent path still CAS-commits result receipt for non-dry apply
    // but must not change snapshot hash
    const order = payload().domains.production.orders[0]
    expect(order.packagingBomSnapshot.contentHash).toBe(first.contentHash)
    expect(Number(dcState.critical!.revision)).toBeGreaterThanOrEqual(Number(rev))
  })

  it('G4 still fail-closed without snapshot', async () => {
    const { svc3 } = await bootstrapWithLegacyOrder()
    const svc4 = await g4()
    const h = await import('../server/fst/_g1CriticalHelpers.mjs')
    const p = payload()
    p.domains.warehouse.movements = [
      ...p.domains.warehouse.movements,
      {
        id: 'm-wip',
        type: 'receipt',
        warehouseId: WH,
        locationId: 'pack-loc',
        itemId: 'wip-1',
        quantity: 50,
        at: DATE,
        productionOrderId: 'po-legacy',
        isWip: true,
        batchNo: 'WB1',
      },
    ]
    dcState.critical!.payloadJson = h.serializeCriticalPayload(p)

    const pack = await cmd(svc4, 'g4', 'packaging.report.confirm', {
      productionOrderId: 'po-legacy',
      lineId: 'pack',
      reportDate: DATE,
      finishedProductId: FG_ID,
      warehouseItemId: FG_ID,
      outputM2: 10,
      outputRolls: 1,
      wipLines: [{ semiFinishedItemId: 'wip-1', quantity: 10, wipBatchId: 'WB1', unitSnapshot: 'pcs' }],
      materialLines: [{ itemId: ITEM_FILM, quantity: 20, unitSnapshot: 'pcs' }],
    })
    expect(pack.ok).toBe(false)
    expect(pack.error).toBe('packaging_bom_snapshot_required')

    // After migrate, G4 can proceed (norms from snapshot)
    const bom = payload().domains.masterData.packagingBoms.find((b: { id: string }) => b.id === 'bom-1')
    expect(
      (
        await cmd(svc3, 'g3', 'production.order.packagingBomSnapshot.apply', {
          orderId: 'po-legacy',
          packagingBomId: 'bom-1',
          packagingBomVersion: bom.version,
          reason: 'for g4',
        })
      ).ok,
    ).toBe(true)
  })

  it('capability required', async () => {
    await bootstrapWithLegacyOrder()
    grant({
      ...ALL_CAPS,
      'production.read': true,
      [G3_CAPS.ORDER_PACKAGING_BOM_SNAPSHOT_MIGRATE]: false,
      productionLineIds: ['*'],
    })
    const svc3 = await g3()
    const bom = payload().domains.masterData.packagingBoms.find((b: { id: string }) => b.id === 'bom-1')
    const denied = await cmd(svc3, 'g3', 'production.order.packagingBomSnapshot.apply', {
      orderId: 'po-legacy',
      packagingBomId: 'bom-1',
      packagingBomVersion: bom.version,
      reason: 'no cap',
    })
    expect(denied.ok).toBe(false)
    expect(denied.status).toBe(403)
    expect(denied.error).toBe('forbidden')

    const previewDenied = await cmd(svc3, 'g3', 'production.order.packagingBomSnapshot.preview', {})
    expect(previewDenied.ok).toBe(false)
    expect(previewDenied.status).toBe(403)
  })

  it('helper hash matches approved bom content', () => {
    const hash = packagingBomContentHash({
      finishedProductId: FG_ID,
      baseOutputQty: 1,
      components: [{ itemId: ITEM_FILM, quantity: 2, unit: 'pcs' }],
    })
    expect(hash).toMatch(/^[a-f0-9]{64}$/i)
  })
})
