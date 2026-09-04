/**
 * PHASE G5 — master-data / sales / MRP / procurement lifecycle.
 *
 * In-memory mocks for Data Connect (critical store + principals + receipts + CAS)
 * and admin auth — mirrors G4 packaging tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { G5_CAPS, defaultG5Capabilities } from '../api/fst/_g5Capabilities.mjs'

// ---------------------------------------------------------------------------
// In-memory Data Connect
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STORE = 'fibercell-main'
const actor = { uid: 'u1', email: 'u1@x', claims: {} }
const sysadminActor = { uid: 'u1', email: 'admin@fibercell.net', claims: {} }

const ALL_CAPS = defaultG5Capabilities(
  Object.fromEntries(Object.values(G5_CAPS).map((k) => [k, true])),
)

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function grant(caps: Record<string, unknown>, uid = 'u1', active = true) {
  const id = `${STORE}::${uid}`
  dcState.principals.set(id, {
    id,
    firebaseUid: uid,
    storeId: STORE,
    roleId: 'sales',
    capabilitiesJson: JSON.stringify(caps),
    active,
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

async function cmd(
  svc: { executeG5Command: (input: Record<string, unknown>) => Promise<Record<string, unknown>> },
  commandType: string,
  command: Record<string, unknown> = {},
  idempotencyKey = `${commandType}-${Math.random().toString(36).slice(2, 8)}`,
  who = actor,
) {
  return svc.executeG5Command({
    actor: who,
    storeId: STORE,
    idempotencyKey,
    commandType,
    command,
  })
}

/** Activate masterData + salesPlanning + procurement; mark warehouse active for receipts. */
async function activateAll(svc: Awaited<ReturnType<typeof g5>>) {
  grant(ALL_CAPS)
  for (const [type, key] of [
    ['masterdata.domain.activate', 'md-act'],
    ['sales.domain.activate', 'sp-act'],
    ['procurement.domain.activate', 'pr-act'],
  ] as const) {
    const r = await cmd(svc, type, { reason: 'g5 bootstrap' }, key)
    expect(r.ok).toBe(true)
  }
  const h = await import('../api/fst/_g1CriticalHelpers.mjs')
  const p = payload()
  const marked = h.markWarehouseDomainActive(p, 'u1')
  marked.domains.warehouse.locations = [{ id: WH }, { id: LOC }]
  dcState.critical!.payloadJson = h.serializeCriticalPayload(marked)
  return svc
}

async function seedMasterCatalog(svc: Awaited<ReturnType<typeof g5>>, opts: { moq?: number; withSupplier?: boolean; withBom?: boolean } = {}) {
  const withSupplier = opts.withSupplier !== false
  const withBom = opts.withBom !== false

  expect(
    (
      await cmd(svc, 'masterdata.item.upsert', {
        id: ITEM_ID,
        code: 'FILM-1',
        name: 'Film',
        baseUnit: 'kg',
        moq: opts.moq ?? 10,
        orderMultiple: opts.moq ? opts.moq : 1,
        leadTimeDays: 7,
        defaultSupplierId: withSupplier ? SUP_ID : undefined,
      }, 'md-item')
    ).ok,
  ).toBe(true)

  expect(
    (
      await cmd(svc, 'masterdata.product.upsert', {
        id: FG_ID,
        code: 'FP-1',
        name: 'Finished panel',
        packagingBomId: withBom ? BOM_ID : undefined,
      }, 'md-fp')
    ).ok,
  ).toBe(true)

  expect(
    (await cmd(svc, 'masterdata.customer.upsert', { id: CUST_ID, code: 'C1', name: 'Acme' }, 'md-cust'))
      .ok,
  ).toBe(true)

  if (withSupplier) {
    expect(
      (
        await cmd(
          svc,
          'masterdata.supplier.upsert',
          { id: SUP_ID, code: 'S1', name: 'Supplier Co', suppliedItemIds: [ITEM_ID] },
          'md-sup',
        )
      ).ok,
    ).toBe(true)
  }

  if (withBom) {
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
  }
}

async function confirmSalesOrder(
  svc: Awaited<ReturnType<typeof g5>>,
  orderId: string,
  qty = 50,
  key = 'so-confirm',
) {
  const draft = await cmd(
    svc,
    'sales.order.draft.save',
    {
      id: orderId,
      customerId: CUST_ID,
      priority: 1,
      lines: [
        {
          lineId: 'sol-1',
          finishedProductId: FG_ID,
          quantity: qty,
          unit: 'm2',
          requestedShipDate: DATE,
        },
      ],
    },
    `${key}-draft`,
  )
  expect(draft.ok).toBe(true)
  const confirmed = await cmd(svc, 'sales.order.confirm', { id: orderId }, key)
  expect(confirmed.ok).toBe(true)
  return confirmed
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

describe('G5 domain activation', () => {
  it('empty domains are not authoritative; login/pull / sibling domains do not activate G5', async () => {
    const h = await import('../api/fst/_g1CriticalHelpers.mjs')
    const empty = h.emptyCriticalPayload()
    expect(h.isMasterDataDomainActive(empty)).toBe(false)
    expect(h.isSalesPlanningActive(empty)).toBe(false)
    expect(h.isProcurementDomainActive(empty)).toBe(false)

    // "Pull" with revision > 0 and empty domains still inactive for G5
    const pulled = h.parseCriticalPayload(h.serializeCriticalPayload(empty), { revision: 12 })
    expect(pulled.ok).toBe(true)
    expect(h.isSalesPlanningActive(pulled.payload)).toBe(false)
    expect(h.isMasterDataDomainActive(pulled.payload)).toBe(false)

    let p = h.markWarehouseDomainActive(empty, 'u1')
    p = h.markProductionDomainActive(p, 'u1')
    p = h.markPackagingQcFeatureActive(p, 'u1')
    expect(h.isWarehouseDomainActive(p, 1)).toBe(true)
    expect(h.isProductionDomainActive(p, 1)).toBe(true)
    expect(h.isPackagingQcFeatureActive(p)).toBe(true)
    expect(h.isSalesPlanningActive(p)).toBe(false)
    expect(h.isMasterDataDomainActive(p)).toBe(false)
    expect(h.isProcurementDomainActive(p)).toBe(false)

    grant(ALL_CAPS)
    const svc = await g5()
    const auth = await svc.getAuthoritativeG5Domains(STORE)
    expect(auth.ok).toBe(true)
    expect(auth.salesPlanningActive).toBe(false)
    expect(auth.masterDataActive).toBe(false)
    expect(auth.procurementActive).toBe(false)
  })

  it('sales.domain.activate sets salesPlanning; masterdata and procurement stay separate', async () => {
    grant(ALL_CAPS)
    const svc = await g5()
    const salesAct = await cmd(svc, 'sales.domain.activate', { reason: 'go-live' }, 'act-sales')
    expect(salesAct.ok).toBe(true)
    expect(salesAct.salesPlanningActive).toBe(true)
    expect(payload().domainMeta.salesPlanning.active).toBe(true)
    expect(payload().domainMeta.masterData?.active).not.toBe(true)
    expect(payload().domainMeta.procurement?.active).not.toBe(true)

    const mdAct = await cmd(svc, 'masterdata.domain.activate', { reason: 'md' }, 'act-md')
    expect(mdAct.ok).toBe(true)
    expect(payload().domainMeta.masterData.active).toBe(true)
    expect(payload().domainMeta.procurement?.active).not.toBe(true)

    const prAct = await cmd(svc, 'procurement.domain.activate', { reason: 'pr' }, 'act-pr')
    expect(prAct.ok).toBe(true)
    expect(payload().domainMeta.procurement.active).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Master data
// ---------------------------------------------------------------------------

describe('G5 master data', () => {
  it('upserts entities, rejects duplicate codes, archives instead of delete', async () => {
    const svc = await g5()
    await activateAll(svc)
    await seedMasterCatalog(svc)

    const p = payload()
    expect(p.domains.masterData.items.some((x: { id: string }) => x.id === ITEM_ID)).toBe(true)
    expect(p.domains.masterData.finishedProducts.some((x: { id: string }) => x.id === FG_ID)).toBe(
      true,
    )
    expect(p.domains.masterData.customers.some((x: { id: string }) => x.id === CUST_ID)).toBe(true)
    expect(p.domains.masterData.suppliers.some((x: { id: string }) => x.id === SUP_ID)).toBe(true)
    expect(p.domains.masterData.packagingBoms.some((x: { id: string }) => x.id === BOM_ID)).toBe(
      true,
    )

    const dup = await cmd(
      svc,
      'masterdata.item.upsert',
      { id: 'item-other', code: 'FILM-1', name: 'Dup', baseUnit: 'kg' },
      'md-dup',
    )
    expect(dup.ok).toBe(false)
    expect(dup.error).toBe('duplicate_code')

    const archived = await cmd(svc, 'masterdata.item.archive', { id: ITEM_ID }, 'md-arch')
    expect(archived.ok).toBe(true)
    const after = payload().domains.masterData.items.find((x: { id: string }) => x.id === ITEM_ID)
    expect(after.archived).toBe(true)
    expect(after.active).toBe(false)
    expect(payload().domains.masterData.items.some((x: { id: string }) => x.id === ITEM_ID)).toBe(
      true,
    )
  })

  it('sales confirm rejects unknown finishedProductId', async () => {
    const svc = await g5()
    await activateAll(svc)
    await seedMasterCatalog(svc)

    // Bypass draft product check by planting a draft with a bogus product id
    const p = payload()
    p.domains.sales.orders = [
      {
        id: 'so-bad',
        status: 'draft',
        customerId: CUST_ID,
        revision: 0,
        lines: [{ lineId: 'sol-1', finishedProductId: 'fp-missing', quantity: 10, unit: 'm2' }],
      },
    ]
    dcState.critical!.payloadJson = JSON.stringify(p)

    const confirmed = await cmd(svc, 'sales.order.confirm', { id: 'so-bad' }, 'so-bad-confirm')
    expect(confirmed.ok).toBe(false)
    expect(confirmed.error).toBe('product_not_found')
  })
})

// ---------------------------------------------------------------------------
// Sales lifecycle
// ---------------------------------------------------------------------------

describe('G5 sales lifecycle', () => {
  it('draft → confirm snapshots + recommendation; idempotent confirm; change/cancel rules', async () => {
    const svc = await g5()
    await activateAll(svc)
    await seedMasterCatalog(svc)

    await confirmSalesOrder(svc, 'so-1', 40, 'life-confirm')
    const order = payload().domains.sales.orders.find((o: { id: string }) => o.id === 'so-1')
    expect(order.status).toBe('confirmed')
    expect(order.customerNameSnapshot).toBe('Acme')
    expect(order.lines[0].productCodeSnapshot).toBe('FP-1')
    expect(order.lines[0].productNameSnapshot).toBe('Finished panel')

    const recs = payload().domains.planning.productionRecommendations.filter(
      (r: { salesOrderId: string; status: string }) =>
        r.salesOrderId === 'so-1' && r.status === 'open',
    )
    expect(recs.length).toBe(1)
    expect(recs[0].requiredQty).toBe(40)

    const again = await cmd(svc, 'sales.order.confirm', { id: 'so-1' }, 'life-confirm')
    expect(again.ok).toBe(true)
    expect(again.idempotent).toBe(true)

    // Simulate prior shipment qty on the line
    const p = payload()
    const o = p.domains.sales.orders.find((x: { id: string }) => x.id === 'so-1')
    o.lines[0].shippedQty = 25
    dcState.critical!.payloadJson = JSON.stringify(p)

    const below = await cmd(
      svc,
      'sales.order.change',
      { id: 'so-1', lines: [{ lineId: 'sol-1', quantity: 10 }] },
      'life-change-low',
    )
    expect(below.ok).toBe(false)
    expect(below.error).toBe('qty_below_shipped')

    const okChange = await cmd(
      svc,
      'sales.order.change',
      { id: 'so-1', lines: [{ lineId: 'sol-1', quantity: 30 }] },
      'life-change-ok',
    )
    expect(okChange.ok).toBe(true)

    const cancelled = await cmd(svc, 'sales.order.cancel', { id: 'so-1' }, 'life-cancel')
    expect(cancelled.ok).toBe(true)
    const openAfter = payload().domains.planning.productionRecommendations.filter(
      (r: { salesOrderId: string; status: string }) =>
        r.salesOrderId === 'so-1' && r.status === 'open',
    )
    expect(openAfter.length).toBe(0)
    expect(
      payload().domains.planning.productionRecommendations.some(
        (r: { salesOrderId: string; status: string }) =>
          r.salesOrderId === 'so-1' && r.status === 'superseded',
      ),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// MRP
// ---------------------------------------------------------------------------

describe('G5 MRP', () => {
  it('run produces planningRun with contentHash; shortage when no stock; fail-closed on missing BOM', async () => {
    const svc = await g5()
    await activateAll(svc)
    await seedMasterCatalog(svc, { withBom: true })
    await confirmSalesOrder(svc, 'so-mrp', 20, 'mrp-so')

    const run = await cmd(svc, 'planning.mrp.run', {}, 'mrp-run-1')
    expect(run.ok).toBe(true)
    expect(run.planningRunId).toBeTruthy()
    expect(run.contentHash).toBeTruthy()
    expect(run.shortageCount).toBeGreaterThan(0)
    expect(run.masterDataErrorCount).toBe(0)

    const planning = payload().domains.planning
    const saved = planning.planningRuns.find((r: { id: string }) => r.id === run.planningRunId)
    expect(saved.contentHash).toBe(run.contentHash)
    expect(planning.shortages.some((s: { itemId: string; status: string }) => s.itemId === ITEM_ID && s.status === 'open')).toBe(
      true,
    )

    // Missing BOM → fail-closed, no packaging shortage invented from BOM explosion
    const svc2 = await g5()
    dcState.critical = null
    dcState.receipts.clear()
    await activateAll(svc2)
    await seedMasterCatalog(svc2, { withBom: false })
    await confirmSalesOrder(svc2, 'so-nobom', 15, 'mrp-nobom-so')

    const failRun = await cmd(svc2, 'planning.mrp.run', {}, 'mrp-run-nobom')
    expect(failRun.ok).toBe(true)
    expect(failRun.failClosed).toBe(true)
    expect(failRun.masterDataErrorCount).toBeGreaterThan(0)
    expect(
      payload().domains.planning.masterDataErrors.some(
        (e: { kind: string }) => e.kind === 'missing_bom',
      ),
    ).toBe(true)

    const drafts = await cmd(
      svc2,
      'procurement.generateDraftsFromMrp',
      { planningRunId: failRun.planningRunId },
      'mrp-nobom-drafts',
    )
    expect(drafts.ok).toBe(true)
    expect(drafts.draftIds ?? []).toHaveLength(0)
  })

  it('generateDraftsFromMrp applies MOQ, is idempotent, and records unassigned when no supplier', async () => {
    const svc = await g5()
    await activateAll(svc)
    await seedMasterCatalog(svc, { moq: 100, withSupplier: true })
    await confirmSalesOrder(svc, 'so-moq', 10, 'moq-so') // BOM need = 20 kg < MOQ 100

    const run = await cmd(svc, 'planning.mrp.run', {}, 'moq-run')
    expect(run.ok).toBe(true)
    const gen = await cmd(
      svc,
      'procurement.generateDraftsFromMrp',
      { planningRunId: run.planningRunId },
      'moq-gen',
    )
    expect(gen.ok).toBe(true)
    expect(gen.draftIds.length).toBe(1)
    const po = payload().domains.procurement.orders.find(
      (o: { id: string }) => o.id === gen.draftIds[0],
    )
    expect(po.lines[0].requestedQty).toBe(100)

    const again = await cmd(
      svc,
      'procurement.generateDraftsFromMrp',
      { planningRunId: run.planningRunId },
      'moq-gen-2',
    )
    expect(again.ok).toBe(true)
    expect(again.idempotent).toBe(true)

    // No supplier path
    const svc3 = await g5()
    dcState.critical = null
    dcState.receipts.clear()
    await activateAll(svc3)
    await seedMasterCatalog(svc3, { withSupplier: false })
    await confirmSalesOrder(svc3, 'so-nosup', 10, 'nosup-so')
    const run3 = await cmd(svc3, 'planning.mrp.run', {}, 'nosup-run')
    const gen3 = await cmd(
      svc3,
      'procurement.generateDraftsFromMrp',
      { planningRunId: run3.planningRunId },
      'nosup-gen',
    )
    expect(gen3.ok).toBe(true)
    expect(gen3.draftIds ?? []).toHaveLength(0)
    expect(
      (gen3.unassignedShortages ?? []).some((u: { reason: string }) => u.reason === 'no_supplier'),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Procurement
// ---------------------------------------------------------------------------

describe('G5 procurement', () => {
  it('submit → approve → receipt.post updates warehouse + PO receivedQty; payment leaves warehouse hash', async () => {
    const h = await import('../api/fst/_g1CriticalHelpers.mjs')
    const svc = await g5()
    await activateAll(svc)
    await seedMasterCatalog(svc, { moq: 10 })
    await confirmSalesOrder(svc, 'so-po', 5, 'po-so')

    const run = await cmd(svc, 'planning.mrp.run', {}, 'po-run')
    const gen = await cmd(
      svc,
      'procurement.generateDraftsFromMrp',
      { planningRunId: run.planningRunId },
      'po-gen',
    )
    expect(gen.ok).toBe(true)
    const poId = gen.draftIds[0] as string

    expect((await cmd(svc, 'procurement.order.submit', { id: poId }, 'po-sub')).ok).toBe(true)
    expect((await cmd(svc, 'procurement.order.approve', { id: poId }, 'po-apr')).ok).toBe(true)

    const revBefore = Number(dcState.critical!.revision)
    const whHashBefore = h.stableDomainHash(payload().domains.warehouse)
    const poLineId = payload().domains.procurement.orders.find((o: { id: string }) => o.id === poId)
      .lines[0].lineId

    const receipt = await cmd(
      svc,
      'procurement.receipt.post',
      {
        purchaseOrderId: poId,
        warehouseId: WH,
        date: DATE,
        lines: [{ lineId: poLineId, quantity: 10, locationId: LOC, batchNo: 'B1' }],
      },
      'po-recv',
    )
    expect(receipt.ok).toBe(true)
    expect(receipt.touchesWarehouse).toBe(true)
    expect(Number(dcState.critical!.revision)).toBe(revBefore + 1)

    const afterRecv = payload()
    expect(afterRecv.domains.warehouse.movements.length).toBeGreaterThan(0)
    expect(afterRecv.domains.warehouse.documents.some((d: { purchaseOrderId: string }) => d.purchaseOrderId === poId)).toBe(
      true,
    )
    const po = afterRecv.domains.procurement.orders.find((o: { id: string }) => o.id === poId)
    expect(po.lines[0].receivedQty).toBe(10)

    const whHashMid = h.stableDomainHash(afterRecv.domains.warehouse)
    const pay = await cmd(
      svc,
      'procurement.payment.record',
      { purchaseOrderId: poId, amount: 250, currency: 'GEL' },
      'po-pay',
    )
    expect(pay.ok).toBe(true)
    expect(pay.touchesWarehouse).toBe(false)
    expect(h.stableDomainHash(payload().domains.warehouse)).toBe(whHashMid)
    expect(whHashMid).not.toBe(whHashBefore)
  })
})

// ---------------------------------------------------------------------------
// Trust boundary
// ---------------------------------------------------------------------------

describe('G5 trust boundary', () => {
  it('rejects payloadJson / roleId', async () => {
    grant(ALL_CAPS)
    const svc = await g5()
    const withPayload = await svc.executeG5Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'rej-payload',
      commandType: 'sales.domain.activate',
      command: { reason: 'x' },
      payloadJson: '{}',
    })
    expect(withPayload.ok).toBe(false)
    expect(withPayload.error).toBe('arbitrary_patch_forbidden')

    const withRole = await svc.executeG5Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'rej-role',
      commandType: 'sales.domain.activate',
      command: { reason: 'x', roleId: 'sysadmin' },
    })
    expect(withRole.ok).toBe(false)
    expect(withRole.error).toBe('client_role_forbidden')
  })

  it('sysadmin without cap cannot run gated command without emergencyReason', async () => {
    // Principal present but no procurement.receipt.post (or confirm) cap
    grant(defaultG5Capabilities({ [G5_CAPS.SALES_READ]: true }))
    const svc = await g5()
    // Seed salesPlanning active so the gate is capability, not domain inactive
    const h = await import('../api/fst/_g1CriticalHelpers.mjs')
    const seeded = h.markSalesPlanningActive(h.emptyCriticalPayload(), 'sys')
    const json = h.serializeCriticalPayload(seeded)
    dcState.critical = {
      id: STORE,
      revision: 1,
      payloadJson: json,
      fingerprint: h.fingerprintCriticalPayload(json),
      updatedByUid: 'sys',
    }

    const denied = await cmd(
      svc,
      'sales.order.confirm',
      { id: 'so-x' },
      'sys-no-emerg',
      sysadminActor,
    )
    expect(denied.ok).toBe(false)
    expect(denied.error).toBe('forbidden')
    expect(denied.status).toBe(403)

    // With emergencyReason, requirePrincipal allows — may fail later on domain data
    const emerg = await cmd(
      svc,
      'sales.order.confirm',
      { id: 'so-missing', emergencyReason: 'break-glass audit' },
      'sys-emerg',
      sysadminActor,
    )
    expect(emerg.error).not.toBe('forbidden')
  })

  it('exports requirePrincipal', async () => {
    const svc = await g5()
    expect(typeof svc.requirePrincipal).toBe('function')
  })
})
