/**
 * PHASE G4.1 — narrow blast radius per command.
 *
 * A QC-only command must not touch the warehouse ledger at all, a shipment must
 * touch only the shipment/ledger/lot structures, activating packagingQc must not
 * activate anything else, and while the feature is off the legacy read path must
 * stay visible instead of being replaced by an empty authoritative domain.
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

vi.mock('../api/fst/_qcDataConnect.mjs', () => ({
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

vi.mock('../api/fst/_qcStorage.mjs', () => {
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
      const row = dcState.principals.get(`${vars.storeId}::${vars.firebaseUid}`)
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
  storageState.objects.set(storagePath, { generation: '9' })
  qcState.attachments.push({
    id,
    storeId: STORE,
    lotId,
    documentKind,
    storagePath,
    contentType: 'application/pdf',
    sizeBytes: 1024,
    checksum: `sum-${documentKind}`,
    objectGeneration: '9',
  })
  return id
}

function seedLedgerFixtures() {
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
  p.domains.warehouse.items = [{ id: FG_ITEM }, { id: WIP_ITEM }, { id: MATERIAL_ITEM }]
  p.domains.production.orders = [
    {
      id: ORDER_ID,
      status: 'active',
      finishedProductId: FINISHED_PRODUCT,
      lineId: 'line-a',
      totalQtyMp: 500,
    },
  ]
  dcState.critical!.payloadJson = JSON.stringify(p)
}

async function activateProduction() {
  const g3 = await import('../api/fst/_g3ProductionService.mjs')
  const activated = await g3.executeG3Command({
    actor,
    storeId: STORE,
    idempotencyKey: 'g41x-act-prod',
    commandType: 'production.domain.activate',
    command: { reason: 'g4.1 cross-domain bootstrap' },
  })
  expect(activated.ok).toBe(true)
  return g3
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type G4 = any

async function bootstrap(): Promise<G4> {
  grant(ALL_CAPS)
  await activateProduction()
  seedLedgerFixtures()
  const g4 = await import('../api/fst/_g4PackagingService.mjs')
  const activated = await g4.executeG4Command({
    actor,
    storeId: STORE,
    idempotencyKey: 'g41x-act-packaging',
    commandType: 'packaging.domain.activate',
    command: { reason: 'g4.1 cross-domain bootstrap' },
  })
  expect(activated.ok).toBe(true)
  return g4
}

async function confirmPackaging(g4: G4, idempotencyKey: string) {
  const confirmed = await g4.executeG4Command({
    actor,
    storeId: STORE,
    idempotencyKey,
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
  return confirmed
}

function warehouseLedgerFingerprint() {
  const p = payload()
  return {
    movements: p.domains.warehouse.movements.length,
    documents: p.domains.warehouse.documents.length,
    movementsJson: JSON.stringify(p.domains.warehouse.movements),
    documentsJson: JSON.stringify(p.domains.warehouse.documents),
    closedMonths: JSON.stringify(p.domains.warehouse.closedMonths),
    items: JSON.stringify(p.domains.warehouse.items),
    loadingShipments: JSON.stringify(p.domains.warehouse.loadingShipments),
  }
}

// ---------------------------------------------------------------------------

describe('G4.1 QC-only commands leave the ledger alone', () => {
  it('qc.review.start changes no warehouse movement or document', async () => {
    const g4 = await bootstrap()
    const confirmed = await confirmPackaging(g4, 'g41x-pk-1')
    const before = warehouseLedgerFingerprint()
    const ordersBefore = JSON.stringify(payload().domains.production.orders)

    const review = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'g41x-review',
      commandType: 'qc.review.start',
      command: { finishedGoodsLotId: confirmed.finishedGoodsLotId, reason: 'sampling' },
    })
    expect(review.ok).toBe(true)
    expect(review.qcStatus).toBe('in_review')
    expect(review.touchesWarehouse).toBe(false)
    expect(warehouseLedgerFingerprint()).toEqual(before)

    const p = payload()
    expect(p.domains.production.finishedGoodsLots[0].qcStatus).toBe('in_review')
    expect(JSON.stringify(p.domains.production.orders)).toBe(ordersBefore)
  })

  it('qc.release changes no warehouse movement or document either', async () => {
    const g4 = await bootstrap()
    const confirmed = await confirmPackaging(g4, 'g41x-pk-1')
    const before = warehouseLedgerFingerprint()

    attachVerified(confirmed.finishedGoodsLotId, 'passport')
    attachVerified(confirmed.finishedGoodsLotId, 'protocol')
    const released = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'g41x-release',
      commandType: 'qc.release',
      command: { finishedGoodsLotId: confirmed.finishedGoodsLotId, reason: 'lab ok' },
    })
    expect(released.ok).toBe(true)
    expect(released.touchesWarehouse).toBe(false)
    expect(warehouseLedgerFingerprint()).toEqual(before)
    expect(payload().domains.production.qcDecisions.length).toBe(1)
  })
})

describe('G4.1 a shipment touches only the shipment structures', () => {
  it('shipment.post adds one issue document + movement, one shipment, and updates one lot', async () => {
    const g4 = await bootstrap()
    const confirmed = await confirmPackaging(g4, 'g41x-pk-1')
    attachVerified(confirmed.finishedGoodsLotId, 'passport')
    attachVerified(confirmed.finishedGoodsLotId, 'protocol')
    const released = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'g41x-release',
      commandType: 'qc.release',
      command: { finishedGoodsLotId: confirmed.finishedGoodsLotId, reason: 'lab ok' },
    })
    expect(released.ok).toBe(true)

    const before = payload()
    const movementsBefore = before.domains.warehouse.movements.length
    const documentsBefore = before.domains.warehouse.documents.length
    const reportsBefore = JSON.stringify(before.domains.production.packagingReports)
    const decisionsBefore = JSON.stringify(before.domains.production.qcDecisions)
    const ordersBefore = JSON.stringify(before.domains.production.orders)
    const itemsBefore = JSON.stringify(before.domains.warehouse.items)

    const shipped = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'g41x-ship',
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
    expect(shipped.touchesWarehouse).toBe(true)

    const after = payload()
    expect(after.domains.warehouse.movements.length).toBe(movementsBefore + 1)
    expect(after.domains.warehouse.documents.length).toBe(documentsBefore + 1)
    expect(after.domains.warehouse.loadingShipments.length).toBe(1)
    expect(after.domains.warehouse.loadingShipments[0].id).toBe('shp-1')

    // Packaging reports, QC decisions, orders and masterdata are untouched.
    expect(JSON.stringify(after.domains.production.packagingReports)).toBe(reportsBefore)
    expect(JSON.stringify(after.domains.production.qcDecisions)).toBe(decisionsBefore)
    expect(JSON.stringify(after.domains.production.orders)).toBe(ordersBefore)
    expect(JSON.stringify(after.domains.warehouse.items)).toBe(itemsBefore)

    // Exactly one lot moved, and only its shipped counters.
    expect(after.domains.production.finishedGoodsLots.length).toBe(1)
    const lot = after.domains.production.finishedGoodsLots[0]
    expect(lot.quantityShipped).toBe(25)
    expect(lot.quantityRemaining).toBe(75)
    expect(lot.qcStatus).toBe('released')
    expect(lot.currentDecisionId).toBe(released.decisionId)
    expect(lot.lotRevision).toBe(released.lotRevision)

    const newDoc = after.domains.warehouse.documents[documentsBefore]
    expect(newDoc.type).toBe('issue')
    expect(newDoc.docRole).toBe('finished_goods_shipment')
    expect(newDoc.shipmentId).toBe('shp-1')
    expect(newDoc.qcDecisionId).toBe(released.decisionId)
  })
})

describe('G4.1 activation is scoped', () => {
  it('production active + packagingQc inactive keeps the legacy read path', async () => {
    grant(ALL_CAPS)
    await activateProduction()
    seedLedgerFixtures()
    const helpers = await import('../api/fst/_g1CriticalHelpers.mjs')
    const parsed = helpers.parseCriticalPayload(dcState.critical!.payloadJson, {
      revision: Number(dcState.critical!.revision) || 0,
    })
    expect(parsed.ok).toBe(true)
    expect(helpers.isProductionDomainActive(parsed.payload, Number(dcState.critical!.revision))).toBe(
      true,
    )
    expect(helpers.isPackagingQcFeatureActive(parsed.payload)).toBe(false)

    const g4 = await import('../api/fst/_g4PackagingService.mjs')
    const read = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'g41x-read-inactive',
      commandType: 'packaging.read',
      command: {},
    })
    expect(read.ok).toBe(true)
    expect(read.productionActive).toBe(true)
    expect(read.packagingQcActive).toBe(false)
    expect(read.source).toBe('legacy_or_inactive')

    const authoritative = await g4.getAuthoritativePackagingDomains(STORE)
    expect(authoritative.ok).toBe(true)
    expect(authoritative.packagingQcActive).toBe(false)
    expect(authoritative.source).toBe('legacy_or_inactive')

    // Mutations stay closed so the legacy UI remains the only writer.
    const confirm = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'g41x-confirm-inactive',
      commandType: 'packaging.report.confirm',
      command: {
        productionOrderId: ORDER_ID,
        lineId: 'pack',
        reportDate: REPORT_DATE,
        finishedProductId: FINISHED_PRODUCT,
        warehouseItemId: FG_ITEM,
        outputM2: 100,
        wipLines: [{ semiFinishedItemId: WIP_ITEM, quantity: 50 }],
        materialLines: [],
      },
    })
    expect(confirm.ok).toBe(false)
    expect(confirm.error).toBe('packaging_qc_inactive')
    expect(confirm.status).toBe(409)
  })

  it('activating packagingQc does not flip any other feature or domain flag', async () => {
    grant(ALL_CAPS)
    await activateProduction()
    seedLedgerFixtures()

    // A pre-existing unknown feature entry must survive untouched and inactive.
    const seeded = payload()
    seeded.domainMeta.production.features = {
      ...(seeded.domainMeta.production.features ?? {}),
      futureFeature: { active: false, version: 0, note: 'keep' },
    }
    seeded.domainMeta.warehouse.futureWarehouseMeta = 'wh-meta-keep'
    dcState.critical!.payloadJson = JSON.stringify(seeded)

    const warehouseMetaBefore = payload().domainMeta.warehouse
    const productionVersionBefore = payload().domainMeta.production.version
    const ledgerBefore = warehouseLedgerFingerprint()

    const g4 = await import('../api/fst/_g4PackagingService.mjs')
    const activated = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'g41x-act-packaging',
      commandType: 'packaging.domain.activate',
      command: { reason: 'scoped activation' },
    })
    expect(activated.ok).toBe(true)
    expect(activated.packagingQcActive).toBe(true)

    const meta = payload().domainMeta
    expect(meta.production.features.packagingQc.active).toBe(true)
    expect(meta.production.features.futureFeature.active).toBe(false)
    expect(meta.production.features.futureFeature.note).toBe('keep')
    expect(meta.production.active).toBe(true)
    expect(meta.production.version).toBe(productionVersionBefore)
    expect(meta.warehouse).toEqual(warehouseMetaBefore)

    // Only exactly one feature key was switched on.
    const activeFeatures = Object.entries(meta.production.features)
      .filter(([, value]) => (value as { active?: boolean })?.active === true)
      .map(([key]) => key)
    expect(activeFeatures).toEqual(['packagingQc'])

    // Activation is a flag flip, not a ledger event.
    expect(warehouseLedgerFingerprint()).toEqual(ledgerBefore)

    // Re-activating is idempotent and still does not widen the flag set.
    const again = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'g41x-act-packaging-2',
      commandType: 'packaging.domain.activate',
      command: { reason: 'scoped activation again' },
    })
    expect(again.ok).toBe(true)
    expect(again.idempotent).toBe(true)
    const metaAgain = payload().domainMeta
    expect(metaAgain.production.features.futureFeature.active).toBe(false)
    expect(
      Object.entries(metaAgain.production.features).filter(
        ([, value]) => (value as { active?: boolean })?.active === true,
      ).length,
    ).toBe(1)
  })
})
