/**
 * PHASE G4.1 — QC status source of truth.
 *
 * The shipment gate reads ONLY the FstCriticalStore snapshot
 * (`finishedGoodsLots[].qcStatus` + `currentDecisionId` + `lotRevision`
 * matched against `qcDecisions`). SQL `QcLotDecision` / `QcFinishedGoodsLot`
 * rows are read-model projections written best-effort after CAS: they can be
 * stale, forged or missing without ever changing an authorization outcome.
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
  failDecisionInsert: false,
  failLotUpsert: false,
}

const qcCalls = {
  insertDecision: vi.fn(async (row: Record<string, unknown>) => {
    if (qcState.failDecisionInsert) throw new Error('projection_unavailable')
    if (qcState.decisions.some((d) => d.id === row.id)) throw new Error('duplicate_decision')
    qcState.decisions.push(row)
  }),
  upsertLot: vi.fn(async (row: Record<string, unknown>) => {
    if (qcState.failLotUpsert) throw new Error('projection_unavailable')
    qcState.lots.set(String(row.id), row)
  }),
  getLatestDecision: vi.fn(async () => ({ data: { qcLotDecisions: [] as unknown[] } })),
  getLot: vi.fn(async () => ({ data: { qcFinishedGoodsLot: null as unknown } })),
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
    await qcCalls.insertDecision(row)
    return { data: {} }
  },
  upsertQcFinishedGoodsLot: async (_dc: unknown, row: Record<string, unknown>) => {
    await qcCalls.upsertLot(row)
    return { data: {} }
  },
  // Present so the test can prove the gateway never reads them.
  getLatestQcLotDecision: (...args: unknown[]) => qcCalls.getLatestDecision(...args),
  getQcFinishedGoodsLot: (...args: unknown[]) => qcCalls.getLot(...args),
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
  productionLineIds: ['*'],
}

beforeEach(() => {
  for (const fn of Object.values(calls)) fn.mockReset()
  for (const fn of Object.values(qcCalls)) fn.mockClear()
  dcState.principals.clear()
  dcState.critical = null
  dcState.receipts.clear()
  qcState.attachments.length = 0
  qcState.decisions.length = 0
  qcState.lots.clear()
  qcState.failDecisionInsert = false
  qcState.failLotUpsert = false
  storageState.objects.clear()
  qcCalls.getLatestDecision.mockResolvedValue({ data: { qcLotDecisions: [] } })
  qcCalls.getLot.mockResolvedValue({ data: { qcFinishedGoodsLot: null } })

  calls.getPrincipal.mockImplementation(
    async (_dc: unknown, vars: { firebaseUid: string; storeId: string }) => {
      const row = dcState.principals.get(`${vars.storeId}::${vars.firebaseUid}`)
      return { data: { fstPrincipalAccesses: row ? [row] : [] } }
    },
  )
  calls.getCritical.mockImplementation(async (_dc: unknown, vars: { id: string }) => ({
    data: { fstCriticalStore: vars.id === STORE ? dcState.critical : null },
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

function writePayload(next: unknown) {
  dcState.critical!.payloadJson = JSON.stringify(next)
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

function seedCriticalFixtures() {
  const p = payload()
  p.domains.warehouse.locations = [{ id: PACK_WH }, { id: PACK_LOC }, { id: FG_LOC }, { id: SCRAP_LOC }]
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
      quantity: 400,
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
      quantity: 80,
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
  writePayload(p)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type G4 = any

async function bootstrap(): Promise<G4> {
  grant(ALL_CAPS)
  const g3 = await import('../server/fst/_g3ProductionService.mjs')
  const activated = await g3.executeG3Command({
    actor,
    storeId: STORE,
    idempotencyKey: 'sot-act-prod',
    commandType: 'production.domain.activate',
    command: { reason: 'g4.1 qc sot bootstrap' },
  })
  expect(activated.ok).toBe(true)
  seedCriticalFixtures()

  const g4 = await import('../server/fst/_g4PackagingService.mjs')
  const packaging = await g4.executeG4Command({
    actor,
    storeId: STORE,
    idempotencyKey: 'sot-act-packaging',
    commandType: 'packaging.domain.activate',
    command: { reason: 'g4.1 qc sot bootstrap' },
  })
  expect(packaging.ok).toBe(true)
  return g4
}

async function confirmPackaging(g4: G4, idempotencyKey: string, overrides: Record<string, unknown> = {}) {
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

async function releaseLot(g4: G4, lotId: string, idempotencyKey = 'sot-release') {
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

async function postShipment(g4: G4, lotId: string, idempotencyKey: string, quantity = 10, extra: Record<string, unknown> = {}) {
  return g4.executeG4Command({
    actor,
    storeId: STORE,
    idempotencyKey,
    commandType: 'shipment.post',
    command: {
      finishedProductId: FINISHED_PRODUCT,
      finishedGoodsLotId: lotId,
      quantity,
      date: REPORT_DATE,
      ...extra,
    },
  })
}

// ---------------------------------------------------------------------------

describe('G4.1 shipment gate reads only the critical snapshot', () => {
  it('never queries the SQL decision/lot projections while posting a shipment', async () => {
    const g4 = await bootstrap()
    const confirmed = await confirmPackaging(g4, 'sot-pk-1')
    const released = await releaseLot(g4, confirmed.finishedGoodsLotId)
    expect(released.ok).toBe(true)

    qcCalls.getLatestDecision.mockClear()
    qcCalls.getLot.mockClear()

    const ship = await postShipment(g4, confirmed.finishedGoodsLotId, 'sot-ship-1', 10)
    expect(ship.ok).toBe(true)
    expect(ship.qcDecisionId).toBe(released.decisionId)
    expect(qcCalls.getLatestDecision).not.toHaveBeenCalled()
    expect(qcCalls.getLot).not.toHaveBeenCalled()

    const lot = payload().domains.production.finishedGoodsLots[0]
    const decision = payload().domains.production.qcDecisions.find(
      (d: { id: string }) => d.id === lot.currentDecisionId,
    )
    expect(decision.status).toBe('released')
    expect(Number(decision.lotRevision)).toBe(Number(lot.lotRevision))
  })

  it('a SQL QcLotDecision released row cannot ship a pending critical lot', async () => {
    const g4 = await bootstrap()
    const confirmed = await confirmPackaging(g4, 'sot-pk-1')
    const lotId = confirmed.finishedGoodsLotId

    // Someone writes straight into the read-model projection tables.
    qcState.decisions.push({
      id: 'forged-sql-decision',
      storeId: STORE,
      lotId,
      lotRevision: 1,
      status: 'released',
      decidedByUid: 'attacker',
    })
    qcState.lots.set(lotId, { id: lotId, storeId: STORE, status: 'released', revision: 1 })
    qcCalls.getLatestDecision.mockResolvedValue({
      data: { qcLotDecisions: [{ id: 'forged-sql-decision', status: 'released', lotId }] },
    })
    qcCalls.getLot.mockResolvedValue({
      data: { qcFinishedGoodsLot: { id: lotId, storeId: STORE, status: 'released' } },
    })

    const ship = await postShipment(g4, lotId, 'sot-ship-forged-sql')
    expect(ship.ok).toBe(false)
    expect(ship.error).toBe('lot_not_released')
    expect(ship.qcStatus).toBe('pending')
    expect(payload().domains.production.qcDecisions.length).toBe(0)
  })

  it('a forged qcStatus=released in the command body is stripped', async () => {
    const g4 = await bootstrap()
    const confirmed = await confirmPackaging(g4, 'sot-pk-forge', {
      qcStatus: 'released',
      availableForShipment: true,
      quantityQcReleased: 999,
      currentDecisionId: 'forged-decision',
      lotRevision: 42,
      qcDecisions: [{ id: 'forged-decision', status: 'released', lotRevision: 42 }],
    })
    expect(confirmed.ok).toBe(true)

    const lot = payload().domains.production.finishedGoodsLots[0]
    expect(lot.qcStatus).toBe('pending')
    expect(lot.currentDecisionId).toBe(null)
    expect(lot.lotRevision).toBe(1)
    expect(lot.quantityQcReleased).toBe(0)
    expect(payload().domains.production.qcDecisions.length).toBe(0)

    // A shipment command cannot smuggle the verdict either.
    const ship = await postShipment(g4, lot.id, 'sot-ship-forge', 5, {
      qcStatus: 'released',
      availableForShipment: true,
      qcDecisions: [{ id: 'forged-decision', status: 'released' }],
    })
    expect(ship.ok).toBe(false)
    expect(ship.error).toBe('lot_not_released')
  })
})

describe('G4.1 lotRevision staleness', () => {
  it('a packaging correction leaves the old release decision behind the lot revision', async () => {
    const g4 = await bootstrap()
    const confirmed = await confirmPackaging(g4, 'sot-pk-1')
    const released = await releaseLot(g4, confirmed.finishedGoodsLotId)
    expect(released.ok).toBe(true)
    const revisionAtRelease = released.lotRevision

    const corrected = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'sot-correct-1',
      commandType: 'packaging.report.confirmCorrection',
      command: {
        originalReportId: confirmed.reportId,
        correctionReason: 'rolls miscounted',
        outputM2: 80,
        wipLines: [{ semiFinishedItemId: WIP_ITEM, quantity: 40 }],
        materialLines: [{ itemId: MATERIAL_ITEM, quantity: 4 }],
      },
    })
    expect(corrected.ok).toBe(true)
    expect(corrected.requiresNewQc).toBe(true)

    const p = payload()
    const oldLot = p.domains.production.finishedGoodsLots.find(
      (l: { id: string }) => l.id === confirmed.finishedGoodsLotId,
    )
    expect(oldLot.qcStatus).toBe('pending')
    expect(Number(oldLot.lotRevision)).toBeGreaterThan(Number(revisionAtRelease))

    const oldDecision = p.domains.production.qcDecisions.find(
      (d: { id: string }) => d.id === released.decisionId,
    )
    expect(oldDecision.status).toBe('released')
    expect(Number(oldDecision.lotRevision)).toBe(Number(revisionAtRelease))
    expect(Number(oldDecision.lotRevision)).toBeLessThan(Number(oldLot.lotRevision))

    // The corrected lot is not shippable on the strength of the old decision.
    const ship = await postShipment(g4, confirmed.finishedGoodsLotId, 'sot-ship-corrected', 1)
    expect(ship.ok).toBe(false)
    expect(ship.error).toBe('lot_not_released')
  })

  it('a tampered qcStatus + old decision pointer is refused as qc_decision_stale', async () => {
    const g4 = await bootstrap()
    const confirmed = await confirmPackaging(g4, 'sot-pk-1')
    const released = await releaseLot(g4, confirmed.finishedGoodsLotId)
    expect(released.ok).toBe(true)

    const corrected = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'sot-correct-1',
      commandType: 'packaging.report.confirmCorrection',
      command: {
        originalReportId: confirmed.reportId,
        correctionReason: 'rolls miscounted',
        outputM2: 80,
        wipLines: [{ semiFinishedItemId: WIP_ITEM, quantity: 40 }],
        materialLines: [{ itemId: MATERIAL_ITEM, quantity: 4 }],
      },
    })
    expect(corrected.ok).toBe(true)

    // Direct payload tamper: claim released again and point back at the stale decision.
    const p = payload()
    const lots = p.domains.production.finishedGoodsLots
    const idx = lots.findIndex((l: { id: string }) => l.id === confirmed.finishedGoodsLotId)
    lots[idx] = {
      ...lots[idx],
      qcStatus: 'released',
      currentDecisionId: released.decisionId,
      quantityQcReleased: 100,
      quantityRemaining: 100,
    }
    writePayload(p)

    const ship = await postShipment(g4, confirmed.finishedGoodsLotId, 'sot-ship-stale', 1)
    expect(ship.ok).toBe(false)
    expect(ship.error).toBe('qc_decision_stale')
    expect(ship.status).toBe(409)
    expect(Number(ship.decisionLotRevision)).toBeLessThan(Number(ship.lotRevision))
  })

  it('a regrade bumps the revision so the released decision stops authorizing', async () => {
    const g4 = await bootstrap()
    const confirmed = await confirmPackaging(g4, 'sot-pk-1')
    const released = await releaseLot(g4, confirmed.finishedGoodsLotId)
    expect(released.ok).toBe(true)

    const regrade = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'sot-regrade-1',
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

    const p = payload()
    const source = p.domains.production.finishedGoodsLots.find(
      (l: { id: string }) => l.id === confirmed.finishedGoodsLotId,
    )
    expect(source.qcStatus).toBe('regrade_pending')
    expect(source.currentDecisionId).toBe(regrade.decisionId)
    expect(Number(source.lotRevision)).toBeGreaterThan(Number(released.lotRevision))

    const ship = await postShipment(g4, confirmed.finishedGoodsLotId, 'sot-ship-regraded', 1)
    expect(ship.ok).toBe(false)
    expect(ship.error).toBe('lot_not_released')

    // Tampering the status back only surfaces the pointer as a non-release decision.
    const tampered = payload()
    const lots = tampered.domains.production.finishedGoodsLots
    const idx = lots.findIndex((l: { id: string }) => l.id === confirmed.finishedGoodsLotId)
    lots[idx] = { ...lots[idx], qcStatus: 'released', quantityQcReleased: 100, quantityRemaining: 100 }
    writePayload(tampered)

    const shipTampered = await postShipment(g4, confirmed.finishedGoodsLotId, 'sot-ship-regraded-2', 1)
    expect(shipTampered.ok).toBe(false)
    expect(shipTampered.error).toBe('qc_decision_missing')
  })
})

describe('G4.1 projections never gate the critical decision', () => {
  it('a projection outage after CAS leaves the release and shipment intact', async () => {
    const g4 = await bootstrap()
    const confirmed = await confirmPackaging(g4, 'sot-pk-1')

    qcState.failDecisionInsert = true
    qcState.failLotUpsert = true
    const released = await releaseLot(g4, confirmed.finishedGoodsLotId)
    expect(released.ok).toBe(true)
    expect(released.qcStatus).toBe('released')

    // Read model is empty, critical store holds the decision.
    expect(qcState.decisions.length).toBe(0)
    expect(qcState.lots.size).toBe(0)
    const lot = payload().domains.production.finishedGoodsLots[0]
    expect(lot.qcStatus).toBe('released')
    expect(lot.currentDecisionId).toBe(released.decisionId)
    expect(payload().domains.production.qcDecisions.length).toBe(1)

    const ship = await postShipment(g4, confirmed.finishedGoodsLotId, 'sot-ship-no-projection', 10)
    expect(ship.ok).toBe(true)
    expect(ship.qcDecisionId).toBe(released.decisionId)
  })

  it('reconcileQcProjectionsFromCritical rebuilds the read model idempotently', async () => {
    const g4 = await bootstrap()
    const confirmed = await confirmPackaging(g4, 'sot-pk-1')

    qcState.failDecisionInsert = true
    qcState.failLotUpsert = true
    const released = await releaseLot(g4, confirmed.finishedGoodsLotId)
    expect(released.ok).toBe(true)
    expect(qcState.decisions.length).toBe(0)

    qcState.failDecisionInsert = false
    qcState.failLotUpsert = false
    const first = await g4.reconcileQcProjectionsFromCritical(STORE, 'u1')
    expect(first.ok).toBe(true)
    expect(first.lots).toBe(1)
    expect(first.lotsWritten).toBe(1)
    expect(first.decisionsWritten).toBe(1)
    expect(first.failures).toEqual([])

    expect(qcState.decisions.length).toBe(1)
    expect(qcState.decisions[0].id).toBe(released.decisionId)
    expect(qcState.decisions[0].status).toBe('released')
    const projected = qcState.lots.get(confirmed.finishedGoodsLotId)!
    expect(projected.status).toBe('released')
    expect(projected.batchNo).toBe(confirmed.lotNumber)
    expect(projected.quantityProduced).toBe(100)

    // Second sweep must not duplicate anything.
    const second = await g4.reconcileQcProjectionsFromCritical(STORE, 'u1')
    expect(second.ok).toBe(true)
    expect(second.decisionsWritten).toBe(0)
    expect(second.decisionsSkipped).toBe(1)
    expect(qcState.decisions.length).toBe(1)
    expect(qcState.lots.size).toBe(1)
  })

  it('reconcile rejects a blank id and an unknown store', async () => {
    const g4 = await bootstrap()

    const blank = await g4.reconcileQcProjectionsFromCritical('', 'u1')
    expect(blank.ok).toBe(false)
    expect(blank.error).toBe('invalid_input')
    expect(blank.status).toBe(400)

    const unknown = await g4.reconcileQcProjectionsFromCritical('other-store', 'u1')
    expect(unknown.ok).toBe(false)
    expect(unknown.error).toBe('not_found')
    expect(unknown.status).toBe(404)

    // A store with no lots is a no-op sweep, not an error.
    const empty = await g4.reconcileQcProjectionsFromCritical(STORE, 'u1')
    expect(empty.ok).toBe(true)
    expect(empty.lots).toBe(0)
    expect(qcState.lots.size).toBe(0)
  })
})

describe('G4.1 idempotency does not duplicate decisions', () => {
  it('replaying qc.release with the same key keeps exactly one critical decision', async () => {
    const g4 = await bootstrap()
    const confirmed = await confirmPackaging(g4, 'sot-pk-1')
    const first = await releaseLot(g4, confirmed.finishedGoodsLotId, 'sot-release-idem')
    expect(first.ok).toBe(true)
    const revisionAfterFirst = dcState.critical!.revision

    const second = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'sot-release-idem',
      commandType: 'qc.release',
      command: { finishedGoodsLotId: confirmed.finishedGoodsLotId, reason: 'lab ok' },
    })
    expect(second.ok).toBe(true)
    expect(second.idempotent).toBe(true)
    expect(second.decisionId).toBe(first.decisionId)
    expect(dcState.critical!.revision).toBe(revisionAfterFirst)
    expect(payload().domains.production.qcDecisions.length).toBe(1)

    // A fresh key with a different semantic payload cannot reuse the terminal lot.
    const third = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'sot-release-idem-2',
      commandType: 'qc.release',
      command: { finishedGoodsLotId: confirmed.finishedGoodsLotId, reason: 'lab ok again' },
    })
    expect(third.ok).toBe(false)
    expect(third.error).toBe('g4_idempotency_conflict')
    expect(payload().domains.production.qcDecisions.length).toBe(1)
    expect(qcState.decisions.length).toBe(1)
  })

  it('replaying shipment.post with the same key does not double-ship', async () => {
    const g4 = await bootstrap()
    const confirmed = await confirmPackaging(g4, 'sot-pk-1')
    await releaseLot(g4, confirmed.finishedGoodsLotId)

    const first = await postShipment(g4, confirmed.finishedGoodsLotId, 'sot-ship-idem', 25, {
      shipmentId: 'shp-1',
    })
    expect(first.ok).toBe(true)
    expect(first.quantityShipped).toBe(25)

    const replay = await postShipment(g4, confirmed.finishedGoodsLotId, 'sot-ship-idem', 25, {
      shipmentId: 'shp-1',
    })
    expect(replay.ok).toBe(true)
    expect(replay.idempotent).toBe(true)
    expect(payload().domains.production.finishedGoodsLots[0].quantityShipped).toBe(25)
    expect(payload().domains.warehouse.loadingShipments.length).toBe(1)
  })
})
