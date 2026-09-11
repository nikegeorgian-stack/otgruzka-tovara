/**
 * PHASE G4 — packaging / finished-goods lot / QC / shipment lifecycle.
 *
 * Everything outside `server/fst/_g4PackagingService.mjs` is mocked in memory:
 * Data Connect (critical store + principals + receipts + CAS revision), the QC
 * read-model connector and QC Storage verification.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { validatePackagingMutationAck } from '../src/lib/production/g4PackagingAck'
import { validateG4CriticalMutationAck } from '../src/lib/production/g4CriticalMutationAck'
import { adaptAuthoritativeG4ProductionDomain } from '../src/lib/production/g4ServerClient'

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
  vi.unstubAllEnvs()
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

function seedCanonicalPackagingFixtures() {
  const p = payload()
  const shiftReportId = 'sr-canonical-shared'
  const wipBatchId = 'wip-canonical-shared'
  const receiptDocumentId = 'wh-wip-canonical-shared'
  const receiptLineId = 'wip-source-line-shared'
  p.domains.production.orders[0] = {
    ...p.domains.production.orders[0],
    warehouseItemId: FG_ITEM,
    semiFinishedItemId: WIP_ITEM,
    wipContractVersion: 1,
    packagingBomSnapshot: {
      packagingBomId: 'bom-canonical-shared',
      version: 1,
      contentHash: 'hash-canonical-shared',
      baseOutputQty: 10,
      components: [{ itemId: MATERIAL_ITEM, quantity: 1, unit: 'pcs' }],
    },
  }
  p.domainMeta.masterData = { active: true, version: 1 }
  p.domains.masterData.items = [
    { id: FG_ITEM, active: true, baseUnit: 'm2' },
    { id: WIP_ITEM, active: true, baseUnit: 'm2' },
    { id: MATERIAL_ITEM, active: true, baseUnit: 'pcs' },
  ]
  p.domains.masterData.finishedProducts = [
    { id: FINISHED_PRODUCT, active: true, baseUnit: 'm2' },
  ]
  p.domains.warehouse.accountingByWarehouse = [
    { id: PACK_WH, warehouseId: PACK_WH, status: 'active' },
  ]
  p.domains.production.shiftReports = [
    {
      id: shiftReportId,
      status: 'confirmed',
      orderId: ORDER_ID,
      wipBatchId,
      semiFinishedItemId: WIP_ITEM,
      packLocationId: PACK_LOC,
      outputMp: 50,
      wipContractVersion: 1,
    },
  ]
  p.domains.production.wipBatches = [
    {
      id: wipBatchId,
      orderId: ORDER_ID,
      shiftReportId,
      itemId: WIP_ITEM,
      quantityMp: 50,
      locationId: PACK_LOC,
      unitSnapshot: 'm2',
      isFinishedGoods: false,
      wipContractVersion: 1,
    },
  ]
  p.domains.warehouse.documents = [
    {
      id: receiptDocumentId,
      type: 'receipt',
      purpose: 'production_receipt',
      docRole: 'wip_receipt',
      warehouseId: PACK_WH,
      productionOrderId: ORDER_ID,
      shiftReportId,
      isWip: true,
      status: 'posted',
      lines: [
        {
          lineId: receiptLineId,
          itemId: WIP_ITEM,
          quantity: 50,
          unitSnapshot: 'm2',
          locationId: PACK_LOC,
          batchNo: wipBatchId,
        },
      ],
    },
  ]
  p.domains.warehouse.movements = p.domains.warehouse.movements
    .filter((movement: { id?: string }) => movement.id !== 'seed-wip')
    .concat({
      id: 'mov-wip-canonical-shared',
      documentId: receiptDocumentId,
      warehouseId: PACK_WH,
      locationId: PACK_LOC,
      itemId: WIP_ITEM,
      quantity: 50,
      type: 'receipt',
      batchNo: wipBatchId,
      productionOrderId: ORDER_ID,
      shiftReportId,
      isWip: true,
    })
  dcState.critical!.payloadJson = JSON.stringify(p)
  return {
    shiftReportId,
    wipBatchId,
    receiptDocumentId,
    wipLines: [
      {
        lineId: receiptLineId,
        productionOrderId: ORDER_ID,
        shiftReportId,
        receiptDocumentId,
        semiFinishedItemId: WIP_ITEM,
        itemId: WIP_ITEM,
        quantity: 50,
        unitSnapshot: 'm2',
        batchNo: wipBatchId,
      },
    ],
  }
}

async function activateProduction() {
  const g3 = await import('../server/fst/_g3ProductionService.mjs')
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
  const g4 = await import('../server/fst/_g4PackagingService.mjs')
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
    const g4 = await import('../server/fst/_g4PackagingService.mjs')
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
    const g4 = await import('../server/fst/_g4PackagingService.mjs')
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
  it('rejects malformed packaging outputs in drafts and confirms without coercion', async () => {
    const g4 = await bootstrap()
    const invalidCounts = [
      { field: 'outputRolls', value: -1, error: 'invalid_output_rolls' },
      { field: 'outputRolls', value: 1.5, error: 'invalid_output_rolls' },
      { field: 'outputRolls', value: 'Infinity', error: 'invalid_output_rolls' },
      { field: 'outputRolls', value: 'NaN', error: 'invalid_output_rolls' },
      { field: 'outputPallets', value: -1, error: 'invalid_output_pallets' },
      { field: 'outputPallets', value: 1.5, error: 'invalid_output_pallets' },
      { field: 'outputPallets', value: 'Infinity', error: 'invalid_output_pallets' },
      { field: 'outputPallets', value: 'NaN', error: 'invalid_output_pallets' },
      { field: 'outputM2', value: -1, error: 'invalid_output' },
      { field: 'outputM2', value: 0, error: 'invalid_output' },
      { field: 'outputM2', value: 'Infinity', error: 'invalid_output' },
      { field: 'outputM2', value: 'NaN', error: 'invalid_output' },
      { field: 'outputM2', value: '', error: 'invalid_output' },
    ] as const

    for (const [index, testCase] of invalidCounts.entries()) {
      const beforeRevision = dcState.critical!.revision
      const beforeJson = String(dcState.critical!.payloadJson)
      const casCallsBefore = calls.updateCas.mock.calls.length
      const draft = await g4.executeG4Command({
        actor,
        storeId: STORE,
        idempotencyKey: `invalid-draft-count-${index}`,
        commandType: 'packaging.report.draft.save',
        command: {
          reportId: `invalid-draft-count-${index}`,
          productionOrderId: ORDER_ID,
          lineId: 'pack',
          [testCase.field]: testCase.value,
        },
      })
      expect(draft).toMatchObject({ ok: false, error: testCase.error, status: 400 })
      expect(dcState.critical!.revision).toBe(beforeRevision)
      expect(dcState.critical!.payloadJson).toBe(beforeJson)
      expect(calls.updateCas.mock.calls).toHaveLength(casCallsBefore)

      const confirmed = await confirmPackaging(g4, `invalid-confirm-count-${index}`, {
        [testCase.field]: testCase.value,
      })
      expect(confirmed).toMatchObject({ ok: false, error: testCase.error, status: 400 })
      expect(dcState.critical!.revision).toBe(beforeRevision)
      expect(dcState.critical!.payloadJson).toBe(beforeJson)
      expect(calls.updateCas.mock.calls).toHaveLength(casCallsBefore)
    }

    const zero = await confirmPackaging(g4, 'zero-packaging-counts', {
      outputRolls: 0,
      outputPallets: 0,
    })
    expect(zero.ok).toBe(true)
    expect(payload().domains.production.packagingReports[0]).toMatchObject({
      outputRolls: 0,
      outputPallets: 0,
    })
    expect(payload().domains.production.finishedGoodsLots[0]).toMatchObject({
      outputRolls: 0,
      outputPallets: 0,
    })
  })

  it('rejects malformed correction counts before creating drafts or reversals', async () => {
    const g4 = await bootstrap()
    const confirmed = await confirmPackaging(g4, 'pk-before-invalid-count-correction')
    expect(confirmed.ok).toBe(true)
    const invalidCounts = [
      { field: 'outputRolls', value: -1, error: 'invalid_output_rolls' },
      { field: 'outputRolls', value: 2.5, error: 'invalid_output_rolls' },
      { field: 'outputRolls', value: 'Infinity', error: 'invalid_output_rolls' },
      { field: 'outputRolls', value: 'NaN', error: 'invalid_output_rolls' },
      { field: 'outputPallets', value: -1, error: 'invalid_output_pallets' },
      { field: 'outputPallets', value: 2.5, error: 'invalid_output_pallets' },
      { field: 'outputPallets', value: 'Infinity', error: 'invalid_output_pallets' },
      { field: 'outputPallets', value: 'NaN', error: 'invalid_output_pallets' },
      { field: 'outputM2', value: -1, error: 'invalid_output' },
      { field: 'outputM2', value: 0, error: 'invalid_output' },
      { field: 'outputM2', value: 'Infinity', error: 'invalid_output' },
      { field: 'outputM2', value: 'NaN', error: 'invalid_output' },
      { field: 'outputM2', value: '', error: 'invalid_output' },
    ] as const

    for (const [index, testCase] of invalidCounts.entries()) {
      for (const commandType of [
        'packaging.report.createCorrection',
        'packaging.report.confirmCorrection',
      ]) {
        const beforeRevision = dcState.critical!.revision
        const beforeJson = String(dcState.critical!.payloadJson)
        const casCallsBefore = calls.updateCas.mock.calls.length
        const result = await g4.executeG4Command({
          actor,
          storeId: STORE,
          idempotencyKey: `invalid-correction-count-${commandType}-${index}`,
          commandType,
          command: {
            originalReportId: confirmed.reportId,
            draftId: `invalid-correction-draft-${index}`,
            correctionReason: 'count validation',
            outputM2: 110,
            [testCase.field]: testCase.value,
          },
        })
        expect(result).toMatchObject({ ok: false, error: testCase.error, status: 400 })
        expect(dcState.critical!.revision).toBe(beforeRevision)
        expect(dcState.critical!.payloadJson).toBe(beforeJson)
        expect(calls.updateCas.mock.calls).toHaveLength(casCallsBefore)
      }
    }
  })

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
    expect(report.number).toMatch(/^УП-20260904-\d{3}$/)
    expect(report.lotNumber).toBe(r.lotNumber)
    expect(report.outputRolls).toBe(4)
    expect(report.outputPallets).toBe(0)
    expect(report.finishedGoodsLotId).toBe(r.finishedGoodsLotId)
    expect(report.documentIds.length).toBe(3)

    const adaptedResult = adaptAuthoritativeG4ProductionDomain(p.domains.production)
    expect(adaptedResult.ok).toBe(true)
    if (!adaptedResult.ok) throw new Error(adaptedResult.reason)
    const adapted = adaptedResult.production
    const selectedShift = (adapted.packagingReports as Record<string, unknown>[]).filter(
      (candidate) =>
        candidate.shiftDate === REPORT_DATE &&
        candidate.shift === 'day' &&
        candidate.productionOrderId === ORDER_ID,
    )
    expect(selectedShift).toHaveLength(1)
    expect(selectedShift[0]).toMatchObject({
      number: report.number,
      batchNo: r.lotNumber,
      rollCount: 4,
      palletCount: 0,
    })
    expect(adapted.finishedGoodsLots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: r.finishedGoodsLotId,
          batchNo: r.lotNumber,
          outputM2: 100,
          rollCount: 4,
          palletCount: 0,
          packagingDate: REPORT_DATE,
        }),
      ]),
    )
    expect(adaptAuthoritativeG4ProductionDomain(adapted)).toEqual({
      ok: true,
      production: adapted,
    })
  })

  it('canonical order confirms only from its exact G3 shift/WIP receipt lineage', async () => {
    const g4 = await bootstrap()
    const p = payload()
    const shiftReportId = 'sr-canonical'
    const wipBatchId = 'wip-canonical'
    const receiptDocumentId = 'wh-wip-canonical'
    p.domains.production.orders[0] = {
      ...p.domains.production.orders[0],
      warehouseItemId: FG_ITEM,
      semiFinishedItemId: WIP_ITEM,
      wipContractVersion: 1,
      packagingBomSnapshot: {
        packagingBomId: 'bom-canonical',
        version: 1,
        contentHash: 'hash-canonical',
        baseOutputQty: 10,
        components: [{ itemId: MATERIAL_ITEM, quantity: 1, unit: 'pcs' }],
      },
    }
    p.domainMeta.masterData = { active: true, version: 1 }
    p.domains.masterData.items = [
      { id: FG_ITEM, active: true, baseUnit: 'm2' },
      { id: WIP_ITEM, active: true, baseUnit: 'm2' },
      { id: MATERIAL_ITEM, active: true, baseUnit: 'pcs' },
    ]
    p.domains.masterData.finishedProducts = [
      { id: FINISHED_PRODUCT, active: true, baseUnit: 'm2' },
    ]
    p.domains.warehouse.accountingByWarehouse = [
      { id: PACK_WH, warehouseId: PACK_WH, status: 'active' },
    ]
    p.domains.production.shiftReports = [
      {
        id: shiftReportId,
        status: 'confirmed',
        orderId: ORDER_ID,
        wipBatchId,
        semiFinishedItemId: WIP_ITEM,
        packLocationId: PACK_LOC,
        outputMp: 50,
        wipContractVersion: 1,
      },
    ]
    p.domains.production.wipBatches = [
      {
        id: wipBatchId,
        orderId: ORDER_ID,
        shiftReportId,
        itemId: WIP_ITEM,
        quantityMp: 50,
        locationId: PACK_LOC,
        unitSnapshot: 'm2',
        isFinishedGoods: false,
        wipContractVersion: 1,
      },
    ]
    p.domains.warehouse.documents = [
      {
        id: receiptDocumentId,
        type: 'receipt',
        purpose: 'production_receipt',
        docRole: 'wip_receipt',
        warehouseId: PACK_WH,
        productionOrderId: ORDER_ID,
        shiftReportId,
        isWip: true,
        status: 'posted',
        lines: [
          {
            lineId: 'wip-source-line',
            itemId: WIP_ITEM,
            quantity: 50,
            unitSnapshot: 'm2',
            locationId: PACK_LOC,
            batchNo: wipBatchId,
          },
        ],
      },
    ]
    p.domains.warehouse.movements = p.domains.warehouse.movements
      .filter((movement: { id?: string }) => movement.id !== 'seed-wip')
      .concat({
        id: 'mov-wip-canonical',
        documentId: receiptDocumentId,
        warehouseId: PACK_WH,
        locationId: PACK_LOC,
        itemId: WIP_ITEM,
        quantity: 50,
        type: 'receipt',
        batchNo: wipBatchId,
        productionOrderId: ORDER_ID,
        shiftReportId,
        isWip: true,
      })
    dcState.critical!.payloadJson = JSON.stringify(p)

    const canonicalWipLines = [
      {
        lineId: 'wip-source-line',
        productionOrderId: ORDER_ID,
        shiftReportId,
        receiptDocumentId,
        semiFinishedItemId: WIP_ITEM,
        itemId: WIP_ITEM,
        quantity: 50,
        unitSnapshot: 'm2',
        batchNo: wipBatchId,
      },
    ]
    const revisionBeforeForgedItem = dcState.critical!.revision
    const documentsBeforeForgedItem = payload().domains.warehouse.documents.length
    const forgedItem = await confirmPackaging(g4, 'pk-canonical-forged-fg', {
      warehouseItemId: 'forged-fg-item',
      outputM2: 50,
      wipLines: canonicalWipLines,
      materialLines: [{ itemId: MATERIAL_ITEM, quantity: 5, unitSnapshot: 'pcs' }],
    })
    expect(forgedItem).toMatchObject({
      ok: false,
      error: 'finished_goods_item_mismatch',
      status: 409,
    })
    expect(dcState.critical!.revision).toBe(revisionBeforeForgedItem)
    expect(payload().domains.warehouse.documents).toHaveLength(documentsBeforeForgedItem)
    expect(payload().domains.production.packagingReports).toHaveLength(0)

    const missingBomMaterial = await confirmPackaging(g4, 'pk-canonical-missing-bom', {
      outputM2: 50,
      wipLines: canonicalWipLines,
      materialLines: [],
    })
    expect(missingBomMaterial).toMatchObject({
      ok: false,
      error: 'packaging_material_bom_incomplete',
      status: 409,
    })
    expect(payload().domains.production.packagingReports).toHaveLength(0)

    const canonicalCommand = {
      reportKey: 'pk-canonical',
      productionOrderId: ORDER_ID,
      lineId: 'pack',
      reportDate: REPORT_DATE,
      shiftSlot: 'day',
      finishedProductId: FINISHED_PRODUCT,
      warehouseItemId: FG_ITEM,
      outputM2: 50,
      outputRolls: 4,
      wipLines: canonicalWipLines,
      materialLines: [{ itemId: MATERIAL_ITEM, quantity: 5, unitSnapshot: 'pcs' }],
    }
    const revisionBeforeConfirm = dcState.critical!.revision
    const confirmed = await confirmPackaging(g4, 'pk-canonical', canonicalCommand)
    expect(confirmed.ok).toBe(true)
    expect(
      await validatePackagingMutationAck({
        ack: confirmed,
        command: canonicalCommand,
        previousCriticalRevision: revisionBeforeConfirm,
      }),
    ).toMatchObject({ ok: true })
    const report = payload().domains.production.packagingReports[0]
    expect(report).toMatchObject({
      productionOrderId: ORDER_ID,
      wipContractVersion: 1,
      sourceShiftReportIds: [shiftReportId],
      sourceWipBatchIds: [wipBatchId],
    })
  })

  it('honors only the server-frozen no-BOM exemption and otherwise requires a snapshot', async () => {
    const g4 = await bootstrap()
    const canonical = seedCanonicalPackagingFixtures()
    const required = payload()
    delete required.domains.production.orders[0].packagingBomSnapshot
    required.domains.production.orders[0].packagingBomRequired = true
    dcState.critical!.payloadJson = JSON.stringify(required)
    const revisionBeforeRequiredFailure = dcState.critical!.revision
    const requiredFailure = await confirmPackaging(g4, 'pk-bom-required-missing', {
      outputM2: 50,
      wipLines: canonical.wipLines,
      materialLines: [],
    })
    expect(requiredFailure).toMatchObject({
      ok: false,
      error: 'packaging_bom_snapshot_required',
      status: 409,
    })
    expect(dcState.critical!.revision).toBe(revisionBeforeRequiredFailure)
    expect(payload().domains.production.packagingReports).toHaveLength(0)

    const exempt = payload()
    exempt.domains.production.orders[0].packagingBomRequired = false
    dcState.critical!.payloadJson = JSON.stringify(exempt)
    const confirmed = await confirmPackaging(g4, 'pk-bom-explicitly-exempt', {
      outputM2: 50,
      wipLines: canonical.wipLines,
      materialLines: [],
    })
    expect(confirmed.ok).toBe(true)
    const report = payload().domains.production.packagingReports[0]
    expect(report).toMatchObject({
      status: 'confirmed',
      packagingBomRequired: false,
      materialLines: [],
    })
    expect(report.documentIds).toHaveLength(2)
  })

  it('strict staging rejects client order/binding fallbacks with zero mutation', async () => {
    const g4 = await bootstrap()
    const canonical = seedCanonicalPackagingFixtures()
    const previousCloudEnv = process.env.FST_CLOUD_ENV
    process.env.FST_CLOUD_ENV = 'staging'
    try {
      const p = payload()
      p.domains.production.orders = []
      p.domains.warehouse.productionLineBindings = []
      dcState.critical!.payloadJson = JSON.stringify(p)
      const beforeJson = String(dcState.critical!.payloadJson)
      const beforeRevision = dcState.critical!.revision

      const result = await confirmPackaging(g4, 'pk-strict-client-fallback', {
        outputM2: 50,
        wipLines: canonical.wipLines,
        materialLines: [{ itemId: MATERIAL_ITEM, quantity: 5, unitSnapshot: 'pcs' }],
        packagingWarehouseId: PACK_WH,
        packagingLocationId: PACK_LOC,
        finishedGoodsWarehouseId: PACK_WH,
        finishedGoodsLocationId: FG_LOC,
        orderSnapshot: {
          id: ORDER_ID,
          status: 'active',
          finishedProductId: FINISHED_PRODUCT,
          warehouseItemId: FG_ITEM,
          semiFinishedItemId: WIP_ITEM,
          wipContractVersion: 1,
        },
      })
      expect(result).toMatchObject({
        ok: false,
        error: 'authoritative_packaging_order_required',
        status: 409,
      })
      expect(dcState.critical!.revision).toBe(beforeRevision)
      expect(dcState.critical!.payloadJson).toBe(beforeJson)
    } finally {
      if (previousCloudEnv == null) delete process.env.FST_CLOUD_ENV
      else process.env.FST_CLOUD_ENV = previousCloudEnv
    }
  })

  it('strict packaging route rejects missing/ambiguous/inactive config with zero mutation', async () => {
    const g4 = await bootstrap()
    const canonical = seedCanonicalPackagingFixtures()
    const baseline = payload()
    const baselineRevision = dcState.critical!.revision
    const previousCloudEnv = process.env.FST_CLOUD_ENV
    process.env.FST_CLOUD_ENV = 'staging'
    const cases: Array<{
      name: string
      error: string
      mutate: (state: ReturnType<typeof payload>) => void
    }> = [
      {
        name: 'missing-binding',
        error: 'canonical_pack_binding_required',
        mutate: (state) => {
          state.domains.warehouse.productionLineBindings = []
        },
      },
      {
        name: 'duplicate-binding',
        error: 'canonical_pack_binding_ambiguous',
        mutate: (state) => {
          state.domains.warehouse.productionLineBindings.push({
            ...state.domains.warehouse.productionLineBindings[0],
            id: 'packing',
            lineId: 'packing',
          })
        },
      },
      {
        name: 'missing-location',
        error: 'pack_location_unavailable',
        mutate: (state) => {
          state.domains.warehouse.locations = state.domains.warehouse.locations.filter(
            (row: { id: string }) => row.id !== FG_LOC,
          )
        },
      },
      {
        name: 'missing-warehouse',
        error: 'pack_location_unavailable',
        mutate: (state) => {
          state.domains.warehouse.locations = state.domains.warehouse.locations.filter(
            (row: { id: string }) => row.id !== PACK_WH,
          )
        },
      },
      {
        name: 'duplicate-location',
        error: 'pack_location_ambiguous',
        mutate: (state) => {
          state.domains.warehouse.locations.push({ id: FG_LOC, active: true })
        },
      },
      {
        name: 'inactive-location',
        error: 'pack_location_unavailable',
        mutate: (state) => {
          state.domains.warehouse.locations = state.domains.warehouse.locations.map(
            (row: { id: string }) => (row.id === FG_LOC ? { ...row, active: false } : row),
          )
        },
      },
      {
        name: 'missing-accounting',
        error: 'pack_accounting_not_configured',
        mutate: (state) => {
          state.domains.warehouse.accountingByWarehouse = []
        },
      },
      {
        name: 'duplicate-accounting',
        error: 'pack_accounting_ambiguous',
        mutate: (state) => {
          state.domains.warehouse.accountingByWarehouse.push({
            ...state.domains.warehouse.accountingByWarehouse[0],
            id: 'pack-wh-duplicate',
          })
        },
      },
      {
        name: 'inactive-accounting',
        error: 'pack_accounting_inactive',
        mutate: (state) => {
          state.domains.warehouse.accountingByWarehouse[0].status = 'inactive'
        },
      },
    ]

    try {
      for (const testCase of cases) {
        const state = structuredClone(baseline)
        testCase.mutate(state)
        dcState.critical = {
          ...dcState.critical!,
          revision: baselineRevision,
          payloadJson: JSON.stringify(state),
        }
        const beforeJson = String(dcState.critical.payloadJson)
        const result = await confirmPackaging(g4, `pk-route-${testCase.name}`, {
          outputM2: 50,
          wipLines: canonical.wipLines,
          materialLines: [{ itemId: MATERIAL_ITEM, quantity: 5, unitSnapshot: 'pcs' }],
        })
        expect(result, testCase.name).toMatchObject({
          ok: false,
          error: testCase.error,
          status: 409,
        })
        expect(dcState.critical.revision, testCase.name).toBe(baselineRevision)
        expect(dcState.critical.payloadJson, testCase.name).toBe(beforeJson)
      }
    } finally {
      if (previousCloudEnv == null) delete process.env.FST_CLOUD_ENV
      else process.env.FST_CLOUD_ENV = previousCloudEnv
    }
  })

  it('canonical FG mapping rejects missing/inactive/non-area catalogue identities before CAS', async () => {
    const g4 = await bootstrap()
    const canonical = seedCanonicalPackagingFixtures()
    const baseline = payload()
    const baselineRevision = dcState.critical!.revision
    const cases: Array<{
      name: string
      error: string
      mutate: (state: ReturnType<typeof payload>) => void
    }> = [
      {
        name: 'order-item-missing',
        error: 'finished_goods_item_mapping_required',
        mutate: (state) => {
          delete state.domains.production.orders[0].warehouseItemId
        },
      },
      {
        name: 'catalogue-item-missing',
        error: 'finished_goods_item_unavailable',
        mutate: (state) => {
          state.domains.masterData.items = state.domains.masterData.items.filter(
            (item: { id: string }) => item.id !== FG_ITEM,
          )
        },
      },
      {
        name: 'catalogue-item-inactive',
        error: 'finished_goods_item_unavailable',
        mutate: (state) => {
          state.domains.masterData.items.find((item: { id: string }) => item.id === FG_ITEM).active =
            false
        },
      },
      {
        name: 'catalogue-item-unit',
        error: 'finished_goods_item_area_unit_required',
        mutate: (state) => {
          state.domains.masterData.items.find(
            (item: { id: string }) => item.id === FG_ITEM,
          ).baseUnit = 'pcs'
        },
      },
      {
        name: 'product-inactive',
        error: 'finished_product_unavailable',
        mutate: (state) => {
          state.domains.masterData.finishedProducts[0].active = false
        },
      },
    ]

    for (const testCase of cases) {
      const state = structuredClone(baseline)
      testCase.mutate(state)
      dcState.critical = {
        ...dcState.critical!,
        revision: baselineRevision,
        payloadJson: JSON.stringify(state),
      }
      const beforeJson = String(dcState.critical.payloadJson)
      const result = await confirmPackaging(g4, `pk-fg-map-${testCase.name}`, {
        outputM2: 50,
        wipLines: canonical.wipLines,
        materialLines: [{ itemId: MATERIAL_ITEM, quantity: 5, unitSnapshot: 'pcs' }],
      })
      expect(result, testCase.name).toMatchObject({
        ok: false,
        error: testCase.error,
        status: 409,
      })
      expect(dcState.critical.revision, testCase.name).toBe(baselineRevision)
      expect(dcState.critical.payloadJson, testCase.name).toBe(beforeJson)
    }
  })

  it('strict correction rejects every downstream lot transition before CAS', async () => {
    const g4 = await bootstrap()
    const confirmed = await confirmPackaging(g4, 'pk-before-downstream-correction')
    expect(confirmed.ok).toBe(true)
    const baseline = payload()
    const baselineRevision = dcState.critical!.revision
    const lotId = String(confirmed.finishedGoodsLotId)
    const reportId = String(confirmed.reportId)
    const previousCloudEnv = process.env.FST_CLOUD_ENV
    process.env.FST_CLOUD_ENV = 'staging'

    const cases: Array<{
      name: string
      mutate: (state: ReturnType<typeof payload>, lot: Record<string, unknown>) => void
    }> = [
      { name: 'in-review', mutate: (_state, lot) => { lot.qcStatus = 'in_review' } },
      {
        name: 'released',
        mutate: (_state, lot) => {
          lot.qcStatus = 'released'
          lot.currentDecisionId = 'decision-release'
          lot.quantityQcReleased = 100
        },
      },
      {
        name: 'regrade-child',
        mutate: (state, lot) => {
          lot.qcStatus = 'regrade_pending'
          state.domains.production.finishedGoodsLots.push({
            id: 'child-lot',
            parentLotId: lotId,
            qcStatus: 'pending',
          })
        },
      },
      { name: 'scrap-pending', mutate: (_state, lot) => { lot.qcStatus = 'scrap_pending' } },
      { name: 'written-off', mutate: (_state, lot) => { lot.qcStatus = 'written_off' } },
      {
        name: 'child-only',
        mutate: (state) => {
          state.domains.production.finishedGoodsLots.push({
            id: 'child-lot-pending',
            parentLotId: lotId,
            qcStatus: 'pending',
          })
        },
      },
      {
        name: 'shipment',
        mutate: (state) => {
          state.domains.warehouse.loadingShipments = [
            { id: 'shipment-downstream', finishedGoodsLotId: lotId, status: 'posted' },
          ]
        },
      },
    ]

    try {
      for (const testCase of cases) {
        const state = structuredClone(baseline)
        const lot = state.domains.production.finishedGoodsLots.find(
          (candidate: { id: string }) => candidate.id === lotId,
        )
        testCase.mutate(state, lot)
        dcState.critical = {
          ...dcState.critical!,
          revision: baselineRevision,
          payloadJson: JSON.stringify(state),
        }
        const beforeJson = String(dcState.critical.payloadJson)
        const result = await g4.executeG4Command({
          actor,
          storeId: STORE,
          idempotencyKey: `pk-correction-block-${testCase.name}`,
          commandType: 'packaging.report.confirmCorrection',
          command: {
            originalReportId: reportId,
            correctionReason: `blocked ${testCase.name}`,
            outputM2: 100,
          },
        })
        expect(result, testCase.name).toMatchObject({
          ok: false,
          error: 'packaging_correction_downstream_started',
          status: 409,
        })
        expect(dcState.critical.revision, testCase.name).toBe(baselineRevision)
        expect(dcState.critical.payloadJson, testCase.name).toBe(beforeJson)
      }
    } finally {
      if (previousCloudEnv == null) delete process.env.FST_CLOUD_ENV
      else process.env.FST_CLOUD_ENV = previousCloudEnv
    }
  })

  it('rejects correction output equal to shipped quantity before reversal and on replay', async () => {
    const g4 = await bootstrap()
    const confirmed = await confirmPackaging(g4, 'pk-before-zero-lot-correction')
    expect(confirmed.ok).toBe(true)
    const released = await releaseLot(g4, String(confirmed.finishedGoodsLotId), 'release-before-zero-lot')
    expect(released.ok).toBe(true)
    const shipment = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'ship-before-zero-lot-correction',
      commandType: 'shipment.post',
      command: {
        shipmentId: 'shipment-before-zero-lot-correction',
        finishedProductId: FINISHED_PRODUCT,
        finishedGoodsLotId: confirmed.finishedGoodsLotId,
        quantity: 40,
        date: REPORT_DATE,
      },
    })
    expect(shipment.ok).toBe(true)

    const command = {
      originalReportId: confirmed.reportId,
      correctionReason: 'would leave no replacement lot',
      outputM2: 40,
    }
    const beforeRevision = dcState.critical!.revision
    const beforeJson = String(dcState.critical!.payloadJson)
    const casCallsBefore = calls.updateCas.mock.calls.length
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await g4.executeG4Command({
        actor,
        storeId: STORE,
        idempotencyKey: 'reject-zero-lot-correction',
        commandType: 'packaging.report.confirmCorrection',
        command,
      })
      expect(result).toMatchObject({ ok: false, error: 'fg_below_shipped', status: 409 })
      expect(dcState.critical!.revision).toBe(beforeRevision)
      expect(dcState.critical!.payloadJson).toBe(beforeJson)
      expect(calls.updateCas.mock.calls).toHaveLength(casCallsBefore)
      expect(dcState.receipts.has('reject-zero-lot-correction')).toBe(false)
    }
  })

  it('packaging correction requires exactly one original report and lot', async () => {
    const g4 = await bootstrap()
    const confirmed = await confirmPackaging(g4, 'pk-before-lineage-correction')
    expect(confirmed.ok).toBe(true)
    const baseline = payload()
    const baselineRevision = dcState.critical!.revision
    const reportId = String(confirmed.reportId)
    const lotId = String(confirmed.finishedGoodsLotId)
    const cases: Array<{
      name: string
      error: string
      mutate: (state: ReturnType<typeof payload>) => void
    }> = [
      {
        name: 'duplicate-report',
        error: 'packaging_report_ambiguous',
        mutate: (state) => {
          const report = state.domains.production.packagingReports.find(
            (candidate: { id: string }) => candidate.id === reportId,
          )
          state.domains.production.packagingReports.push({ ...report })
        },
      },
      {
        name: 'missing-lot',
        error: 'packaging_correction_lot_missing',
        mutate: (state) => {
          state.domains.production.finishedGoodsLots = []
        },
      },
      {
        name: 'duplicate-lot',
        error: 'packaging_correction_lot_ambiguous',
        mutate: (state) => {
          const lot = state.domains.production.finishedGoodsLots.find(
            (candidate: { id: string }) => candidate.id === lotId,
          )
          state.domains.production.finishedGoodsLots.push({ ...lot })
        },
      },
    ]

    for (const testCase of cases) {
      const state = structuredClone(baseline)
      testCase.mutate(state)
      dcState.critical = {
        ...dcState.critical!,
        revision: baselineRevision,
        payloadJson: JSON.stringify(state),
      }
      const beforeJson = String(dcState.critical.payloadJson)
      const result = await g4.executeG4Command({
        actor,
        storeId: STORE,
        idempotencyKey: `pk-correction-lineage-${testCase.name}`,
        commandType: 'packaging.report.confirmCorrection',
        command: {
          originalReportId: reportId,
          correctionReason: `blocked ${testCase.name}`,
          outputM2: 100,
        },
      })
      expect(result, testCase.name).toMatchObject({
        ok: false,
        error: testCase.error,
        status: testCase.name === 'duplicate-report' ? 409 : 409,
      })
      expect(dcState.critical.revision, testCase.name).toBe(baselineRevision)
      expect(dcState.critical.payloadJson, testCase.name).toBe(beforeJson)
    }
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

  it('promotes only the matching draft ID and replays that exact confirmation', async () => {
    const g4 = await bootstrap()
    const reportId = 'draft-to-confirm'
    const draft = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'save-draft-to-confirm',
      commandType: 'packaging.report.draft.save',
      command: {
        reportId,
        productionOrderId: ORDER_ID,
        lineId: 'pack',
        reportDate: REPORT_DATE,
        outputM2: 100,
        outputRolls: 4,
        outputPallets: 0,
        wipLines: [{ lineId: 'draft-wip-line', semiFinishedItemId: WIP_ITEM, quantity: 50 }],
        materialLines: [{ lineId: 'draft-material-line', itemId: MATERIAL_ITEM, quantity: 5 }],
      },
    })
    expect(draft).toMatchObject({ ok: true, reportId, status: 'draft' })

    const confirmed = await confirmPackaging(g4, 'confirm-draft-to-confirm', {
      reportId,
      reportKey: 'draft-to-confirm-business-key',
      outputPallets: 0,
      wipLines: [{ lineId: 'draft-wip-line', semiFinishedItemId: WIP_ITEM, quantity: 50 }],
      materialLines: [{ lineId: 'draft-material-line', itemId: MATERIAL_ITEM, quantity: 5 }],
    })
    expect(confirmed).toMatchObject({ ok: true, reportId, status: 'confirmed' })
    const revision = dcState.critical!.revision
    const replay = await confirmPackaging(g4, 'confirm-draft-to-confirm', {
      reportId,
      reportKey: 'draft-to-confirm-business-key',
      outputPallets: 0,
      wipLines: [{ lineId: 'draft-wip-line', semiFinishedItemId: WIP_ITEM, quantity: 50 }],
      materialLines: [{ lineId: 'draft-material-line', itemId: MATERIAL_ITEM, quantity: 5 }],
    })
    expect(replay).toMatchObject({ ok: true, reportId, idempotent: true })
    expect(dcState.critical!.revision).toBe(revision)
  })

  it('rejects report-ID collisions and duplicate client line IDs before CAS', async () => {
    const g4 = await bootstrap()
    const first = await confirmPackaging(g4, 'confirm-existing-report-id', {
      reportId: 'claimed-report-id',
      reportKey: 'existing-report-business-key',
    })
    expect(first.ok).toBe(true)

    const collisionRevision = dcState.critical!.revision
    const collisionJson = String(dcState.critical!.payloadJson)
    const collisionCasCalls = calls.updateCas.mock.calls.length
    const collision = await confirmPackaging(g4, 'confirm-colliding-report-id', {
      reportId: 'claimed-report-id',
      reportKey: 'different-report-business-key',
    })
    expect(collision).toMatchObject({
      ok: false,
      error: 'packaging_report_id_conflict',
      status: 409,
    })
    expect(dcState.critical!.revision).toBe(collisionRevision)
    expect(dcState.critical!.payloadJson).toBe(collisionJson)
    expect(calls.updateCas.mock.calls).toHaveLength(collisionCasCalls)

    for (const [name, lines] of [
      [
        'wip',
        {
          wipLines: [
            { lineId: 'duplicate-line', semiFinishedItemId: WIP_ITEM, quantity: 20 },
            { lineId: 'duplicate-line', semiFinishedItemId: WIP_ITEM, quantity: 20 },
          ],
        },
      ],
      [
        'material',
        {
          materialLines: [
            { lineId: 'duplicate-line', itemId: MATERIAL_ITEM, quantity: 2 },
            { lineId: 'duplicate-line', itemId: MATERIAL_ITEM, quantity: 2 },
          ],
        },
      ],
    ] as const) {
      const revision = dcState.critical!.revision
      const json = String(dcState.critical!.payloadJson)
      const casCalls = calls.updateCas.mock.calls.length
      const duplicate = await confirmPackaging(g4, `confirm-duplicate-${name}`, {
        reportKey: `duplicate-${name}`,
        ...lines,
      })
      expect(duplicate).toMatchObject({ ok: false, error: 'duplicate_line_id', status: 400 })
      expect(dcState.critical!.revision).toBe(revision)
      expect(dcState.critical!.payloadJson).toBe(json)
      expect(calls.updateCas.mock.calls).toHaveLength(casCalls)
    }
  })

  it('rejects a draft ID whose order lineage does not match the confirm', async () => {
    const g4 = await bootstrap()
    const draft = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'save-lineage-draft',
      commandType: 'packaging.report.draft.save',
      command: {
        reportId: 'lineage-draft',
        productionOrderId: ORDER_ID,
        lineId: 'pack',
      },
    })
    expect(draft.ok).toBe(true)
    const revision = dcState.critical!.revision
    const json = String(dcState.critical!.payloadJson)
    const casCalls = calls.updateCas.mock.calls.length
    const mismatch = await confirmPackaging(g4, 'confirm-wrong-draft-lineage', {
      reportId: 'lineage-draft',
      reportKey: 'wrong-draft-lineage',
      productionOrderId: 'another-order',
    })
    expect(mismatch).toMatchObject({
      ok: false,
      error: 'packaging_report_id_conflict',
      status: 409,
    })
    expect(dcState.critical!.revision).toBe(revision)
    expect(dcState.critical!.payloadJson).toBe(json)
    expect(calls.updateCas.mock.calls).toHaveLength(casCalls)
  })

  it('replays a semantically identical command whose object keys are reordered', async () => {
    const g4 = await bootstrap()
    const first = await confirmPackaging(g4, 'pk-semantic-key-order')
    expect(first.ok).toBe(true)
    const revisionAfterFirst = dcState.critical!.revision
    const replay = await g4.executeG4Command({
      command: {
        materialLines: [{ quantity: 5, itemId: MATERIAL_ITEM }],
        wipLines: [{ quantity: 50, semiFinishedItemId: WIP_ITEM }],
        outputRolls: 4,
        outputM2: 100,
        warehouseItemId: FG_ITEM,
        finishedProductId: FINISHED_PRODUCT,
        shiftSlot: 'day',
        reportDate: REPORT_DATE,
        lineId: 'pack',
        productionOrderId: ORDER_ID,
      },
      commandType: 'packaging.report.confirm',
      idempotencyKey: 'pk-semantic-key-order',
      storeId: STORE,
      actor,
    })
    expect(replay.ok).toBe(true)
    expect(replay.idempotent).toBe(true)
    expect(dcState.critical!.revision).toBe(revisionAfterFirst)
    expect(payload().domains.production.finishedGoodsLots).toHaveLength(1)
  })

  it('same transport key with a different full packaging payload is a 409 conflict', async () => {
    const g4 = await bootstrap()
    const first = await confirmPackaging(g4, 'pk-payload-bound')
    expect(first.ok).toBe(true)
    const revisionAfterFirst = dcState.critical!.revision

    const conflict = await confirmPackaging(g4, 'pk-payload-bound', { outputRolls: 99 })
    expect(conflict).toMatchObject({
      ok: false,
      error: 'packaging_idempotency_conflict',
      status: 409,
    })
    expect(dcState.critical!.revision).toBe(revisionAfterFirst)
    expect(payload().domains.production.finishedGoodsLots).toHaveLength(1)
  })

  it('canonical replay reloads embedded critical truth instead of returning the SQL receipt snapshot', async () => {
    const g4 = await bootstrap()
    const canonical = seedCanonicalPackagingFixtures()
    const overrides = {
      reportKey: 'pk-canonical-current-replay',
      outputM2: 50,
      wipLines: canonical.wipLines,
      materialLines: [{ itemId: MATERIAL_ITEM, quantity: 5, unitSnapshot: 'pcs' }],
    }
    const first = await confirmPackaging(g4, 'pk-canonical-current-replay', overrides)
    expect(first.ok).toBe(true)
    const revisionAfterFirst = dcState.critical!.revision

    const projected = dcState.receipts.get('pk-canonical-current-replay')!
    const poisonedResult = JSON.parse(String(projected.resultJson))
    poisonedResult.reportId = 'soft-only-wrong-report'
    projected.resultJson = JSON.stringify(poisonedResult)

    const replay = await confirmPackaging(g4, 'pk-canonical-current-replay', overrides)
    expect(replay).toMatchObject({
      ok: true,
      idempotent: true,
      reportId: first.reportId,
      finishedGoodsLotId: first.finishedGoodsLotId,
      criticalRevision: revisionAfterFirst,
      productionActive: true,
      packagingQcActive: true,
    })
    expect(replay.reportId).not.toBe('soft-only-wrong-report')
    expect(dcState.critical!.revision).toBe(revisionAfterFirst)
  })

  it('strict staging rejects a pre-R3.1C SQL-only receipt without mutating critical state', async () => {
    const g4 = await bootstrap()
    vi.stubEnv('FST_CLOUD_ENV', 'staging')
    dcState.receipts.set('pk-soft-receipt-only', {
      id: 'pk-soft-receipt-only',
      storeId: STORE,
      commandType: 'packaging.report.confirm',
      resultJson: JSON.stringify({
        reportId: 'soft-report',
        finishedGoodsLotId: 'soft-lot',
        status: 'confirmed',
        criticalRevision: dcState.critical!.revision,
      }),
      criticalRevisionAfter: dcState.critical!.revision,
    })
    const beforeRevision = dcState.critical!.revision
    const beforeJson = String(dcState.critical!.payloadJson)
    const casCallsBefore = calls.updateCas.mock.calls.length

    const rejected = await confirmPackaging(g4, 'pk-soft-receipt-only')
    expect(rejected).toMatchObject({
      ok: false,
      error: 'packaging_idempotency_conflict',
      status: 409,
    })
    expect(dcState.critical!.revision).toBe(beforeRevision)
    expect(dcState.critical!.payloadJson).toBe(beforeJson)
    expect(calls.updateCas.mock.calls).toHaveLength(casCallsBefore)
  })

  it('same business report key cannot be reused with a different payload', async () => {
    const g4 = await bootstrap()
    const first = await confirmPackaging(g4, 'pk-business-transport-1', {
      reportKey: 'pk-business-key',
    })
    expect(first.ok).toBe(true)
    const revisionAfterFirst = dcState.critical!.revision

    const conflict = await confirmPackaging(g4, 'pk-business-transport-2', {
      reportKey: 'pk-business-key',
      outputRolls: 99,
    })
    expect(conflict).toMatchObject({
      ok: false,
      error: 'packaging_idempotency_conflict',
      status: 409,
    })
    expect(dcState.critical!.revision).toBe(revisionAfterFirst)
    expect(payload().domains.production.packagingReports).toHaveLength(1)
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

    // Same key replays the embedded receipt; a changed semantic payload conflicts.
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
    expect(replayNewKey.ok).toBe(false)
    expect(replayNewKey.error).toBe('g4_idempotency_conflict')
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

describe('R3.1C critical G4 acknowledgement contract', () => {
  it('accepts exact review/release ACKs and rejects a forged lot projection', async () => {
    const g4 = await bootstrap()
    const confirmed = await confirmPackaging(g4, 'ack-qc-package')
    const lotId = String(confirmed.finishedGoodsLotId)

    const reviewCommand = { finishedGoodsLotId: lotId, reason: 'inspection opened' }
    const reviewRevision = Number(dcState.critical!.revision)
    const reviewed = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'ack-qc-review',
      commandType: 'qc.review.start',
      command: reviewCommand,
    })
    const reviewAck = validateG4CriticalMutationAck({
      ack: reviewed,
      commandType: 'qc.review.start',
      command: reviewCommand,
      previousCriticalRevision: reviewRevision,
    })
    expect(reviewAck.ok).toBe(true)

    attachVerified(lotId, 'passport')
    attachVerified(lotId, 'protocol')
    const releaseCommand = { finishedGoodsLotId: lotId, reason: 'lab ok' }
    const releaseRevision = Number(dcState.critical!.revision)
    const released = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'ack-qc-release',
      commandType: 'qc.release',
      command: releaseCommand,
    })
    const releaseAck = validateG4CriticalMutationAck({
      ack: released,
      commandType: 'qc.release',
      command: releaseCommand,
      previousCriticalRevision: releaseRevision,
    })
    expect(releaseAck.ok).toBe(true)

    const forged = structuredClone(released)
    forged.production.finishedGoodsLots[0].qcStatus = 'pending'
    expect(
      validateG4CriticalMutationAck({
        ack: forged,
        commandType: 'qc.release',
        command: releaseCommand,
        previousCriticalRevision: releaseRevision,
      }).ok,
    ).toBe(false)
  })

  it('accepts exact regrade/reject/writeoff ledger graphs', async () => {
    const g4 = await bootstrap()
    const regradeConfirmed = await confirmPackaging(g4, 'ack-regrade-package')
    const regradeCommand = {
      finishedGoodsLotId: String(regradeConfirmed.finishedGoodsLotId),
      reason: 'grade B',
      targetFinishedProductId: 'fp-2',
      targetWarehouseItemId: 'fg-item-b',
      date: REPORT_DATE,
    }
    const regradeRevision = Number(dcState.critical!.revision)
    const regraded = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'ack-regrade',
      commandType: 'qc.regrade',
      command: regradeCommand,
    })
    expect(
      validateG4CriticalMutationAck({
        ack: regraded,
        commandType: 'qc.regrade',
        command: regradeCommand,
        previousCriticalRevision: regradeRevision,
      }).ok,
    ).toBe(true)

    const rejectConfirmed = await confirmPackaging(g4, 'ack-reject-package', {
      reportKey: 'ack-reject-package',
    })
    const rejectCommand = {
      finishedGoodsLotId: String(rejectConfirmed.finishedGoodsLotId),
      reason: 'delamination',
      date: REPORT_DATE,
    }
    const rejectRevision = Number(dcState.critical!.revision)
    const rejected = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'ack-reject',
      commandType: 'qc.reject',
      command: rejectCommand,
    })
    expect(
      validateG4CriticalMutationAck({
        ack: rejected,
        commandType: 'qc.reject',
        command: rejectCommand,
        previousCriticalRevision: rejectRevision,
      }).ok,
    ).toBe(true)

    const writeoffCommand = {
      finishedGoodsLotId: String(rejectConfirmed.finishedGoodsLotId),
      reason: 'unsalvageable',
      date: REPORT_DATE,
    }
    const writeoffRevision = Number(dcState.critical!.revision)
    const writtenOff = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'ack-writeoff',
      commandType: 'qc.scrap.writeoff',
      command: writeoffCommand,
    })
    expect(
      validateG4CriticalMutationAck({
        ack: writtenOff,
        commandType: 'qc.scrap.writeoff',
        command: writeoffCommand,
        previousCriticalRevision: writeoffRevision,
      }).ok,
    ).toBe(true)
  })

  it('accepts exact legacy shipment post/cancel and rejects stale replay state', async () => {
    const g4 = await bootstrap()
    const confirmed = await confirmPackaging(g4, 'ack-ship-package')
    const lotId = String(confirmed.finishedGoodsLotId)
    await releaseLot(g4, lotId, 'ack-ship-release')

    const postCommand = {
      shipmentId: 'ack-shipment',
      finishedProductId: FINISHED_PRODUCT,
      finishedGoodsLotId: lotId,
      quantity: 15,
      warehouseId: PACK_WH,
      date: REPORT_DATE,
    }
    const postRevision = Number(dcState.critical!.revision)
    const posted = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'ack-ship-post',
      commandType: 'shipment.post',
      command: postCommand,
    })
    expect(
      validateG4CriticalMutationAck({
        ack: posted,
        commandType: 'shipment.post',
        command: postCommand,
        previousCriticalRevision: postRevision,
      }).ok,
    ).toBe(true)

    const malformedCases: Array<{
      name: string
      mutate: (ack: Record<string, unknown>) => void
    }> = []
    for (const [domain, key] of [
      ['production', 'packagingReports'],
      ['production', 'finishedGoodsLots'],
      ['production', 'qcDecisions'],
      ['warehouse', 'documents'],
      ['warehouse', 'movements'],
      ['warehouse', 'loadingShipments'],
    ] as const) {
      malformedCases.push(
        {
          name: `${domain}.${key}=null`,
          mutate: (ack) => {
            ;(ack[domain] as Record<string, unknown>)[key] = null
          },
        },
        {
          name: `${domain}.${key}=string`,
          mutate: (ack) => {
            ;(ack[domain] as Record<string, unknown>)[key] = 'malformed'
          },
        },
        {
          name: `${domain}.${key}=array-row`,
          mutate: (ack) => {
            const owner = ack[domain] as Record<string, unknown>
            owner[key] = [...(owner[key] as unknown[]), []]
          },
        },
      )
    }
    for (const testCase of malformedCases) {
      const malformed = structuredClone(posted) as Record<string, unknown>
      testCase.mutate(malformed)
      let mirrorCalls = 0
      const validation = validateG4CriticalMutationAck({
        ack: malformed,
        commandType: 'shipment.post',
        command: postCommand,
        previousCriticalRevision: postRevision,
      })
      if (validation.ok) mirrorCalls += 1
      expect(validation, testCase.name).toMatchObject({
        ok: false,
        reason: 'authoritative_shape_invalid',
      })
      expect(mirrorCalls, testCase.name).toBe(0)
    }

    for (const malformedLines of [null, 'malformed', [[]]]) {
      const malformed = structuredClone(posted) as Record<string, unknown>
      const warehouse = malformed.warehouse as Record<string, unknown>
      const relatedDocument = (warehouse.documents as Record<string, unknown>[]).find(
        (document) => document.id === posted.documentId,
      )!
      relatedDocument.lines = malformedLines
      expect(
        validateG4CriticalMutationAck({
          ack: malformed,
          commandType: 'shipment.post',
          command: postCommand,
          previousCriticalRevision: postRevision,
        }),
      ).toMatchObject({ ok: false })
    }

    const cancelCommand = {
      shipmentId: 'ack-shipment',
      reason: 'carrier refused',
      date: REPORT_DATE,
    }
    const cancelRevision = Number(dcState.critical!.revision)
    const cancelled = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'ack-ship-cancel',
      commandType: 'shipment.cancel',
      command: cancelCommand,
    })
    expect(
      validateG4CriticalMutationAck({
        ack: cancelled,
        commandType: 'shipment.cancel',
        command: cancelCommand,
        previousCriticalRevision: cancelRevision,
      }).ok,
    ).toBe(true)

    const critical = payload()
    critical.domains.warehouse.loadingShipments[0].cancelCommandFingerprint = 'tampered'
    dcState.critical!.payloadJson = JSON.stringify(critical)
    const replay = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'ack-ship-cancel',
      commandType: 'shipment.cancel',
      command: cancelCommand,
    })
    expect(replay.ok).toBe(false)
    expect(replay.error).toBe('g4_idempotency_state_mismatch')
  })
})

// ---------------------------------------------------------------------------
// Feature activation
// ---------------------------------------------------------------------------

describe('G4 feature activation', () => {
  it('packaging.domain.activate requires an active production domain', async () => {
    grant(ALL_CAPS)
    const g4 = await import('../server/fst/_g4PackagingService.mjs')
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
    expect(dcState.critical).toBeNull()
    expect(calls.upsertCritical).not.toHaveBeenCalled()

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

  it('missing critical store stays absent for reads and rejected non-activation writes', async () => {
    grant(ALL_CAPS)
    const g4 = await import('../server/fst/_g4PackagingService.mjs')

    const read = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'g4-read-missing-critical',
      commandType: 'packaging.read',
      command: {},
    })
    expect(read).toMatchObject({
      ok: true,
      criticalRevision: 0,
      productionActive: false,
      packagingQcActive: false,
      source: 'critical_store_missing',
    })

    dcState.receipts.set('g4-confirm-missing-critical', {
      id: 'g4-confirm-missing-critical',
      storeId: STORE,
      commandType: 'packaging.report.confirm',
      resultJson: JSON.stringify({
        reportId: 'soft-report-without-store',
        finishedGoodsLotId: 'soft-lot-without-store',
        status: 'confirmed',
      }),
      criticalRevisionAfter: 7,
    })
    const rejected = await confirmPackaging(g4, 'g4-confirm-missing-critical')
    expect(rejected).toMatchObject({
      ok: false,
      error: 'critical_store_missing',
      status: 409,
    })
    expect(dcState.critical).toBeNull()
    expect(calls.upsertCritical).not.toHaveBeenCalled()
    expect(calls.updateCas).not.toHaveBeenCalled()
  })

  it('production active + packagingQc inactive → confirm blocked, read still works', async () => {
    grant(ALL_CAPS)
    await activateProduction()
    seedCriticalFixtures()
    const g4 = await import('../server/fst/_g4PackagingService.mjs')

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

// ---------------------------------------------------------------------------
// R2.9K — UI-contract extras (CAS fail, reject blocks release, lot links)
// ---------------------------------------------------------------------------

describe('R2.9K packaging/shipment UI contract extras', () => {
  it('FG lot links to packaging report, order and batch; material issue once', async () => {
    const g4 = await bootstrap()
    const confirmed = await confirmPackaging(g4, 'r29k-link', {
      batchNo: 'ЗМ-20260907-001',
    })
    expect(confirmed.ok).toBe(true)
    const p = payload()
    const lot = p.domains.production.finishedGoodsLots[0]
    expect(lot.packagingReportId).toBeTruthy()
    expect(lot.productionOrderId).toBe(ORDER_ID)
    // Batch/traceability field name varies (batchNo vs lotNumber); require a non-empty lot identity.
    expect(String(lot.lotNumber ?? lot.batchNo ?? confirmed.lotNumber ?? '')).toBeTruthy()
    const materialIssues = (p.domains.warehouse.movements ?? []).filter(
      (m: { itemId?: string; type?: string; cancelled?: boolean }) =>
        m.itemId === MATERIAL_ITEM && (m.type === 'issue' || m.type === 'out') && !m.cancelled,
    )
    expect(materialIssues.length).toBe(1)
    const replay = await confirmPackaging(g4, 'r29k-link', { batchNo: 'ЗМ-20260907-001' })
    expect(replay.idempotent).toBe(true)
    expect(payload().domains.warehouse.movements.filter(
      (m: { itemId?: string; type?: string; cancelled?: boolean }) =>
        m.itemId === MATERIAL_ITEM && (m.type === 'issue' || m.type === 'out') && !m.cancelled,
    ).length).toBe(1)
  })

  it('rejected QC cannot later release the same lot', async () => {
    const g4 = await bootstrap()
    const confirmed = await confirmPackaging(g4, 'r29k-rej')
    const rejected = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'r29k-reject',
      commandType: 'qc.reject',
      command: {
        finishedGoodsLotId: confirmed.finishedGoodsLotId,
        reason: 'edu soft reject',
        date: REPORT_DATE,
      },
    })
    expect(rejected.ok).toBe(true)
    attachVerified(String(confirmed.finishedGoodsLotId), 'passport')
    attachVerified(String(confirmed.finishedGoodsLotId), 'protocol')
    const release = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'r29k-release-after-reject',
      commandType: 'qc.release',
      command: { finishedGoodsLotId: confirmed.finishedGoodsLotId, reason: 'should fail' },
    })
    expect(release.ok).toBe(false)
    expect(payload().domains.production.finishedGoodsLots[0].qcStatus).not.toBe('released')
  })

  it('failed shipment CAS leaves no posted loading shipment', async () => {
    const g4 = await bootstrap()
    const confirmed = await confirmPackaging(g4, 'r29k-cas')
    await releaseLot(g4, String(confirmed.finishedGoodsLotId), 'r29k-cas-release')
    const revBefore = dcState.critical!.revision as number
    const shipsBefore = payload().domains.warehouse.loadingShipments.length
    calls.updateCas.mockImplementationOnce(async () => {
      throw new Error('revision_conflict')
    })
    const failed = await g4.executeG4Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'r29k-ship-cas-fail',
      commandType: 'shipment.post',
      command: {
        shipmentId: 'shp-cas-fail',
        finishedProductId: FINISHED_PRODUCT,
        finishedGoodsLotId: confirmed.finishedGoodsLotId,
        quantity: 10,
        date: REPORT_DATE,
      },
    })
    expect(failed.ok).toBe(false)
    expect(dcState.critical!.revision).toBe(revBefore)
    expect(payload().domains.warehouse.loadingShipments.length).toBe(shipsBefore)
  })
})
