/**
 * PHASE G5.2 — bypass gates + MRP receipt double-count + UI fail-closed (memory-mocked DC).
 *
 * - G2 purchase purpose after procurement.active → use_g5_gateway
 * - G4 shipment.post after salesPlanning.active → use_g5_gateway
 * - stale planningRun rejected for generateDraftsFromMrp
 * - received qty not double-counted as inbound+onhand in MRP after receipt
 * - issued-to-line not free for other orders
 * - UI rule: executeG5Command failure does not call mirrorG5Ack
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { G5_CAPS, defaultG5Capabilities } from '../api/fst/_g5Capabilities.mjs'
import { G2_CAPS } from '../api/fst/_g2Capabilities.mjs'
import {
  G5_UI_GATEWAY_MATRIX,
  mirrorG5AckIfOk,
  type G5AckPayload,
  type G5ServerResult,
} from '../src/lib/planner/g5ServerClient'
import type { AppStore } from '../src/lib/types'

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

const STORE = 'fibercell-main'
const actor = { uid: 'u1', email: 'u1@x', claims: {} }
const ALL_G5 = defaultG5Capabilities(
  Object.fromEntries(Object.values(G5_CAPS).map((k) => [k, true])),
)
const ALL_G2 = Object.fromEntries(Object.values(G2_CAPS).map((k) => [k, true]))

const WH = 'wh-main'
const LINE_WH = 'wh-line-1'
const LOC = 'loc-1'
const ITEM_ID = 'item-film'
const FG_ID = 'fp-1'
const CUST_ID = 'cust-1'
const SUP_ID = 'sup-1'
const BOM_ID = 'bom-1'
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
    roleId: 'wh',
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

async function cmd(
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

async function activateAndSeedCatalog(opts: { withBom?: boolean } = {}) {
  grant({ ...ALL_G5, ...ALL_G2, 'shipment.post': true, 'packaging.read': true })
  const svc = await import('../api/fst/_g5SalesProcurementService.mjs')
  for (const [type, key] of [
    ['masterdata.domain.activate', 'a1'],
    ['sales.domain.activate', 'a2'],
    ['procurement.domain.activate', 'a3'],
  ] as const) {
    expect((await cmd(svc, type, { reason: 'x' }, key)).ok).toBe(true)
  }
  const h = await import('../api/fst/_g1CriticalHelpers.mjs')
  let p = payload()
  p = h.markWarehouseDomainActive(p, 'u1')
  p.domains.warehouse.locations = [
    { id: LOC, warehouseId: WH },
    { id: LINE_WH, warehouseId: LINE_WH },
  ]
  p.domains.warehouse.productionLineBindings = [
    { id: 'bind-1', warehouseId: LINE_WH, lineId: 'line-1' },
  ]
  dcState.critical!.payloadJson = h.serializeCriticalPayload(p)

  expect(
    (
      await cmd(svc, 'masterdata.item.upsert', {
        id: ITEM_ID,
        code: 'FILM-1',
        name: 'Film',
        baseUnit: 'kg',
        moq: 10,
        orderMultiple: 10,
        defaultSupplierId: SUP_ID,
      }, 'item')
    ).ok,
  ).toBe(true)
  expect(
    (
      await cmd(svc, 'masterdata.product.upsert', {
        id: FG_ID,
        code: 'FP-1',
        name: 'Panel',
        packagingBomId: opts.withBom === false ? undefined : BOM_ID,
      }, 'fp')
    ).ok,
  ).toBe(true)
  expect((await cmd(svc, 'masterdata.customer.upsert', { id: CUST_ID, code: 'C1', name: 'Acme' }, 'c')).ok).toBe(
    true,
  )
  expect(
    (
      await cmd(svc, 'masterdata.supplier.upsert', {
        id: SUP_ID,
        code: 'S1',
        name: 'Sup',
        suppliedItemIds: [ITEM_ID],
      }, 's')
    ).ok,
  ).toBe(true)
  if (opts.withBom !== false) {
    expect(
      (
        await cmd(svc, 'masterdata.bom.upsert', {
          id: BOM_ID,
          finishedProductId: FG_ID,
          version: 1,
          lines: [{ itemId: ITEM_ID, qty: 2, unit: 'kg' }],
        }, 'bom')
      ).ok,
    ).toBe(true)
    expect((await cmd(svc, 'masterdata.bom.approve', { id: BOM_ID }, 'bom-ap')).ok).toBe(true)
  }
  return svc
}

describe('G5.2 bypass gates', () => {
  it('G2 purchase purpose after procurement.active → use_g5_gateway', async () => {
    await activateAndSeedCatalog()
    const g2 = await import('../api/fst/_g2WarehouseService.mjs')
    const denied = await g2.executeG2Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'g2-purchase-denied-g52',
      commandType: 'warehouse.document.post',
      command: {
        type: 'receipt',
        warehouseId: WH,
        date: DATE,
        purpose: 'purchase',
        lines: [{ itemId: ITEM_ID, quantity: 1, locationId: LOC }],
      },
    })
    expect(denied.ok).toBe(false)
    expect(denied.error).toBe('use_g5_gateway')
  })

  it('G4 shipment.post after salesPlanning.active → use_g5_gateway', async () => {
    const svc = await activateAndSeedCatalog()
    const h = await import('../api/fst/_g1CriticalHelpers.mjs')
    let p = payload()
    p = h.markProductionDomainActive(p, 'u1')
    p = h.markPackagingQcFeatureActive(p, 'u1')
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

    // Ensure salesPlanning stays active (already activated)
    expect(payload().domainMeta.salesPlanning.active).toBe(true)
    void svc

    const g4 = await import('../api/fst/_g4PackagingService.mjs')
    const denied = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'g4-ship-denied-g52',
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

describe('G5.2 planning / MRP safety', () => {
  it('stale planningRun rejected for generateDraftsFromMrp', async () => {
    const svc = await activateAndSeedCatalog()
    await cmd(
      svc,
      'sales.order.draft.save',
      {
        id: 'so-stale',
        customerId: CUST_ID,
        lines: [
          { lineId: 'sol-1', finishedProductId: FG_ID, quantity: 5, unit: 'm2', requestedShipDate: DATE },
        ],
      },
      'sod',
    )
    expect((await cmd(svc, 'sales.order.confirm', { id: 'so-stale' }, 'soc')).ok).toBe(true)

    const run1 = await cmd(svc, 'planning.mrp.run', {}, 'run1')
    expect(run1.ok).toBe(true)
    const run2 = await cmd(svc, 'planning.mrp.run', {}, 'run2')
    expect(run2.ok).toBe(true)

    const stale = await cmd(
      svc,
      'procurement.generateDraftsFromMrp',
      { planningRunId: run1.planningRunId },
      'gen-stale',
    )
    expect(stale.ok).toBe(false)
    expect(stale.error).toBe('planning_run_stale')
  })

  it('received qty is not double-counted as inbound+onhand after receipt', async () => {
    const svc = await activateAndSeedCatalog()
    await cmd(
      svc,
      'sales.order.draft.save',
      {
        id: 'so-recv',
        customerId: CUST_ID,
        lines: [
          { lineId: 'sol-1', finishedProductId: FG_ID, quantity: 10, unit: 'm2', requestedShipDate: DATE },
        ],
      },
      'sod',
    )
    expect((await cmd(svc, 'sales.order.confirm', { id: 'so-recv' }, 'soc')).ok).toBe(true)

    const run = await cmd(svc, 'planning.mrp.run', {}, 'run')
    expect(run.ok).toBe(true)
    const gen = await cmd(
      svc,
      'procurement.generateDraftsFromMrp',
      { planningRunId: run.planningRunId },
      'gen',
    )
    expect(gen.ok).toBe(true)
    const poId = gen.draftIds[0] as string
    expect((await cmd(svc, 'procurement.order.submit', { id: poId }, 'sub')).ok).toBe(true)
    expect((await cmd(svc, 'procurement.order.approve', { id: poId }, 'apr')).ok).toBe(true)
    expect((await cmd(svc, 'procurement.order.markOrdered', { id: poId }, 'ord')).ok).toBe(true)

    const po = payload().domains.procurement.orders.find((o: { id: string }) => o.id === poId)
    const lineId = po.lines[0].lineId as string
    const requested = Number(po.lines[0].requestedQty)
    const partial = Math.max(1, Math.floor(requested / 2))

    const recv = await cmd(
      svc,
      'procurement.receipt.post',
      {
        purchaseOrderId: poId,
        warehouseId: WH,
        date: DATE,
        lines: [{ lineId, quantity: partial, locationId: LOC, batchNo: 'B1' }],
      },
      'recv',
    )
    expect(recv.ok).toBe(true)

    const mrp2 = await cmd(svc, 'planning.mrp.run', {}, 'run-after-recv')
    expect(mrp2.ok).toBe(true)
    const saved = payload().domains.planning.planningRuns.find(
      (r: { id: string }) => r.id === mrp2.planningRunId,
    )
    const openRemaining = requested - partial
    const inboundEvents = (saved.supplyEvents ?? []).filter(
      (e: { kind: string; itemId: string }) =>
        e.kind === 'procurement_inbound' && e.itemId === ITEM_ID,
    )
    const inboundQty = inboundEvents.reduce(
      (s: number, e: { qty: number }) => s + (Number(e.qty) || 0),
      0,
    )
    // Open inbound after partial receipt = remaining, NOT full requested + onhand duplicate
    expect(inboundQty).toBeLessThanOrEqual(openRemaining + 0.01)
    expect(inboundQty).toBeCloseTo(openRemaining, 5)

    const onhandFromMovements = (payload().domains.warehouse.movements ?? [])
      .filter((m: { itemId: string; cancelled?: boolean }) => m.itemId === ITEM_ID && !m.cancelled)
      .reduce((s: number, m: { quantity: number; type: string }) => {
        const t = String(m.type).toLowerCase()
        if (t === 'receipt' || t === 'in') return s + (Number(m.quantity) || 0)
        if (t === 'issue' || t === 'out') return s - (Number(m.quantity) || 0)
        return s
      }, 0)
    // Total supply attribution must not be onhand + full original inbound
    expect(inboundQty + onhandFromMovements).toBeLessThan(requested + partial + 0.01)
  })

  it('issued-to-line is not free supply for other orders', async () => {
    const svc = await activateAndSeedCatalog()
    const h = await import('../api/fst/_g1CriticalHelpers.mjs')
    const p = payload()
    p.domains.warehouse.movements = [
      {
        id: 'iss-other',
        type: 'receipt',
        warehouseId: LINE_WH,
        itemId: ITEM_ID,
        quantity: 100,
        productionOrderId: 'po-other',
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
    // BOM need = 10 * 2 = 20; line stock for po-other ignored → shortage ~20
    expect(sh.shortageQty).toBeGreaterThanOrEqual(19)
  })
})

describe('G5.2 UI fail-closed', () => {
  it('executeG5Command failure does not call mirrorG5Ack (mirrorG5AckIfOk)', () => {
    const store = { sales: { orders: [] }, procurement: { orders: [] } } as unknown as AppStore
    const failResult: G5ServerResult<G5AckPayload> = {
      ok: false,
      error: 'forbidden',
      message: 'no',
    }
    expect(mirrorG5AckIfOk(store, failResult)).toBeNull()

    // Slice pattern: only mirror when ok
    const mirrorSpy = vi.fn((s: AppStore, ack: G5AckPayload) => {
      void ack
      return s
    })
    const conf = failResult
    if (conf.ok) {
      mirrorSpy(store, conf.data)
    }
    expect(mirrorSpy).not.toHaveBeenCalled()
  })

  it('G5_UI_GATEWAY_MATRIX lists all named wrappers (sanity)', () => {
    expect(G5_UI_GATEWAY_MATRIX.length).toBeGreaterThanOrEqual(30)
    expect(G5_UI_GATEWAY_MATRIX.some((r) => r.commandType === 'procurement.receipt.post')).toBe(true)
    expect(G5_UI_GATEWAY_MATRIX.some((r) => r.commandType === 'sales.shipment.post')).toBe(true)
  })
})
