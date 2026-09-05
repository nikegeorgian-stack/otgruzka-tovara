/**
 * PHASE R1.1 — Auth + Data Connect freeze/access smoke (demo-otgruzka ONLY).
 *
 * Covers: real Auth ID token + Admin verifyIdToken(checkRevoked), G1-G6 light
 * commands, warehouse freeze->deny->resume->ok, disabled user, foreign store,
 * idempotent receipt retry. Storage = QC_STORAGE_ADAPTER=memory.
 *
 * Usage:
 *   node scripts/r11-auth-dc-freeze-smoke.mjs
 *
 * Does NOT modify repo firebase.json, .dataconnect/**, or CURRENT_STATE.md.
 * No commit / push / deploy. Never uses otgruzka-tovara credentials.
 */
import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const fstWeb = path.join(repoRoot, 'fst-web')
const apiDir = path.join(repoRoot, 'server', 'fst')
const dataconnectSourceAbs = path.join(fstWeb, 'dataconnect')

const EMULATOR_HOST = '127.0.0.1'
const AUTH_PORT = 9099
const DC_PORT = 9399
const PROJECT = 'demo-otgruzka'
const FORBIDDEN_PROJECT = 'otgruzka-tovara'
const API_KEY = 'fake-api-key-r11'

const STORE_ID = 'fibercell-main'
const FOREIGN_STORE = 'foreign-store-r11'
const WH = 'wh-main'
const DATE = '2026-09-04'
const TAG = '[r11-auth-dc-freeze-smoke]'

const results = []

function log(msg) {
  process.stdout.write(`${TAG} ${msg}\n`)
}

function fail(msg) {
  process.stderr.write(`${TAG} FAIL: ${msg}\n`)
  process.exitCode = 1
}

function passLine(name) {
  results.push({ name, ok: true })
  log(`PASS ${name}`)
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
  process.env.DATA_CONNECT_EMULATOR_HOST = `${EMULATOR_HOST}:${DC_PORT}`
  process.env.FIREBASE_DATA_CONNECT_EMULATOR_HOST = `${EMULATOR_HOST}:${DC_PORT}`
  process.env.FIREBASE_AUTH_EMULATOR_HOST = `${EMULATOR_HOST}:${AUTH_PORT}`
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

function ensureFirebaseCli() {
  try {
    const v = execSync('firebase --version', { encoding: 'utf8', shell: true }).trim()
    log(`firebase CLI ${v}`)
    return true
  } catch {
    return false
  }
}

function writeTempFirebaseConfig() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'r11-demo-firebase-'))
  const dataDir = path.join(tmpRoot, 'dataconnect-data')
  fs.mkdirSync(dataDir, { recursive: true })
  const cfg = {
    emulators: {
      auth: { port: AUTH_PORT, host: EMULATOR_HOST },
      dataconnect: { port: DC_PORT, dataDir },
      ui: { enabled: false },
    },
    dataconnect: {
      source: dataconnectSourceAbs.replace(/\\/g, '/'),
    },
  }
  const cfgPath = path.join(tmpRoot, 'firebase.json')
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8')
  fs.writeFileSync(
    path.join(tmpRoot, '.firebaserc'),
    JSON.stringify({ projects: { default: PROJECT } }, null, 2),
    'utf8',
  )
  log(`temp firebase config: ${cfgPath}`)
  return { tmpRoot, cfgPath, dataDir }
}

function startAuthAndDcEmulators(cfgPath) {
  log(`starting emulators auth+dataconnect project=${PROJECT}`)
  const child = spawn(
    'firebase',
    [
      'emulators:start',
      '--only',
      'auth,dataconnect',
      '--project',
      PROJECT,
      '--config',
      cfgPath,
    ],
    {
      cwd: path.dirname(cfgPath),
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GCLOUD_PROJECT: PROJECT,
        GOOGLE_CLOUD_PROJECT: PROJECT,
      },
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
  log('stopping emulator process tree...')
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

async function cleanupPorts() {
  if (process.platform === 'win32') {
    try {
      spawn(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `@( ${AUTH_PORT}, ${DC_PORT} ) | ForEach-Object { Get-NetTCPConnection -LocalPort $_ -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }`,
        ],
        { shell: true, stdio: 'ignore' },
      )
    } catch {
      /* ignore */
    }
  }
  await new Promise((r) => setTimeout(r, 1500))
}

function importApi(file) {
  return import(pathToFileURL(path.join(apiDir, file)).href)
}

async function waitForSchemaReady(ms = 120000) {
  const start = Date.now()
  let lastErr = ''
  while (Date.now() - start < ms) {
    try {
      const g1 = await importApi('_g1DataConnect.mjs')
      const dc = g1.getG1DataConnect()
      await g1.getFstCriticalStore(dc, { id: STORE_ID })
      log('OK Data Connect schema ready')
      return true
    } catch (err) {
      lastErr = String(err?.message || err)
      if (!/no schema found|UNAVAILABLE|ECONNREFUSED/i.test(lastErr)) {
        log(`OK Data Connect schema ready (probe: ${lastErr.slice(0, 120)})`)
        return true
      }
      await new Promise((r) => setTimeout(r, 1500))
    }
  }
  throw new Error(`Data Connect schema not ready after ${ms}ms: ${lastErr}`)
}

function authBase() {
  return `http://${EMULATOR_HOST}:${AUTH_PORT}/identitytoolkit.googleapis.com/v1`
}

async function authJson(pathname, body) {
  const url = `${authBase()}/${pathname}?key=${API_KEY}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(`Auth emulator ${pathname}: HTTP ${res.status} ${JSON.stringify(data)}`)
  }
  return data
}

async function createAuthUser(email, password) {
  return authJson('accounts:signUp', { email, password, returnSecureToken: true })
}

async function signInAuthUser(email, password) {
  return authJson('accounts:signInWithPassword', { email, password, returnSecureToken: true })
}

async function disableAuthUser(localId) {
  const { initFirebaseAdmin, getAdminAuth } = await importApi('_adminAuth.mjs')
  initFirebaseAdmin()
  await getAdminAuth().updateUser(localId, { disabled: true })
  return { localId, disabled: true }
}

function allR11Caps() {
  return {
    'critical.domain.freeze': true,
    'warehouse.read': true,
    'warehouse.draft.edit': true,
    'warehouse.document.post': true,
    'warehouse.transfer.post': true,
    'warehouse.document.cancel': true,
    'warehouse.period.close': true,
    'warehouse.period.reopen': true,
    'warehouse.inventory.post': true,
    'warehouse.opening.activate': true,
    'production.read': true,
    'production.recipe.draft.edit': true,
    'production.recipe.approve': true,
    'production.order.edit': true,
    'production.order.confirm': true,
    'packaging.read': true,
    'packaging.report.edit': true,
    'packaging.report.confirm': true,
    'qc.review': true,
    'qc.release': true,
    'shipment.post': true,
    'shipment.cancel': true,
    'masterdata.read': true,
    'masterdata.item.manage': true,
    'masterdata.product.manage': true,
    'masterdata.customer.manage': true,
    'masterdata.supplier.manage': true,
    'masterdata.bom.manage': true,
    'masterdata.bom.approve': true,
    'sales.read': true,
    'sales.order.edit': true,
    'sales.order.confirm': true,
    'planning.read': true,
    'planning.mrp.run': true,
    'procurement.read': true,
    'procurement.draft.edit': true,
    'capacity.read': true,
    'capacity.norm.edit': true,
    'capacity.norm.approve': true,
    'capacity.calendar.edit': true,
    'capacity.run': true,
    'capacity.schedule.edit': true,
    'capacity.schedule.publish': true,
    'capacity.overload.approve': true,
    productionLineIds: ['*', '1', '2', 'pack'],
    warehouseIds: ['*', WH, 'w1'],
  }
}

async function loadCritical(g1, storeId) {
  const dc = g1.getG1DataConnect()
  const { data } = await g1.getFstCriticalStore(dc, { id: storeId })
  const row = data?.fstCriticalStore
  assert(row, 'critical store missing')
  return { dc, row, payload: JSON.parse(row.payloadJson) }
}

async function casMarkWarehouseActive(g1, helpers, storeId, actorUid) {
  const { dc, row, payload } = await loadCritical(g1, storeId)
  const next = helpers.markWarehouseDomainActive(payload, actorUid)
  if (!next.domains.warehouse.locations?.length) {
    next.domains.warehouse.locations = [
      { id: 'loc-1', warehouseId: WH },
      { id: WH },
    ]
  }
  const json = helpers.serializeCriticalPayload(next)
  await g1.updateFstCriticalStoreCas(dc, {
    id: storeId,
    expectedRevision: row.revision,
    revision: row.revision + 1,
    payloadJson: json,
    fingerprint: helpers.fingerprintCriticalPayload(json),
    updatedByUid: actorUid,
  })
}

function receiptCmd(extra = {}) {
  return {
    type: 'receipt',
    warehouseId: WH,
    date: DATE,
    lines: [{ itemId: 'item-r11', quantity: 2, batchNo: 'LOT-R11', expiryDate: '2026-12-01' }],
    ...extra,
  }
}

async function runSmoke(runId) {
  assert(String(process.env.GCLOUD_PROJECT) === PROJECT, 'GCLOUD_PROJECT must be demo-otgruzka')
  assert(
    !String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? '').trim(),
    'FIREBASE_SERVICE_ACCOUNT_JSON must be unset',
  )
  assert(
    String(process.env.FIREBASE_AUTH_EMULATOR_HOST) === `${EMULATOR_HOST}:${AUTH_PORT}`,
    'FIREBASE_AUTH_EMULATOR_HOST must point at Auth emulator',
  )
  assert(process.env.QC_STORAGE_ADAPTER === 'memory', 'QC_STORAGE_ADAPTER must be memory')

  const adminAuth = await importApi('_adminAuth.mjs')
  const g1 = await importApi('_g1DataConnect.mjs')
  const g2 = await importApi('_g2WarehouseService.mjs')
  const g3 = await importApi('_g3ProductionService.mjs')
  const g4 = await importApi('_g4PackagingService.mjs')
  const g5 = await importApi('_g5SalesProcurementService.mjs')
  const g6 = await importApi('_g6CapacityService.mjs')
  const freeze = await importApi('_g1DomainFreeze.mjs')
  const helpers = await importApi('_g1CriticalHelpers.mjs')
  assert(typeof adminAuth.verifyIdToken === 'function', 'verifyIdToken missing')
  assert(typeof g1.getG1DataConnect === 'function', 'getG1DataConnect missing')
  assert(typeof freeze.executeDomainFreezeCommand === 'function', 'executeDomainFreezeCommand missing')
  passLine('01_import_g1_g6_admin_dc_modules')
  passLine('02_qc_storage_adapter_memory')

  const email = `r11-${runId}@example.com`
  const password = 'R11-Smoke-Pass-1!'
  await createAuthUser(email, password)
  const signed = await signInAuthUser(email, password)
  assert(signed?.idToken && signed?.localId, 'Auth emulator sign-in failed')

  adminAuth.initFirebaseAdmin()
  const decoded = await adminAuth.verifyIdToken(signed.idToken)
  assert(decoded.uid === signed.localId, 'verifyIdToken uid mismatch')
  passLine('03_verifyIdToken_checkRevoked')

  const actor = {
    uid: decoded.uid,
    email: decoded.email || email,
    claims: {},
  }
  const sys = {
    uid: 'r11-sys',
    email: 'admin@fibercell.net',
    claims: { fstSysadmin: true },
  }

  const granted = await g2.grantPrincipalAccess({
    actor: sys,
    firebaseUid: actor.uid,
    storeId: STORE_ID,
    roleId: 'planner',
    capabilities: allR11Caps(),
  })
  assert(granted.ok, `grantPrincipalAccess: ${granted.error}`)
  passLine('03b_grant_principal_access')

  const draft = await g2.executeG2Command({
    actor,
    storeId: STORE_ID,
    idempotencyKey: `r11-draft-${runId}`,
    commandType: 'warehouse.draft.save',
    command: receiptCmd(),
  })
  assert(draft.ok, `warehouse.draft.save: ${draft.error}`)

  await casMarkWarehouseActive(g1, helpers, STORE_ID, actor.uid)

  const postKey = `r11-wh-post-${runId}`
  const post1 = await g2.executeG2Command({
    actor,
    storeId: STORE_ID,
    idempotencyKey: postKey,
    commandType: 'warehouse.document.post',
    command: receiptCmd({
      lines: [{ itemId: 'item-r11', quantity: 5, batchNo: 'LOT-R11A' }],
    }),
  })
  assert(post1.ok, `warehouse.document.post: ${post1.error}`)
  passLine('04_g2_warehouse_light_write')

  const { row: revBefore } = await loadCritical(g1, STORE_ID)
  const postRetry = await g2.executeG2Command({
    actor,
    storeId: STORE_ID,
    idempotencyKey: postKey,
    commandType: 'warehouse.document.post',
    command: receiptCmd({
      lines: [{ itemId: 'item-r11', quantity: 5, batchNo: 'LOT-R11A' }],
    }),
  })
  assert(postRetry.ok, `idempotent retry failed: ${postRetry.error}`)
  const { row: revAfter } = await loadCritical(g1, STORE_ID)
  assert(
    postRetry.idempotent === true ||
      postRetry.recoveredFromEmbeddedReceipt === true ||
      revBefore.revision === revAfter.revision,
    'idempotent retry must not advance revision without flag',
  )
  passLine('12_cas_idempotent_retry')

  const g3Act = await g3.executeG3Command({
    actor,
    storeId: STORE_ID,
    idempotencyKey: `r11-g3-act-${runId}`,
    commandType: 'production.domain.activate',
    command: { reason: 'r11 smoke' },
  })
  assert(g3Act.ok, `production.domain.activate: ${g3Act.error}`)
  const g3Read = await g3.executeG3Command({
    actor,
    storeId: STORE_ID,
    idempotencyKey: `r11-g3-read-${runId}`,
    commandType: 'production.read',
    command: {},
  })
  assert(g3Read.ok, `production.read: ${g3Read.error}`)
  passLine('05_g3_production_activate_read')

  const g4Act = await g4.executeG4Command({
    actor,
    storeId: STORE_ID,
    idempotencyKey: `r11-g4-act-${runId}`,
    commandType: 'packaging.domain.activate',
    command: { reason: 'r11 smoke' },
  })
  assert(g4Act.ok, `packaging.domain.activate: ${g4Act.error}`)
  const g4Read = await g4.executeG4Command({
    actor,
    storeId: STORE_ID,
    idempotencyKey: `r11-g4-read-${runId}`,
    commandType: 'packaging.read',
    command: {},
  })
  assert(g4Read.ok, `packaging.read: ${g4Read.error}`)
  passLine('06_g4_packaging_activate_read')

  const mdAct = await g5.executeG5Command({
    actor,
    storeId: STORE_ID,
    idempotencyKey: `r11-md-act-${runId}`,
    commandType: 'masterdata.domain.activate',
    command: { reason: 'r11 smoke' },
  })
  assert(mdAct.ok, `masterdata.domain.activate: ${mdAct.error}`)
  const itemUp = await g5.executeG5Command({
    actor,
    storeId: STORE_ID,
    idempotencyKey: `r11-item-${runId}`,
    commandType: 'masterdata.item.upsert',
    command: {
      id: 'item-r11-md',
      code: 'R11-ITEM',
      name: 'R11 Item',
      baseUnit: 'kg',
      moq: 1,
      orderMultiple: 1,
      leadTimeDays: 1,
    },
  })
  assert(itemUp.ok, `masterdata.item.upsert: ${itemUp.error}`)
  const salesAct = await g5.executeG5Command({
    actor,
    storeId: STORE_ID,
    idempotencyKey: `r11-sales-act-${runId}`,
    commandType: 'sales.domain.activate',
    command: { reason: 'r11 smoke' },
  })
  assert(salesAct.ok, `sales.domain.activate: ${salesAct.error}`)
  passLine('07_g5_masterdata_sales_light')

  const g6Act = await g6.executeG6Command({
    actor,
    storeId: STORE_ID,
    idempotencyKey: `r11-g6-act-${runId}`,
    commandType: 'capacity.domain.activate',
    command: { reason: 'r11 smoke' },
  })
  assert(g6Act.ok, `capacity.domain.activate: ${g6Act.error}`)
  passLine('08_g6_capacity_activate')

  const frz = await freeze.executeDomainFreezeCommand({
    actor,
    storeId: STORE_ID,
    idempotencyKey: `r11-freeze-${runId}`,
    commandType: 'warehouse.domain.freeze',
    command: { reason: 'r11 freeze smoke' },
  })
  assert(frz.ok, `warehouse.domain.freeze: ${frz.error}`)

  const denied = await g2.executeG2Command({
    actor,
    storeId: STORE_ID,
    idempotencyKey: `r11-wh-frozen-${runId}`,
    commandType: 'warehouse.document.post',
    command: receiptCmd({
      lines: [{ itemId: 'item-r11', quantity: 1, batchNo: 'LOT-FROZEN' }],
    }),
  })
  assert(
    denied.ok === false && denied.error === 'domain_frozen',
    `expected domain_frozen (got ok=${denied.ok} error=${denied.error})`,
  )

  const resume = await freeze.executeDomainFreezeCommand({
    actor,
    storeId: STORE_ID,
    idempotencyKey: `r11-resume-${runId}`,
    commandType: 'warehouse.domain.resume',
    command: { reason: 'r11 resume smoke' },
  })
  assert(resume.ok, `warehouse.domain.resume: ${resume.error}`)

  const afterResume = await g2.executeG2Command({
    actor,
    storeId: STORE_ID,
    idempotencyKey: `r11-wh-after-resume-${runId}`,
    commandType: 'warehouse.document.post',
    command: receiptCmd({
      lines: [{ itemId: 'item-r11', quantity: 1, batchNo: 'LOT-RESUME' }],
    }),
  })
  assert(afterResume.ok, `post after resume: ${afterResume.error}`)
  passLine('09_freeze_deny_resume_write_ok')

  const foreign = await g2.executeG2Command({
    actor,
    storeId: FOREIGN_STORE,
    idempotencyKey: `r11-foreign-${runId}`,
    commandType: 'warehouse.document.post',
    command: receiptCmd(),
  })
  assert(
    foreign.ok === false &&
      (Number(foreign.status) === 403 ||
        /forbidden|principal|access/i.test(String(foreign.error))),
    `foreign store must deny (got ok=${foreign.ok} status=${foreign.status} error=${foreign.error})`,
  )
  passLine('11_foreign_store_denied')

  await disableAuthUser(signed.localId)
  let disabledDenied = false
  let disabledDetail = ''
  try {
    await adminAuth.verifyIdToken(signed.idToken)
    disabledDetail = 'verifyIdToken unexpectedly succeeded'
  } catch (err) {
    disabledDenied = true
    disabledDetail = String(err?.message || err).slice(0, 160)
  }
  assert(disabledDenied, `disabled user must fail verifyIdToken (${disabledDetail})`)
  passLine('10_disabled_user_verifyIdToken_denied')

  const { row: finalRow } = await loadCritical(g1, STORE_ID)
  return {
    mode: 'live-auth-dc-emulator',
    project: PROJECT,
    storeId: STORE_ID,
    criticalRevision: finalRow.revision,
    authUid: actor.uid,
    passes: results.filter((r) => r.ok).map((r) => r.name),
    qcStorageAdapter: process.env.QC_STORAGE_ADAPTER,
  }
}

async function main() {
  scrubProdEnv()
  const runId = String(Date.now())

  if (!ensureFirebaseCli()) {
    fail('BLOCK: firebase CLI missing — cannot start Auth+DC emulators')
    process.exitCode = 2
    return
  }

  let emu = null
  let startedByUs = false
  let tmpRoot = null

  try {
    const authUp = await waitPort(EMULATOR_HOST, AUTH_PORT, 800)
    const dcUp = await waitPort(EMULATOR_HOST, DC_PORT, 800)
    if (!authUp || !dcUp) {
      const temp = writeTempFirebaseConfig()
      tmpRoot = temp.tmpRoot
      try {
        emu = startAuthAndDcEmulators(temp.cfgPath)
        startedByUs = true
      } catch (err) {
        fail(`BLOCK: failed to spawn Auth+DC emulators — ${err?.message || err}`)
        process.exitCode = 2
        return
      }
      const authReady = await waitPort(EMULATOR_HOST, AUTH_PORT, 120000)
      const dcReady = await waitPort(EMULATOR_HOST, DC_PORT, 120000)
      if (!authReady || !dcReady) {
        const tail = emu?.getLog()?.slice(-2500) ?? ''
        fail(`BLOCK: emulators not ready auth=${authReady} dc=${dcReady}\n${tail}`)
        await stopEmulator(emu?.child)
        process.exitCode = 2
        return
      }
      await new Promise((r) => setTimeout(r, 5000))
      log(`Auth+DC emulators up auth=${AUTH_PORT} dc=${DC_PORT} project=${PROJECT}`)
    } else {
      log(`reusing Auth=${AUTH_PORT} DC=${DC_PORT}`)
    }

    await waitForSchemaReady()
    const summary = await runSmoke(runId)
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
    const allPass = results.length > 0 && results.every((r) => r.ok)
    if (!allPass) {
      fail('SMOKE incomplete — not all PASS lines recorded')
      process.exitCode = 1
      return
    }
    log(`SMOKE PASS (project=${PROJECT} checks=${results.length})`)
    process.exitCode = 0
  } catch (err) {
    fail(err?.stack || String(err))
    process.exitCode = 1
  } finally {
    if (startedByUs && emu?.child) {
      await stopEmulator(emu.child)
    }
    await cleanupPorts()
    const authFree = !(await waitPort(EMULATOR_HOST, AUTH_PORT, 800))
    const dcFree = !(await waitPort(EMULATOR_HOST, DC_PORT, 800))
    log(`ports freed summary: ${AUTH_PORT} free=${authFree}; ${DC_PORT} free=${dcFree}`)
    if (!authFree || !dcFree) {
      log('WARNING: ports still busy after cleanup — forcing cleanupPorts again')
      await cleanupPorts()
      const authFree2 = !(await waitPort(EMULATOR_HOST, AUTH_PORT, 800))
      const dcFree2 = !(await waitPort(EMULATOR_HOST, DC_PORT, 800))
      log(`ports freed retry: ${AUTH_PORT} free=${authFree2}; ${DC_PORT} free=${dcFree2}`)
    }
    if (tmpRoot) {
      try {
        fs.rmSync(tmpRoot, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  }
}

main()