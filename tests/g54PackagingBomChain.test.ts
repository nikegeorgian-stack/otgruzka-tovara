/**
 * PHASE G5.4 — packaging BOM chain: MRP → recommendation → G3 snapshot → G4 actual.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { G5_CAPS, defaultG5Capabilities } from '../api/fst/_g5Capabilities.mjs'
import {
  buildPackagingBomSnapshot,
  comparePackagingActualToNorm,
  computePackagingRequirements,
  legacyRecipeToDraftComponents,
  packagingBomContentHash,
  selectApprovedPackagingBom,
} from '../api/fst/_g5PackagingBomHelpers.mjs'

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

vi.mock('../api/fst/_g1DataConnect.mjs', () => ({
  getG1DataConnect: vi.fn(() => ({ mocked: true })),
  getFstPrincipalAccessByUidStore: (...args: unknown[]) => calls.getPrincipal(...args),
  getFstCriticalStore: (...args: unknown[]) => calls.getCritical(...args),
  getFstCommandReceipt: (...args: unknown[]) => calls.getReceipt(...args),
  upsertFstCriticalStore: (...args: unknown[]) => calls.upsertCritical(...args),
  updateFstCriticalStoreCas: (...args: unknown[]) => calls.updateCas(...args),
  insertFstCommandReceipt: (...args: unknown[]) => calls.insertReceipt(...args),
  upsertFstPrincipalAccess: (...args: unknown[]) => calls.upsertPrincipal(...args),
}))

vi.mock('../api/fst/_adminAuth.mjs', () => ({
  FST_ADMIN_EMAILS: new Set(['admin@fibercell.net']),
  initFirebaseAdmin: vi.fn(),
}))

vi.mock('../api/fst/_qcDataConnect.mjs', () => ({
  getQcDataConnect: vi.fn(() => ({})),
  insertQcLotDecision: vi.fn(async () => undefined),
  listVerifiedLotAttachments: vi.fn(async () => []),
  upsertQcFinishedGoodsLot: vi.fn(async () => undefined),
}))

vi.mock('../api/fst/_qcStorage.mjs', () => ({
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
const CUST_ID = 'cust-1'
const DATE = '2026-09-04'
const ITEM_FILM = 'item-film'
const ITEM_LABEL = 'item-label'
const ITEM_CORNER = 'item-corner'
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
  return import('../api/fst/_g5SalesProcurementService.mjs')
}
async function g3() {
  return import('../api/fst/_g3ProductionService.mjs')
}
async function g4() {
  return import('../api/fst/_g4PackagingService.mjs')
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

async function bootstrapMdSales() {
  grant({
    ...ALL_CAPS,
    'production.read': true,
    'production.recipe.draft.edit': true,
    'production.recipe.approve': true,
    'production.order.edit': true,
    'production.order.confirm': true,
    'production.domain.activate': true,
    'packaging.read': true,
    'packaging.report.confirm': true,
    'packaging.report.correct': true,
    productionLineIds: ['*', '1', 'pack'],
  })
  const svc = await g5()
  for (const [type, key] of [
    ['masterdata.domain.activate', 'md-act'],
    ['sales.domain.activate', 'sp-act'],
  ] as const) {
    expect((await cmd(svc, 'g5', type, { reason: 'g54' }, key)).ok).toBe(true)
  }
  const h = await import('../api/fst/_g1CriticalHelpers.mjs')
  let p = payload()
  p = h.markWarehouseDomainActive(p, 'u1')
  p = h.markProductionDomainActive(p, 'u1')
  p.domains.warehouse.locations = [{ id: LOC, warehouseId: WH }]
  p.domains.warehouse.movements = []
  p.domains.warehouse.documents = []
  p.domains.production.orders = []
  p.domains.production.recipeVersions = []
  p.domains.production.packagingReports = []
  p.domains.production.finishedGoodsLots = []
  dcState.critical!.payloadJson = h.serializeCriticalPayload(p)
  dcState.critical!.fingerprint = h.fingerprintCriticalPayload(dcState.critical!.payloadJson)

  for (const [id, code, name] of [
    [ITEM_FILM, 'FILM', 'Film'],
    [ITEM_LABEL, 'LBL', 'Label'],
    [ITEM_CORNER, 'CRN', 'Corner'],
  ] as const) {
    const r = await cmd(svc, 'g5', 'masterdata.item.upsert', {
      id,
      code,
      name,
      baseUnit: 'pcs',
      moq: 1,
      active: true,
    })
    expect(r.ok, r.error).toBe(true)
  }
  expect(
    (
      await cmd(svc, 'g5', 'masterdata.product.upsert', {
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
      await cmd(svc, 'g5', 'masterdata.customer.upsert', {
        id: CUST_ID,
        code: 'C',
        name: 'Cust',
        active: true,
      })
    ).ok,
  ).toBe(true)
  expect(
    (
      await cmd(svc, 'g5', 'masterdata.bom.upsert', {
        id: 'bom-1',
        finishedProductId: FG_ID,
        baseOutputQty: 1,
        components: [
          { itemId: ITEM_FILM, quantity: 2, unit: 'pcs', wasteFactor: 0.1 },
          { itemId: ITEM_LABEL, quantity: 1, unit: 'pcs' },
          { itemId: ITEM_CORNER, quantity: 4, unit: 'pcs', tolerance: 0.05 },
        ],
      })
    ).ok,
  ).toBe(true)
  expect((await cmd(svc, 'g5', 'masterdata.bom.approve', { id: 'bom-1' })).ok).toBe(true)
  return svc
}

describe('G5.4 packaging BOM helpers', () => {
  it('legacy pallet/box mapping creates draft requires_review only', () => {
    const legacy = legacyRecipeToDraftComponents({
      palletItemId: 'p1',
      boxItemId: 'b1',
      rollsPerBox: 3,
      stack: ['pallet', 'box'],
    })
    expect(legacy.status).toBe('draft')
    expect(legacy.requiresReview).toBe(true)
    expect(legacy.reviewKind).toBe('requires_review')
    expect(legacy.components.map((c) => c.itemId)).toEqual(['p1', 'b1'])
  })

  it('norm/actual/deviation/tolerance and excess reason', () => {
    const snap = {
      packagingBomId: 'bom-1',
      version: 1,
      contentHash: 'abc',
      baseOutputQty: 1,
      components: [
        { itemId: ITEM_FILM, quantity: 2, unit: 'pcs', wasteFactor: 0, tolerance: 0.1 },
      ],
    }
    const ok = comparePackagingActualToNorm(snap, 10, [
      { itemId: ITEM_FILM, quantity: 21, unitSnapshot: 'pcs' },
    ])
    expect(ok.ok).toBe(true)
    expect(ok.components![0].normQty).toBe(20)
    expect(ok.components![0].actualQty).toBe(21)
    const excess = comparePackagingActualToNorm(snap, 10, [
      { itemId: ITEM_FILM, quantity: 25, unitSnapshot: 'pcs' },
    ])
    expect(excess.ok).toBe(false)
    expect(excess.error).toBe('packaging_excess_reason_required')
    const withReason = comparePackagingActualToNorm(
      snap,
      10,
      [{ itemId: ITEM_FILM, quantity: 25, unitSnapshot: 'pcs' }],
      { excessReason: 'tear' },
    )
    expect(withReason.ok).toBe(true)
    const unitBad = comparePackagingActualToNorm(snap, 1, [
      { itemId: ITEM_FILM, quantity: 2, unitSnapshot: 'kg' },
    ])
    expect(unitBad.ok).toBe(false)
    expect(unitBad.error).toBe('packaging_unit_mismatch')
  })
})

describe('G5.4 MRP → accept → G3 snapshot → G4', () => {
  it('MRP run records packagingBomRefs; draft BOM ignored; accept attaches trusted refs', async () => {
    const svc = await bootstrapMdSales()
    // draft bom for other product should not be used
    await cmd(svc, 'g5', 'masterdata.product.upsert', {
      id: 'fp-2',
      code: 'FP2',
      name: 'FG2',
      active: true,
      packagingBomId: 'bom-draft',
    })
    await cmd(svc, 'g5', 'masterdata.bom.upsert', {
      id: 'bom-draft',
      finishedProductId: 'fp-2',
      baseOutputQty: 1,
      components: [{ itemId: ITEM_FILM, quantity: 1, unit: 'pcs' }],
    })

    expect(
      (
        await cmd(svc, 'g5', 'sales.order.draft.save', {
          id: 'so-1',
          customerId: CUST_ID,
          priority: 1,
          lines: [
            {
              lineId: 'l1',
              finishedProductId: FG_ID,
              quantity: 10,
              unit: 'm2',
              requestedShipDate: '2026-09-20',
            },
          ],
        })
      ).ok,
    ).toBe(true)
    expect((await cmd(svc, 'g5', 'sales.order.confirm', { id: 'so-1' })).ok).toBe(true)
    const run = await cmd(svc, 'g5', 'planning.mrp.run', { asOfDate: DATE })
    expect(run.ok).toBe(true)
    const refs = payload().domains.planning.planningRuns.at(-1).packagingBomRefs
    expect(refs.length).toBeGreaterThan(0)
    expect(refs[0].packagingBomId).toBe('bom-1')
    expect(refs[0].contentHash).toMatch(/^[a-f0-9]{64}$/i)

    const p = payload()
    const rec = p.domains.planning.productionRecommendations.find(
      (r: { status: string }) => r.status === 'open',
    )
    expect(rec.packagingBomId).toBe('bom-1')

    const accept = await cmd(svc, 'g5', 'planning.mrp.acceptProductionDrafts', {
      planningRunId: run.planningRunId,
      recommendationIds: [rec.id],
    })
    expect(accept.ok).toBe(true)
    const draft = accept.productionOrderDrafts[0]
    expect(draft.packagingBomId).toBe('bom-1')
    expect(draft.packagingBomContentHash).toBe(refs[0].contentHash)
    expect(draft.packagingRequirements.length).toBe(3)
    expect(draft.planningRunId).toBe(run.planningRunId)
  })

  it('accept rejects client forged BOM and stale BOM', async () => {
    const svc = await bootstrapMdSales()
    await cmd(svc, 'g5', 'sales.order.draft.save', {
      id: 'so-2',
      customerId: CUST_ID,
      lines: [
        {
          lineId: 'l1',
          finishedProductId: FG_ID,
          quantity: 5,
          unit: 'm2',
          requestedShipDate: '2026-09-20',
        },
      ],
    })
    await cmd(svc, 'g5', 'sales.order.confirm', { id: 'so-2' })
    const run = await cmd(svc, 'g5', 'planning.mrp.run', { asOfDate: DATE })
    const forged = await cmd(svc, 'g5', 'planning.mrp.acceptProductionDrafts', {
      planningRunId: run.planningRunId,
      packagingBomSnapshot: { packagingBomId: 'evil', version: 99, contentHash: 'x' },
    })
    expect(forged.ok).toBe(false)
    expect(forged.error).toBe('client_bom_forbidden')

    // Retire BOM → run becomes stale on accept refresh
    await cmd(svc, 'g5', 'masterdata.bom.archive', { id: 'bom-1' })
    const stale = await cmd(svc, 'g5', 'planning.mrp.acceptProductionDrafts', {
      planningRunId: run.planningRunId,
    })
    expect(stale.ok).toBe(false)
    expect(['planning_run_stale', 'packaging_bom_required', 'packaging_bom_stale']).toContain(
      stale.error,
    )
  })

  it('G3 confirm builds packagingBomSnapshot; BOM change after confirm does not alter it', async () => {
    const svc5 = await bootstrapMdSales()
    const svc3 = await g3()
    // activate production already done in bootstrap
    await cmd(svc3, 'g3', 'production.recipe.draft.save', {
      versionId: 'rv-1',
      recipeId: RECIPE_ID,
      versionNumber: 1,
      components: [
        {
          warehouseItemId: ITEM_FILM,
          unitSnapshot: 'pcs',
          normQty: 0.01,
        },
      ],
      normBase: 'per_m2',
    })
    await cmd(svc3, 'g3', 'production.recipe.version.approve', { versionId: 'rv-1' })
    await cmd(svc3, 'g3', 'production.order.draft.save', {
      orderId: 'po-1',
      finishedProductId: FG_ID,
      formulationRecipeId: RECIPE_ID,
      totalQtyMp: 10,
      startDate: DATE,
      endDate: DATE,
      lineId: '1',
      packagingBomId: 'bom-1',
      packagingBomVersion: payload().domains.masterData.packagingBoms[0].version,
      packagingBomContentHash: payload().domains.masterData.packagingBoms[0].contentHash,
    })
    // seed stock for reserve
    const h = await import('../api/fst/_g1CriticalHelpers.mjs')
    const p = payload()
    p.domains.warehouse.movements = [
      {
        id: 'm1',
        type: 'receipt',
        warehouseId: WH,
        itemId: ITEM_FILM,
        quantity: 100,
        at: DATE,
      },
    ]
    dcState.critical!.payloadJson = h.serializeCriticalPayload(p)

    const conf = await cmd(svc3, 'g3', 'production.order.confirm', {
      orderId: 'po-1',
      rawWarehouseId: WH,
      packagingBomSnapshot: { packagingBomId: 'forged', version: 9, contentHash: 'nope' },
    })
    expect(conf.ok).toBe(true)
    const order = payload().domains.production.orders.find((o: { id: string }) => o.id === 'po-1')
    expect(order.packagingBomSnapshot.packagingBomId).toBe('bom-1')
    expect(order.packagingBomSnapshot.contentHash).toBe(conf.packagingBomContentHash)
    const frozenHash = order.packagingBomSnapshot.contentHash

    // Change BOM after confirm
    await cmd(svc5, 'g5', 'masterdata.bom.upsert', {
      id: 'bom-1b',
      finishedProductId: FG_ID,
      baseOutputQty: 1,
      components: [{ itemId: ITEM_FILM, quantity: 99, unit: 'pcs' }],
    })
    await cmd(svc5, 'g5', 'masterdata.bom.approve', { id: 'bom-1b' })
    await cmd(svc5, 'g5', 'masterdata.product.upsert', {
      id: FG_ID,
      code: 'FP',
      name: 'FG',
      active: true,
      packagingBomId: 'bom-1b',
    })
    const order2 = payload().domains.production.orders.find((o: { id: string }) => o.id === 'po-1')
    expect(order2.packagingBomSnapshot.contentHash).toBe(frozenHash)
  })

  it('manual order without required BOM blocked; packagingBomRequired=false allowed', async () => {
    const svc5 = await bootstrapMdSales()
    const svc3 = await g3()
    await cmd(svc3, 'g3', 'production.recipe.draft.save', {
      versionId: 'rv-2',
      recipeId: 'form-2',
      versionNumber: 1,
      components: [{ warehouseItemId: ITEM_FILM, unitSnapshot: 'pcs', normQty: 1 }],
      normBase: 'per_m2',
    })
    await cmd(svc3, 'g3', 'production.recipe.version.approve', { versionId: 'rv-2' })

    await cmd(svc5, 'g5', 'masterdata.product.upsert', {
      id: 'fp-nobom',
      code: 'NOBOM',
      name: 'NoBom',
      active: true,
    })
    // archive only bom for fp-nobom — product has no approved bom
    await cmd(svc3, 'g3', 'production.order.draft.save', {
      orderId: 'po-nobom',
      finishedProductId: 'fp-nobom',
      formulationRecipeId: 'form-2',
      totalQtyMp: 1,
      startDate: DATE,
      endDate: DATE,
      lineId: '1',
    })
    const blocked = await cmd(svc3, 'g3', 'production.order.confirm', {
      orderId: 'po-nobom',
      rawWarehouseId: WH,
    })
    expect(blocked.ok).toBe(false)
    expect(blocked.error).toBe('packaging_bom_required')

    await cmd(svc5, 'g5', 'masterdata.product.upsert', {
      id: 'fp-opt',
      code: 'OPT',
      name: 'Opt',
      active: true,
      packagingBomRequired: false,
    })
    await cmd(svc3, 'g3', 'production.order.draft.save', {
      orderId: 'po-opt',
      finishedProductId: 'fp-opt',
      formulationRecipeId: 'form-2',
      totalQtyMp: 1,
      startDate: DATE,
      endDate: DATE,
      lineId: '1',
    })
    const h = await import('../api/fst/_g1CriticalHelpers.mjs')
    const p = payload()
    p.domains.warehouse.movements = [
      { id: 'm2', type: 'receipt', warehouseId: WH, itemId: ITEM_FILM, quantity: 10, at: DATE },
    ]
    dcState.critical!.payloadJson = h.serializeCriticalPayload(p)
    const allowed = await cmd(svc3, 'g3', 'production.order.confirm', {
      orderId: 'po-opt',
      rawWarehouseId: WH,
    })
    expect(allowed.ok).toBe(true)
    expect(payload().domains.production.orders.find((o: { id: string }) => o.id === 'po-opt')
      .packagingBomSnapshot).toBeFalsy()
  })

  it('G4 uses order snapshot not live BOM; multi components', async () => {
    const svc5 = await bootstrapMdSales()
    const svc3 = await g3()
    const svc4 = await g4()
    await cmd(svc3, 'g3', 'production.recipe.draft.save', {
      versionId: 'rv-3',
      recipeId: 'form-3',
      versionNumber: 1,
      components: [{ warehouseItemId: ITEM_FILM, unitSnapshot: 'pcs', normQty: 0.01 }],
      normBase: 'per_m2',
    })
    await cmd(svc3, 'g3', 'production.recipe.version.approve', { versionId: 'rv-3' })
    const bom = payload().domains.masterData.packagingBoms.find((b: { id: string }) => b.id === 'bom-1')
    await cmd(svc3, 'g3', 'production.order.draft.save', {
      orderId: 'po-pack',
      finishedProductId: FG_ID,
      formulationRecipeId: 'form-3',
      totalQtyMp: 10,
      startDate: DATE,
      endDate: DATE,
      lineId: '1',
      packagingBomId: bom.id,
      packagingBomVersion: bom.version,
      packagingBomContentHash: bom.contentHash,
    })
    const h = await import('../api/fst/_g1CriticalHelpers.mjs')
    let p = payload()
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
      { id: 'm-f', type: 'receipt', warehouseId: WH, locationId: 'pack-loc', itemId: ITEM_FILM, quantity: 100, at: DATE },
      { id: 'm-l', type: 'receipt', warehouseId: WH, locationId: 'pack-loc', itemId: ITEM_LABEL, quantity: 100, at: DATE },
      { id: 'm-c', type: 'receipt', warehouseId: WH, locationId: 'pack-loc', itemId: ITEM_CORNER, quantity: 100, at: DATE },
      {
        id: 'm-wip',
        type: 'receipt',
        warehouseId: WH,
        locationId: 'pack-loc',
        itemId: 'wip-1',
        quantity: 50,
        at: DATE,
        productionOrderId: 'po-pack',
        isWip: true,
        batchNo: 'WB1',
      },
    ]
    dcState.critical!.payloadJson = h.serializeCriticalPayload(p)

    expect(
      (
        await cmd(svc3, 'g3', 'production.order.confirm', {
          orderId: 'po-pack',
          rawWarehouseId: WH,
        })
      ).ok,
    ).toBe(true)

    const snap = payload().domains.production.orders.find((o: { id: string }) => o.id === 'po-pack')
      .packagingBomSnapshot
    const reqs = computePackagingRequirements(snap, 10)

    // Approve a different live BOM — G4 must still use snap
    await cmd(svc5, 'g5', 'masterdata.bom.upsert', {
      id: 'bom-live',
      finishedProductId: FG_ID,
      baseOutputQty: 1,
      components: [{ itemId: ITEM_FILM, quantity: 999, unit: 'pcs' }],
    })
    await cmd(svc5, 'g5', 'masterdata.bom.approve', { id: 'bom-live' })

    const pack = await cmd(svc4, 'g4', 'packaging.report.confirm', {
      productionOrderId: 'po-pack',
      lineId: 'pack',
      reportDate: DATE,
      finishedProductId: FG_ID,
      warehouseItemId: FG_ID,
      outputM2: 10,
      outputRolls: 1,
      wipLines: [{ semiFinishedItemId: 'wip-1', quantity: 10, wipBatchId: 'WB1', unitSnapshot: 'pcs' }],
      materialLines: reqs.map((r) => ({
        itemId: r.itemId,
        quantity: r.normQty,
        unitSnapshot: r.unit,
      })),
    })
    expect(pack.ok).toBe(true)
    const report = payload().domains.production.packagingReports[0]
    expect(report.packagingBomId).toBe(snap.packagingBomId)
    expect(report.packagingBomContentHash).toBe(snap.contentHash)
    expect(report.packagingComponentNorms.length).toBe(3)
    expect(report.packagingBomSnapshot.contentHash).toBe(snap.contentHash)
  })
})

describe('G5.4 UpdateFstStore forged BOM irrelevant after activation', () => {
  it('selectApprovedPackagingBom ignores draft and prefers approved hash', () => {
    const hash = packagingBomContentHash({
      finishedProductId: FG_ID,
      baseOutputQty: 1,
      components: [{ itemId: ITEM_FILM, quantity: 1, unit: 'pcs' }],
    })
    const masterData = {
      packagingBoms: [
        {
          id: 'draft',
          finishedProductId: FG_ID,
          status: 'draft',
          version: 9,
          contentHash: 'x',
          components: [{ itemId: ITEM_FILM, quantity: 9, unit: 'pcs' }],
        },
        {
          id: 'ok',
          finishedProductId: FG_ID,
          status: 'approved',
          version: 1,
          contentHash: hash,
          components: [{ itemId: ITEM_FILM, quantity: 1, unit: 'pcs' }],
        },
      ],
      finishedProducts: [{ id: FG_ID, packagingBomId: 'ok' }],
    }
    const bom = selectApprovedPackagingBom(masterData, masterData.finishedProducts[0], DATE)
    expect(bom?.id).toBe('ok')
    const snap = buildPackagingBomSnapshot(bom!, masterData.finishedProducts[0], actor, DATE, DATE)
    expect(snap.contentHash).toBe(hash)
  })
})
