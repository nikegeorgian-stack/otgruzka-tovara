/**
 * PHASE G5.1 — issued-to-line is not free supply; netNeed; linked production reduces FG BOM.
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
const LINE_WH = 'wh-line-1'
const LOC = 'loc-1'
const ITEM_ID = 'item-film'
const FG_ID = 'fp-1'
const CUST_ID = 'cust-1'
const SUP_ID = 'sup-1'
const BOM_ID = 'bom-1'
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

async function bootstrap() {
  grant(ALL_CAPS)
  const svc = await g5()
  for (const [type, key] of [
    ['masterdata.domain.activate', 'md-act'],
    ['sales.domain.activate', 'sp-act'],
    ['procurement.domain.activate', 'pr-act'],
  ] as const) {
    expect((await cmd(svc, type, { reason: 'g51' }, key)).ok).toBe(true)
  }
  const h = await import('../server/fst/_g1CriticalHelpers.mjs')
  let p = payload()
  p = h.markWarehouseDomainActive(p, 'u1')
  p = h.markProductionDomainActive(p, 'u1')
  p.domains.warehouse.locations = [
    { id: LOC, warehouseId: WH },
    { id: 'loc-line', warehouseId: LINE_WH },
  ]
  p.domains.warehouse.productionLineBindings = [{ warehouseId: LINE_WH, lineId: '1' }]
  p.domains.warehouse.movements = []
  p.domains.warehouse.documents = []
  p.domains.production.orders = []
  dcState.critical!.payloadJson = h.serializeCriticalPayload(p)
  dcState.critical!.fingerprint = h.fingerprintCriticalPayload(dcState.critical!.payloadJson)

  expect(
    (
      await cmd(svc, 'masterdata.item.upsert', {
        id: ITEM_ID,
        code: 'FILM-1',
        name: 'Film',
        baseUnit: 'kg',
        moq: 1,
        defaultSupplierId: SUP_ID,
      }, 'md-item')
    ).ok,
  ).toBe(true)
  expect(
    (
      await cmd(svc, 'masterdata.product.upsert', {
        id: FG_ID,
        code: 'FP-1',
        name: 'Panel',
        packagingBomId: BOM_ID,
      }, 'md-fp')
    ).ok,
  ).toBe(true)
  expect(
    (await cmd(svc, 'masterdata.customer.upsert', { id: CUST_ID, code: 'C1', name: 'Acme' }, 'md-c'))
      .ok,
  ).toBe(true)
  expect(
    (
      await cmd(
        svc,
        'masterdata.supplier.upsert',
        { id: SUP_ID, code: 'S1', name: 'Sup', suppliedItemIds: [ITEM_ID] },
        'md-s',
      )
    ).ok,
  ).toBe(true)
  expect(
    (
      await cmd(
        svc,
        'masterdata.bom.upsert',
        {
          id: BOM_ID,
          finishedProductId: FG_ID,
          version: 1,
          lines: [{ itemId: ITEM_ID, qty: 2, unit: 'kg' }],
        },
        'md-bom',
      )
    ).ok,
  ).toBe(true)
  expect((await cmd(svc, 'masterdata.bom.approve', { id: BOM_ID }, 'md-bom-ap')).ok).toBe(true)

  return svc
}

describe('G5.1 issued-to-line / netNeed / linked production', () => {
  it('does not treat line-warehouse stock as free supply', async () => {
    const svc = await bootstrap()
    const h = await import('../server/fst/_g1CriticalHelpers.mjs')
    const p = payload()
    // 100 kg only on line warehouse — must NOT cover FG packaging shortage
    p.domains.warehouse.movements = [
      {
        id: 'm1',
        type: 'receipt',
        warehouseId: LINE_WH,
        itemId: ITEM_ID,
        quantity: 100,
        productionOrderId: 'po-x',
      },
    ]
    dcState.critical!.payloadJson = h.serializeCriticalPayload(p)

    await cmd(
      svc,
      'sales.order.draft.save',
      {
        id: 'so-1',
        customerId: CUST_ID,
        lines: [
          {
            lineId: 'sol-1',
            finishedProductId: FG_ID,
            quantity: 10,
            unit: 'm2',
            requestedShipDate: DATE,
          },
        ],
      },
      'so-d',
    )
    expect((await cmd(svc, 'sales.order.confirm', { id: 'so-1' }, 'so-c')).ok).toBe(true)

    const run = await cmd(svc, 'planning.mrp.run', {}, 'mrp-1')
    expect(run.ok).toBe(true)
    expect(run.shortageCount).toBeGreaterThan(0)
    const sh = payload().domains.planning.shortages.find(
      (s: { itemId: string; status: string }) => s.itemId === ITEM_ID && s.status === 'open',
    )
    expect(sh).toBeTruthy()
    // BOM need = 10 * 2 = 20; line stock ignored → shortage ~20
    expect(sh.shortageQty).toBeGreaterThanOrEqual(19)
  })

  it('netNeed = recipeNeed - issuedToLine for production materials', async () => {
    const svc = await bootstrap()
    const h = await import('../server/fst/_g1CriticalHelpers.mjs')
    const p = payload()
    p.domains.production.orders = [
      {
        id: 'po-1',
        status: 'released',
        totalQtyMp: 10,
        producedQtyMp: 0,
        dueDate: DATE,
        recipeSnapshot: {
          components: [{ warehouseItemId: ITEM_ID, normQty: 5, unitSnapshot: 'kg' }],
          batchSize: 1,
        },
      },
    ]
    // Issued 30 of 50 needed onto line warehouse
    p.domains.warehouse.movements = [
      {
        id: 'iss-1',
        type: 'receipt',
        warehouseId: LINE_WH,
        itemId: ITEM_ID,
        quantity: 30,
        productionOrderId: 'po-1',
      },
    ]
    dcState.critical!.payloadJson = h.serializeCriticalPayload(p)

    const run = await cmd(svc, 'planning.mrp.run', {}, 'mrp-net')
    expect(run.ok).toBe(true)
    const events = payload().domains.planning.planningRuns.find(
      (r: { id: string }) => r.id === run.planningRunId,
    )?.demandEvents
    const prodEv = (events ?? []).find(
      (e: { kind: string; productionOrderId?: string }) =>
        e.kind === 'production_material' && e.productionOrderId === 'po-1',
    )
    expect(prodEv).toBeTruthy()
    expect(prodEv.grossNeedQty).toBe(50)
    expect(prodEv.issuedToLineQty).toBe(30)
    expect(prodEv.qty).toBe(20)
  })

  it('linked production remaining reduces FG packaging BOM demand', async () => {
    const svc = await bootstrap()
    const h = await import('../server/fst/_g1CriticalHelpers.mjs')

    const p = payload()
    // The G5 authority accepts only an existing canonical WIP-v1 order link.
    p.domains.production.orders = [
      {
        id: 'po-link',
        status: 'released',
        wipContractVersion: 1,
        finishedProductId: FG_ID,
        totalQtyMp: 40,
        producedQtyMp: 0,
        dueDate: DATE,
      },
    ]
    dcState.critical!.payloadJson = h.serializeCriticalPayload(p)

    await cmd(
      svc,
      'sales.order.draft.save',
      {
        id: 'so-link',
        customerId: CUST_ID,
        lines: [
          {
            lineId: 'sol-1',
            finishedProductId: FG_ID,
            quantity: 40,
            unit: 'm2',
            requestedShipDate: DATE,
            linkedProductionOrderIds: ['po-link'],
          },
        ],
      },
      'so-ld',
    )
    expect((await cmd(svc, 'sales.order.confirm', { id: 'so-link' }, 'so-lc')).ok).toBe(true)

    // Link covers all 40 → fgDemand 0 → no packaging BOM shortage from this SO.
    const so = payload().domains.sales.orders.find((o: { id: string }) => o.id === 'so-link')
    expect(so.lines[0].linkedProductionOrderIds).toEqual(['po-link'])

    const run = await cmd(svc, 'planning.mrp.run', {}, 'mrp-link')
    expect(run.ok).toBe(true)
    const fgEvents = (
      payload().domains.planning.planningRuns.find((r: { id: string }) => r.id === run.planningRunId)
        ?.demandEvents ?? []
    ).filter((e: { kind: string; salesOrderId?: string }) => e.kind === 'packaging_bom' && e.salesOrderId === 'so-link')
    expect(fgEvents.every((e: { qty: number }) => e.qty <= 0) || fgEvents.length === 0).toBe(true)
  })
})
