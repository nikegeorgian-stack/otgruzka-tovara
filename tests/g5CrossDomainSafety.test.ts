/**
 * PHASE G5 — cross-domain safety.
 *
 * G5 shares one FstCriticalStore envelope with G2/G3/G4. Sales/planning/procurement
 * mutations must never drop warehouse documents/movements, packaging lots, or the
 * packagingQc feature flag. Bare revision / warehouse active ≠ salesPlanning.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { G5_CAPS, defaultG5Capabilities } from '../server/fst/_g5Capabilities.mjs'

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

const STORE = 'fibercell-main'
const actor = { uid: 'u1', email: 'u1@x', claims: {} }

const ALL_CAPS = defaultG5Capabilities(
  Object.fromEntries(Object.values(G5_CAPS).map((k) => [k, true])),
)

const WH = 'wh-main'
const LOC = 'loc-1'
const ITEM_ID = 'item-film'
const FG_ID = 'fp-1'
const CUST_ID = 'cust-1'
const DATE = '2026-09-04'

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
  calls.upsertPrincipal.mockImplementation(async (_dc: unknown, row: Record<string, unknown>) => {
    dcState.principals.set(String(row.id), row)
  })
  calls.upsertCritical.mockImplementation(async (_dc: unknown, row: Record<string, unknown>) => {
    dcState.critical = { ...row }
  })
  calls.updateCas.mockImplementation(async (_dc: unknown, vars: Record<string, unknown>) => {
    if (!dcState.critical) throw new Error('missing')
    if (dcState.critical.revision !== vars.expectedRevision) {
      throw new Error('revision_conflict')
    }
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

function grant(caps: Record<string, unknown>) {
  const id = `${STORE}::u1`
  dcState.principals.set(id, {
    id,
    firebaseUid: 'u1',
    storeId: STORE,
    roleId: 'sales',
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

async function cmd(
  svc: { executeG5Command: (input: Record<string, unknown>) => Promise<Record<string, unknown>> },
  commandType: string,
  command: Record<string, unknown> = {},
  idempotencyKey = `${commandType}-${Math.random().toString(36).slice(2, 8)}`,
) {
  return svc.executeG5Command({
    actor,
    storeId: STORE,
    idempotencyKey,
    commandType,
    command,
  })
}

/**
 * Seed warehouse docs/movements + G4 packaging lots/reports + packagingQc flag,
 * then activate G5 domains so subsequent sales writes exercise casCommitG5 preservation.
 */
async function seedSiblingDomainsAndActivateG5() {
  const h = await import('../server/fst/_g1CriticalHelpers.mjs')
  let p = h.emptyCriticalPayload()
  p = h.markWarehouseDomainActive(p, 'seed')
  p = h.markProductionDomainActive(p, 'seed')
  p = h.markPackagingQcFeatureActive(p, 'seed')

  p.domains.warehouse.documents = [
    {
      id: 'doc-keep',
      type: 'receipt',
      warehouseId: WH,
      date: '2026-09-01',
      status: 'posted',
      lines: [{ itemId: ITEM_ID, quantity: 5 }],
    },
  ]
  p.domains.warehouse.movements = [
    {
      id: 'mov-keep',
      warehouseId: WH,
      locationId: LOC,
      itemId: ITEM_ID,
      quantity: 5,
      type: 'receipt',
      at: '2026-09-01T00:00:00.000Z',
      date: '2026-09-01',
    },
  ]
  p.domains.warehouse.loadingShipments = []
  p.domains.production.packagingReports = [
    { id: 'pkr-keep', productionOrderId: 'ord-1', status: 'confirmed', outputM2: 100 },
  ]
  p.domains.production.finishedGoodsLots = [
    { id: 'lot-keep', finishedProductId: FG_ID, qty: 100, qcStatus: 'released' },
  ]

  const json = h.serializeCriticalPayload(p)
  dcState.critical = {
    id: STORE,
    revision: 3,
    payloadJson: json,
    fingerprint: h.fingerprintCriticalPayload(json),
    updatedByUid: 'seed',
  }

  grant(ALL_CAPS)
  const svc = await g5()
  for (const [type, key] of [
    ['masterdata.domain.activate', 'x-md'],
    ['sales.domain.activate', 'x-sp'],
    ['procurement.domain.activate', 'x-pr'],
  ] as const) {
    const r = await cmd(svc, type, { reason: 'cross-domain' }, key)
    expect(r.ok).toBe(true)
  }
  return { svc, h }
}

function siblingSnapshot() {
  const p = payload()
  return {
    documents: p.domains.warehouse.documents,
    movements: p.domains.warehouse.movements,
    packagingReports: p.domains.production.packagingReports,
    finishedGoodsLots: p.domains.production.finishedGoodsLots,
    packagingQc: p.domainMeta.production.features.packagingQc,
  }
}

async function seedMinimalCatalog(svc: Awaited<ReturnType<typeof g5>>) {
  expect(
    (
      await cmd(svc, 'masterdata.item.upsert', {
        id: ITEM_ID,
        code: 'FILM-1',
        name: 'Film',
        baseUnit: 'kg',
      }, 'x-item')
    ).ok,
  ).toBe(true)
  expect(
    (
      await cmd(svc, 'masterdata.product.upsert', {
        id: FG_ID,
        code: 'FP-1',
        name: 'Panel',
      }, 'x-fp')
    ).ok,
  ).toBe(true)
  expect(
    (await cmd(svc, 'masterdata.customer.upsert', { id: CUST_ID, name: 'Acme' }, 'x-cust')).ok,
  ).toBe(true)
}

// ---------------------------------------------------------------------------

describe('G5 cross-domain preservation', () => {
  it('sales write preserves warehouse documents/movements and packaging reports/lots', async () => {
    const { svc } = await seedSiblingDomainsAndActivateG5()
    const before = siblingSnapshot()
    expect(before.documents).toHaveLength(1)
    expect(before.movements).toHaveLength(1)
    expect(before.packagingReports).toHaveLength(1)
    expect(before.finishedGoodsLots).toHaveLength(1)

    await seedMinimalCatalog(svc)
    const draft = await cmd(
      svc,
      'sales.order.draft.save',
      {
        id: 'so-keep',
        customerId: CUST_ID,
        lines: [{ lineId: 'sol-1', finishedProductId: FG_ID, quantity: 8, unit: 'm2' }],
      },
      'x-so-draft',
    )
    expect(draft.ok).toBe(true)

    const after = siblingSnapshot()
    expect(after.documents).toEqual(before.documents)
    expect(after.movements).toEqual(before.movements)
    expect(after.packagingReports).toEqual(before.packagingReports)
    expect(after.finishedGoodsLots).toEqual(before.finishedGoodsLots)
    expect(payload().domains.sales.orders.some((o: { id: string }) => o.id === 'so-keep')).toBe(
      true,
    )
  })

  it('G5 command preserves packagingQc feature flag and G4 lots', async () => {
    const { svc } = await seedSiblingDomainsAndActivateG5()
    expect(payload().domainMeta.production.features.packagingQc.active).toBe(true)
    const lotsBefore = payload().domains.production.finishedGoodsLots

    await seedMinimalCatalog(svc)
    const confirm = await cmd(
      svc,
      'sales.order.draft.save',
      {
        id: 'so-flag',
        customerId: CUST_ID,
        lines: [{ lineId: 'sol-1', finishedProductId: FG_ID, quantity: 3 }],
      },
      'x-flag-draft',
    )
    expect(confirm.ok).toBe(true)
    expect(payload().domainMeta.production.features.packagingQc.active).toBe(true)
    expect(payload().domains.production.finishedGoodsLots).toEqual(lotsBefore)
  })
})

describe('G5 activation isolation', () => {
  it('bare critical revision / warehouse active does not make salesPlanningActive', async () => {
    const h = await import('../server/fst/_g1CriticalHelpers.mjs')
    let p = h.emptyCriticalPayload()
    p = h.markWarehouseDomainActive(p, 'u1')
    const json = h.serializeCriticalPayload(p)
    const round = h.parseCriticalPayload(json, { revision: 99 })
    expect(round.ok).toBe(true)
    expect(h.isWarehouseDomainActive(round.payload, 99)).toBe(true)
    expect(h.isSalesPlanningActive(round.payload)).toBe(false)
    expect(h.isMasterDataDomainActive(round.payload)).toBe(false)
    expect(h.isProcurementDomainActive(round.payload)).toBe(false)

    grant(ALL_CAPS)
    dcState.critical = {
      id: STORE,
      revision: 99,
      payloadJson: json,
      fingerprint: h.fingerprintCriticalPayload(json),
      updatedByUid: 'u1',
    }
    const svc = await g5()
    const denied = await cmd(svc, 'sales.order.confirm', { id: 'so-x' }, 'inactive-confirm')
    expect(denied.ok).toBe(false)
    expect(denied.error).toBe('sales_planning_inactive')
  })
})

describe('G5 payload / domain allow-list', () => {
  it('parseCriticalPayload allows G5 domains; rejects employees', async () => {
    const h = await import('../server/fst/_g1CriticalHelpers.mjs')
    expect(h.G1_ALLOWED_DOMAINS).toEqual(
      expect.arrayContaining(['masterData', 'sales', 'planning', 'procurement']),
    )
    expect(h.G1_ALLOWED_DOMAINS).toContain('warehouse')
    expect(h.G1_ALLOWED_DOMAINS).toContain('production')

    const ok = h.parseCriticalPayload(
      JSON.stringify({
        schemaVersion: 4,
        domains: {
          warehouse: h.emptyWarehouseStore(),
          production: h.emptyProductionStore(),
          masterData: h.emptyMasterDataStore(),
          sales: h.emptySalesStore(),
          planning: h.emptyPlanningStore(),
          procurement: h.emptyProcurementStore(),
        },
      }),
    )
    expect(ok.ok).toBe(true)

    const bad = h.parseCriticalPayload(
      JSON.stringify({
        schemaVersion: 4,
        domains: {
          warehouse: h.emptyWarehouseStore(),
          employees: [],
        },
      }),
    )
    expect(bad.ok).toBe(false)
    expect(bad.error).toBe('domain_not_allowed')
  })

  it('when salesPlanning inactive, sales.order.confirm → sales_planning_inactive', async () => {
    grant(ALL_CAPS)
    const svc = await g5()
    // Activate only masterdata so confirm is blocked by salesPlanning gate
    expect((await cmd(svc, 'masterdata.domain.activate', { reason: 'md' }, 'gate-md')).ok).toBe(
      true,
    )
    const r = await cmd(svc, 'sales.order.confirm', { id: 'so-1' }, 'gate-confirm')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('sales_planning_inactive')
    expect(r.status).toBe(409)
  })
})

describe('G5 fulfillment sync', () => {
  it('syncFromShipments updates shippedQty from posted loadingShipments', async () => {
    const { svc } = await seedSiblingDomainsAndActivateG5()
    await seedMinimalCatalog(svc)

    const draft = await cmd(
      svc,
      'sales.order.draft.save',
      {
        id: 'so-ship',
        customerId: CUST_ID,
        lines: [
          {
            lineId: 'sol-1',
            finishedProductId: FG_ID,
            quantity: 40,
            unit: 'm2',
            requestedShipDate: DATE,
          },
        ],
      },
      'ship-draft',
    )
    expect(draft.ok).toBe(true)
    expect((await cmd(svc, 'sales.order.confirm', { id: 'so-ship' }, 'ship-confirm')).ok).toBe(true)

    const p = payload()
    p.domains.warehouse.loadingShipments = [
      {
        id: 'shp-1',
        salesOrderId: 'so-ship',
        finishedProductId: FG_ID,
        quantity: 12,
        status: 'posted',
        date: DATE,
      },
    ]
    dcState.critical!.payloadJson = JSON.stringify(p)

    const sync = await cmd(
      svc,
      'sales.fulfillment.syncFromShipments',
      { salesOrderId: 'so-ship' },
      'ship-sync',
    )
    expect(sync.ok).toBe(true)
    expect(sync.status).toBe('partially_shipped')

    const order = payload().domains.sales.orders.find((o: { id: string }) => o.id === 'so-ship')
    expect(order.lines[0].shippedQty).toBe(12)
    expect(order.lines[0].remainingQty).toBe(28)
    expect(order.status).toBe('partially_shipped')
  })
})

describe('G5 casCommitG5 preservation helper', () => {
  it('casCommitG5 with only sales changes keeps warehouse + packaging slots', async () => {
    const { svc, h } = await seedSiblingDomainsAndActivateG5()
    const before = siblingSnapshot()
    const critical = await svc.loadCritical(STORE, 'u1')
    expect(critical.ok).toBe(true)

    const sales = {
      ...critical.payload.domains.sales,
      orders: [
        ...(critical.payload.domains.sales.orders ?? []),
        { id: 'so-cas', status: 'draft', customerId: CUST_ID, lines: [] },
      ],
    }

    const committed = await svc.casCommitG5(
      { mocked: true },
      STORE,
      critical,
      'u1',
      {
        sales,
        production: critical.payload.domains.production,
        masterData: critical.payload.domains.masterData,
        planning: critical.payload.domains.planning,
        procurement: critical.payload.domains.procurement,
        // warehouse intentionally omitted — must preserve previous
        idempotencyKey: 'cas-only-sales',
        commandType: 'sales.order.draft.save',
        result: { id: 'so-cas' },
      },
    )
    expect(committed.ok).toBe(true)
    expect(siblingSnapshot()).toEqual(before)
    expect(payload().domains.sales.orders.some((o: { id: string }) => o.id === 'so-cas')).toBe(true)
    expect(h.isPackagingQcFeatureActive(payload())).toBe(true)
  })
})
