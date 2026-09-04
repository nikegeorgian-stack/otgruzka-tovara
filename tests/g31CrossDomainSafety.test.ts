/**
 * PHASE G3.1 — domain activation, cross-domain preservation, CAS-embedded idempotency,
 * command coverage, ACL negatives.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('../api/fst/_g1DataConnect.mjs', () => ({
  getG1DataConnect: vi.fn(() => ({ mocked: true })),
  getFstPrincipalAccessByUidStore: (...args: unknown[]) => calls.getPrincipal(...args),
  getFstCriticalStore: (...args: unknown[]) => calls.getCritical(...args),
  getFstCommandReceipt: (...args: unknown[]) => calls.getReceipt(...args),
  upsertFstCriticalStore: (...args: unknown[]) => calls.upsertCritical(...args),
  updateFstCriticalStoreCas: (...args: unknown[]) => calls.updateCas(...args),
  insertFstCommandReceipt: (...args: unknown[]) => calls.insertReceipt(...args),
  upsertFstPrincipalAccess: vi.fn(async () => undefined),
}))

vi.mock('../api/fst/_adminAuth.mjs', () => ({
  FST_ADMIN_EMAILS: new Set(['admin@fibercell.net']),
  initFirebaseAdmin: vi.fn(),
}))

beforeEach(() => {
  for (const fn of Object.values(calls)) fn.mockReset()
  dcState.principals.clear()
  dcState.critical = null
  dcState.receipts.clear()
  calls.getPrincipal.mockImplementation(async (_dc: unknown, vars: { firebaseUid: string; storeId: string }) => {
    const id = `${vars.storeId}::${vars.firebaseUid}`
    const row = dcState.principals.get(id)
    return { data: { fstPrincipalAccesses: row ? [row] : [] } }
  })
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

function grant(uid: string, storeId: string, caps: Record<string, unknown>, active = true) {
  const id = `${storeId}::${uid}`
  dcState.principals.set(id, {
    id,
    firebaseUid: uid,
    storeId,
    roleId: 'production',
    capabilitiesJson: JSON.stringify(caps),
    active,
    revision: 1,
    createdByUid: 'sys',
    updatedByUid: 'sys',
  })
}

const actor = { uid: 'u1', email: 'u1@x', claims: {} }
const STORE = 'fibercell-main'
const ALL_CAPS = {
  'production.recipe.draft.edit': true,
  'production.recipe.approve': true,
  'production.order.edit': true,
  'production.order.confirm': true,
  'production.order.cancel': true,
  'production.material.issue': true,
  'production.material.return': true,
  'production.shift.edit': true,
  'production.shift.confirm': true,
  'production.shift.correct': true,
  'production.reservation.reallocate': true,
  'production.read': true,
  'warehouse.read': true,
  'warehouse.document.post': true,
  'warehouse.period.close': true,
  'warehouse.period.reopen': true,
  'warehouse.transfer.post': true,
  'warehouse.document.cancel': true,
  productionLineIds: ['*'],
}

function payload() {
  return JSON.parse(String(dcState.critical!.payloadJson))
}

async function activateProduction(svc: typeof import('../api/fst/_g3ProductionService.mjs')) {
  grant('u1', STORE, ALL_CAPS)
  const r = await svc.executeG3Command({
    actor,
    storeId: STORE,
    idempotencyKey: `act-${Math.random()}`,
    commandType: 'production.domain.activate',
    command: { reason: 'g31 bootstrap' },
  })
  expect(r.ok).toBe(true)
  expect(payload().domainMeta.production.active).toBe(true)
  return r
}

async function seedWhAndRecipe(svc: typeof import('../api/fst/_g3ProductionService.mjs')) {
  await activateProduction(svc)
  await svc.executeG3Command({
    actor,
    storeId: STORE,
    idempotencyKey: `rec-${Math.random()}`,
    commandType: 'production.recipe.draft.save',
    command: {
      recipeId: 'rec-1',
      versionId: 'rv-1',
      components: [{ warehouseItemId: 'mat-1', unitSnapshot: 'kg', normQty: 1, tolerancePct: 5 }],
    },
  })
  const p = payload()
  p.domains.warehouse.movements = [
    {
      id: 'm1',
      warehouseId: 'raw',
      itemId: 'mat-1',
      type: 'receipt',
      quantity: 10,
      batchNo: 'B1',
      expiryDate: '2026-12-01',
      at: '2026-09-01T00:00:00.000Z',
    },
  ]
  p.domains.warehouse.productionLineBindings = [
    { id: 'line-a', lineId: 'line-a', productionWarehouseId: 'prod-wh', productionLocationId: 'prod-loc' },
  ]
  p.domains.warehouse.locations = [{ id: 'raw' }, { id: 'prod-wh' }, { id: 'prod-loc' }, { id: 'scrap' }]
  p.domains.warehouse.scrapLocationId = 'scrap'
  p.domains.warehouse.futureExtraField = { keep: true }
  p.envelopeFuture = 'preserve-me'
  dcState.critical!.payloadJson = JSON.stringify(p)
  await svc.executeG3Command({
    actor,
    storeId: STORE,
    idempotencyKey: `apr-${Math.random()}`,
    commandType: 'production.recipe.version.approve',
    command: { versionId: 'rv-1' },
  })
}

describe('G3.1 domain activation', () => {
  it('warehouse active + production inactive keeps legacy production readable; revision alone does not activate production', async () => {
    const helpers = await import('../api/fst/_g1CriticalHelpers.mjs')
    const raw = {
      schemaVersion: 2,
      domains: {
        warehouse: { ...helpers.emptyWarehouseStore(), documents: [{ id: 'd1' }], movements: [] },
      },
    }
    const parsed = helpers.parseCriticalPayload(JSON.stringify(raw), { revision: 5 })
    expect(parsed.ok).toBe(true)
    expect(helpers.isWarehouseDomainActive(parsed.payload, 5)).toBe(true)
    expect(helpers.isProductionDomainActive(parsed.payload, 5)).toBe(false)

    const { resolveAuthoritativeProductionOverlay } = await import('../src/lib/production/g3ServerClient')
    const overlay = resolveAuthoritativeProductionOverlay({
      legacyProduction: { planner: { orders: [{ id: 'legacy-1' }] } },
      criticalProduction: { orders: [] },
      criticalRevision: 5,
      productionActive: false,
    })
    expect(overlay.source).toBe('legacy_fst_store_not_authoritative')
    expect((overlay.production as { planner: { orders: unknown[] } }).planner.orders[0].id).toBe('legacy-1')
  })

  it('production active: fetch failure blocks legacy; empty critical production is intentional', async () => {
    const { resolveAuthoritativeProductionOverlay } = await import('../src/lib/production/g3ServerClient')
    const blocked = resolveAuthoritativeProductionOverlay({
      legacyProduction: { planner: { orders: [{ id: 'legacy-1' }] } },
      criticalProduction: null,
      criticalRevision: 9,
      productionActive: true,
      fetchFailed: true,
    })
    expect(blocked.authoritativeBlocked).toBe(true)
    const emptyOk = resolveAuthoritativeProductionOverlay({
      legacyProduction: { planner: { orders: [{ id: 'legacy-1' }] } },
      criticalProduction: { orders: [] },
      criticalRevision: 9,
      productionActive: true,
    })
    expect(emptyOk.source).toBe('fst_critical_store')
    expect((emptyOk.production as { g3Orders: unknown[] }).g3Orders).toEqual([])
  })

  it('mutating G3 without activate → production_domain_inactive; activate does not wipe warehouse', async () => {
    const g2 = await import('../api/fst/_g2WarehouseService.mjs')
    const g3 = await import('../api/fst/_g3ProductionService.mjs')
    grant('u1', STORE, ALL_CAPS)
    await g2.executeG2Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'wh-seed',
      commandType: 'warehouse.document.post',
      command: {
        type: 'receipt',
        warehouseId: 'raw',
        date: '2026-09-04',
        lines: [{ itemId: 'mat-1', quantity: 3 }],
      },
    })
    const denied = await g3.executeG3Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'no-act',
      commandType: 'production.recipe.draft.save',
      command: { recipeId: 'r', versionId: 'v', components: [{ warehouseItemId: 'mat-1', unitSnapshot: 'kg', normQty: 1 }] },
    })
    expect(denied.ok).toBe(false)
    expect(denied.error).toBe('production_domain_inactive')
    const docsBefore = payload().domains.warehouse.documents.length
    const movBefore = payload().domains.warehouse.movements.length
    await activateProduction(g3)
    expect(payload().domains.warehouse.documents.length).toBe(docsBefore)
    expect(payload().domains.warehouse.movements.length).toBe(movBefore)
    expect(payload().domainMeta.warehouse.active).toBe(true)
  })
})

describe('G3.1 cross-domain preservation', () => {
  it('G2 warehouse commands preserve production deep-equal; unknown fields survive', async () => {
    const g2 = await import('../api/fst/_g2WarehouseService.mjs')
    const g3 = await import('../api/fst/_g3ProductionService.mjs')
    await seedWhAndRecipe(g3)
    const marker = { secretFuture: [1, 2, 3], nested: { a: true } }
    const p = payload()
    p.domains.production.futureProductionField = marker
    p.domains.warehouse.futureWhField = 'wh-keep'
    p.topLevelFuture = 'top-keep'
    dcState.critical!.payloadJson = JSON.stringify(p)
    const prodBefore = structuredClone(payload().domains.production)

    await g2.executeG2Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'g2-period',
      commandType: 'warehouse.period.close',
      command: { month: '2026-08' },
    })
    expect(payload().domains.production).toEqual(prodBefore)
    expect(payload().domains.production.futureProductionField).toEqual(marker)
    expect(payload().domains.warehouse.futureWhField).toBe('wh-keep')
    expect(payload().topLevelFuture).toBe('top-keep')

    await g2.executeG2Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'g2-reopen',
      commandType: 'warehouse.period.reopen',
      command: { month: '2026-08', reason: 'fix' },
    })
    expect(payload().domains.production).toEqual(prodBefore)

    const whBefore = payload().domains.warehouse
    const docsBefore = whBefore.documents
    const movBefore = whBefore.movements
    await g3.executeG3Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'recipe-only',
      commandType: 'production.recipe.draft.save',
      command: {
        recipeId: 'rec-2',
        versionId: 'rv-2',
        components: [{ warehouseItemId: 'mat-1', unitSnapshot: 'kg', normQty: 1, tolerancePct: 0 }],
      },
    })
    expect(payload().domains.warehouse.documents).toEqual(docsBefore)
    expect(payload().domains.warehouse.movements).toEqual(movBefore)
  })

  it('parse v1/v2 without production key does not activate production; serialize round-trip keeps extras', async () => {
    const h = await import('../api/fst/_g1CriticalHelpers.mjs')
    const v1 = {
      schemaVersion: 1,
      domains: { warehouse: { ...h.emptyWarehouseStore(), customWh: 42 } },
      orphan: true,
    }
    const parsed = h.parseCriticalPayload(JSON.stringify(v1), { revision: 2 })
    expect(parsed.ok).toBe(true)
    expect(h.isProductionDomainActive(parsed.payload, 2)).toBe(false)
    expect(parsed.payload.domains.warehouse.customWh).toBe(42)
    expect(parsed.payload.orphan).toBe(true)
    const again = h.parseCriticalPayload(h.serializeCriticalPayload(parsed.payload), { revision: 2 })
    expect(again.payload.domains.warehouse.customWh).toBe(42)
    expect(again.payload.orphan).toBe(true)
  })
})

describe('G3.1 CAS + embedded receipt fail-safe', () => {
  it('CAS success + external receipt failure → retry same key does not double-write', async () => {
    const g3 = await import('../api/fst/_g3ProductionService.mjs')
    await seedWhAndRecipe(g3)
    const receiptsBefore = dcState.receipts.size
    calls.insertReceipt.mockImplementation(async () => {
      throw new Error('receipt_down')
    })
    const first = await g3.executeG3Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'idem-1',
      commandType: 'production.order.draft.save',
      command: {
        orderId: 'o1',
        finishedProductId: 'fp',
        formulationRecipeId: 'rec-1',
        lineId: 'line-a',
        totalQtyMp: 2,
        startDate: '2026-09-04',
        endDate: '2026-09-05',
      },
    })
    expect(first.ok).toBe(true)
    expect(dcState.receipts.size).toBe(receiptsBefore)
    expect(payload().commandReceipts['idem-1']).toBeTruthy()
    const ordersAfterFirst = payload().domains.production.orders.length

    calls.insertReceipt.mockImplementation(async (_dc: unknown, row: Record<string, unknown>) => {
      dcState.receipts.set(String(row.id), row)
    })
    const retry = await g3.executeG3Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'idem-1',
      commandType: 'production.order.draft.save',
      command: {
        orderId: 'o1',
        finishedProductId: 'fp',
        formulationRecipeId: 'rec-1',
        lineId: 'line-a',
        totalQtyMp: 99,
        startDate: '2026-09-04',
        endDate: '2026-09-05',
      },
    })
    expect(retry.ok).toBe(true)
    expect(retry.idempotent).toBe(true)
    expect(retry.recoveredFromEmbeddedReceipt).toBe(true)
    expect(payload().domains.production.orders.length).toBe(ordersAfterFirst)
    expect(payload().domains.production.orders[0].totalQtyMp).toBe(2)
  })
})

describe('G3.1 command coverage + ACL', () => {
  it('covers recipe/order/reserve/material/shift success and denial paths', async () => {
    const g3 = await import('../api/fst/_g3ProductionService.mjs')
    await seedWhAndRecipe(g3)

    // recipe draft delete denied on approved
    const delApproved = await g3.executeG3Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'del-appr',
      commandType: 'production.recipe.draft.delete',
      command: { versionId: 'rv-1' },
    })
    expect(delApproved.ok).toBe(false)

    await g3.executeG3Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'rv2',
      commandType: 'production.recipe.draft.save',
      command: {
        recipeId: 'rec-1',
        versionId: 'rv-draft',
        components: [{ warehouseItemId: 'mat-1', unitSnapshot: 'kg', normQty: 1 }],
      },
    })
    const delDraft = await g3.executeG3Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'del-draft',
      commandType: 'production.recipe.draft.delete',
      command: { versionId: 'rv-draft' },
    })
    expect(delDraft.ok).toBe(true)

    await g3.executeG3Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'od',
      commandType: 'production.order.draft.save',
      command: {
        orderId: 'ord-1',
        finishedProductId: 'fp',
        formulationRecipeId: 'rec-1',
        lineId: 'line-a',
        totalQtyMp: 12,
        startDate: '2026-09-04',
        endDate: '2026-09-05',
      },
    })
    const conf = await g3.executeG3Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'oc',
      commandType: 'production.order.confirm',
      command: { orderId: 'ord-1', rawWarehouseId: 'raw' },
    })
    expect(conf.ok).toBe(true)
    expect(conf.production.orders[0].recipeNormSnapshot).toBeTruthy()
    expect(payload().domains.warehouse.materialShortages?.length).toBeGreaterThan(0)

    const conf2 = await g3.executeG3Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'oc2',
      commandType: 'production.order.confirm',
      command: { orderId: 'ord-1', rawWarehouseId: 'raw' },
    })
    expect(conf2.idempotent || conf2.ok).toBe(true)

    const up = await g3.executeG3Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'chg-up',
      commandType: 'production.order.change',
      command: { orderId: 'ord-1', rawWarehouseId: 'raw', totalQtyMp: 14 },
    })
    expect(up.ok).toBe(true)
    const down = await g3.executeG3Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'chg-dn',
      commandType: 'production.order.change',
      command: { orderId: 'ord-1', rawWarehouseId: 'raw', totalQtyMp: 8 },
    })
    expect(down.ok).toBe(true)

    // second order for reallocate
    await g3.executeG3Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'od2',
      commandType: 'production.order.draft.save',
      command: {
        orderId: 'ord-2',
        finishedProductId: 'fp',
        formulationRecipeId: 'rec-1',
        lineId: 'line-a',
        totalQtyMp: 2,
        startDate: '2026-09-04',
        endDate: '2026-09-05',
        priority: 'urgent',
      },
    })
    await g3.executeG3Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'oc-b',
      commandType: 'production.order.confirm',
      command: { orderId: 'ord-2', rawWarehouseId: 'raw' },
    })
    const realloc = await g3.executeG3Command({
      actor,
      storeId: STORE,
      idempotencyKey: 're',
      commandType: 'production.reservation.reallocate',
      command: {
        reason: 'priority',
        sourceOrderId: 'ord-1',
        targetOrderId: 'ord-2',
        itemId: 'mat-1',
        warehouseId: 'raw',
        quantity: 1,
      },
    })
    expect(realloc.ok).toBe(true)

    const issue = await g3.executeG3Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'iss',
      commandType: 'production.material.issueToLine',
      command: {
        orderId: 'ord-1',
        lineId: 'line-a',
        rawWarehouseId: 'raw',
        lines: [{ itemId: 'mat-1', quantity: 2 }],
      },
    })
    expect(issue.ok).toBe(true)

    const over = await g3.executeG3Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'iss-over',
      commandType: 'production.material.issueToLine',
      command: {
        orderId: 'ord-1',
        lineId: 'line-a',
        rawWarehouseId: 'raw',
        lines: [{ itemId: 'mat-1', quantity: 50 }],
      },
    })
    expect(over.ok).toBe(false)

    const ret = await g3.executeG3Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'ret',
      commandType: 'production.material.returnFromLine',
      command: {
        orderId: 'ord-1',
        lineId: 'line-a',
        rawWarehouseId: 'raw',
        reason: 'unused',
        lines: [{ itemId: 'mat-1', quantity: 0.5, batchNo: 'B1', expiryDate: '2026-12-01' }],
      },
    })
    expect(ret.ok).toBe(true)

    const sd = await g3.executeG3Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'sd',
      commandType: 'production.shift.draft.save',
      command: { draftId: 'dr1', orderId: 'ord-1', lineId: 'line-a', outputMp: 1 },
    })
    expect(sd.ok).toBe(true)
    const sdd = await g3.executeG3Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'sdd',
      commandType: 'production.shift.draft.delete',
      command: { draftId: 'dr1' },
    })
    expect(sdd.ok).toBe(true)

    const shift = await g3.executeG3Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'sh',
      commandType: 'production.shift.confirm',
      command: {
        orderId: 'ord-1',
        lineId: 'line-a',
        shiftDate: '2026-09-04',
        outputMp: 1,
        actualInputs: [{ itemId: 'mat-1', quantity: 1 }],
        wasteLines: [],
        semiFinishedItemId: 'wip',
        packLocationId: 'prod-loc',
      },
    })
    expect(shift.ok).toBe(true)
    expect(shift.isFinishedGoods).toBe(false)

    const corrDraft = await g3.executeG3Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'cd',
      commandType: 'production.shift.createCorrection',
      command: {
        originalReportId: shift.reportId,
        correctionReason: 'fix',
        orderId: 'ord-1',
        lineId: 'line-a',
      },
    })
    expect(corrDraft.ok).toBe(true)

    const corr = await g3.executeG3Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'cc',
      commandType: 'production.shift.confirmCorrection',
      command: {
        originalReportId: shift.reportId,
        correctionReason: 'fix',
        orderId: 'ord-1',
        lineId: 'line-a',
        outputMp: 1.1,
        actualInputs: [{ itemId: 'mat-1', quantity: 1.1 }],
        wasteLines: [],
        semiFinishedItemId: 'wip',
        packLocationId: 'prod-loc',
      },
    })
    expect(corr.ok).toBe(true)
    expect((corr.reverseDocumentIds ?? []).length).toBeGreaterThan(0)

    // cancel releases remaining only
    const cancel = await g3.executeG3Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'can',
      commandType: 'production.order.cancel',
      command: { orderId: 'ord-2', reason: 'abort', rawWarehouseId: 'raw' },
    })
    expect(cancel.ok).toBe(true)

    // ACL negatives
    grant('u1', STORE, { 'production.shift.confirm': true, productionLineIds: [] })
    const emptyScope = await g3.executeG3Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'empty-scope',
      commandType: 'production.shift.confirm',
      command: { orderId: 'ord-1', lineId: 'line-a', outputMp: 0.1, actualInputs: [] },
    })
    expect(emptyScope.ok).toBe(false)
    expect(emptyScope.error).toBe('forbidden_line_scope')

    grant('u1', STORE, { 'production.material.issue': true, productionLineIds: ['*'] })
    // keeper cannot confirm shift
    const keeperShift = await g3.executeG3Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'keeper-shift',
      commandType: 'production.shift.confirm',
      command: { orderId: 'ord-1', lineId: 'line-a', outputMp: 0.1, actualInputs: [] },
    })
    expect(keeperShift.ok).toBe(false)
    expect(keeperShift.status).toBe(403)

    grant('u1', STORE, { 'production.shift.confirm': true, productionLineIds: ['*'] })
    const masterIssue = await g3.executeG3Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'master-iss',
      commandType: 'production.material.issueToLine',
      command: {
        orderId: 'ord-1',
        lineId: 'line-a',
        rawWarehouseId: 'raw',
        lines: [{ itemId: 'mat-1', quantity: 0.1 }],
      },
    })
    expect(masterIssue.ok).toBe(false)
    expect(masterIssue.status).toBe(403)

    grant('u1', STORE, {})
    const foreign = await g3.executeG3Command({
      actor,
      storeId: 'other-store',
      idempotencyKey: 'foreign',
      commandType: 'production.read',
      command: {},
    })
    expect(foreign.ok).toBe(false)
    expect(foreign.status).toBe(403)

    // forged payloadJson capabilities ignored
    grant('u1', STORE, { 'production.read': true })
    const forged = await g3.executeG3Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'forged',
      commandType: 'production.recipe.version.approve',
      command: { versionId: 'rv-1', roleId: 'director', capabilities: { 'production.recipe.approve': true } },
    })
    expect(forged.ok).toBe(false)
  })

  it('deterministic concurrent CAS race: only one final-stock issue succeeds', async () => {
    const g3 = await import('../api/fst/_g3ProductionService.mjs')
    await seedWhAndRecipe(g3)
    await g3.executeG3Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'race-d',
      commandType: 'production.order.draft.save',
      command: {
        orderId: 'race-o',
        finishedProductId: 'fp',
        formulationRecipeId: 'rec-1',
        lineId: 'line-a',
        totalQtyMp: 10,
        startDate: '2026-09-04',
        endDate: '2026-09-05',
      },
    })
    await g3.executeG3Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'race-c',
      commandType: 'production.order.confirm',
      command: { orderId: 'race-o', rawWarehouseId: 'raw' },
    })

    let gate = 0
    const real = calls.updateCas.getMockImplementation()!
    calls.updateCas.mockImplementation(async (...args: unknown[]) => {
      const n = ++gate
      if (n === 1) await new Promise((r) => setTimeout(r, 40))
      return real(...args)
    })

    const [a, b] = await Promise.all([
      g3.executeG3Command({
        actor,
        storeId: STORE,
        idempotencyKey: 'race-a',
        commandType: 'production.material.issueToLine',
        command: {
          orderId: 'race-o',
          lineId: 'line-a',
          rawWarehouseId: 'raw',
          lines: [{ itemId: 'mat-1', quantity: 10 }],
        },
      }),
      g3.executeG3Command({
        actor,
        storeId: STORE,
        idempotencyKey: 'race-b',
        commandType: 'production.material.issueToLine',
        command: {
          orderId: 'race-o',
          lineId: 'line-a',
          rawWarehouseId: 'raw',
          lines: [{ itemId: 'mat-1', quantity: 10 }],
        },
      }),
    ])
    const oks = [a, b].filter((x) => x.ok)
    expect(oks.length).toBe(1)
    expect([a, b].some((x) => !x.ok && (x.status === 409 || x.error === 'insufficient_stock'))).toBe(true)
  })
})

describe('G3.1 overlay client helpers', () => {
  it('client resolveAuthoritativeProductionOverlay ignores revision without productionActive', async () => {
    const { resolveAuthoritativeProductionOverlay, isG3ProductionDomainActive } = await import(
      '../src/lib/production/g3ServerClient'
    )
    const o = resolveAuthoritativeProductionOverlay({
      legacyProduction: { x: 1 },
      criticalProduction: { orders: [{ id: 'c' }] },
      criticalRevision: 99,
      productionActive: false,
    })
    expect(o.productionActive).toBe(false)
    expect(isG3ProductionDomainActive(o.production)).toBe(false)
  })
})
