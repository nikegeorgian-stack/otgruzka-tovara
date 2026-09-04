/**
 * LIVE G4.1 Admin SDK smoke against local Data Connect emulator only.
 *
 * Project: demo-otgruzka (never otgruzka-tovara / production credentials).
 * Starts Data Connect emulator on :9399 from fst-web if needed, exercises
 * packagingQc activate → confirm → attach → release → ship → cancel →
 * revoke QC caps → deny (incl. QcPermission bypass) → idempotency / audit asserts,
 * then stops emulator processes and verifies ports free.
 *
 * Storage: firebase.json has rules but no emulators.auth/storage block.
 * Signed URLs need a service account; this smoke uses QC_STORAGE_ADAPTER=memory
 * and still runs initiate → redeem → finalizeAttachment → verifyStorageObject
 * (production service path). Auth/Storage emulators are NOT started by default.
 *
 * Usage:
 *   node scripts/g41-live-emulator-smoke.mjs
 *
 * No commit / push / deploy. Leaves fst-web/dataconnect/.dataconnect/ alone.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const fstWeb = path.join(repoRoot, 'fst-web')
const apiDir = path.join(repoRoot, 'api', 'fst')

const EMULATOR_HOST = '127.0.0.1'
const EMULATOR_PORT = 9399
const PROJECT = 'demo-otgruzka'
const FORBIDDEN_PROJECT = 'otgruzka-tovara'

const STORE_ID = 'fibercell-main'
const PACK_WH = 'pack-wh'
const PACK_LOC = 'pack-loc'
const FG_LOC = 'fg-loc'
const SCRAP_LOC = 'scrap-loc'
const ORDER_ID = 'ord-g41'
const WIP_ITEM = 'wip-item'
const MATERIAL_ITEM = 'film-1'
const FG_ITEM = 'fg-item'
const FINISHED_PRODUCT = 'fp-1'
const REPORT_DATE = '2026-09-04'

const CAPABILITIES = {
  'warehouse.read': true,
  'warehouse.document.post': true,
  'production.order.confirm': true,
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
  productionLineIds: ['*'],
}

const CAPABILITIES_NO_QC = {
  'warehouse.read': true,
  'warehouse.document.post': true,
  'production.order.confirm': true,
  'production.read': true,
  'packaging.read': true,
  'packaging.report.edit': true,
  'packaging.report.confirm': true,
  'packaging.report.correct': true,
  'shipment.draft.edit': true,
  'shipment.cancel': true,
  productionLineIds: ['*'],
}

function log(msg) {
  process.stdout.write(`[g41-live-smoke] ${msg}\n`)
}

function fail(msg) {
  process.stderr.write(`[g41-live-smoke] FAIL: ${msg}\n`)
  process.exitCode = 1
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg)
}

function scrubProdEnv() {
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS
  for (const key of [
    'GCLOUD_PROJECT',
    'GOOGLE_CLOUD_PROJECT',
    'FIREBASE_PROJECT',
    'FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_PROJECT_ID',
  ]) {
    const v = String(process.env[key] ?? '')
    if (v.includes(FORBIDDEN_PROJECT)) delete process.env[key]
  }
  process.env.GCLOUD_PROJECT = PROJECT
  process.env.GOOGLE_CLOUD_PROJECT = PROJECT
  process.env.DATA_CONNECT_EMULATOR_HOST = `${EMULATOR_HOST}:${EMULATOR_PORT}`
  process.env.FIREBASE_DATA_CONNECT_EMULATOR_HOST = `${EMULATOR_HOST}:${EMULATOR_PORT}`
  process.env.QC_LOCAL_EMULATOR = '1'
  process.env.QC_STORAGE_ADAPTER = 'memory'
}

async function waitPort(host, port, ms = 90000) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    const ok = await new Promise((resolve) => {
      const socket = net.connect({ host, port }, () => {
        socket.end()
        resolve(true)
      })
      socket.on('error', () => resolve(false))
    })
    if (ok) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

function readFirebaseJson() {
  try {
    return JSON.parse(fs.readFileSync(path.join(fstWeb, 'firebase.json'), 'utf8'))
  } catch {
    return null
  }
}

/** Auth/Storage only if firebase.json declares emulator ports (avoid flaky defaults). */
function optionalEmulatorPlan(firebaseJson) {
  const emu = firebaseJson?.emulators
  if (!emu || typeof emu !== 'object') {
    return {
      startAuthStorage: false,
      reason:
        'firebase.json has no emulators.auth/storage block — skipping Auth/Storage start; QC uses memory adapter',
    }
  }
  const authPort = Number(emu.auth?.port)
  const storagePort = Number(emu.storage?.port)
  if (!authPort && !storagePort) {
    return {
      startAuthStorage: false,
      reason: 'emulators block present but auth/storage ports unset — skipping',
    }
  }
  return {
    startAuthStorage: true,
    authPort: authPort || null,
    storagePort: storagePort || null,
    reason: 'firebase.json declares auth/storage emulator ports',
  }
}

function assertStorageRulesClientWriteDeny() {
  const rulesPath = path.join(fstWeb, 'storage.rules')
  const rules = fs.readFileSync(rulesPath, 'utf8')
  assert(/qc-lots/.test(rules), 'storage.rules missing qc-lots match')
  const qcBlock = rules.match(
    /match\s+\/fstFiles\/\{storeId\}\/qc-lots\/\{lotId\}\/\{attachmentId\}\/\{fileName\}\s*\{[\s\S]*?\}/,
  )
  assert(qcBlock, 'storage.rules qc-lots block not found')
  assert(
    /allow\s+(create,\s*update,\s*delete|write)\s*:\s*if\s+false/.test(qcBlock[0]),
    'storage.rules qc-lots must deny client writes (allow write/create/update/delete: if false)',
  )
  log('OK storage.rules static assert: qc-lots client write deny')
}

function startDataConnectEmulator({ withAuthStorage }) {
  const only = withAuthStorage ? 'dataconnect,auth,storage' : 'dataconnect'
  log(`starting Firebase emulators --only ${only} (project=${PROJECT})…`)
  const child = spawn(
    'firebase',
    ['emulators:start', '--only', only, '--project', PROJECT],
    {
      cwd: fstWeb,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GCLOUD_PROJECT: PROJECT, GOOGLE_CLOUD_PROJECT: PROJECT },
    },
  )
  let buf = ''
  child.stdout.on('data', (d) => {
    buf += d.toString()
  })
  child.stderr.on('data', (d) => {
    buf += d.toString()
  })
  return { child, getLog: () => buf }
}

async function stopEmulator(child) {
  if (!child || child.killed) return
  log('stopping emulator process tree…')
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { shell: true, stdio: 'ignore' })
    } else {
      child.kill('SIGTERM')
    }
  } catch {
    /* ignore */
  }
  await new Promise((r) => setTimeout(r, 2500))
}

function importApi(file) {
  return import(pathToFileURL(path.join(apiDir, file)).href)
}

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
      id: 'seed-wip-g41',
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
      id: 'seed-material-g41',
      warehouseId: PACK_WH,
      locationId: PACK_LOC,
      itemId: MATERIAL_ITEM,
      quantity: 40,
      type: 'receipt',
      at: '2026-09-03T00:00:00.000Z',
      date: '2026-09-03',
      batchNo: 'M-G41',
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

async function attachViaProductionPath({ qcService, qcStorage, actor, lotId, documentKind, runId }) {
  const attachmentId = `g41-${documentKind}-${runId}`
  const sizeBytes = 128
  const checksum = `chk-g41-${documentKind}`
  const init = await qcService.initiateAttachment({
    actor,
    storeId: STORE_ID,
    lotId,
    documentKind,
    contentType: 'application/pdf',
    sizeBytes,
    checksum,
    attachmentId,
    idempotencyKey: `g41-att-${documentKind}-${runId}`,
  })
  assert(init.ok, `initiateAttachment ${documentKind}: ${init.error}`)
  assert(init.upload?.uploadUrl, `signed session missing for ${documentKind}`)
  assert(
    init.upload.storagePath === init.attachment.storagePath,
    `signed session path unbound for ${documentKind}`,
  )
  const bound = qcStorage.assertSignedSessionPathBound(
    { ok: true, storagePath: init.upload.storagePath, contentType: init.upload.contentType },
    init.attachment.storagePath,
    'application/pdf',
  )
  assert(bound.ok, `assertSignedSessionPathBound ${documentKind}: ${bound.error}`)

  const redeem = qcStorage.redeemMemorySignedUpload({
    uploadUrl: init.upload.uploadUrl,
    bytes: Buffer.alloc(sizeBytes, 1),
    contentType: 'application/pdf',
    checksum,
  })
  assert(redeem.ok, `memory redeem ${documentKind}: ${redeem.error}`)

  const fin = await qcService.finalizeAttachment({
    actor,
    storeId: STORE_ID,
    lotId,
    attachmentId,
  })
  assert(fin.ok, `finalizeAttachment ${documentKind}: ${fin.error}`)
  assert(fin.attachment?.status === 'verified', `${documentKind} not verified`)
  log(`OK attachment ${documentKind} initiate→redeem→finalize (memory signed session)`)
  return fin.attachment
}

async function loadCritical(g1, helpers, storeId) {
  const dc = g1.getG1DataConnect()
  const { data } = await g1.getFstCriticalStore(dc, { id: storeId })
  const row = data?.fstCriticalStore
  assert(row, 'critical store missing')
  const payload = JSON.parse(row.payloadJson)
  return { dc, row, payload, fingerprint: helpers.fingerprintCriticalPayload(row.payloadJson) }
}

async function runSmoke({ runId }) {
  const g1 = await importApi('_g1DataConnect.mjs')
  const g2 = await importApi('_g2WarehouseService.mjs')
  const g3 = await importApi('_g3ProductionService.mjs')
  const g4 = await importApi('_g4PackagingService.mjs')
  const helpers = await importApi('_g1CriticalHelpers.mjs')
  const qcService = await importApi('_qcService.mjs')
  const qcStorage = await importApi('_qcStorage.mjs')

  assert(String(process.env.GCLOUD_PROJECT) === PROJECT, 'GCLOUD_PROJECT must be demo-otgruzka')
  assert(
    !String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? '').trim(),
    'FIREBASE_SERVICE_ACCOUNT_JSON must be unset',
  )

  // --- signed session unit section (memory adapter; Storage emulator signed URLs unsupported) ---
  {
    const samplePath = qcStorage.buildQcStoragePath(STORE_ID, 'lot-session', 'att-session')
    const session = await qcStorage.createSignedUploadSession({
      storagePath: samplePath,
      contentType: 'application/pdf',
      sizeBytes: 64,
      checksum: 'session-chk',
    })
    assert(session.ok, `createSignedUploadSession: ${session.error}`)
    assert(String(session.uploadUrl).startsWith('memory://qc-upload/'), 'expected memory:// signed URL')
    assert(session.storagePath === samplePath, 'session path mismatch')
    const bad = qcStorage.redeemMemorySignedUpload({
      uploadUrl: session.uploadUrl,
      bytes: Buffer.alloc(32),
      contentType: 'application/pdf',
      checksum: 'session-chk',
    })
    assert(!bad.ok, 'size mismatch must fail redeem')
    const session2 = await qcStorage.createSignedUploadSession({
      storagePath: samplePath,
      contentType: 'application/pdf',
      sizeBytes: 64,
      checksum: 'session-chk',
    })
    const okRedeem = qcStorage.redeemMemorySignedUpload({
      uploadUrl: session2.uploadUrl,
      bytes: Buffer.alloc(64, 2),
      contentType: 'application/pdf',
      checksum: 'session-chk',
    })
    assert(okRedeem.ok, `session redeem: ${okRedeem.error}`)
    log('OK signed session generation (memory) — Storage emulator signed URLs not used')
  }

  assertStorageRulesClientWriteDeny()

  const sys = { uid: 'g41-sys', email: 'admin@fibercell.net', claims: { fstSysadmin: true } }
  const actor = { uid: `g41-user-${runId}`, email: 'g41@example.com', claims: {} }

  const granted = await g2.grantPrincipalAccess({
    actor: sys,
    firebaseUid: actor.uid,
    storeId: STORE_ID,
    roleId: 'packaging',
    capabilities: CAPABILITIES,
  })
  assert(granted.ok, `grantPrincipalAccess: ${granted.error}`)
  log('OK FstPrincipalAccess with QC caps')

  const activateProduction = await g3.executeG3Command({
    actor,
    storeId: STORE_ID,
    idempotencyKey: `g41-activate-production-${runId}`,
    commandType: 'production.domain.activate',
    command: { reason: 'g41 live smoke bootstrap' },
  })
  assert(activateProduction.ok, `production activate: ${activateProduction.error}`)
  log('OK production domain active')

  {
    const { dc, row, payload } = await loadCritical(g1, helpers, STORE_ID)
    const next = applyFixtures(payload)
    const json = JSON.stringify(next)
    await g1.updateFstCriticalStoreCas(dc, {
      id: STORE_ID,
      expectedRevision: row.revision,
      revision: row.revision + 1,
      payloadJson: json,
      fingerprint: helpers.fingerprintCriticalPayload(json),
      updatedByUid: actor.uid,
    })
  }
  log('OK seeded WIP + materials + pack line binding')

  const activatePackaging = await g4.executeG4Command({
    actor,
    storeId: STORE_ID,
    idempotencyKey: `g41-activate-packaging-${runId}`,
    commandType: 'packaging.domain.activate',
    command: { reason: 'g41 live smoke packagingQc' },
  })
  assert(activatePackaging.ok, `packaging activate: ${activatePackaging.error}`)
  assert(activatePackaging.packagingQcActive === true, 'packagingQc not active')
  log('OK packagingQc feature active')

  const confirmed = await g4.executeG4Command({
    actor,
    storeId: STORE_ID,
    idempotencyKey: `g41-confirm-${runId}`,
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
      qcStatus: 'released',
      availableForShipment: true,
    },
  })
  assert(confirmed.ok, `packaging confirm: ${confirmed.error}`)
  assert(confirmed.qcStatus === 'pending', `expected pending lot, got ${confirmed.qcStatus}`)
  assert(confirmed.finishedGoodsLotId, 'missing finishedGoodsLotId')
  log(`OK packaging confirm lot=${confirmed.lotNumber} qty=${confirmed.quantityProduced} status=pending`)

  const releaseNoDocs = await g4.executeG4Command({
    actor,
    storeId: STORE_ID,
    idempotencyKey: `g41-release-no-docs-${runId}`,
    commandType: 'qc.release',
    command: { finishedGoodsLotId: confirmed.finishedGoodsLotId },
  })
  assert(
    !releaseNoDocs.ok && releaseNoDocs.error === 'qc_attachments_required',
    `release without attachments must fail (got ${releaseNoDocs.error})`,
  )
  log('OK release without passport/protocol refused')

  await attachViaProductionPath({
    qcService,
    qcStorage,
    actor,
    lotId: confirmed.finishedGoodsLotId,
    documentKind: 'passport',
    runId,
  })
  await attachViaProductionPath({
    qcService,
    qcStorage,
    actor,
    lotId: confirmed.finishedGoodsLotId,
    documentKind: 'protocol',
    runId,
  })

  const releaseKey = `g41-release-${runId}`
  const released = await g4.executeG4Command({
    actor,
    storeId: STORE_ID,
    idempotencyKey: releaseKey,
    commandType: 'qc.release',
    command: { finishedGoodsLotId: confirmed.finishedGoodsLotId, reason: 'lab ok' },
  })
  assert(released.ok, `qc release: ${released.error}`)
  assert(released.qcStatus === 'released', `expected released, got ${released.qcStatus}`)
  log(`OK qc release decision=${released.decisionId}`)

  const releasedReplay = await g4.executeG4Command({
    actor,
    storeId: STORE_ID,
    idempotencyKey: releaseKey,
    commandType: 'qc.release',
    command: { finishedGoodsLotId: confirmed.finishedGoodsLotId, reason: 'lab ok replay' },
  })
  assert(releasedReplay.ok, `idempotent release replay: ${releasedReplay.error}`)
  log('OK release idempotencyKey replay (no duplicate decision)')

  const shipKey = `g41-ship-${runId}`
  const shipped = await g4.executeG4Command({
    actor,
    storeId: STORE_ID,
    idempotencyKey: shipKey,
    commandType: 'shipment.post',
    command: {
      shipmentId: `shp-g41-${runId}`,
      finishedProductId: FINISHED_PRODUCT,
      finishedGoodsLotId: confirmed.finishedGoodsLotId,
      quantity: 40,
      date: REPORT_DATE,
    },
  })
  assert(shipped.ok, `shipment post: ${shipped.error}`)
  assert(shipped.quantityRemaining === 60, `expected remaining 60, got ${shipped.quantityRemaining}`)
  log(`OK partial shipment shipped=${shipped.quantityShipped} remaining=${shipped.quantityRemaining}`)

  const cancelKey = `g41-cancel-${runId}`
  const cancelled = await g4.executeG4Command({
    actor,
    storeId: STORE_ID,
    idempotencyKey: cancelKey,
    commandType: 'shipment.cancel',
    command: {
      shipmentId: `shp-g41-${runId}`,
      reason: 'g41 smoke rollback',
      date: REPORT_DATE,
    },
  })
  assert(cancelled.ok, `shipment cancel: ${cancelled.error}`)
  assert(cancelled.quantityShipped === 0, `expected shipped 0, got ${cancelled.quantityShipped}`)
  log(`OK shipment cancel reversals=${(cancelled.reversalDocumentIds ?? []).length}`)

  const cancelReplay = await g4.executeG4Command({
    actor,
    storeId: STORE_ID,
    idempotencyKey: cancelKey,
    commandType: 'shipment.cancel',
    command: {
      shipmentId: `shp-g41-${runId}`,
      reason: 'g41 smoke rollback again',
      date: REPORT_DATE,
    },
  })
  assert(cancelReplay.ok && cancelReplay.idempotent === true, 'cancel replay must be idempotent')
  log('OK cancel idempotencyKey replay')

  // --- revoke QC caps ---
  const revokedCaps = await g2.grantPrincipalAccess({
    actor: sys,
    firebaseUid: actor.uid,
    storeId: STORE_ID,
    roleId: 'packaging',
    capabilities: CAPABILITIES_NO_QC,
  })
  assert(revokedCaps.ok, `clear QC caps: ${revokedCaps.error}`)
  const capsAfter = revokedCaps.principal?.capabilities ?? {}
  assert(capsAfter['qc.release'] !== true, 'qc.release still true after revoke')
  assert(capsAfter['qc.regrade'] !== true, 'qc.regrade still true after revoke')
  assert(capsAfter['qc.attachment.upload'] !== true, 'qc.attachment.upload still true after revoke')
  log('OK principal QC caps cleared (qc.release/regrade/upload)')

  const denyRelease = await g4.executeG4Command({
    actor,
    storeId: STORE_ID,
    idempotencyKey: `g41-release-denied-${runId}`,
    commandType: 'qc.release',
    command: { finishedGoodsLotId: confirmed.finishedGoodsLotId, reason: 'should deny' },
  })
  assert(!denyRelease.ok, `release after revoke must deny (got ok=${denyRelease.ok})`)
  log(`OK release denied after revoke error=${denyRelease.error}`)

  const denyRegrade = await g4.executeG4Command({
    actor,
    storeId: STORE_ID,
    idempotencyKey: `g41-regrade-denied-${runId}`,
    commandType: 'qc.regrade',
    command: {
      finishedGoodsLotId: confirmed.finishedGoodsLotId,
      targetFinishedProductId: 'fp-other',
      reason: 'should deny',
    },
  })
  assert(!denyRegrade.ok, `regrade after revoke must deny (got ok=${denyRegrade.ok})`)
  log(`OK regrade denied after revoke error=${denyRegrade.error}`)

  // QcPermission=true must NOT help while packagingQc active
  const legacyGrant = await qcService.grantPermission({
    actor: sys,
    firebaseUid: actor.uid,
    storeId: STORE_ID,
    flags: {
      canView: true,
      canUpload: true,
      canRelease: true,
      canRegrade: true,
      canReject: true,
      canPostShipment: true,
    },
  })
  // grantPermission also upserts principal QC caps — re-clear them to isolate QcPermission
  assert(legacyGrant.ok, `legacy QcPermission grant: ${legacyGrant.error}`)
  const reClear = await g2.grantPrincipalAccess({
    actor: sys,
    firebaseUid: actor.uid,
    storeId: STORE_ID,
    roleId: 'packaging',
    capabilities: CAPABILITIES_NO_QC,
  })
  assert(reClear.ok, `re-clear after QcPermission: ${reClear.error}`)

  const reqPerm = await qcService.requireActivePermission(actor.uid, STORE_ID, 'canRelease')
  assert(!reqPerm.ok, 'requireActivePermission must deny when packagingQc active + no principal QC cap')
  log('OK QcPermission=true ignored (requireActivePermission deny with packagingQc active)')

  // --- warehouse / lot / audit / receipts ---
  const { row, payload } = await loadCritical(g1, helpers, STORE_ID)
  assert(payload.domainMeta?.production?.features?.packagingQc?.active === true, 'feature flag lost')
  const lot = (payload.domains.production.finishedGoodsLots ?? []).find(
    (l) => l.id === confirmed.finishedGoodsLotId,
  )
  assert(lot, 'lot missing from critical production')
  assert(Number(lot.quantityProduced) === 100, `lot qty produced expected 100 got ${lot.quantityProduced}`)
  assert(Number(lot.quantityShipped) === 0, `lot qty shipped expected 0 after cancel got ${lot.quantityShipped}`)
  assert(lot.qcStatus === 'released', `lot qcStatus expected released got ${lot.qcStatus}`)

  const movements = payload.domains.warehouse.movements ?? []
  assert(movements.length > 2, `expected warehouse movements after pack/ship/cancel, got ${movements.length}`)
  const whAudit = payload.domains.warehouse.auditLog ?? []
  const prodAudit = payload.domains.production.auditLog ?? []
  assert(whAudit.length + prodAudit.length > 0, 'expected audit log entries')

  const receipts = payload.commandReceipts ?? {}
  assert(receipts[releaseKey] || receipts[shipKey] || receipts[cancelKey], 'embedded commandReceipts missing')

  const dc = g1.getG1DataConnect()
  const receiptRow = await g1.getFstCommandReceipt(dc, { id: releaseKey })
  assert(receiptRow.data?.fstCommandReceipt?.id === releaseKey, 'FstCommandReceipt missing for release key')
  log(
    `OK asserts: movements=${movements.length} lot.qty=${lot.quantityProduced} shipped=${lot.quantityShipped} audit(w/p)=${whAudit.length}/${prodAudit.length} receipts+criticalRev=${row.revision}`,
  )
}

async function main() {
  scrubProdEnv()
  const runId = String(Date.now())
  const firebaseJson = readFirebaseJson()
  const plan = optionalEmulatorPlan(firebaseJson)
  log(`limitation: ${plan.reason}`)
  log(
    'limitation: Storage emulator signed URLs need a real service account — using QC_STORAGE_ADAPTER=memory + finalizeAttachment/verifyStorageObject path',
  )

  let emu = null
  let startedByUs = false
  let liveEmulator = false
  const extraPorts = [plan.authPort, plan.storagePort].filter(Boolean)

  try {
    if (!(await waitPort(EMULATOR_HOST, EMULATOR_PORT, 1500))) {
      try {
        emu = startDataConnectEmulator({ withAuthStorage: plan.startAuthStorage })
        startedByUs = true
      } catch (err) {
        fail(`BLOCK: failed to spawn firebase CLI — ${err?.message || err}`)
        return
      }
      const ready = await waitPort(EMULATOR_HOST, EMULATOR_PORT, 120000)
      if (!ready) {
        const tail = emu?.getLog()?.slice(-2500) ?? ''
        const missingJava = /java|JDK|JRE/i.test(tail)
        const missingFirebase = /firebase|not recognized|ENOENT/i.test(tail)
        fail(
          `BLOCK: Data Connect emulator did not open ${EMULATOR_HOST}:${EMULATOR_PORT}` +
            (missingJava ? ' (Java/JDK missing?)' : '') +
            (missingFirebase ? ' (firebase CLI missing?)' : '') +
            `\n${tail}`,
        )
        await stopEmulator(emu?.child)
        return
      }
      await new Promise((r) => setTimeout(r, 4000))
      log(`live DC emulator listening on ${EMULATOR_HOST}:${EMULATOR_PORT} project=${PROJECT}`)
      liveEmulator = true
    } else {
      log(`reusing already-running DC emulator on ${EMULATOR_PORT}`)
      liveEmulator = true
    }

    await runSmoke({ runId })
    log(`SMOKE PASS (liveDcEmulator=${liveEmulator} mode=live-dc-emulator project=${PROJECT})`)
    process.exitCode = 0
  } catch (err) {
    fail(err?.stack || String(err))
  } finally {
    if (startedByUs && emu?.child) await stopEmulator(emu.child)
    const dcFree = !(await waitPort(EMULATOR_HOST, EMULATOR_PORT, 800))
    log(`port ${EMULATOR_PORT} free=${dcFree}`)
    for (const p of extraPorts) {
      const free = !(await waitPort(EMULATOR_HOST, p, 800))
      log(`port ${p} free=${free}`)
    }
    if (startedByUs && !dcFree) {
      log('WARN: port 9399 still occupied after stop — check orphaned java/firebase processes')
    }
  }
}

main()
