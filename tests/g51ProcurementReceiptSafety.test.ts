/**
 * PHASE G5.1 — procurement receipt safety: over_receipt, batch_required, G2 use_g5_gateway.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { G5_CAPS, defaultG5Capabilities } from '../api/fst/_g5Capabilities.mjs'
import { G2_CAPS } from '../api/fst/_g2Capabilities.mjs'

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

async function seedApprovedPo(batchTracking = false) {
  grant({ ...ALL_G5, ...ALL_G2 })
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
  p.domains.warehouse.locations = [{ id: LOC, warehouseId: WH }]
  dcState.critical!.payloadJson = h.serializeCriticalPayload(p)

  expect(
    (
      await cmd(svc, 'masterdata.item.upsert', {
        id: ITEM_ID,
        code: 'FILM-1',
        name: 'Film',
        baseUnit: 'kg',
        moq: 10,
        batchTracking,
        defaultSupplierId: SUP_ID,
      }, 'item')
    ).ok,
  ).toBe(true)
  expect(
    (
      await cmd(svc, 'masterdata.product.upsert', {
        id: FG_ID,
        code: 'FP-1',
        name: 'P',
        packagingBomId: BOM_ID,
      }, 'fp')
    ).ok,
  ).toBe(true)
  expect((await cmd(svc, 'masterdata.customer.upsert', { id: CUST_ID, code: 'C1', name: 'A' }, 'c')).ok).toBe(
    true,
  )
  expect(
    (
      await cmd(svc, 'masterdata.supplier.upsert', {
        id: SUP_ID,
        code: 'S1',
        name: 'S',
        suppliedItemIds: [ITEM_ID],
      }, 's')
    ).ok,
  ).toBe(true)
  expect(
    (
      await cmd(svc, 'masterdata.bom.upsert', {
        id: BOM_ID,
        finishedProductId: FG_ID,
        version: 1,
        lines: [{ itemId: ITEM_ID, qty: 1, unit: 'kg' }],
      }, 'bom')
    ).ok,
  ).toBe(true)
  expect((await cmd(svc, 'masterdata.bom.approve', { id: BOM_ID }, 'bom-ap')).ok).toBe(true)

  await cmd(
    svc,
    'sales.order.draft.save',
    {
      id: 'so-1',
      customerId: CUST_ID,
      lines: [{ lineId: 'l1', finishedProductId: FG_ID, quantity: 5, unit: 'm2', requestedShipDate: DATE }],
    },
    'sod',
  )
  expect((await cmd(svc, 'sales.order.confirm', { id: 'so-1' }, 'soc')).ok).toBe(true)
  const run = await cmd(svc, 'planning.mrp.run', {}, 'run')
  const gen = await cmd(svc, 'procurement.generateDraftsFromMrp', { planningRunId: run.planningRunId }, 'gen')
  const poId = gen.draftIds[0] as string
  expect((await cmd(svc, 'procurement.order.submit', { id: poId }, 'sub')).ok).toBe(true)
  expect((await cmd(svc, 'procurement.order.approve', { id: poId }, 'apr')).ok).toBe(true)
  const lineId = payload().domains.procurement.orders.find((o: { id: string }) => o.id === poId).lines[0]
    .lineId
  return { svc, poId, lineId }
}

describe('G5.1 procurement receipt safety', () => {
  it('rejects over_receipt and requires batch when batchTracking', async () => {
    const { svc, poId, lineId } = await seedApprovedPo(true)
    const openQty = payload().domains.procurement.orders.find((o: { id: string }) => o.id === poId)
      .lines[0].requestedQty as number

    const noBatch = await cmd(
      svc,
      'procurement.receipt.post',
      {
        purchaseOrderId: poId,
        warehouseId: WH,
        date: DATE,
        lines: [{ lineId, quantity: 1, locationId: LOC }],
      },
      'recv-nb',
    )
    expect(noBatch.ok).toBe(false)
    expect(noBatch.error).toBe('batch_required')

    const over = await cmd(
      svc,
      'procurement.receipt.post',
      {
        purchaseOrderId: poId,
        warehouseId: WH,
        date: DATE,
        lines: [{ lineId, quantity: openQty + 5, locationId: LOC, batchNo: 'B1' }],
      },
      'recv-over',
    )
    expect(over.ok).toBe(false)
    expect(over.error).toBe('over_receipt')
  })

  it('G2 purchase post returns use_g5_gateway when procurement active', async () => {
    await seedApprovedPo(false)
    const g2 = await import('../api/fst/_g2WarehouseService.mjs')
    const denied = await g2.executeG2Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'g2-purchase-denied',
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
})
