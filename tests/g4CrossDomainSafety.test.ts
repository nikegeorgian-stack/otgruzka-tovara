/**
 * PHASE G4 — cross-domain safety.
 *
 * G2 (warehouse), G3 (production core) and G4 (packaging/QC/shipment) share one
 * FstCriticalStore envelope and one CAS. None of them may drop a sibling domain,
 * an unknown future field, or another domain's activation flag.
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

type QcAttachment = {
  id: string
  storeId: string
  lotId: string
  documentKind: string
  storagePath: string
  contentType: string
  sizeBytes: number
  checksum: string
  objectGeneration: string
}

const qcState = {
  attachments: [] as QcAttachment[],
  decisions: [] as Record<string, unknown>[],
  lots: new Map<string, Record<string, unknown>>(),
}

const storageState = {
  objects: new Map<string, { generation: string }>(),
}

vi.mock('../server/fst/_qcDataConnect.mjs', () => ({
  getQcDataConnect: vi.fn(() => ({ qcMocked: true })),
  listVerifiedLotAttachments: async (_dc: unknown, vars: { storeId: string; lotId: string }) => ({
    data: {
      qcAttachmentRecords: qcState.attachments.filter(
        (row) => row.storeId === vars.storeId && row.lotId === vars.lotId,
      ),
    },
  }),
  insertQcLotDecision: async (_dc: unknown, row: Record<string, unknown>) => {
    qcState.decisions.push(row)
    return { data: {} }
  },
  upsertQcFinishedGoodsLot: async (_dc: unknown, row: Record<string, unknown>) => {
    qcState.lots.set(String(row.id), row)
    return { data: {} }
  },
}))

vi.mock('../server/fst/_qcStorage.mjs', () => {
  const seg = (value: unknown, fallback: string) =>
    String(value ?? '')
      .replace(/[^a-zA-Z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '') || fallback
  return {
    buildQcStoragePath: (storeId: string, lotId: string, attachmentId: string) =>
      `fstFiles/${seg(storeId, 'store')}/qc-lots/${seg(lotId, 'lot')}/${seg(
        attachmentId,
        'attachment',
      )}/blob`,
    verifyStorageObject: async ({ storagePath }: { storagePath: string }) => {
      const object = storageState.objects.get(storagePath)
      if (!object) return { ok: false, error: 'not_found' }
      return { ok: true, generation: object.generation }
    },
  }
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STORE = 'fibercell-main'
const actor = { uid: 'u1', email: 'u1@x', claims: {} }

const PACK_WH = 'pack-wh'
const PACK_LOC = 'pack-loc'
const FG_LOC = 'fg-loc'
const SCRAP_LOC = 'scrap-loc'
const ORDER_ID = 'ord-1'
const WIP_ITEM = 'wip-item'
const MATERIAL_ITEM = 'film-1'
const FG_ITEM = 'fg-item'
const FINISHED_PRODUCT = 'fp-1'
const REPORT_DATE = '2026-09-04'

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
  'packaging.read': true,
  'packaging.report.edit': true,
  'packaging.report.confirm': true,
  'packaging.report.correct': true,
  'qc.attachment.upload': true,
  'qc.review': true,
  'qc.release': true,
  'qc.regrade': true,
  'qc.reject': true,
  'qc.scrap.writeoff': true,
  'shipment.draft.edit': true,
  'shipment.post': true,
  'shipment.cancel': true,
  'warehouse.read': true,
  'warehouse.document.post': true,
  'warehouse.document.cancel': true,
  'warehouse.transfer.post': true,
  'warehouse.period.close': true,
  'warehouse.period.reopen': true,
  productionLineIds: ['*'],
}

beforeEach(() => {
  for (const fn of Object.values(calls)) fn.mockReset()
  dcState.principals.clear()
  dcState.critical = null
  dcState.receipts.clear()
  qcState.attachments.length = 0
  qcState.decisions.length = 0
  qcState.lots.clear()
  storageState.objects.clear()

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
    roleId: 'packaging',
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

function qcStoragePath(storeId: string, lotId: string, attachmentId: string) {
  const seg = (value: string, fallback: string) =>
    String(value ?? '')
      .replace(/[^a-zA-Z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '') || fallback
  return `fstFiles/${seg(storeId, 'store')}/qc-lots/${seg(lotId, 'lot')}/${seg(
    attachmentId,
    'attachment',
  )}/blob`
}

function attachVerified(lotId: string, documentKind: 'passport' | 'protocol') {
  const id = `att-${documentKind}-${String(qcState.attachments.length + 1)}`
  const storagePath = qcStoragePath(STORE, lotId, id)
  storageState.objects.set(storagePath, { generation: '7' })
  qcState.attachments.push({
    id,
    storeId: STORE,
    lotId,
    documentKind,
    storagePath,
    contentType: 'application/pdf',
    sizeBytes: 1024,
    checksum: `sum-${documentKind}`,
    objectGeneration: '7',
  })
  return id
}

/**
 * Bootstrap the full stack: production domain active, G3 recipe + order,
 * seeded ledger, packaging/QC feature active, one confirmed + released lot.
 */
async function bootstrapFullStack() {
  grant(ALL_CAPS)
  const g2 = await import('../server/fst/_g2WarehouseService.mjs')
  const g3 = await import('../server/fst/_g3ProductionService.mjs')

  const activated = await g3.executeG3Command({
    actor,
    storeId: STORE,
    idempotencyKey: 'x-act-prod',
    commandType: 'production.domain.activate',
    command: { reason: 'cross-domain bootstrap' },
  })
  expect(activated.ok).toBe(true)

  const recipe = await g3.executeG3Command({
    actor,
    storeId: STORE,
    idempotencyKey: 'x-recipe',
    commandType: 'production.recipe.draft.save',
    command: {
      recipeId: 'rec-1',
      versionId: 'rv-1',
      components: [{ warehouseItemId: MATERIAL_ITEM, unitSnapshot: 'kg', normQty: 1, tolerancePct: 5 }],
    },
  })
  expect(recipe.ok).toBe(true)

  const p = payload()
  p.domains.warehouse.locations = [{ id: PACK_WH }, { id: PACK_LOC }, { id: FG_LOC }, { id: SCRAP_LOC }]
  p.domains.warehouse.scrapLocationId = SCRAP_LOC
  p.domains.warehouse.productionLineBindings = [
    {
      id: 'pack',
      lineId: 'pack',
      packagingWarehouseId: PACK_WH,
      packagingLocationId: PACK_LOC,
      finishedGoodsWarehouseId: PACK_WH,
      finishedGoodsLocationId: FG_LOC,
    },
  ]
  p.domains.warehouse.movements = [
    {
      id: 'seed-wip',
      warehouseId: PACK_WH,
      locationId: PACK_LOC,
      itemId: WIP_ITEM,
      quantity: 200,
      type: 'receipt',
      at: '2026-09-03T00:00:00.000Z',
      date: '2026-09-03',
      productionOrderId: ORDER_ID,
      isWip: true,
    },
    {
      id: 'seed-material',
      warehouseId: PACK_WH,
      locationId: PACK_LOC,
      itemId: MATERIAL_ITEM,
      quantity: 40,
      type: 'receipt',
      at: '2026-09-03T00:00:00.000Z',
      date: '2026-09-03',
      batchNo: 'M-1',
      expiryDate: '2027-12-31',
    },
  ]
  p.domains.production.orders = [
    {
      id: ORDER_ID,
      status: 'active',
      finishedProductId: FINISHED_PRODUCT,
      lineId: 'line-a',
      totalQtyMp: 500,
    },
  ]
  p.domains.production.shiftReports = [
    { id: 'shift-1', orderId: ORDER_ID, lineId: 'line-a', status: 'confirmed', outputMp: 200 },
  ]
  dcState.critical!.payloadJson = JSON.stringify(p)

  const g4 = await import('../server/fst/_g4PackagingService.mjs')
  const packagingActive = await g4.executeG4Command({
    actor,
    storeId: STORE,
    idempotencyKey: 'x-act-packaging',
    commandType: 'packaging.domain.activate',
    command: { reason: 'cross-domain bootstrap' },
  })
  expect(packagingActive.ok).toBe(true)

  const confirmed = await g4.executeG4Command({
    actor,
    storeId: STORE,
    idempotencyKey: 'x-confirm',
    commandType: 'packaging.report.confirm',
    command: {
      productionOrderId: ORDER_ID,
      lineId: 'pack',
      reportDate: REPORT_DATE,
      shiftSlot: 'day',
      finishedProductId: FINISHED_PRODUCT,
      warehouseItemId: FG_ITEM,
      outputM2: 100,
      outputRolls: 4,
      wipLines: [{ semiFinishedItemId: WIP_ITEM, quantity: 50 }],
      materialLines: [{ itemId: MATERIAL_ITEM, quantity: 5 }],
    },
  })
  expect(confirmed.ok).toBe(true)

  attachVerified(confirmed.finishedGoodsLotId, 'passport')
  attachVerified(confirmed.finishedGoodsLotId, 'protocol')
  const released = await g4.executeG4Command({
    actor,
    storeId: STORE,
    idempotencyKey: 'x-release',
    commandType: 'qc.release',
    command: { finishedGoodsLotId: confirmed.finishedGoodsLotId, reason: 'lab ok' },
  })
  expect(released.ok).toBe(true)

  const shipped = await g4.executeG4Command({
    actor,
    storeId: STORE,
    idempotencyKey: 'x-ship',
    commandType: 'shipment.post',
    command: {
      shipmentId: 'shp-1',
      finishedProductId: FINISHED_PRODUCT,
      finishedGoodsLotId: confirmed.finishedGoodsLotId,
      quantity: 25,
      date: REPORT_DATE,
    },
  })
  expect(shipped.ok).toBe(true)

  return { g2, g3, g4, lotId: confirmed.finishedGoodsLotId, decisionId: released.decisionId }
}

function g4Snapshot() {
  const p = payload()
  return {
    packagingReports: p.domains.production.packagingReports,
    finishedGoodsLots: p.domains.production.finishedGoodsLots,
    qcDecisions: p.domains.production.qcDecisions,
    loadingShipments: p.domains.warehouse.loadingShipments,
    packagingQc: p.domainMeta.production.features.packagingQc,
  }
}

// ---------------------------------------------------------------------------

describe('G4 cross-domain preservation', () => {
  it('a G2 warehouse command preserves packaging/QC data and the packagingQc feature flag', async () => {
    const { g2 } = await bootstrapFullStack()
    const before = g4Snapshot()
    expect(before.finishedGoodsLots.length).toBe(1)
    expect(before.qcDecisions.length).toBe(1)
    expect(before.loadingShipments.length).toBe(1)
    expect(before.packagingQc.active).toBe(true)

    const posted = await g2.executeG2Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'g2-receipt',
      commandType: 'warehouse.document.post',
      command: {
        type: 'receipt',
        warehouseId: PACK_WH,
        date: REPORT_DATE,
        lines: [{ itemId: MATERIAL_ITEM, quantity: 5, locationId: PACK_LOC }],
      },
    })
    expect(posted.ok).toBe(true)
    expect(g4Snapshot()).toEqual(before)

    const closed = await g2.executeG2Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'g2-close',
      commandType: 'warehouse.period.close',
      command: { month: '2026-07' },
    })
    expect(closed.ok).toBe(true)
    expect(g4Snapshot()).toEqual(before)

    const reopened = await g2.executeG2Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'g2-reopen',
      commandType: 'warehouse.period.reopen',
      command: { month: '2026-07', reason: 'audit fix' },
    })
    expect(reopened.ok).toBe(true)
    expect(g4Snapshot()).toEqual(before)
    expect(payload().domainMeta.production.active).toBe(true)
  })

  it('a G3 order/shift command preserves the G4 fields', async () => {
    const { g3 } = await bootstrapFullStack()
    const before = g4Snapshot()

    const orderDraft = await g3.executeG3Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'g3-order-draft',
      commandType: 'production.order.draft.save',
      command: {
        orderId: 'ord-2',
        finishedProductId: FINISHED_PRODUCT,
        formulationRecipeId: 'rec-1',
        lineId: 'line-a',
        totalQtyMp: 5,
        startDate: REPORT_DATE,
        endDate: '2026-09-06',
      },
    })
    expect(orderDraft.ok).toBe(true)
    expect(g4Snapshot()).toEqual(before)

    const shiftDraft = await g3.executeG3Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'g3-shift-draft',
      commandType: 'production.shift.draft.save',
      command: { draftId: 'sd-1', orderId: 'ord-2', lineId: 'line-a', outputMp: 1 },
    })
    expect(shiftDraft.ok).toBe(true)
    expect(g4Snapshot()).toEqual(before)

    // The G3 order it just wrote is present alongside the untouched G4 state.
    const orders = payload().domains.production.orders
    expect(orders.some((o: { id: string }) => o.id === 'ord-2')).toBe(true)
    expect(orders.some((o: { id: string }) => o.id === ORDER_ID)).toBe(true)
  })

  it('a G4 command preserves G3 recipes, orders and shift reports', async () => {
    const { g4 } = await bootstrapFullStack()
    const p0 = payload()
    const recipesBefore = p0.domains.production.recipeVersions
    const ordersBefore = p0.domains.production.orders
    const shiftsBefore = p0.domains.production.shiftReports
    expect(recipesBefore.length).toBeGreaterThan(0)
    expect(shiftsBefore.length).toBe(1)

    const draft = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'g4-ship-draft',
      commandType: 'shipment.draft.save',
      command: { shipmentId: 'shp-draft', warehouseId: PACK_WH, date: REPORT_DATE, quantity: 5 },
    })
    expect(draft.ok).toBe(true)

    const reportDraft = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'g4-report-draft',
      commandType: 'packaging.report.draft.save',
      command: {
        reportId: 'pkr-draft',
        productionOrderId: ORDER_ID,
        lineId: 'pack',
        reportDate: REPORT_DATE,
        finishedProductId: FINISHED_PRODUCT,
        warehouseItemId: FG_ITEM,
        outputM2: 10,
        wipLines: [{ semiFinishedItemId: WIP_ITEM, quantity: 5 }],
        materialLines: [],
      },
    })
    expect(reportDraft.ok).toBe(true)

    const p1 = payload()
    expect(p1.domains.production.recipeVersions).toEqual(recipesBefore)
    expect(p1.domains.production.orders).toEqual(ordersBefore)
    expect(p1.domains.production.shiftReports).toEqual(shiftsBefore)
  })

  it('unknown future fields on production / warehouse / domainMeta survive parse + CAS', async () => {
    const { g2, g3, g4 } = await bootstrapFullStack()

    const marker = { secret: [1, 2, 3], nested: { a: true } }
    const p = payload()
    p.domains.production.futureProductionField = marker
    p.domains.warehouse.futureWarehouseField = 'wh-keep'
    p.domainMeta.production.futureProductionMeta = { keep: true }
    p.domainMeta.warehouse.futureWarehouseMeta = 'wh-meta-keep'
    p.domainMeta.production.features.futureFeature = { active: false, note: 'keep' }
    p.topLevelFuture = 'top-keep'
    dcState.critical!.payloadJson = JSON.stringify(p)

    const expectPreserved = () => {
      const after = payload()
      expect(after.domains.production.futureProductionField).toEqual(marker)
      expect(after.domains.warehouse.futureWarehouseField).toBe('wh-keep')
      expect(after.domainMeta.production.futureProductionMeta).toEqual({ keep: true })
      expect(after.domainMeta.warehouse.futureWarehouseMeta).toBe('wh-meta-keep')
      expect(after.domainMeta.production.features.futureFeature.note).toBe('keep')
      expect(after.topLevelFuture).toBe('top-keep')
    }

    const g4Command = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'future-g4',
      commandType: 'shipment.draft.save',
      command: { shipmentId: 'shp-future', warehouseId: PACK_WH, date: REPORT_DATE, quantity: 1 },
    })
    expect(g4Command.ok).toBe(true)
    expectPreserved()

    const g3Command = await g3.executeG3Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'future-g3',
      commandType: 'production.order.draft.save',
      command: {
        orderId: 'ord-future',
        finishedProductId: FINISHED_PRODUCT,
        formulationRecipeId: 'rec-1',
        lineId: 'line-a',
        totalQtyMp: 1,
        startDate: REPORT_DATE,
        endDate: '2026-09-06',
      },
    })
    expect(g3Command.ok).toBe(true)
    expectPreserved()

    const g2Command = await g2.executeG2Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'future-g2',
      commandType: 'warehouse.document.post',
      command: {
        type: 'receipt',
        warehouseId: PACK_WH,
        date: REPORT_DATE,
        lines: [{ itemId: MATERIAL_ITEM, quantity: 1, locationId: PACK_LOC }],
      },
    })
    expect(g2Command.ok).toBe(true)
    expectPreserved()
  })
})

describe('G4 feature flag helpers', () => {
  it('isPackagingQcFeatureActive is false when only production.active is true', async () => {
    const h = await import('../server/fst/_g1CriticalHelpers.mjs')
    const activeProduction = h.markProductionDomainActive(h.emptyCriticalPayload(), 'u1')
    expect(h.isProductionDomainActive(activeProduction, 1)).toBe(true)
    expect(h.isPackagingQcFeatureActive(activeProduction)).toBe(false)

    // A revision bump alone must not imply the feature either.
    const roundTrip = h.parseCriticalPayload(h.serializeCriticalPayload(activeProduction), {
      revision: 42,
    })
    expect(roundTrip.ok).toBe(true)
    expect(h.isPackagingQcFeatureActive(roundTrip.payload)).toBe(false)

    // Legacy G1/G2 payload without domainMeta: neither production nor packaging.
    const legacy = h.parseCriticalPayload(
      JSON.stringify({ schemaVersion: 2, domains: { warehouse: h.emptyWarehouseStore() } }),
      { revision: 9 },
    )
    expect(h.isWarehouseDomainActive(legacy.payload, 9)).toBe(true)
    expect(h.isProductionDomainActive(legacy.payload, 9)).toBe(false)
    expect(h.isPackagingQcFeatureActive(legacy.payload)).toBe(false)
  })

  it('markPackagingQcFeatureActive does not clear production.active or warehouse activation', async () => {
    const h = await import('../server/fst/_g1CriticalHelpers.mjs')
    let p = h.emptyCriticalPayload()
    p = h.markWarehouseDomainActive(p, 'u1')
    p = h.markProductionDomainActive(p, 'u1')
    const productionMetaBefore = { ...p.domainMeta.production }

    const withFeature = h.markPackagingQcFeatureActive(p, 'u2')
    expect(withFeature.domainMeta.production.active).toBe(true)
    expect(withFeature.domainMeta.production.version).toBe(productionMetaBefore.version)
    expect(withFeature.domainMeta.production.activatedBy).toBe(productionMetaBefore.activatedBy)
    expect(withFeature.domainMeta.warehouse.active).toBe(true)
    expect(h.isPackagingQcFeatureActive(withFeature)).toBe(true)
    expect(withFeature.domainMeta.production.features.packagingQc.activatedBy).toBe('u2')

    // Re-activating is stable: no version churn, original activation metadata kept.
    const again = h.markPackagingQcFeatureActive(withFeature, 'u3')
    expect(again.domainMeta.production.features.packagingQc.version).toBe(
      withFeature.domainMeta.production.features.packagingQc.version,
    )
    expect(again.domainMeta.production.features.packagingQc.activatedBy).toBe('u2')
    expect(again.domainMeta.production.active).toBe(true)

    // And re-marking the production domain does not drop the feature.
    const reMarked = h.markProductionDomainActive(again, 'u4')
    expect(h.isPackagingQcFeatureActive(reMarked)).toBe(true)
    expect(reMarked.domainMeta.production.active).toBe(true)
  })
})
