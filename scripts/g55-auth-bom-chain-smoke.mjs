/**
 * PHASE G5.5 — Auth + packaging BOM chain smoke (demo-otgruzka ONLY).
 *
 * Happy path: Auth → caps → masterdata/sales/production/packagingQc → BOM →
 * sales → MRP → acceptProductionDrafts → G3 snapshot → G4 packaging.report
 * (norm/actual/deviation, warehouse issues, FG lot pending) + idempotency.
 *
 * Negatives: draft BOM ignored, stale accept, forged G3 snapshot ignored,
 * G4 unit/excess fails, missing cap 403, disabled Auth, revoked principal.
 *
 * Usage:
 *   node scripts/g55-auth-bom-chain-smoke.mjs
 *
 * Env (set by script after scrub):
 *   GCLOUD_PROJECT=demo-otgruzka
 *   GOOGLE_CLOUD_PROJECT=demo-otgruzka
 *   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
 *   DATA_CONNECT_EMULATOR_HOST=127.0.0.1:9399
 *   FIREBASE_DATA_CONNECT_EMULATOR_HOST=127.0.0.1:9399
 *
 * No commit / push / deploy. Does not modify repo firebase.json, .dataconnect,
 * or CURRENT_STATE.md.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const fstWeb = path.join(repoRoot, 'fst-web')
const apiDir = path.join(repoRoot, 'api', 'fst')
const dataconnectSourceAbs = path.join(fstWeb, 'dataconnect')

const EMULATOR_HOST = '127.0.0.1'
const AUTH_PORT = 9099
const DC_PORT = 9399
const PROJECT = 'demo-otgruzka'
const FORBIDDEN_PROJECT = 'otgruzka-tovara'
const API_KEY = 'fake-api-key-g55'

const STORE_ID = 'fibercell-main'
const WH = 'wh-main'
const LOC = 'loc-1'
const PACK_LOC = 'pack-loc'
const FG_LOC = 'fg-loc'
const ITEM_FILM = 'item-film-g55'
const ITEM_LABEL = 'item-label-g55'
const ITEM_CORNER = 'item-corner-g55'
const ITEM_WIP = 'wip-g55'
const FG_ID = 'fp-g55'
const FG_DRAFT = 'fp-g55-draft'
const CUST_ID = 'cust-g55'
const SUP_ID = 'sup-g55'
const BOM_ID = 'bom-g55'
const BOM_DRAFT = 'bom-g55-draft'
const RECIPE_ID = 'form-g55'
const DATE = '2026-09-04'
const OUTPUT_M2 = 10

function log(msg) {
  process.stdout.write(`[g55-auth-bom-smoke] ${msg}\n`)
}

function fail(msg) {
  process.stderr.write(`[g55-auth-bom-smoke] FAIL: ${msg}\n`)
  process.exitCode = 1
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg)
}

/** Scrub production credentials / project IDs (never hit otgruzka-tovara). */
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

function readRepoFirebaseJson() {
  try {
    return JSON.parse(fs.readFileSync(path.join(fstWeb, 'firebase.json'), 'utf8'))
  } catch {
    return null
  }
}

/**
 * Prefer TEMP firebase.json outside the repo so we do not modify fst-web/firebase.json.
 * Includes Auth + Data Connect emulator blocks.
 */
function writeTempFirebaseConfig() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'g55-demo-firebase-'))
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
  log(
    `starting firebase emulators:start --only auth,dataconnect --project ${PROJECT} --config ${cfgPath}`,
  )
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
  return authJson('accounts:signUp', {
    email,
    password,
    returnSecureToken: true,
  })
}

async function signInAuthUser(email, password) {
  return authJson('accounts:signInWithPassword', {
    email,
    password,
    returnSecureToken: true,
  })
}

async function disableAuthUser(localId) {
  const { initFirebaseAdmin, getAdminAuth } = await importApi('_adminAuth.mjs')
  initFirebaseAdmin()
  await getAdminAuth().updateUser(localId, { disabled: true })
  return { localId, disabled: true }
}

/** Minimal caps for G5 masterdata/sales/planning + G3 production + G4 packaging + warehouse. */
function chainCaps() {
  return {
    'masterdata.read': true,
    'masterdata.item.manage': true,
    'masterdata.product.manage': true,
    'masterdata.customer.manage': true,
    'masterdata.supplier.manage': true,
    'masterdata.bom.manage': true,
    'masterdata.bom.approve': true,
    'masterdata.archive': true,
    'sales.read': true,
    'sales.order.edit': true,
    'sales.order.confirm': true,
    'planning.read': true,
    'planning.mrp.run': true,
    'planning.productionDraft.create': true,
    'warehouse.read': true,
    'warehouse.document.post': true,
    'production.read': true,
    'production.recipe.draft.edit': true,
    'production.recipe.approve': true,
    'production.order.edit': true,
    'production.order.confirm': true,
    'packaging.read': true,
    'packaging.report.confirm': true,
    'packaging.report.edit': true,
    productionLineIds: ['*', '1', 'pack'],
  }
}

async function loadCritical(g1, storeId) {
  const dc = g1.getG1DataConnect()
  const { data } = await g1.getFstCriticalStore(dc, { id: storeId })
  const row = data?.fstCriticalStore
  assert(row, 'critical store missing')
  return { dc, row, payload: JSON.parse(row.payloadJson) }
}

async function casWrite(g1, helpers, storeId, actorUid, mutate) {
  const { dc, row, payload } = await loadCritical(g1, storeId)
  mutate(payload)
  const json = helpers.serializeCriticalPayload(payload)
  await g1.updateFstCriticalStoreCas(dc, {
    id: storeId,
    expectedRevision: row.revision,
    revision: row.revision + 1,
    payloadJson: json,
    fingerprint: helpers.fingerprintCriticalPayload(json),
    updatedByUid: actorUid,
  })
  return row.revision + 1
}

async function cmdG5(g5, actor, commandType, command, key, storeId = STORE_ID) {
  return g5.executeG5Command({
    actor,
    storeId,
    idempotencyKey: key,
    commandType,
    command,
  })
}

async function cmdG3(g3, actor, commandType, command, key, storeId = STORE_ID) {
  return g3.executeG3Command({
    actor,
    storeId,
    idempotencyKey: key,
    commandType,
    command,
  })
}

async function cmdG4(g4, actor, commandType, command, key, storeId = STORE_ID) {
  return g4.executeG4Command({
    actor,
    storeId,
    idempotencyKey: key,
    commandType,
    command,
  })
}

async function runAuthBomChain(runId) {
  assert(String(process.env.GCLOUD_PROJECT) === PROJECT, 'GCLOUD_PROJECT must be demo-otgruzka')
  assert(
    !String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? '').trim(),
    'FIREBASE_SERVICE_ACCOUNT_JSON must be unset',
  )
  assert(
    String(process.env.FIREBASE_AUTH_EMULATOR_HOST) === `${EMULATOR_HOST}:${AUTH_PORT}`,
    'FIREBASE_AUTH_EMULATOR_HOST must point at Auth emulator',
  )

  const email = `g55-${runId}@example.com`
  const password = 'G55-Smoke-Pass-1!'
  const noCapEmail = `g55-nocap-${runId}@example.com`
  const noCapPassword = 'G55-NoCap-Pass-1!'

  let signed
  try {
    await createAuthUser(email, password)
    signed = await signInAuthUser(email, password)
  } catch (err) {
    throw new Error(`Auth emulator user create/sign-in failed: ${err?.message || err}`)
  }
  assert(signed?.idToken, 'Auth emulator did not return idToken')
  assert(signed?.localId, 'Auth emulator did not return localId')
  log(`OK Auth emulator sign-in uid=${signed.localId}`)

  const { verifyBearerToken } = await importApi('_qcAuth.mjs')
  const auth = await verifyBearerToken({
    headers: { authorization: `Bearer ${signed.idToken}` },
  })
  assert(auth.ok === true, `verifyBearerToken failed: ${auth.error}`)
  assert(auth.uid === signed.localId, 'verified uid mismatch')
  log(`OK verifyBearerToken uid=${auth.uid}`)

  const verifiedActor = {
    uid: auth.uid,
    email: auth.email,
    claims: auth.claims ?? {},
  }

  const g1 = await importApi('_g1DataConnect.mjs')
  const g2 = await importApi('_g2WarehouseService.mjs')
  const g3 = await importApi('_g3ProductionService.mjs')
  const g4 = await importApi('_g4PackagingService.mjs')
  const g5 = await importApi('_g5SalesProcurementService.mjs')
  const helpers = await importApi('_g1CriticalHelpers.mjs')
  const bomHelpers = await importApi('_g5PackagingBomHelpers.mjs')

  const sys = {
    uid: 'g55-sys',
    email: 'admin@fibercell.net',
    claims: { fstSysadmin: true },
  }
  const granted = await g2.grantPrincipalAccess({
    actor: sys,
    firebaseUid: verifiedActor.uid,
    storeId: STORE_ID,
    roleId: 'planner',
    capabilities: chainCaps(),
  })
  assert(granted.ok, `grantPrincipalAccess: ${granted.error}`)
  log('OK FstPrincipalAccess upsert with G5+G3+G4 caps')

  // --- Activate domains ---
  const mdAct = await cmdG5(
    g5,
    verifiedActor,
    'masterdata.domain.activate',
    { reason: 'g55 auth bom smoke' },
    `g55-md-${runId}`,
  )
  assert(mdAct.ok, `masterdata activate: ${mdAct.error}`)

  const salesAct = await cmdG5(
    g5,
    verifiedActor,
    'sales.domain.activate',
    { reason: 'g55 auth bom smoke' },
    `g55-sp-${runId}`,
  )
  assert(salesAct.ok, `sales activate: ${salesAct.error}`)

  const prodAct = await cmdG3(
    g3,
    verifiedActor,
    'production.domain.activate',
    { reason: 'g55 auth bom smoke' },
    `g55-prod-${runId}`,
  )
  assert(prodAct.ok, `production activate: ${prodAct.error}`)

  const pkgAct = await cmdG4(
    g4,
    verifiedActor,
    'packaging.domain.activate',
    { reason: 'g55 auth bom smoke' },
    `g55-pkg-${runId}`,
  )
  assert(pkgAct.ok, `packaging activate: ${pkgAct.error}`)
  log('OK masterdata/sales/production/packagingQc activated')

  await casWrite(g1, helpers, STORE_ID, verifiedActor.uid, (p) => {
    const marked = helpers.markWarehouseDomainActive(p, verifiedActor.uid)
    p.domainMeta = marked.domainMeta
    p.domains = marked.domains
    p.domains.warehouse.locations = [
      { id: LOC, warehouseId: WH },
      { id: PACK_LOC, warehouseId: WH },
      { id: FG_LOC, warehouseId: WH },
      { id: WH },
    ]
    p.domains.warehouse.productionLineBindings = [
      {
        lineId: 'pack',
        packagingWarehouseId: WH,
        packagingLocationId: PACK_LOC,
        fgWarehouseId: WH,
        fgLocationId: FG_LOC,
      },
    ]
    p.domains.warehouse.movements = p.domains.warehouse.movements ?? []
    p.domains.warehouse.documents = p.domains.warehouse.documents ?? []
  })
  log('OK warehouse domain active + pack/fg bindings')

  // --- Masterdata: packaging materials + WIP + product + supplier + customer ---
  for (const [type, body, key] of [
    [
      'masterdata.item.upsert',
      {
        id: ITEM_FILM,
        code: 'FILM-G55',
        name: 'Film G55',
        baseUnit: 'pcs',
        moq: 1,
        active: true,
        defaultSupplierId: SUP_ID,
      },
      `g55-item-film-${runId}`,
    ],
    [
      'masterdata.item.upsert',
      {
        id: ITEM_LABEL,
        code: 'LBL-G55',
        name: 'Label G55',
        baseUnit: 'pcs',
        moq: 1,
        active: true,
        defaultSupplierId: SUP_ID,
      },
      `g55-item-lbl-${runId}`,
    ],
    [
      'masterdata.item.upsert',
      {
        id: ITEM_CORNER,
        code: 'CRN-G55',
        name: 'Corner G55',
        baseUnit: 'pcs',
        moq: 1,
        active: true,
        defaultSupplierId: SUP_ID,
      },
      `g55-item-crn-${runId}`,
    ],
    [
      'masterdata.item.upsert',
      {
        id: ITEM_WIP,
        code: 'WIP-G55',
        name: 'WIP G55',
        baseUnit: 'pcs',
        moq: 1,
        active: true,
      },
      `g55-item-wip-${runId}`,
    ],
    [
      'masterdata.product.upsert',
      {
        id: FG_ID,
        code: 'FP-G55',
        name: 'Panel G55',
        active: true,
        packagingBomId: BOM_ID,
      },
      `g55-fp-${runId}`,
    ],
    [
      'masterdata.product.upsert',
      {
        id: FG_DRAFT,
        code: 'FP-G55-DRAFT',
        name: 'Panel DraftOnly',
        active: true,
        packagingBomId: BOM_DRAFT,
      },
      `g55-fp-draft-${runId}`,
    ],
    [
      'masterdata.customer.upsert',
      { id: CUST_ID, code: 'C-G55', name: 'Customer G55', active: true },
      `g55-cust-${runId}`,
    ],
    [
      'masterdata.supplier.upsert',
      {
        id: SUP_ID,
        code: 'S-G55',
        name: 'Supplier G55',
        suppliedItemIds: [ITEM_FILM, ITEM_LABEL, ITEM_CORNER],
      },
      `g55-sup-${runId}`,
    ],
  ]) {
    const r = await cmdG5(g5, verifiedActor, type, body, key)
    assert(r.ok, `${type}: ${r.error}`)
  }
  log('OK masterdata items/product/customer/supplier (+ draft-only product)')

  // Draft BOM (never approved) — must be ignored by MRP / confirm paths
  const draftBom = await cmdG5(
    g5,
    verifiedActor,
    'masterdata.bom.upsert',
    {
      id: BOM_DRAFT,
      finishedProductId: FG_DRAFT,
      baseOutputQty: 1,
      components: [{ itemId: ITEM_FILM, quantity: 99, unit: 'pcs' }],
    },
    `g55-bom-draft-${runId}`,
  )
  assert(draftBom.ok, `draft bom.upsert: ${draftBom.error}`)

  const bomUpsert = await cmdG5(
    g5,
    verifiedActor,
    'masterdata.bom.upsert',
    {
      id: BOM_ID,
      finishedProductId: FG_ID,
      baseOutputQty: 1,
      components: [
        { itemId: ITEM_FILM, quantity: 2, unit: 'pcs', wasteFactor: 0.1 },
        { itemId: ITEM_LABEL, quantity: 1, unit: 'pcs' },
        { itemId: ITEM_CORNER, quantity: 4, unit: 'pcs', tolerance: 0.05 },
      ],
    },
    `g55-bom-${runId}`,
  )
  assert(bomUpsert.ok, `bom.upsert: ${bomUpsert.error}`)
  const bomApprove = await cmdG5(
    g5,
    verifiedActor,
    'masterdata.bom.approve',
    { id: BOM_ID },
    `g55-bom-apr-${runId}`,
  )
  assert(bomApprove.ok, `bom.approve: ${bomApprove.error}`)
  log('OK packaging BOM upsert+approve (multi components; draft BOM left draft)')

  // --- Sales draft + confirm ---
  const soId = `so-g55-${runId}`
  assert(
    (
      await cmdG5(
        g5,
        verifiedActor,
        'sales.order.draft.save',
        {
          id: soId,
          customerId: CUST_ID,
          priority: 1,
          lines: [
            {
              lineId: 'sol-1',
              finishedProductId: FG_ID,
              quantity: OUTPUT_M2,
              unit: 'm2',
              requestedShipDate: DATE,
            },
          ],
        },
        `g55-sod-${runId}`,
      )
    ).ok,
    'sales draft failed',
  )
  assert(
    (await cmdG5(g5, verifiedActor, 'sales.order.confirm', { id: soId }, `g55-soc-${runId}`)).ok,
    'sales confirm failed',
  )
  log(`OK sales draft+confirm order=${soId}`)

  // --- MRP: packagingBomRefs must have id/version/contentHash; draft BOM ignored ---
  const mrp1 = await cmdG5(
    g5,
    verifiedActor,
    'planning.mrp.run',
    { asOfDate: DATE },
    `g55-mrp1-${runId}`,
  )
  assert(mrp1.ok, `mrp.run: ${mrp1.error}`)
  const planningRunId = mrp1.planningRunId
  assert(planningRunId, 'mrp planningRunId missing')

  let { payload: afterMrp } = await loadCritical(g1, STORE_ID)
  const runRow = (afterMrp.domains.planning?.planningRuns ?? []).find((r) => r.id === planningRunId)
  assert(runRow, 'planning run missing in critical store')
  const refs = runRow.packagingBomRefs ?? []
  assert(refs.length > 0, 'packagingBomRefs empty')
  const mainRef = refs.find((r) => r.finishedProductId === FG_ID || r.packagingBomId === BOM_ID)
  assert(mainRef, 'packagingBomRefs missing approved FG BOM')
  assert(mainRef.packagingBomId, 'packagingBomRefs.packagingBomId missing')
  assert(mainRef.version != null, 'packagingBomRefs.version missing')
  assert(
    mainRef.contentHash && String(mainRef.contentHash).length > 8,
    'packagingBomRefs.contentHash missing',
  )
  assert(
    !refs.some((r) => r.packagingBomId === BOM_DRAFT),
    'draft BOM must not appear in packagingBomRefs',
  )
  log(
    `OK planning.mrp.run refs bom=${mainRef.packagingBomId} v=${mainRef.version} hash=${String(mainRef.contentHash).slice(0, 12)}…`,
  )

  // --- Negatives before accept: forged client BOM + stale after archive ---
  const forgedAccept = await cmdG5(
    g5,
    verifiedActor,
    'planning.mrp.acceptProductionDrafts',
    {
      planningRunId,
      packagingBomSnapshot: { packagingBomId: 'evil', version: 99, contentHash: 'x' },
    },
    `g55-accept-forged-${runId}`,
  )
  assert(
    forgedAccept.ok === false && forgedAccept.error === 'client_bom_forbidden',
    `forged accept must fail client_bom_forbidden (got ${forgedAccept.error})`,
  )
  log('OK forged packagingBomSnapshot on accept → client_bom_forbidden')

  // Stale path: archive BOM then accept must fail (then restore for happy path)
  const arch = await cmdG5(
    g5,
    verifiedActor,
    'masterdata.bom.archive',
    { id: BOM_ID },
    `g55-bom-arch-${runId}`,
  )
  assert(arch.ok, `bom.archive: ${arch.error}`)
  const staleAccept = await cmdG5(
    g5,
    verifiedActor,
    'planning.mrp.acceptProductionDrafts',
    { planningRunId },
    `g55-accept-stale-${runId}`,
  )
  assert(staleAccept.ok === false, 'stale accept must fail')
  assert(
    ['planning_run_stale', 'packaging_bom_required', 'packaging_bom_stale'].includes(
      staleAccept.error,
    ),
    `stale accept unexpected error: ${staleAccept.error}`,
  )
  log(`OK stale planning/BOM accept → ${staleAccept.error}`)

  // Restore: new approved BOM + product link + sales change refreshes recommendation + new MRP
  const bomId2 = `bom-g55-b-${runId}`
  assert(
    (
      await cmdG5(
        g5,
        verifiedActor,
        'masterdata.bom.upsert',
        {
          id: bomId2,
          finishedProductId: FG_ID,
          baseOutputQty: 1,
          components: [
            { itemId: ITEM_FILM, quantity: 2, unit: 'pcs', wasteFactor: 0.1 },
            { itemId: ITEM_LABEL, quantity: 1, unit: 'pcs' },
            { itemId: ITEM_CORNER, quantity: 4, unit: 'pcs', tolerance: 0.05 },
          ],
        },
        `g55-bom2-${runId}`,
      )
    ).ok,
    'bom2 upsert failed',
  )
  assert(
    (
      await cmdG5(g5, verifiedActor, 'masterdata.bom.approve', { id: bomId2 }, `g55-bom2-apr-${runId}`)
    ).ok,
    'bom2 approve failed',
  )
  assert(
    (
      await cmdG5(
        g5,
        verifiedActor,
        'masterdata.product.upsert',
        {
          id: FG_ID,
          code: 'FP-G55',
          name: 'Panel G55',
          active: true,
          packagingBomId: bomId2,
        },
        `g55-fp-relink-${runId}`,
      )
    ).ok,
    'product relink failed',
  )
  // New sales order so recommendation carries the restored BOM refs
  const soId2 = `so-g55-b-${runId}`
  assert(
    (
      await cmdG5(
        g5,
        verifiedActor,
        'sales.order.draft.save',
        {
          id: soId2,
          customerId: CUST_ID,
          priority: 1,
          lines: [
            {
              lineId: 'sol-1',
              finishedProductId: FG_ID,
              quantity: OUTPUT_M2,
              unit: 'm2',
              requestedShipDate: DATE,
            },
          ],
        },
        `g55-sod2-${runId}`,
      )
    ).ok,
    'sales2 draft failed',
  )
  assert(
    (await cmdG5(g5, verifiedActor, 'sales.order.confirm', { id: soId2 }, `g55-soc2-${runId}`)).ok,
    'sales2 confirm failed',
  )
  const mrp2 = await cmdG5(
    g5,
    verifiedActor,
    'planning.mrp.run',
    { asOfDate: DATE },
    `g55-mrp2-${runId}`,
  )
  assert(mrp2.ok, `mrp2: ${mrp2.error}`)
  const planningRunId2 = mrp2.planningRunId
  assert(planningRunId2, 'mrp2 planningRunId missing')

  ;({ payload: afterMrp } = await loadCritical(g1, STORE_ID))
  const runRow2 = (afterMrp.domains.planning?.planningRuns ?? []).find(
    (r) => r.id === planningRunId2,
  )
  const refs2 = runRow2?.packagingBomRefs ?? []
  const mainRef2 = refs2.find((r) => r.packagingBomId === bomId2)
  assert(mainRef2?.contentHash, 'restored MRP packagingBomRefs missing')
  assert(
    !refs2.some((r) => r.packagingBomId === BOM_DRAFT || r.packagingBomId === BOM_ID),
    'draft/retired BOM must not be in restored packagingBomRefs',
  )

  const rec = (afterMrp.domains.planning?.productionRecommendations ?? []).find(
    (r) => r.status === 'open' && r.salesOrderId === soId2,
  )
  assert(rec, 'open recommendation missing after sales2 confirm')

  const accept = await cmdG5(
    g5,
    verifiedActor,
    'planning.mrp.acceptProductionDrafts',
    {
      planningRunId: planningRunId2,
      recommendationIds: [rec.id],
    },
    `g55-accept-${runId}`,
  )
  assert(accept.ok, `acceptProductionDrafts: ${accept.error}`)
  const draft = accept.productionOrderDrafts?.[0]
  assert(draft, 'productionOrderDrafts empty')
  assert(draft.packagingBomId === bomId2, `draft packagingBomId=${draft.packagingBomId}`)
  assert(
    draft.packagingBomContentHash === mainRef2.contentHash,
    'draft packagingBomContentHash mismatch vs MRP ref',
  )
  assert(
    Array.isArray(draft.packagingRequirements) && draft.packagingRequirements.length === 3,
    'draft packagingRequirements must list 3 components',
  )
  assert(draft.planningRunId === planningRunId2, 'draft.planningRunId mismatch')
  log('OK acceptProductionDrafts trusted BOM refs on drafts')

  // --- G3: recipe → order draft (BOM refs from accept) → confirm (forged client snapshot ignored) ---
  assert(
    (
      await cmdG3(
        g3,
        verifiedActor,
        'production.recipe.draft.save',
        {
          versionId: `rv-g55-${runId}`,
          recipeId: RECIPE_ID,
          versionNumber: 1,
          components: [
            {
              warehouseItemId: ITEM_FILM,
              unitSnapshot: 'pcs',
              normQty: 0.01,
            },
          ],
          normBase: 'per_m2',
        },
        `g55-recipe-${runId}`,
      )
    ).ok,
    'recipe draft failed',
  )
  assert(
    (
      await cmdG3(
        g3,
        verifiedActor,
        'production.recipe.version.approve',
        { versionId: `rv-g55-${runId}` },
        `g55-recipe-apr-${runId}`,
      )
    ).ok,
    'recipe approve failed',
  )

  const orderId = `po-g55-${runId}`
  // Seed raw stock for G3 reservation before confirm
  await casWrite(g1, helpers, STORE_ID, verifiedActor.uid, (p) => {
    const mov = [...(p.domains.warehouse.movements ?? [])]
    mov.push({
      id: `seed-raw-${runId}`,
      type: 'receipt',
      warehouseId: WH,
      itemId: ITEM_FILM,
      quantity: 500,
      at: `${DATE}T00:00:00.000Z`,
      date: DATE,
    })
    p.domains.warehouse.movements = mov
  })

  assert(
    (
      await cmdG3(
        g3,
        verifiedActor,
        'production.order.draft.save',
        {
          orderId,
          finishedProductId: FG_ID,
          formulationRecipeId: RECIPE_ID,
          totalQtyMp: OUTPUT_M2,
          startDate: DATE,
          endDate: DATE,
          lineId: '1',
          packagingBomId: draft.packagingBomId,
          packagingBomVersion: draft.packagingBomVersion,
          packagingBomContentHash: draft.packagingBomContentHash,
        },
        `g55-pod-${runId}`,
      )
    ).ok,
    'production order draft failed',
  )

  const conf = await cmdG3(
    g3,
    verifiedActor,
    'production.order.confirm',
    {
      orderId,
      rawWarehouseId: WH,
      packagingBomSnapshot: {
        packagingBomId: 'forged',
        version: 9,
        contentHash: 'nope',
      },
    },
    `g55-poc-${runId}`,
  )
  assert(conf.ok, `production.order.confirm: ${conf.error}`)
  const { payload: afterConfirm } = await loadCritical(g1, STORE_ID)
  const order = (afterConfirm.domains.production?.orders ?? []).find((o) => o.id === orderId)
  assert(order?.status === 'active', 'order not active after confirm')
  assert(order.packagingBomSnapshot, 'immutable packagingBomSnapshot missing')
  assert(
    order.packagingBomSnapshot.packagingBomId === bomId2,
    `forged client snapshot must be ignored (got ${order.packagingBomSnapshot.packagingBomId})`,
  )
  assert(
    order.packagingBomSnapshot.contentHash === draft.packagingBomContentHash ||
      order.packagingBomSnapshot.contentHash === conf.packagingBomContentHash,
    'packagingBomSnapshot contentHash mismatch',
  )
  const frozenHash = order.packagingBomSnapshot.contentHash
  log(`OK G3 confirm authoritative packagingBomSnapshot hash=${String(frozenHash).slice(0, 12)}…`)

  // --- Seed pack-location materials + WIP bound to production order (G4 pattern) ---
  await casWrite(g1, helpers, STORE_ID, verifiedActor.uid, (p) => {
    const mov = [...(p.domains.warehouse.movements ?? [])]
    for (const [id, itemId] of [
      [`seed-pack-film-${runId}`, ITEM_FILM],
      [`seed-pack-lbl-${runId}`, ITEM_LABEL],
      [`seed-pack-crn-${runId}`, ITEM_CORNER],
    ]) {
      mov.push({
        id,
        type: 'receipt',
        warehouseId: WH,
        locationId: PACK_LOC,
        itemId,
        quantity: 500,
        at: `${DATE}T01:00:00.000Z`,
        date: DATE,
      })
    }
    mov.push({
      id: `seed-wip-${runId}`,
      type: 'receipt',
      warehouseId: WH,
      locationId: PACK_LOC,
      itemId: ITEM_WIP,
      quantity: 50,
      at: `${DATE}T01:00:00.000Z`,
      date: DATE,
      productionOrderId: orderId,
      isWip: true,
      batchNo: 'WB-G55',
    })
    p.domains.warehouse.movements = mov
  })
  log('OK seeded pack-location materials + WIP bound to production order')

  const snap = order.packagingBomSnapshot
  const reqs = bomHelpers.computePackagingRequirements(snap, OUTPUT_M2)
  assert(reqs.length === 3, 'computePackagingRequirements expected 3 lines')

  // --- G4 negatives: unit mismatch, excess without reason ---
  const unitBad = await cmdG4(
    g4,
    verifiedActor,
    'packaging.report.confirm',
    {
      productionOrderId: orderId,
      lineId: 'pack',
      reportDate: DATE,
      reportKey: `pkg-unit-${runId}`,
      finishedProductId: FG_ID,
      warehouseItemId: FG_ID,
      outputM2: OUTPUT_M2,
      outputRolls: 1,
      wipLines: [
        {
          semiFinishedItemId: ITEM_WIP,
          quantity: 1,
          wipBatchId: 'WB-G55',
          unitSnapshot: 'pcs',
        },
      ],
      materialLines: reqs.map((r) => ({
        itemId: r.itemId,
        quantity: r.normQty,
        unitSnapshot: 'kg',
      })),
    },
    `g55-pkg-unit-${runId}`,
  )
  assert(
    unitBad.ok === false && unitBad.error === 'packaging_unit_mismatch',
    `unit mismatch must fail (got ${unitBad.error})`,
  )
  log('OK G4 unit mismatch → packaging_unit_mismatch')

  const excessBad = await cmdG4(
    g4,
    verifiedActor,
    'packaging.report.confirm',
    {
      productionOrderId: orderId,
      lineId: 'pack',
      reportDate: DATE,
      reportKey: `pkg-excess-${runId}`,
      finishedProductId: FG_ID,
      warehouseItemId: FG_ID,
      outputM2: OUTPUT_M2,
      outputRolls: 1,
      wipLines: [
        {
          semiFinishedItemId: ITEM_WIP,
          quantity: 1,
          wipBatchId: 'WB-G55',
          unitSnapshot: 'pcs',
        },
      ],
      materialLines: reqs.map((r) => ({
        itemId: r.itemId,
        quantity: r.itemId === ITEM_FILM ? r.normQty * 2 : r.normQty,
        unitSnapshot: r.unit,
      })),
    },
    `g55-pkg-excess-${runId}`,
  )
  assert(
    excessBad.ok === false && excessBad.error === 'packaging_excess_reason_required',
    `excess without reason must fail (got ${excessBad.error})`,
  )
  log('OK G4 excess without reason → packaging_excess_reason_required')

  // --- Capability missing → 403 ---
  let noCapSigned
  try {
    await createAuthUser(noCapEmail, noCapPassword)
    noCapSigned = await signInAuthUser(noCapEmail, noCapPassword)
  } catch (err) {
    throw new Error(`no-cap Auth user failed: ${err?.message || err}`)
  }
  const noCapAuth = await verifyBearerToken({
    headers: { authorization: `Bearer ${noCapSigned.idToken}` },
  })
  assert(noCapAuth.ok, 'no-cap verifyBearerToken failed')
  await g2.grantPrincipalAccess({
    actor: sys,
    firebaseUid: noCapAuth.uid,
    storeId: STORE_ID,
    roleId: 'viewer',
    capabilities: {
      'packaging.read': true,
      'warehouse.read': true,
      // deliberately no packaging.report.confirm
    },
  })
  const noCapActor = {
    uid: noCapAuth.uid,
    email: noCapAuth.email,
    claims: noCapAuth.claims ?? {},
  }
  const forbiddenPkg = await cmdG4(
    g4,
    noCapActor,
    'packaging.report.confirm',
    {
      productionOrderId: orderId,
      lineId: 'pack',
      reportDate: DATE,
      reportKey: `pkg-nocap-${runId}`,
      finishedProductId: FG_ID,
      warehouseItemId: FG_ID,
      outputM2: OUTPUT_M2,
      outputRolls: 1,
      wipLines: [
        {
          semiFinishedItemId: ITEM_WIP,
          quantity: 1,
          wipBatchId: 'WB-G55',
          unitSnapshot: 'pcs',
        },
      ],
      materialLines: reqs.map((r) => ({
        itemId: r.itemId,
        quantity: r.normQty,
        unitSnapshot: r.unit,
      })),
    },
    `g55-pkg-nocap-${runId}`,
  )
  assert(
    forbiddenPkg.ok === false && Number(forbiddenPkg.status) === 403,
    `missing cap must 403 (got ok=${forbiddenPkg.ok} status=${forbiddenPkg.status} err=${forbiddenPkg.error})`,
  )
  log('OK request without packaging.report.confirm → 403')

  // --- Happy G4 confirm ---
  // NOTE: must NOT reuse packaging.domain.activate idempotency key (`g55-pkg-${runId}`).
  const reportKey = `pkg-g55-${runId}`
  const packKey = `g55-pkg-confirm-${runId}`
  const pack = await cmdG4(
    g4,
    verifiedActor,
    'packaging.report.confirm',
    {
      productionOrderId: orderId,
      lineId: 'pack',
      reportDate: DATE,
      reportKey,
      finishedProductId: FG_ID,
      warehouseItemId: FG_ID,
      outputM2: OUTPUT_M2,
      outputRolls: 1,
      wipLines: [
        {
          semiFinishedItemId: ITEM_WIP,
          quantity: OUTPUT_M2,
          wipBatchId: 'WB-G55',
          unitSnapshot: 'pcs',
        },
      ],
      materialLines: reqs.map((r) => ({
        itemId: r.itemId,
        quantity: r.normQty,
        unitSnapshot: r.unit,
      })),
    },
    packKey,
  )
  assert(pack.ok, `packaging.report.confirm: ${pack.error}`)
  assert(
    pack.qcStatus === 'pending' || pack.finishedGoodsLotId,
    `FG lot expected (got finishedGoodsLotId=${pack.finishedGoodsLotId} qcStatus=${pack.qcStatus} reportId=${pack.reportId} idempotent=${pack.idempotent})`,
  )

  const { payload: afterPack } = await loadCritical(g1, STORE_ID)
  const report = (afterPack.domains.production?.packagingReports ?? []).find(
    (r) => r.idempotencyKey === reportKey || r.id === pack.reportId,
  )
  assert(report, 'packaging report missing')
  assert(report.packagingBomId === snap.packagingBomId, 'report packagingBomId mismatch')
  assert(
    report.packagingBomContentHash === snap.contentHash,
    'report packagingBomContentHash mismatch',
  )
  assert(
    Array.isArray(report.packagingComponentNorms) && report.packagingComponentNorms.length === 3,
    'packagingComponentNorms missing',
  )
  for (const c of report.packagingComponentNorms) {
    assert(c.normQty != null, 'normQty missing')
    assert(c.actualQty != null, 'actualQty missing')
    assert(c.deviation != null, 'deviation missing')
  }
  const lot = (afterPack.domains.production?.finishedGoodsLots ?? []).find(
    (l) => l.id === pack.finishedGoodsLotId || l.packagingReportId === report.id,
  )
  assert(lot, 'FG lot missing')
  assert(lot.qcStatus === 'pending', `FG lot qcStatus expected pending, got ${lot.qcStatus}`)

  const materialItemIds = new Set([ITEM_FILM, ITEM_LABEL, ITEM_CORNER])
  const issueItemIds = new Set()
  for (const m of afterPack.domains.warehouse?.movements ?? []) {
    if (
      m.type === 'issue' &&
      materialItemIds.has(m.itemId) &&
      (m.packagingReportId === report.id || m.productionOrderId === orderId)
    ) {
      issueItemIds.add(m.itemId)
    }
  }
  for (const d of afterPack.domains.warehouse?.documents ?? []) {
    if (d.docRole === 'packaging_material_consumption') {
      for (const line of d.lines ?? []) {
        if (materialItemIds.has(line.itemId)) issueItemIds.add(line.itemId)
      }
    }
  }
  assert(
    issueItemIds.has(ITEM_FILM) && issueItemIds.has(ITEM_LABEL) && issueItemIds.has(ITEM_CORNER),
    `warehouse packaging issue movements missing stable itemIds (got ${[...issueItemIds].join(',')})`,
  )
  log('OK G4 packaging.report.confirm norm/actual/deviation + issues + FG pending')

  // --- Idempotent replay ---
  const lotsBefore = (afterPack.domains.production?.finishedGoodsLots ?? []).length
  const issuesBefore = (afterPack.domains.warehouse?.movements ?? []).filter(
    (m) =>
      m.type === 'issue' &&
      materialItemIds.has(m.itemId) &&
      (m.packagingReportId === report.id || m.productionOrderId === orderId),
  ).length
  const pack2 = await cmdG4(
    g4,
    verifiedActor,
    'packaging.report.confirm',
    {
      productionOrderId: orderId,
      lineId: 'pack',
      reportDate: DATE,
      reportKey,
      finishedProductId: FG_ID,
      warehouseItemId: FG_ID,
      outputM2: OUTPUT_M2,
      outputRolls: 1,
      wipLines: [
        {
          semiFinishedItemId: ITEM_WIP,
          quantity: OUTPUT_M2,
          wipBatchId: 'WB-G55',
          unitSnapshot: 'pcs',
        },
      ],
      materialLines: reqs.map((r) => ({
        itemId: r.itemId,
        quantity: r.normQty,
        unitSnapshot: r.unit,
      })),
    },
    packKey,
  )
  assert(pack2.ok, `idempotent packaging.report.confirm: ${pack2.error}`)
  assert(pack2.idempotent === true, 'second confirm must be idempotent')
  const { payload: afterIdem } = await loadCritical(g1, STORE_ID)
  const lotsAfter = (afterIdem.domains.production?.finishedGoodsLots ?? []).length
  const issuesAfter = (afterIdem.domains.warehouse?.movements ?? []).filter(
    (m) =>
      m.type === 'issue' &&
      materialItemIds.has(m.itemId) &&
      (m.packagingReportId === report.id || m.productionOrderId === orderId),
  ).length
  assert(lotsAfter === lotsBefore, 'idempotent replay must not create second FG lot')
  assert(issuesAfter === issuesBefore, 'idempotent replay must not create extra issue movements')
  log('OK idempotent packaging.report.confirm (same reportKey/idempotencyKey)')

  // --- Optional: parallel G5 CAS race → one 409 ---
  let raceNote = 'skipped'
  try {
    const [a, b] = await Promise.all([
      cmdG5(
        g5,
        verifiedActor,
        'masterdata.item.upsert',
        {
          id: `race-a-${runId}`,
          code: `RACE-A-${runId}`.slice(0, 24),
          name: 'Race A',
          baseUnit: 'pcs',
          moq: 1,
          active: true,
        },
        `g55-race-a-${runId}`,
      ),
      cmdG5(
        g5,
        verifiedActor,
        'masterdata.item.upsert',
        {
          id: `race-b-${runId}`,
          code: `RACE-B-${runId}`.slice(0, 24),
          name: 'Race B',
          baseUnit: 'pcs',
          moq: 1,
          active: true,
        },
        `g55-race-b-${runId}`,
      ),
    ])
    const statuses = [a, b].map((r) => ({ ok: r.ok, error: r.error, status: r.status }))
    const conflicts = statuses.filter(
      (s) => s.ok === false && (s.error === 'revision_conflict' || Number(s.status) === 409),
    )
    if (conflicts.length >= 1) {
      raceNote = 'one_409_ok'
      log('OK parallel G5 race → at least one revision_conflict/409')
    } else if (statuses.every((s) => s.ok)) {
      raceNote = 'skipped_both_ok_serialized'
      log('SKIP parallel G5 race (both succeeded — leave deterministic unit test to cover 409)')
    } else {
      raceNote = `skipped_unexpected_${JSON.stringify(statuses)}`
      log(`SKIP parallel G5 race unexpected: ${JSON.stringify(statuses)}`)
    }
  } catch (err) {
    raceNote = `skipped_error_${String(err?.message || err).slice(0, 80)}`
    log(`SKIP parallel G5 race error: ${err?.message || err}`)
  }

  // --- Disabled Auth user ---
  await disableAuthUser(signed.localId)
  const afterDisable = await verifyBearerToken({
    headers: { authorization: `Bearer ${signed.idToken}` },
  })
  assert(
    afterDisable.ok === false,
    `disabled user token must fail verifyBearerToken (got ok=${afterDisable.ok})`,
  )
  log(`OK disabled Auth user → verifyBearerToken fails (${afterDisable.error})`)

  // --- Revoked principal → G5/G3 403 ---
  await g2.grantPrincipalAccess({
    actor: sys,
    firebaseUid: verifiedActor.uid,
    storeId: STORE_ID,
    roleId: 'planner',
    capabilities: chainCaps(),
    active: false,
  })
  const revokedG5 = await cmdG5(
    g5,
    verifiedActor,
    'planning.mrp.run',
    { asOfDate: DATE },
    `g55-revoked-g5-${runId}`,
  )
  assert(
    revokedG5.ok === false && Number(revokedG5.status) === 403,
    `revoked principal G5 must 403 (got ${revokedG5.status} ${revokedG5.error})`,
  )
  const revokedG3 = await cmdG3(
    g3,
    verifiedActor,
    'production.read',
    {},
    `g55-revoked-g3-${runId}`,
  )
  assert(
    revokedG3.ok === false && Number(revokedG3.status) === 403,
    `revoked principal G3 must 403 (got ${revokedG3.status} ${revokedG3.error})`,
  )
  log('OK revoked principal → G5/G3 403')

  const { row: finalRow, payload: finalPayload } = await loadCritical(g1, STORE_ID)
  return {
    mode: 'live-auth-dc-emulator',
    project: PROJECT,
    storeId: STORE_ID,
    criticalRevision: finalRow.revision,
    authUid: verifiedActor.uid,
    packagingBomId: bomId2,
    packagingBomContentHash: frozenHash,
    planningRunId: planningRunId2,
    productionOrderId: orderId,
    packagingReportId: pack.reportId ?? report.id,
    finishedGoodsLotId: pack.finishedGoodsLotId ?? lot.id,
    race: raceNote,
    counts: {
      masterDataItems: finalPayload.domains.masterData?.items?.length ?? 0,
      packagingBoms: finalPayload.domains.masterData?.packagingBoms?.length ?? 0,
      salesOrders: finalPayload.domains.sales?.orders?.length ?? 0,
      planningRuns: finalPayload.domains.planning?.planningRuns?.length ?? 0,
      productionOrders: finalPayload.domains.production?.orders?.length ?? 0,
      packagingReports: finalPayload.domains.production?.packagingReports?.length ?? 0,
      finishedGoodsLots: finalPayload.domains.production?.finishedGoodsLots?.length ?? 0,
      warehouseMovements: finalPayload.domains.warehouse?.movements?.length ?? 0,
    },
  }
}

async function main() {
  scrubProdEnv()
  const runId = String(Date.now())
  let authSmoke = 0

  const repoFb = readRepoFirebaseJson()
  if (repoFb?.emulators?.auth) {
    log('repo firebase.json already declares emulators.auth — still using TEMP config outside repo')
  } else {
    log(
      'repo firebase.json has NO emulators.auth — using TEMP config outside repo (not modifying repo)',
    )
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
        process.stdout.write('AUTH_SMOKE=1\n')
        return
      }
      const authReady = await waitPort(EMULATOR_HOST, AUTH_PORT, 120000)
      const dcReady = await waitPort(EMULATOR_HOST, DC_PORT, 120000)
      if (!authReady) {
        const tail = emu?.getLog()?.slice(-2000) ?? ''
        fail(
          `BLOCK: Auth emulator did not open ${EMULATOR_HOST}:${AUTH_PORT}` +
            (/firebase|not recognized|ENOENT/i.test(tail) ? ' (firebase CLI missing?)' : '') +
            `\n${tail}`,
        )
        await stopEmulator(emu?.child)
        process.stdout.write('AUTH_SMOKE=1\n')
        return
      }
      if (!dcReady) {
        const tail = emu?.getLog()?.slice(-2000) ?? ''
        fail(
          `BLOCK: Data Connect emulator did not open ${EMULATOR_HOST}:${DC_PORT}` +
            (/java|JDK|JRE/i.test(tail) ? ' (Java/JDK missing?)' : '') +
            `\n${tail}`,
        )
        await stopEmulator(emu?.child)
        process.stdout.write('AUTH_SMOKE=1\n')
        return
      }
      await new Promise((r) => setTimeout(r, 5000))
      log(`Auth+DC emulators up auth=${AUTH_PORT} dc=${DC_PORT} project=${PROJECT}`)
    } else {
      log(`reusing Auth=${AUTH_PORT} DC=${DC_PORT}`)
    }

    await waitForSchemaReady()
    const summary = await runAuthBomChain(runId)
    authSmoke = 0
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
    log(`SMOKE PASS (liveAuthDcEmulator=true project=${PROJECT})`)
    // Match g53: AUTH_SMOKE=0 means PASS.
    process.stdout.write('AUTH_SMOKE=0\n')
    process.exitCode = 0
  } catch (err) {
    authSmoke = 1
    fail(err?.stack || String(err))
    process.stdout.write('AUTH_SMOKE=1\n')
    process.exitCode = 1
  } finally {
    if (startedByUs && emu?.child) {
      await stopEmulator(emu.child)
      await cleanupPorts()
    }
    const authFree = !(await waitPort(EMULATOR_HOST, AUTH_PORT, 800))
    const dcFree = !(await waitPort(EMULATOR_HOST, DC_PORT, 800))
    log(`port ${AUTH_PORT} free=${authFree}; port ${DC_PORT} free=${dcFree}`)
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
