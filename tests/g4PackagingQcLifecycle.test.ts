/**
 * PHASE G4 — packaging / finished-goods lot / QC / shipment lifecycle.
 *
 * Everything outside `api/fst/_g4PackagingService.mjs` is mocked in memory:
 * Data Connect (critical store + principals + receipts + CAS revision), the QC
 * read-model connector and QC Storage verification.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

// ---------------------------------------------------------------------------
// In-memory QC read model + Storage
// ---------------------------------------------------------------------------

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
const sysadminActor = { uid: 'u1', email: 'admin@fibercell.net', claims: {} }

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

const G3_CAPS_ALL = {
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
}

const G4_CAPS_ALL = {
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
}

const ALL_CAPS = {
  ...G3_CAPS_ALL,
  ...G4_CAPS_ALL,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function grant(caps: Record<string, unknown>, uid = 'u1', active = true) {
  const id = `${STORE}::${uid}`
  dcState.principals.set(id, {
    id,
    firebaseUid: uid,
    storeId: STORE,
    roleId: 'packaging',
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

type MovementFilter = {
  warehouseId: string
  locationId?: string
  itemId: string
  batchNo?: string
  productionOrderId?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function balanceOf(movements: any[], filter: MovementFilter) {
  let qty = 0
  for (const m of movements ?? []) {
    if (m.cancelled) continue
    if (m.warehouseId !== filter.warehouseId) continue
    if (m.itemId !== filter.itemId) continue
    if (filter.locationId != null && (m.locationId ?? '') !== filter.locationId) continue
    if (filter.batchNo != null && String(m.batchNo ?? '') !== filter.batchNo) continue
    if (
      filter.productionOrderId != null &&
      String(m.productionOrderId ?? '') !== filter.productionOrderId
    ) {
      continue
    }
    const q = Math.abs(Number(m.quantity) || 0)
    if (m.type === 'receipt' || m.type === 'in') qty += q
    else if (m.type === 'issue' || m.type === 'out') qty -= q
  }
  return Math.round(qty * 1e6) / 1e6
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

/** Simulates a browser upload that already passed `qc-upload-finalize` verification. */
function attachVerified(lotId: string, documentKind: 'passport' | 'protocol') {
  const id = `att-${documentKind}-${String(qcState.attachments.length + 1)}`
  const storagePath = qcStoragePath(STORE, lotId, id)
  storageState.objects.set(storagePath, { generation: '11' })
  qcState.attachments.push({
    id,
    storeId: STORE,
    lotId,
    documentKind,
    storagePath,
    contentType: 'application/pdf',
    sizeBytes: 2048,
    checksum: `sum-${documentKind}`,
    objectGeneration: '11',
  })
  return id
}

function seedCriticalFixtures({ wipQty = 200, materialQty = 40 } = {}) {
  const p = payload()
  p.domains.warehouse.locations = [
    { id: PACK_WH },
    { id: PACK_LOC },
    { id: FG_LOC },
    { id: SCRAP_LOC },
  ]
  p.domains.warehouse.scrapLocationId = SCRAP_LOC
  p.domains.warehouse.productionLineBindings = [
    {
      id: 'pack',
      lineId: 'pack',
      productionWarehouseId: PACK_WH,
      productionLocationId: PACK_LOC,
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
      quantity: wipQty,
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
      quantity: materialQty,
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
  const r = await g3.executeG3Command({
    actor,
    storeId: STORE,
    idempotencyKey: `g3-act-${Math.random()}`,
    commandType: 'production.domain.activate',
    command: { reason: 'g4 test bootstrap' },
  })
  expect(r.ok).toBe(true)
  return g3
}

/**
 * Full G4 bootstrap: caps → production domain active → seeded warehouse/order
 * fixtures → packaging/QC feature active.
 */
async function bootstrap(options: { wipQty?: number; materialQty?: number; caps?: Record<string, unknown> } = {}) {
  grant(options.caps ?? ALL_CAPS)
  await activateProduction()
  seedCriticalFixtures({ wipQty: options.wipQty, materialQty: options.materialQty })
  const g4 = await import('../api/fst/_g4PackagingService.mjs')
  const activated = await g4.executeG4Command({
    actor,
    storeId: STORE,
    idempotencyKey: 'g4-activate',
    commandType: 'packaging.domain.activate',
    command: { reason: 'g4 test bootstrap' },
  })
  expect(activated.ok).toBe(true)
  expect(payload().domainMeta.production.features.packagingQc.active).toBe(true)
  return g4
}

type ConfirmOverrides = Record<string, unknown>

async function confirmPackaging(
  g4: { executeG4Command: (input: Record<string, unknown>) => Promise<{ ok: boolean; error?: string; status?: number; [k: string]: unknown }> },
  idempotencyKey: string,
  overrides: ConfirmOverrides = {},
) {
  return g4.executeG4Command({
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
      ...overrides,
    },
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function releaseLot(g4: any, lotId: string, idempotencyKey = 'qc-release') {
  attachVerified(lotId, 'passport')
  attachVerified(lotId, 'protocol')
  return g4.executeG4Command({
    actor,
    storeId: STORE,
    idempotencyKey,
    commandType: 'qc.release',
    command: { finishedGoodsLotId: lotId, reason: 'lab ok' },
  })
}

// ---------------------------------------------------------------------------
// Trust boundary
// ---------------------------------------------------------------------------

describe('G4 trust boundary', () => {
  it('no principal → 403 for every packaging command', async () => {
    const g4 = await import('../api/fst/_g4PackagingService.mjs')
    for (const commandType of ['packaging.read', 'packaging.report.confirm', 'shipment.post']) {
      const r = await g4.executeG4Command({
        actor,
        storeId: STORE,
        idempotencyKey: `deny-${commandType}`,
        commandType,
        command: {},
      })
      expect(r.ok).toBe(false)
      expect(r.status).toBe(403)
    }
  })

  it('inactive principal → 403 even with full capabilities', async () => {
    grant(ALL_CAPS, 'u1', false)
    const g4 = await import('../api/fst/_g4PackagingService.mjs')
    const r = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'inactive',
      commandType: 'packaging.read',
      command: {},
    })
    expect(r.ok).toBe(false)
    expect(r.status).toBe(403)
  })

  it('missing qc.release → release denied even for a sysadmin email actor', async () => {
    const caps = { ...ALL_CAPS }
    delete (caps as Record<string, unknown>)['qc.release']
    const g4 = await bootstrap({ caps })
    const confirmed = await confirmPackaging(g4, 'pk-1')
    expect(confirmed.ok).toBe(true)

    const denied = await g4.executeG4Command({
      actor: sysadminActor,
      storeId: STORE,
      idempotencyKey: 'release-no-cap',
      commandType: 'qc.release',
      command: { finishedGoodsLotId: confirmed.finishedGoodsLotId },
    })
    expect(denied.ok).toBe(false)
    expect(denied.status).toBe(403)
    expect(payload().domains.production.finishedGoodsLots[0].qcStatus).toBe('pending')
  })

  it('arbitrary payload patch is refused before any capability work', async () => {
    const g4 = await bootstrap()
    const r = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'patch',
      commandType: 'packaging.read',
      command: {},
      payloadJson: '{}',
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('arbitrary_patch_forbidden')
  })
})

// ---------------------------------------------------------------------------
// Packaging confirm
// ---------------------------------------------------------------------------

describe('G4 packaging confirm', () => {
  it('creates a pending lot with a server lot number, FG receipt movements and WIP deduction', async () => {
    const g4 = await bootstrap({ wipQty: 200, materialQty: 40 })
    const r = await confirmPackaging(g4, 'pk-1')
    expect(r.ok).toBe(true)
    expect(r.status).toBe('confirmed')
    expect(r.qcStatus).toBe('pending')
    expect(r.lotNumber).toMatch(/^LOT-20260904-\d{3}$/)
    expect(r.quantityProduced).toBe(100)

    const p = payload()
    const lots = p.domains.production.finishedGoodsLots
    expect(lots.length).toBe(1)
    expect(lots[0].id).toBe(r.finishedGoodsLotId)
    expect(lots[0].qcStatus).toBe('pending')
    expect(lots[0].lotNumber).toBe(r.lotNumber)
    expect(lots[0].quantityQcReleased).toBe(0)
    expect(lots[0].warehouseId).toBe(PACK_WH)
    expect(lots[0].locationId).toBe(FG_LOC)

    // Finished goods received into the FG location under the server lot number
    expect(
      balanceOf(p.domains.warehouse.movements, {
        warehouseId: PACK_WH,
        locationId: FG_LOC,
        itemId: FG_ITEM,
        batchNo: r.lotNumber,
      }),
    ).toBe(100)

    // WIP and packaging material consumed at the pack location
    expect(
      balanceOf(p.domains.warehouse.movements, {
        warehouseId: PACK_WH,
        locationId: PACK_LOC,
        itemId: WIP_ITEM,
      }),
    ).toBe(150)
    expect(
      balanceOf(p.domains.warehouse.movements, {
        warehouseId: PACK_WH,
        locationId: PACK_LOC,
        itemId: MATERIAL_ITEM,
      }),
    ).toBe(35)

    const report = p.domains.production.packagingReports[0]
    expect(report.status).toBe('confirmed')
    expect(report.finishedGoodsLotId).toBe(r.finishedGoodsLotId)
    expect(report.documentIds.length).toBe(3)
  })

  it('double confirm with the same idempotencyKey is idempotent (no second lot)', async () => {
    const g4 = await bootstrap()
    const first = await confirmPackaging(g4, 'pk-idem')
    expect(first.ok).toBe(true)
    const revisionAfterFirst = dcState.critical!.revision

    const second = await confirmPackaging(g4, 'pk-idem')
    expect(second.ok).toBe(true)
    expect(second.idempotent).toBe(true)
    expect(second.finishedGoodsLotId).toBe(first.finishedGoodsLotId)
    expect(payload().domains.production.finishedGoodsLots.length).toBe(1)
    expect(payload().domains.production.packagingReports.length).toBe(1)
    expect(dcState.critical!.revision).toBe(revisionAfterFirst)
  })

  it('two confirms racing the last WIP (different keys) → exactly one commits', async () => {
    const g4 = await bootstrap({ wipQty: 50 })

    let gate = 0
    const realCas = calls.updateCas.getMockImplementation()!
    calls.updateCas.mockImplementation(async (...args: unknown[]) => {
      const turn = ++gate
      if (turn === 1) await new Promise((r) => setTimeout(r, 40))
      return realCas(...args)
    })

    const [a, b] = await Promise.all([
      confirmPackaging(g4, 'race-a', { reportKey: 'race-a' }),
      confirmPackaging(g4, 'race-b', { reportKey: 'race-b' }),
    ])
    const oks = [a, b].filter((r) => r.ok)
    const fails = [a, b].filter((r) => !r.ok)
    expect(oks.length).toBe(1)
    expect(fails.length).toBe(1)
    expect(['revision_conflict', 'insufficient_wip']).toContain(fails[0].error)
    expect(payload().domains.production.finishedGoodsLots.length).toBe(1)

    calls.updateCas.mockImplementation(realCas)

    // The WIP is gone; a sequential retry now fails on stock, not on CAS.
    const after = await confirmPackaging(g4, 'race-c', { reportKey: 'race-c' })
    expect(after.ok).toBe(false)
    expect(after.error).toBe('insufficient_wip')
    expect(after.status).toBe(400)
    expect(payload().domains.production.finishedGoodsLots.length).toBe(1)
  })

  it('strips a forged qcStatus=released / availableForShipment command', async () => {
    const g4 = await bootstrap()
    const r = await confirmPackaging(g4, 'pk-forge', {
      qcStatus: 'released',
      availableForShipment: true,
      quantityQcReleased: 999,
      currentDecisionId: 'forged-decision',
      qcDecisions: [{ id: 'forged-decision', status: 'released' }],
      finishedGoodsLots: [{ id: 'forged-lot', qcStatus: 'released' }],
    })
    expect(r.ok).toBe(true)

    const p = payload()
    const lot = p.domains.production.finishedGoodsLots[0]
    expect(p.domains.production.finishedGoodsLots.length).toBe(1)
    expect(lot.qcStatus).toBe('pending')
    expect(lot.quantityQcReleased).toBe(0)
    expect(lot.currentDecisionId).toBe(null)
    expect(p.domains.production.qcDecisions.length).toBe(0)

    const ship = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'ship-forged',
      commandType: 'shipment.post',
      command: {
        finishedProductId: FINISHED_PRODUCT,
        finishedGoodsLotId: lot.id,
        quantity: 10,
      },
    })
    expect(ship.ok).toBe(false)
    expect(ship.error).toBe('lot_not_released')
  })
})

// ---------------------------------------------------------------------------
// QC release gate
// ---------------------------------------------------------------------------

describe('G4 QC release gate', () => {
  it('a pending lot cannot be shipped', async () => {
    const g4 = await bootstrap()
    const confirmed = await confirmPackaging(g4, 'pk-1')
    const ship = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'ship-pending',
      commandType: 'shipment.post',
      command: {
        finishedProductId: FINISHED_PRODUCT,
        finishedGoodsLotId: confirmed.finishedGoodsLotId,
        quantity: 1,
      },
    })
    expect(ship.ok).toBe(false)
    expect(ship.error).toBe('lot_not_released')
    expect(ship.qcStatus).toBe('pending')
  })

  it('release without verified attachments is denied', async () => {
    const g4 = await bootstrap()
    const confirmed = await confirmPackaging(g4, 'pk-1')
    const r = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'release-no-att',
      commandType: 'qc.release',
      command: { finishedGoodsLotId: confirmed.finishedGoodsLotId },
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('qc_attachments_required')
    expect(payload().domains.production.finishedGoodsLots[0].qcStatus).toBe('pending')
  })

  it('release with only a passport is denied (protocol still required)', async () => {
    const g4 = await bootstrap()
    const confirmed = await confirmPackaging(g4, 'pk-1')
    attachVerified(confirmed.finishedGoodsLotId, 'passport')
    const r = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'release-passport-only',
      commandType: 'qc.release',
      command: { finishedGoodsLotId: confirmed.finishedGoodsLotId },
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('qc_attachments_required')
  })

  it('release with a storage object missing behind the record is denied', async () => {
    const g4 = await bootstrap()
    const confirmed = await confirmPackaging(g4, 'pk-1')
    attachVerified(confirmed.finishedGoodsLotId, 'passport')
    attachVerified(confirmed.finishedGoodsLotId, 'protocol')
    storageState.objects.clear()
    const r = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'release-missing-object',
      commandType: 'qc.release',
      command: { finishedGoodsLotId: confirmed.finishedGoodsLotId },
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('not_found')
  })

  it('verified passport + protocol → released, decision recorded in critical qcDecisions, shipment gate opens', async () => {
    const g4 = await bootstrap()
    const confirmed = await confirmPackaging(g4, 'pk-1')
    const released = await releaseLot(g4, confirmed.finishedGoodsLotId)
    expect(released.ok).toBe(true)
    expect(released.qcStatus).toBe('released')
    expect(released.quantityQcReleased).toBe(100)
    expect(released.decisionId).toBeTruthy()

    const p = payload()
    const lot = p.domains.production.finishedGoodsLots[0]
    expect(lot.qcStatus).toBe('released')
    expect(lot.currentDecisionId).toBe(released.decisionId)
    expect(lot.quantityRemaining).toBe(100)

    const decisions = p.domains.production.qcDecisions
    expect(decisions.length).toBe(1)
    expect(decisions[0].id).toBe(released.decisionId)
    expect(decisions[0].status).toBe('released')
    expect(decisions[0].lotRevision).toBe(lot.lotRevision)
    expect(decisions[0].passportAttachmentId).toBeTruthy()
    expect(decisions[0].protocolAttachmentId).toBeTruthy()

    // Read-model projection is written after CAS but is never the gate.
    expect(qcState.decisions.length).toBe(1)
    expect(qcState.lots.get(lot.id)?.status).toBe('released')


    const ship = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'ship-ok',
      commandType: 'shipment.post',
      command: {
        finishedProductId: FINISHED_PRODUCT,
        finishedGoodsLotId: lot.id,
        quantity: 10,
      },
    })
    expect(ship.ok).toBe(true)
    expect(ship.qcDecisionId).toBe(released.decisionId)
  })

  it('a released lot whose decision snapshot is stale cannot ship', async () => {
    const g4 = await bootstrap()
    const confirmed = await confirmPackaging(g4, 'pk-1')
    const released = await releaseLot(g4, confirmed.finishedGoodsLotId)
    expect(released.ok).toBe(true)

    // Simulate a tampered/stale snapshot: the lot claims a newer revision than its decision.
    const p = payload()
    p.domains.production.finishedGoodsLots[0].lotRevision =
      Number(p.domains.production.finishedGoodsLots[0].lotRevision) + 5
    dcState.critical!.payloadJson = JSON.stringify(p)

    const ship = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'ship-stale',
      commandType: 'shipment.post',
      command: {
        finishedProductId: FINISHED_PRODUCT,
        finishedGoodsLotId: confirmed.finishedGoodsLotId,
        quantity: 1,
      },
    })
    expect(ship.ok).toBe(false)
    expect(ship.error).toBe('qc_decision_stale')
  })
})

// ---------------------------------------------------------------------------
// Shipments
// ---------------------------------------------------------------------------

describe('G4 shipments', () => {
  it('partial shipment succeeds and overshipping the remainder is denied', async () => {
    const g4 = await bootstrap()
    const confirmed = await confirmPackaging(g4, 'pk-1')
    await releaseLot(g4, confirmed.finishedGoodsLotId)

    const first = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'ship-1',
      commandType: 'shipment.post',
      command: {
        shipmentId: 'shp-1',
        finishedProductId: FINISHED_PRODUCT,
        finishedGoodsLotId: confirmed.finishedGoodsLotId,
        quantity: 40,
        date: REPORT_DATE,
      },
    })
    expect(first.ok).toBe(true)
    expect(first.quantityShipped).toBe(40)
    expect(first.quantityRemaining).toBe(60)

    const over = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'ship-2',
      commandType: 'shipment.post',
      command: {
        shipmentId: 'shp-2',
        finishedProductId: FINISHED_PRODUCT,
        finishedGoodsLotId: confirmed.finishedGoodsLotId,
        quantity: 70,
        date: REPORT_DATE,
      },
    })
    expect(over.ok).toBe(false)
    expect(over.error).toBe('quantity_exceeds_remaining')
    expect(over.remaining).toBe(60)

    const p = payload()
    expect(p.domains.production.finishedGoodsLots[0].quantityShipped).toBe(40)
    expect(p.domains.warehouse.loadingShipments.length).toBe(1)
    expect(
      balanceOf(p.domains.warehouse.movements, {
        warehouseId: PACK_WH,
        locationId: FG_LOC,
        itemId: FG_ITEM,
        batchNo: confirmed.lotNumber,
      }),
    ).toBe(60)
  })


  it('shipment cancel restores quantity and repeats idempotently', async () => {
    const g4 = await bootstrap()
    const confirmed = await confirmPackaging(g4, 'pk-1')
    await releaseLot(g4, confirmed.finishedGoodsLotId)
    const posted = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'ship-1',
      commandType: 'shipment.post',
      command: {
        shipmentId: 'shp-1',
        finishedProductId: FINISHED_PRODUCT,
        finishedGoodsLotId: confirmed.finishedGoodsLotId,
        quantity: 40,
        date: REPORT_DATE,
      },
    })
    expect(posted.ok).toBe(true)

    const cancelled = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'ship-cancel-1',
      commandType: 'shipment.cancel',
      command: { shipmentId: 'shp-1', reason: 'truck refused', date: REPORT_DATE },
    })
    expect(cancelled.ok).toBe(true)
    expect(cancelled.quantityShipped).toBe(0)
    expect(cancelled.quantityRemaining).toBe(100)
    expect((cancelled.reversalDocumentIds ?? []).length).toBeGreaterThan(0)

    const p = payload()
    expect(p.domains.production.finishedGoodsLots[0].quantityShipped).toBe(0)
    expect(
      balanceOf(p.domains.warehouse.movements, {
        warehouseId: PACK_WH,
        locationId: FG_LOC,
        itemId: FG_ITEM,
        batchNo: confirmed.lotNumber,
      }),
    ).toBe(100)

    // Same key → gateway receipt; different key → domain-level idempotency.
    const replaySameKey = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'ship-cancel-1',
      commandType: 'shipment.cancel',
      command: { shipmentId: 'shp-1', reason: 'truck refused', date: REPORT_DATE },
    })
    expect(replaySameKey.ok).toBe(true)
    expect(replaySameKey.idempotent).toBe(true)

    const replayNewKey = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'ship-cancel-2',
      commandType: 'shipment.cancel',
      command: { shipmentId: 'shp-1', reason: 'truck refused again', date: REPORT_DATE },
    })
    expect(replayNewKey.ok).toBe(true)
    expect(replayNewKey.idempotent).toBe(true)
    expect(payload().domains.production.finishedGoodsLots[0].quantityShipped).toBe(0)
    expect(
      balanceOf(payload().domains.warehouse.movements, {
        warehouseId: PACK_WH,
        locationId: FG_LOC,
        itemId: FG_ITEM,
        batchNo: confirmed.lotNumber,
      }),
    ).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// Regrade / reject / write-off
// ---------------------------------------------------------------------------

describe('G4 regrade, reject and scrap write-off', () => {
  it('regrade creates a new pending lot and the source lot stops being shippable', async () => {
    const g4 = await bootstrap()
    const confirmed = await confirmPackaging(g4, 'pk-1')
    await releaseLot(g4, confirmed.finishedGoodsLotId)
    await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'ship-1',
      commandType: 'shipment.post',
      command: {
        shipmentId: 'shp-1',
        finishedProductId: FINISHED_PRODUCT,
        finishedGoodsLotId: confirmed.finishedGoodsLotId,
        quantity: 40,
        date: REPORT_DATE,
      },
    })

    const freeText = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'regrade-free-text',
      commandType: 'qc.regrade',
      command: {
        finishedGoodsLotId: confirmed.finishedGoodsLotId,
        reason: 'grade B',
        targetFinishedProductId: 'fp-2',
        targetFinishedProductName: 'Second grade mesh',
        date: REPORT_DATE,
      },
    })
    expect(freeText.ok).toBe(false)
    expect(freeText.error).toBe('free_text_product_forbidden')

    const regrade = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'regrade-1',
      commandType: 'qc.regrade',
      command: {
        finishedGoodsLotId: confirmed.finishedGoodsLotId,
        reason: 'grade B',
        targetFinishedProductId: 'fp-2',
        targetWarehouseItemId: 'fg-item-b',
        date: REPORT_DATE,
      },
    })
    expect(regrade.ok).toBe(true)
    expect(regrade.qcStatus).toBe('regrade_pending')
    expect(regrade.quantity).toBe(60)
    expect(regrade.newFinishedGoodsLotId).toBeTruthy()

    const p = payload()
    const lots = p.domains.production.finishedGoodsLots
    expect(lots.length).toBe(2)
    const source = lots.find((l: { id: string }) => l.id === confirmed.finishedGoodsLotId)
    const child = lots.find((l: { id: string }) => l.id === regrade.newFinishedGoodsLotId)
    expect(source.qcStatus).toBe('regrade_pending')
    expect(child.qcStatus).toBe('pending')
    expect(child.finishedProductId).toBe('fp-2')
    expect(child.quantityProduced).toBe(60)
    expect(child.parentLotId).toBe(source.id)

    const shipOld = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'ship-old',
      commandType: 'shipment.post',
      command: {
        finishedProductId: FINISHED_PRODUCT,
        finishedGoodsLotId: source.id,
        quantity: 1,
        date: REPORT_DATE,
      },
    })
    expect(shipOld.ok).toBe(false)
    expect(shipOld.error).toBe('lot_not_released')

    const shipNew = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'ship-new',
      commandType: 'shipment.post',
      command: {
        finishedProductId: 'fp-2',
        finishedGoodsLotId: child.id,
        quantity: 1,
        date: REPORT_DATE,
      },
    })
    expect(shipNew.ok).toBe(false)
    expect(shipNew.error).toBe('lot_not_released')
  })

  it('reject moves the lot to scrap_pending without an automatic write-off', async () => {
    const g4 = await bootstrap()
    const confirmed = await confirmPackaging(g4, 'pk-1')

    const noReason = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'reject-no-reason',
      commandType: 'qc.reject',
      command: { finishedGoodsLotId: confirmed.finishedGoodsLotId },
    })
    expect(noReason.ok).toBe(false)
    expect(noReason.error).toBe('reject_reason_required')

    const rejected = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'reject-1',
      commandType: 'qc.reject',
      command: {
        finishedGoodsLotId: confirmed.finishedGoodsLotId,
        reason: 'delamination',
        date: REPORT_DATE,
      },
    })
    expect(rejected.ok).toBe(true)
    expect(rejected.qcStatus).toBe('scrap_pending')
    expect(rejected.scrapLocationId).toBe(SCRAP_LOC)
    expect(rejected.quantity).toBe(100)

    const p = payload()
    const lot = p.domains.production.finishedGoodsLots[0]
    expect(lot.qcStatus).toBe('scrap_pending')
    expect(lot.locationId).toBe(SCRAP_LOC)
    // Stock is transferred to scrap, not removed from the books.
    expect(
      balanceOf(p.domains.warehouse.movements, {
        warehouseId: PACK_WH,
        locationId: FG_LOC,
        itemId: FG_ITEM,
        batchNo: confirmed.lotNumber,
      }),
    ).toBe(0)
    expect(
      balanceOf(p.domains.warehouse.movements, {
        warehouseId: PACK_WH,
        locationId: SCRAP_LOC,
        itemId: FG_ITEM,
        batchNo: confirmed.lotNumber,
      }),
    ).toBe(100)

    const ship = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'ship-rejected',
      commandType: 'shipment.post',
      command: {
        finishedProductId: FINISHED_PRODUCT,
        finishedGoodsLotId: confirmed.finishedGoodsLotId,
        quantity: 1,
        date: REPORT_DATE,
      },
    })
    expect(ship.ok).toBe(false)
    expect(ship.error).toBe('lot_not_released')
  })

  it('write-off is denied without qc.scrap.writeoff and succeeds once granted', async () => {
    const capsWithoutWriteoff = { ...ALL_CAPS }
    delete (capsWithoutWriteoff as Record<string, unknown>)['qc.scrap.writeoff']
    const g4 = await bootstrap({ caps: capsWithoutWriteoff })
    const confirmed = await confirmPackaging(g4, 'pk-1')
    await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'reject-1',
      commandType: 'qc.reject',
      command: {
        finishedGoodsLotId: confirmed.finishedGoodsLotId,
        reason: 'delamination',
        date: REPORT_DATE,
      },
    })

    const denied = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'writeoff-denied',
      commandType: 'qc.scrap.writeoff',
      command: {
        finishedGoodsLotId: confirmed.finishedGoodsLotId,
        reason: 'unsalvageable',
        date: REPORT_DATE,
      },
    })
    expect(denied.ok).toBe(false)
    expect(denied.status).toBe(403)
    expect(payload().domains.production.finishedGoodsLots[0].qcStatus).toBe('scrap_pending')

    grant(ALL_CAPS)
    const ok = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'writeoff-ok',
      commandType: 'qc.scrap.writeoff',
      command: {
        finishedGoodsLotId: confirmed.finishedGoodsLotId,
        reason: 'unsalvageable',
        date: REPORT_DATE,
      },
    })
    expect(ok.ok).toBe(true)
    expect(ok.qcStatus).toBe('written_off')
    expect(ok.quantity).toBe(100)

    const p = payload()
    expect(p.domains.production.finishedGoodsLots[0].qcStatus).toBe('written_off')
    expect(
      balanceOf(p.domains.warehouse.movements, {
        warehouseId: PACK_WH,
        locationId: SCRAP_LOC,
        itemId: FG_ITEM,
        batchNo: confirmed.lotNumber,
      }),
    ).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Feature activation
// ---------------------------------------------------------------------------

describe('G4 feature activation', () => {
  it('packaging.domain.activate requires an active production domain', async () => {
    grant(ALL_CAPS)
    const g4 = await import('../api/fst/_g4PackagingService.mjs')
    const denied = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'g4-activate-early',
      commandType: 'packaging.domain.activate',
      command: { reason: 'too early' },
    })
    expect(denied.ok).toBe(false)
    expect(denied.error).toBe('production_domain_inactive')
    expect(denied.status).toBe(409)

    await activateProduction()
    const activated = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'g4-activate-late',
      commandType: 'packaging.domain.activate',
      command: { reason: 'bootstrap' },
    })
    expect(activated.ok).toBe(true)
    expect(activated.packagingQcActive).toBe(true)
    expect(payload().domainMeta.production.active).toBe(true)
    expect(payload().domainMeta.production.features.packagingQc.active).toBe(true)
  })

  it('production active + packagingQc inactive → confirm blocked, read still works', async () => {
    grant(ALL_CAPS)
    await activateProduction()
    seedCriticalFixtures()
    const g4 = await import('../api/fst/_g4PackagingService.mjs')

    const confirm = await confirmPackaging(g4, 'pk-inactive')
    expect(confirm.ok).toBe(false)
    expect(confirm.error).toBe('packaging_qc_inactive')
    expect(confirm.status).toBe(409)
    expect(payload().domains.production.finishedGoodsLots.length).toBe(0)

    const read = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'read-inactive',
      commandType: 'packaging.read',
      command: {},
    })
    expect(read.ok).toBe(true)
    expect(read.productionActive).toBe(true)
    expect(read.packagingQcActive).toBe(false)
    expect(read.source).toBe('legacy_or_inactive')

    // Activating the feature flips the read source without touching the ledger.
    const movementsBefore = payload().domains.warehouse.movements.length
    const activated = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'g4-activate',
      commandType: 'packaging.domain.activate',
      command: { reason: 'bootstrap' },
    })
    expect(activated.ok).toBe(true)
    expect(payload().domains.warehouse.movements.length).toBe(movementsBefore)

    const readAfter = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'read-active',
      commandType: 'packaging.read',
      command: {},
    })
    expect(readAfter.packagingQcActive).toBe(true)
    expect(readAfter.source).toBe('fst_critical_store')
  })
})
