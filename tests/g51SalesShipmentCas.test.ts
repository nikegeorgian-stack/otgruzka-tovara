/**
 * PHASE G5.1 — sales.shipment CAS; G4 shipment.post → use_g5_gateway when salesPlanning active.
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
  upsertFstPrincipalAccess: vi.fn(async () => undefined),
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

const WH = 'fg-wh'
const LOC = 'fg-loc'
const FG_ID = 'fp-1'
const CUST_ID = 'cust-1'
const LOT_ID = 'lot-1'
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

afterEach(() => vi.resetModules())

function grant(caps: Record<string, unknown>) {
  const id = `${STORE}::u1`
  dcState.principals.set(id, {
    id,
    firebaseUid: 'u1',
    storeId: STORE,
    roleId: 'sales',
    capabilitiesJson: JSON.stringify({
      ...caps,
      'shipment.post': true,
      'packaging.read': true,
    }),
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

async function g5cmd(
  svc: { executeG5Command: (i: Record<string, unknown>) => Promise<Record<string, unknown>> },
  commandType: string,
  command: Record<string, unknown> = {},
  key = `${commandType}-${Math.random().toString(36).slice(2, 8)}`,
) {
  return svc.executeG5Command({
    actor,
    storeId: STORE,
    idempotencyKey: key,
    commandType,
    command,
  })
}

async function seedShipReady() {
  grant(ALL_CAPS)
  const svc = await import('../server/fst/_g5SalesProcurementService.mjs')
  expect((await g5cmd(svc, 'masterdata.domain.activate', { reason: 'x' }, 'md')).ok).toBe(true)
  expect((await g5cmd(svc, 'sales.domain.activate', { reason: 'x' }, 'sp')).ok).toBe(true)
  const h = await import('../server/fst/_g1CriticalHelpers.mjs')
  let p = payload()
  p = h.markWarehouseDomainActive(p, 'u1')
  p = h.markProductionDomainActive(p, 'u1')
  p = h.markPackagingQcFeatureActive(p, 'u1')
  p.domains.warehouse.locations = [{ id: LOC, warehouseId: WH }]
  p.domains.warehouse.movements = [
    {
      id: 'm-fg',
      type: 'receipt',
      warehouseId: WH,
      locationId: LOC,
      itemId: FG_ID,
      quantity: 100,
      batchNo: 'LOT-1',
    },
  ]
  p.domains.production.finishedGoodsLots = [
    {
      id: LOT_ID,
      finishedProductId: FG_ID,
      warehouseId: WH,
      locationId: LOC,
      warehouseItemId: FG_ID,
      lotNumber: 'LOT-1',
      qcStatus: 'released',
      quantityQcReleased: 50,
      quantityShipped: 0,
      lotRevision: 1,
      currentDecisionId: 'dec-1',
    },
  ]
  p.domains.production.qcDecisions = [
    { id: 'dec-1', lotId: LOT_ID, status: 'released', lotRevision: 1 },
  ]
  dcState.critical!.payloadJson = h.serializeCriticalPayload(p)
  dcState.critical!.fingerprint = h.fingerprintCriticalPayload(dcState.critical!.payloadJson)

  expect(
    (
      await g5cmd(svc, 'masterdata.product.upsert', { id: FG_ID, code: 'FP-1', name: 'Panel' }, 'fp')
    ).ok,
  ).toBe(true)
  expect(
    (await g5cmd(svc, 'masterdata.customer.upsert', { id: CUST_ID, code: 'C1', name: 'Acme' }, 'c'))
      .ok,
  ).toBe(true)

  await g5cmd(
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
    'sod',
  )
  expect((await g5cmd(svc, 'sales.order.confirm', { id: 'so-ship' }, 'soc')).ok).toBe(true)
  return svc
}

describe('G5.1 sales shipment CAS', () => {
  it('posts sales shipment and updates shippedQty; double post same key is idempotent', async () => {
    const svc = await seedShipReady()
    const ship = await g5cmd(
      svc,
      'sales.shipment.post',
      {
        salesOrderId: 'so-ship',
        salesLineId: 'sol-1',
        shipmentId: 'shp-1',
        finishedGoodsLotId: LOT_ID,
        finishedProductId: FG_ID,
        quantity: 10,
        warehouseId: WH,
        date: DATE,
      },
      'ship-1',
    )
    expect(ship.ok).toBe(true)
    const order = payload().domains.sales.orders.find((o: { id: string }) => o.id === 'so-ship')
    expect(order.lines[0].shippedQty).toBe(10)
    expect(order.status === 'partially_shipped' || order.lines[0].shippedQty < order.lines[0].quantity).toBe(
      true,
    )

    const again = await g5cmd(
      svc,
      'sales.shipment.post',
      {
        salesOrderId: 'so-ship',
        salesLineId: 'sol-1',
        shipmentId: 'shp-1',
        finishedGoodsLotId: LOT_ID,
        finishedProductId: FG_ID,
        quantity: 10,
        warehouseId: WH,
        date: DATE,
      },
      'ship-1',
    )
    expect(again.ok).toBe(true)
    expect(again.idempotent).toBe(true)
    expect(
      payload().domains.sales.orders.find((o: { id: string }) => o.id === 'so-ship').lines[0]
        .shippedQty,
    ).toBe(10)
  })

  it('G4 shipment.post returns use_g5_gateway when salesPlanning is active', async () => {
    await seedShipReady()
    const g4 = await import('../server/fst/_g4PackagingService.mjs')
    const denied = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'g4-ship-denied',
      commandType: 'shipment.post',
      command: {
        shipmentId: 'shp-g4',
        finishedGoodsLotId: LOT_ID,
        quantity: 1,
        warehouseId: WH,
        date: DATE,
      },
    })
    expect(denied.ok).toBe(false)
    expect(denied.error).toBe('use_g5_gateway')
  })
})
