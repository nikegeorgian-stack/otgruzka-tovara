/**
 * PHASE G5.1 — security / concurrency: forged IDs, finance can't receipt,
 * double-ship race (second fails), stale planningRun.
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
const financeActor = { uid: 'fin', email: 'fin@x', claims: {} }
const ALL_CAPS = defaultG5Capabilities(
  Object.fromEntries(Object.values(G5_CAPS).map((k) => [k, true])),
)

const WH = 'fg-wh'
const LOC = 'fg-loc'
const FG_ID = 'fp-1'
const ITEM_ID = 'item-1'
const CUST_ID = 'cust-1'
const SUP_ID = 'sup-1'
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

function grant(caps: Record<string, unknown>, uid = 'u1') {
  const id = `${STORE}::${uid}`
  dcState.principals.set(id, {
    id,
    firebaseUid: uid,
    storeId: STORE,
    roleId: 'x',
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
  who = actor,
) {
  return svc.executeG5Command({
    actor: who,
    storeId: STORE,
    idempotencyKey: key,
    commandType,
    command,
  })
}

describe('G5.1 security / concurrency', () => {
  it('rejects forged client roleId and finance cannot receipt', async () => {
    grant(ALL_CAPS)
    const svc = await import('../server/fst/_g5SalesProcurementService.mjs')
    const forged = await svc.executeG5Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'forge-role',
      commandType: 'sales.domain.activate',
      command: { reason: 'x', roleId: 'sysadmin' },
    })
    expect(forged.ok).toBe(false)
    expect(forged.error).toBe('client_role_forbidden')

    expect((await cmd(svc, 'masterdata.domain.activate', { reason: 'x' }, 'md')).ok).toBe(true)
    expect((await cmd(svc, 'procurement.domain.activate', { reason: 'x' }, 'pr')).ok).toBe(true)
    const h = await import('../server/fst/_g1CriticalHelpers.mjs')
    let p = payload()
    p = h.markWarehouseDomainActive(p, 'u1')
    p.domains.warehouse.locations = [{ id: LOC, warehouseId: WH }]
    p.domains.procurement.orders = [
      {
        id: 'po-1',
        status: 'approved',
        lines: [
          {
            lineId: 'pl-1',
            itemId: ITEM_ID,
            requestedQty: 10,
            receivedQty: 0,
            unit: 'kg',
          },
        ],
      },
    ]
    p.domains.masterData.items = [
      { id: ITEM_ID, code: 'I1', name: 'Item', baseUnit: 'kg', active: true },
    ]
    dcState.critical!.payloadJson = h.serializeCriticalPayload(p)

    grant(defaultG5Capabilities({ [G5_CAPS.PROCUREMENT_PAYMENT_RECORD]: true }), 'fin')
    const denied = await cmd(
      svc,
      'procurement.receipt.post',
      {
        purchaseOrderId: 'po-1',
        warehouseId: WH,
        date: DATE,
        lines: [{ lineId: 'pl-1', quantity: 1, locationId: LOC }],
      },
      'fin-recv',
      financeActor,
    )
    expect(denied.ok).toBe(false)
    expect(denied.error).toBe('forbidden')
  })

  it('second concurrent ship of overlapping qty fails after first posts', async () => {
    grant(ALL_CAPS)
    const svc = await import('../server/fst/_g5SalesProcurementService.mjs')
    expect((await cmd(svc, 'masterdata.domain.activate', { reason: 'x' }, 'md')).ok).toBe(true)
    expect((await cmd(svc, 'sales.domain.activate', { reason: 'x' }, 'sp')).ok).toBe(true)
    const h = await import('../server/fst/_g1CriticalHelpers.mjs')
    let p = payload()
    p = h.markWarehouseDomainActive(p, 'u1')
    p = h.markPackagingQcFeatureActive(p, 'u1')
    p.domains.warehouse.locations = [{ id: LOC, warehouseId: WH }]
    p.domains.warehouse.movements = [
      {
        id: 'm1',
        type: 'receipt',
        warehouseId: WH,
        locationId: LOC,
        itemId: FG_ID,
        quantity: 20,
        batchNo: 'L1',
      },
    ]
    p.domains.production.finishedGoodsLots = [
      {
        id: LOT_ID,
        finishedProductId: FG_ID,
        warehouseId: WH,
        locationId: LOC,
        warehouseItemId: FG_ID,
        lotNumber: 'L1',
        qcStatus: 'released',
        quantityQcReleased: 20,
        quantityShipped: 0,
        lotRevision: 1,
        currentDecisionId: 'd1',
      },
    ]
    p.domains.production.qcDecisions = [{ id: 'd1', lotId: LOT_ID, status: 'released', lotRevision: 1 }]
    dcState.critical!.payloadJson = h.serializeCriticalPayload(p)

    expect(
      (await cmd(svc, 'masterdata.product.upsert', { id: FG_ID, code: 'FP', name: 'P' }, 'fp')).ok,
    ).toBe(true)
    expect(
      (await cmd(svc, 'masterdata.customer.upsert', { id: CUST_ID, code: 'C', name: 'C' }, 'c')).ok,
    ).toBe(true)
    await cmd(
      svc,
      'sales.order.draft.save',
      {
        id: 'so-r',
        customerId: CUST_ID,
        lines: [
          { lineId: 'sol-1', finishedProductId: FG_ID, quantity: 20, unit: 'm2', requestedShipDate: DATE },
        ],
      },
      'sod',
    )
    expect((await cmd(svc, 'sales.order.confirm', { id: 'so-r' }, 'soc')).ok).toBe(true)

    const first = await cmd(
      svc,
      'sales.shipment.post',
      {
        salesOrderId: 'so-r',
        salesLineId: 'sol-1',
        shipmentId: 'shp-a',
        finishedGoodsLotId: LOT_ID,
        finishedProductId: FG_ID,
        quantity: 15,
        warehouseId: WH,
        date: DATE,
      },
      'ship-a',
    )
    expect(first.ok).toBe(true)

    const second = await cmd(
      svc,
      'sales.shipment.post',
      {
        salesOrderId: 'so-r',
        salesLineId: 'sol-1',
        shipmentId: 'shp-b',
        finishedGoodsLotId: LOT_ID,
        finishedProductId: FG_ID,
        quantity: 15,
        warehouseId: WH,
        date: DATE,
      },
      'ship-b',
    )
    expect(second.ok).toBe(false)
    expect(
      second.error === 'quantity_exceeds_remaining' ||
        second.error === 'quantity_exceeds_sales_remaining' ||
        second.error === 'insufficient_stock',
    ).toBe(true)
  })

  it('stale planningRun cannot generate drafts', async () => {
    grant(ALL_CAPS)
    const svc = await import('../server/fst/_g5SalesProcurementService.mjs')
    expect((await cmd(svc, 'masterdata.domain.activate', { reason: 'x' }, 'md')).ok).toBe(true)
    expect((await cmd(svc, 'sales.domain.activate', { reason: 'x' }, 'sp')).ok).toBe(true)
    expect((await cmd(svc, 'procurement.domain.activate', { reason: 'x' }, 'pr')).ok).toBe(true)

    expect(
      (
        await cmd(svc, 'masterdata.item.upsert', {
          id: ITEM_ID,
          code: 'I1',
          name: 'Item',
          baseUnit: 'kg',
          moq: 1,
          defaultSupplierId: SUP_ID,
        }, 'item')
      ).ok,
    ).toBe(true)
    expect(
      (await cmd(svc, 'masterdata.product.upsert', { id: FG_ID, code: 'FP', name: 'P', packagingBomId: 'bom-1' }, 'fp'))
        .ok,
    ).toBe(true)
    expect(
      (await cmd(svc, 'masterdata.customer.upsert', { id: CUST_ID, code: 'C', name: 'C' }, 'c')).ok,
    ).toBe(true)
    expect(
      (
        await cmd(svc, 'masterdata.supplier.upsert', {
          id: SUP_ID,
          code: 'S',
          name: 'S',
          suppliedItemIds: [ITEM_ID],
        }, 's')
      ).ok,
    ).toBe(true)
    expect(
      (
        await cmd(svc, 'masterdata.bom.upsert', {
          id: 'bom-1',
          finishedProductId: FG_ID,
          version: 1,
          lines: [{ itemId: ITEM_ID, qty: 1, unit: 'kg' }],
        }, 'bom')
      ).ok,
    ).toBe(true)
    expect((await cmd(svc, 'masterdata.bom.approve', { id: 'bom-1' }, 'bom-ap')).ok).toBe(true)

    await cmd(
      svc,
      'sales.order.draft.save',
      {
        id: 'so-s',
        customerId: CUST_ID,
        lines: [
          { lineId: 'sol-1', finishedProductId: FG_ID, quantity: 5, unit: 'm2', requestedShipDate: DATE },
        ],
      },
      'sod',
    )
    expect((await cmd(svc, 'sales.order.confirm', { id: 'so-s' }, 'soc')).ok).toBe(true)

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
})
