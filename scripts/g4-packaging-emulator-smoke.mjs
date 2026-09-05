/**
 * PHASE G4 smoke — WIP → pack confirm → pending lot → attachment verify → QC release
 * → partial shipment → shipment cancel.
 *
 * Default mode is IN-PROCESS: `_g1DataConnect`, `_qcDataConnect`, `_qcStorage` and
 * `_adminAuth` are replaced through `module.registerHooks`, so nothing leaves the
 * process and the script is safe to run anywhere.
 *
 * If DATA_CONNECT_EMULATOR_HOST (or FIREBASE_DATA_CONNECT_EMULATOR_HOST) points at a
 * reachable local emulator, the real `api/fst` modules run against it with the demo
 * project. Production credentials are removed in both modes; nothing is deployed.
 *
 * Usage:
 *   node scripts/g4-packaging-emulator-smoke.mjs
 *   DATA_CONNECT_EMULATOR_HOST=127.0.0.1:9399 node scripts/g4-packaging-emulator-smoke.mjs
 */
import net from 'node:net'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const apiDir = path.join(repoRoot, 'server', 'fst')

const STORE_ID = 'fibercell-main'
const PROJECT = 'demo-otgruzka'
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

const actor = { uid: 'g4-user', email: 'g4@example.com', claims: {} }

const CAPABILITIES = {
  'warehouse.read': true,
  'warehouse.document.post': true,
  'production.order.confirm': true,
  'production.read': true,
  'packaging.read': true,
  'packaging.report.edit': true,
  'packaging.report.confirm': true,
  'packaging.report.correct': true,
  'qc.review': true,
  'qc.release': true,
  'qc.regrade': true,
  'qc.reject': true,
  'qc.scrap.writeoff': true,
  'shipment.draft.edit': true,
  'shipment.post': true,
  'shipment.cancel': true,
  productionLineIds: ['*'],
}

function log(msg) {
  process.stdout.write(`[g4-smoke] ${msg}\n`)
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg)
}

// ---------------------------------------------------------------------------
// In-process stubs
// ---------------------------------------------------------------------------

const memory = {
  principals: new Map(),
  critical: null,
  receipts: new Map(),
  attachments: [],
  qcDecisions: [],
  qcLots: new Map(),
  storageObjects: new Map(),
}

function sanitizeIdSegment(value, fallback) {
  const safe = String(value ?? '')
    .replace(/[^a-zA-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return safe || fallback
}

function buildQcStoragePath(storeId, lotId, attachmentId) {
  return `fstFiles/${sanitizeIdSegment(storeId, 'store')}/qc-lots/${sanitizeIdSegment(
    lotId,
    'lot',
  )}/${sanitizeIdSegment(attachmentId, 'attachment')}/blob`
}

globalThis.__g4Smoke = {
  memory,
  buildQcStoragePath,
  g1: {
    getG1DataConnect: () => ({ inProcess: true }),
    async getFstPrincipalAccessByUidStore(_dc, vars) {
      const row = memory.principals.get(`${vars.storeId}::${vars.firebaseUid}`)
      return { data: { fstPrincipalAccesses: row ? [row] : [] } }
    },
    async getFstCriticalStore() {
      return { data: { fstCriticalStore: memory.critical } }
    },
    async getFstCommandReceipt(_dc, vars) {
      return { data: { fstCommandReceipt: memory.receipts.get(vars.id) ?? null } }
    },
    async upsertFstCriticalStore(_dc, row) {
      memory.critical = { ...row }
    },
    async updateFstCriticalStoreCas(_dc, vars) {
      if (!memory.critical) throw new Error('missing')
      if (memory.critical.revision !== vars.expectedRevision) throw new Error('revision_conflict')
      memory.critical = {
        ...memory.critical,
        revision: vars.revision,
        payloadJson: vars.payloadJson,
        fingerprint: vars.fingerprint,
        updatedByUid: vars.updatedByUid,
      }
    },
    async insertFstCommandReceipt(_dc, row) {
      if (memory.receipts.has(String(row.id))) throw new Error('duplicate_receipt')
      memory.receipts.set(String(row.id), row)
    },
    async upsertFstPrincipalAccess(_dc, row) {
      memory.principals.set(String(row.id), row)
    },
  },
  qcDataConnect: {
    getQcDataConnect: () => ({ inProcess: true }),
    async listVerifiedLotAttachments(_dc, vars) {
      return {
        data: {
          qcAttachmentRecords: memory.attachments.filter(
            (row) => row.storeId === vars.storeId && row.lotId === vars.lotId,
          ),
        },
      }
    },
    async insertQcLotDecision(_dc, row) {
      memory.qcDecisions.push(row)
      return { data: {} }
    },
    async upsertQcFinishedGoodsLot(_dc, row) {
      memory.qcLots.set(String(row.id), row)
      return { data: {} }
    },
  },
  qcStorage: {
    buildQcStoragePath,
    async verifyStorageObject({ storagePath }) {
      const object = memory.storageObjects.get(storagePath)
      if (!object) return { ok: false, error: 'not_found' }
      return { ok: true, generation: object.generation }
    },
  },
  adminAuth: {
    FST_ADMIN_EMAILS: new Set(['admin@fibercell.net']),
    initFirebaseAdmin: () => {},
  },
}

function stubSource(namespace, names) {
  const ref = `globalThis.__g4Smoke[${JSON.stringify(namespace)}]`
  return names.map((name) => `export const ${name} = ${ref}[${JSON.stringify(name)}];`).join('\n')
}

const STUBS = new Map([
  [
    '_g1DataConnect.mjs',
    stubSource('g1', [
      'getG1DataConnect',
      'getFstPrincipalAccessByUidStore',
      'getFstCriticalStore',
      'getFstCommandReceipt',
      'upsertFstCriticalStore',
      'updateFstCriticalStoreCas',
      'insertFstCommandReceipt',
      'upsertFstPrincipalAccess',
    ]),
  ],
  [
    '_qcDataConnect.mjs',
    stubSource('qcDataConnect', [
      'getQcDataConnect',
      'listVerifiedLotAttachments',
      'insertQcLotDecision',
      'upsertQcFinishedGoodsLot',
    ]),
  ],
  ['_qcStorage.mjs', stubSource('qcStorage', ['buildQcStoragePath', 'verifyStorageObject'])],
  ['_adminAuth.mjs', stubSource('adminAuth', ['FST_ADMIN_EMAILS', 'initFirebaseAdmin'])],
])

function installInProcessStubs() {
  registerHooks({
    load(url, context, nextLoad) {
      for (const [file, source] of STUBS) {
        if (url.endsWith(`/server/fst/${file}`)) {
          return { format: 'module', shortCircuit: true, source }
        }
      }
      return nextLoad(url, context)
    },
  })
}

// ---------------------------------------------------------------------------
// Emulator detection
// ---------------------------------------------------------------------------

function emulatorTarget() {
  const host = String(
    process.env.DATA_CONNECT_EMULATOR_HOST ?? process.env.FIREBASE_DATA_CONNECT_EMULATOR_HOST ?? '',
  ).trim()
  if (!host) return null
  const [hostname, port] = host.split(':')
  if (!hostname || !Number(port)) return null
  return { hostname, port: Number(port) }
}

async function portOpen(hostname, port, ms = 2000) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    const ok = await new Promise((resolve) => {
      const socket = net.connect({ host: hostname, port }, () => {
        socket.end()
        resolve(true)
      })
      socket.on('error', () => resolve(false))
    })
    if (ok) return true
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

function importApi(file) {
  return import(pathToFileURL(path.join(apiDir, file)).href)
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function applyFixtures(payload) {
  payload.domains.warehouse.locations = [
    { id: PACK_WH },
    { id: PACK_LOC },
    { id: FG_LOC },
    { id: SCRAP_LOC },
  ]
  payload.domains.warehouse.scrapLocationId = SCRAP_LOC
  payload.domains.warehouse.productionLineBindings = [
    {
      id: 'pack',
      lineId: 'pack',
      packagingWarehouseId: PACK_WH,
      packagingLocationId: PACK_LOC,
      finishedGoodsWarehouseId: PACK_WH,
      finishedGoodsLocationId: FG_LOC,
    },
  ]
  payload.domains.warehouse.movements = [
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
  payload.domains.production.orders = [
    {
      id: ORDER_ID,
      status: 'active',
      finishedProductId: FINISHED_PRODUCT,
      lineId: 'line-a',
      totalQtyMp: 500,
    },
  ]
  return payload
}

// ---------------------------------------------------------------------------
// Flow (identical for both modes; only the adapters differ)
// ---------------------------------------------------------------------------

async function runFlow({ g3, g4, grantAccess, seedFixtures, attachVerified }) {
  await grantAccess()
  log('OK principal capabilities granted')

  const activateProduction = await g3.executeG3Command({
    actor,
    storeId: STORE_ID,
    idempotencyKey: 'g4-smoke-activate-production',
    commandType: 'production.domain.activate',
    command: { reason: 'g4 smoke bootstrap' },
  })
  assert(activateProduction.ok, `production activate: ${activateProduction.error}`)
  log('OK production domain active')

  await seedFixtures()
  log('OK seeded WIP + packaging materials + pack line binding')

  const activatePackaging = await g4.executeG4Command({
    actor,
    storeId: STORE_ID,
    idempotencyKey: 'g4-smoke-activate-packaging',
    commandType: 'packaging.domain.activate',
    command: { reason: 'g4 smoke bootstrap' },
  })
  assert(activatePackaging.ok, `packaging activate: ${activatePackaging.error}`)
  log('OK packagingQc feature active')

  const confirmed = await g4.executeG4Command({
    actor,
    storeId: STORE_ID,
    idempotencyKey: 'g4-smoke-confirm',
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
      // Server-owned fields: must be stripped, the lot still opens as pending.
      qcStatus: 'released',
      availableForShipment: true,
    },
  })
  assert(confirmed.ok, `packaging confirm: ${confirmed.error}`)
  assert(confirmed.qcStatus === 'pending', `expected pending lot, got ${confirmed.qcStatus}`)
  log(`OK packaging confirm lot=${confirmed.lotNumber} qty=${confirmed.quantityProduced} status=pending`)

  const shipTooEarly = await g4.executeG4Command({
    actor,
    storeId: STORE_ID,
    idempotencyKey: 'g4-smoke-ship-early',
    commandType: 'shipment.post',
    command: {
      finishedProductId: FINISHED_PRODUCT,
      finishedGoodsLotId: confirmed.finishedGoodsLotId,
      quantity: 10,
      date: REPORT_DATE,
    },
  })
  assert(
    !shipTooEarly.ok && shipTooEarly.error === 'lot_not_released',
    `pending lot must not ship (got ${shipTooEarly.error})`,
  )
  log('OK pending lot refused by the shipment gate')

  const releaseNoDocs = await g4.executeG4Command({
    actor,
    storeId: STORE_ID,
    idempotencyKey: 'g4-smoke-release-no-docs',
    commandType: 'qc.release',
    command: { finishedGoodsLotId: confirmed.finishedGoodsLotId },
  })
  assert(
    !releaseNoDocs.ok && releaseNoDocs.error === 'qc_attachments_required',
    `release without attachments must fail (got ${releaseNoDocs.error})`,
  )
  log('OK release without passport/protocol refused')

  await attachVerified(confirmed.finishedGoodsLotId, 'passport')
  await attachVerified(confirmed.finishedGoodsLotId, 'protocol')

  const released = await g4.executeG4Command({
    actor,
    storeId: STORE_ID,
    idempotencyKey: 'g4-smoke-release',
    commandType: 'qc.release',
    command: { finishedGoodsLotId: confirmed.finishedGoodsLotId, reason: 'lab ok' },
  })
  assert(released.ok, `qc release: ${released.error}`)
  assert(released.qcStatus === 'released', `expected released, got ${released.qcStatus}`)
  log(`OK qc release decision=${released.decisionId} released=${released.quantityQcReleased}`)

  const shipped = await g4.executeG4Command({
    actor,
    storeId: STORE_ID,
    idempotencyKey: 'g4-smoke-ship',
    commandType: 'shipment.post',
    command: {
      shipmentId: 'shp-1',
      finishedProductId: FINISHED_PRODUCT,
      finishedGoodsLotId: confirmed.finishedGoodsLotId,
      quantity: 40,
      date: REPORT_DATE,
    },
  })
  assert(shipped.ok, `shipment post: ${shipped.error}`)
  assert(shipped.quantityRemaining === 60, `expected remaining 60, got ${shipped.quantityRemaining}`)
  log(`OK partial shipment shipped=${shipped.quantityShipped} remaining=${shipped.quantityRemaining}`)

  const overship = await g4.executeG4Command({
    actor,
    storeId: STORE_ID,
    idempotencyKey: 'g4-smoke-overship',
    commandType: 'shipment.post',
    command: {
      shipmentId: 'shp-2',
      finishedProductId: FINISHED_PRODUCT,
      finishedGoodsLotId: confirmed.finishedGoodsLotId,
      quantity: 70,
      date: REPORT_DATE,
    },
  })
  assert(
    !overship.ok && overship.error === 'quantity_exceeds_remaining',
    `overshipping must be refused (got ${overship.error})`,
  )
  log('OK overshipping refused')

  const cancelled = await g4.executeG4Command({
    actor,
    storeId: STORE_ID,
    idempotencyKey: 'g4-smoke-cancel',
    commandType: 'shipment.cancel',
    command: { shipmentId: 'shp-1', reason: 'smoke rollback', date: REPORT_DATE },
  })
  assert(cancelled.ok, `shipment cancel: ${cancelled.error}`)
  assert(cancelled.quantityShipped === 0, `expected shipped 0, got ${cancelled.quantityShipped}`)
  log(`OK shipment cancel reversals=${(cancelled.reversalDocumentIds ?? []).length}`)

  const cancelAgain = await g4.executeG4Command({
    actor,
    storeId: STORE_ID,
    idempotencyKey: 'g4-smoke-cancel-2',
    commandType: 'shipment.cancel',
    command: { shipmentId: 'shp-1', reason: 'smoke rollback again', date: REPORT_DATE },
  })
  assert(cancelAgain.ok && cancelAgain.idempotent === true, 'cancel replay must be idempotent')
  log('OK shipment cancel is idempotent')
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

async function runInProcess() {
  installInProcessStubs()
  const g3 = await importApi('_g3ProductionService.mjs')
  const g4 = await importApi('_g4PackagingService.mjs')

  await runFlow({
    g3,
    g4,
    grantAccess: async () => {
      const id = `${STORE_ID}::${actor.uid}`
      memory.principals.set(id, {
        id,
        firebaseUid: actor.uid,
        storeId: STORE_ID,
        roleId: 'packaging',
        capabilitiesJson: JSON.stringify(CAPABILITIES),
        active: true,
        revision: 1,
        createdByUid: 'sys',
        updatedByUid: 'sys',
      })
    },
    seedFixtures: async () => {
      const payload = applyFixtures(JSON.parse(String(memory.critical.payloadJson)))
      memory.critical.payloadJson = JSON.stringify(payload)
    },
    attachVerified: async (lotId, documentKind) => {
      const id = `att-${documentKind}-${memory.attachments.length + 1}`
      const storagePath = buildQcStoragePath(STORE_ID, lotId, id)
      memory.storageObjects.set(storagePath, { generation: '5' })
      memory.attachments.push({
        id,
        storeId: STORE_ID,
        lotId,
        documentKind,
        storagePath,
        contentType: 'application/pdf',
        sizeBytes: 1024,
        checksum: `sum-${documentKind}`,
        objectGeneration: '5',
        status: 'verified',
      })
    },
  })
}

async function runAgainstEmulator(target) {
  process.env.GCLOUD_PROJECT = PROJECT
  process.env.GOOGLE_CLOUD_PROJECT = PROJECT
  process.env.DATA_CONNECT_EMULATOR_HOST = `${target.hostname}:${target.port}`
  process.env.FIREBASE_DATA_CONNECT_EMULATOR_HOST = `${target.hostname}:${target.port}`
  // Storage stays in the local memory adapter: the smoke never touches a real bucket.
  process.env.QC_STORAGE_ADAPTER = 'memory'
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON

  const g1 = await importApi('_g1DataConnect.mjs')
  const g2 = await importApi('_g2WarehouseService.mjs')
  const g3 = await importApi('_g3ProductionService.mjs')
  const g4 = await importApi('_g4PackagingService.mjs')
  const helpers = await importApi('_g1CriticalHelpers.mjs')
  const qcStorage = await importApi('_qcStorage.mjs')
  const qcDataConnect = await importApi('_qcDataConnect.mjs')
  const dc = g1.getG1DataConnect()

  await runFlow({
    g3,
    g4,
    grantAccess: async () => {
      const sys = { uid: 'g4-sys', email: 'admin@fibercell.net', claims: { fstSysadmin: true } }
      const granted = await g2.grantPrincipalAccess({
        actor: sys,
        firebaseUid: actor.uid,
        storeId: STORE_ID,
        capabilities: CAPABILITIES,
      })
      assert(granted.ok, `grant: ${granted.error}`)
    },
    seedFixtures: async () => {
      const { data } = await g1.getFstCriticalStore(dc, { id: STORE_ID })
      const row = data.fstCriticalStore
      assert(row, 'critical store row missing after production activation')
      const payload = applyFixtures(JSON.parse(row.payloadJson))
      const json = JSON.stringify(payload)
      await g1.updateFstCriticalStoreCas(dc, {
        id: STORE_ID,
        expectedRevision: row.revision,
        revision: row.revision + 1,
        payloadJson: json,
        fingerprint: helpers.fingerprintCriticalPayload(json),
        updatedByUid: actor.uid,
      })
    },
    attachVerified: async (lotId, documentKind) => {
      const id = `att-${documentKind}-${Date.now()}-${Math.floor(Math.random() * 1000)}`
      const storagePath = qcStorage.buildQcStoragePath(STORE_ID, lotId, id)
      const objectGeneration = qcStorage.memoryPutObject(storagePath, {
        contentType: 'application/pdf',
        sizeBytes: 1024,
        checksum: `sum-${documentKind}`,
      })
      await qcDataConnect.insertQcAttachmentRecord(qcDataConnect.getQcDataConnect(), {
        id,
        storeId: STORE_ID,
        lotId,
        documentKind,
        storagePath,
        contentType: 'application/pdf',
        sizeBytes: 1024,
        checksum: `sum-${documentKind}`,
        objectGeneration,
        status: 'verified',
        uploadedByUid: actor.uid,
        revision: 1,
        idempotencyKey: id,
      })
    },
  })
}

async function main() {
  const target = emulatorTarget()
  const useEmulator = target ? await portOpen(target.hostname, target.port) : false
  try {
    if (useEmulator) {
      log(`mode=emulator ${target.hostname}:${target.port} project=${PROJECT}`)
      await runAgainstEmulator(target)
    } else {
      if (target) log(`emulator ${target.hostname}:${target.port} unreachable — falling back`)
      log('mode=in-process (no Data Connect emulator)')
      await runInProcess()
    }
    log('SMOKE PASS')
    process.exitCode = 0
  } catch (err) {
    process.stderr.write(`[g4-smoke] FAIL: ${err?.stack || String(err)}\n`)
    process.exitCode = 1
  } finally {
    log('stopped cleanly — no production credentials, no deploy, no remote writes')
  }
}

await main()
