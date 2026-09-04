/**
 * PHASE G5.3 — Auth + Data Connect emulator smoke (demo-otgruzka ONLY).
 *
 * Requires live Auth emulator + DC emulator. Never claims PASS if Auth failed.
 * G53_ALLOW_MEMORY_FALLBACK is documented but MUST NOT claim Auth-chain PASS
 * (memory path exits with BLOCK for G5_AUTH_CHAIN_SMOKE).
 *
 * Usage:
 *   node scripts/g53-auth-dataconnect-smoke.mjs
 *
 * Env (set by script after scrub):
 *   GCLOUD_PROJECT=demo-otgruzka
 *   GOOGLE_CLOUD_PROJECT=demo-otgruzka
 *   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
 *   DATA_CONNECT_EMULATOR_HOST=127.0.0.1:9399
 *   FIREBASE_DATA_CONNECT_EMULATOR_HOST=127.0.0.1:9399
 *
 * No commit / push / deploy. Does not modify repo firebase.json or CURRENT_STATE.md.
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
const API_KEY = 'fake-api-key-g53'

const STORE_ID = 'fibercell-main'
const FOREIGN_STORE = 'foreign-store-g53'
const WH = 'wh-main'
const LOC = 'loc-1'
const FG_LOC = 'fg-loc'
const ITEM_A = 'item-film-g53a'
const ITEM_B = 'item-glue-g53b'
const FG_ID = 'fp-g53'
const CUST_ID = 'cust-g53'
const SUP_ID = 'sup-g53'
const BOM_ID = 'bom-g53'
const LOT_ID = 'lot-g53'
const DATE = '2026-09-04'
const ALLOW_MEMORY = String(process.env.G53_ALLOW_MEMORY_FALLBACK ?? '') === '1'

function log(msg) {
  process.stdout.write(`[g53-auth-smoke] ${msg}\n`)
}

function fail(msg) {
  process.stderr.write(`[g53-auth-smoke] FAIL: ${msg}\n`)
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
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'g53-demo-firebase-'))
  const dataDir = path.join(tmpRoot, 'dataconnect-data')
  fs.mkdirSync(dataDir, { recursive: true })
  const cfg = {
    emulators: {
      auth: { port: AUTH_PORT, host: EMULATOR_HOST },
      dataconnect: { port: DC_PORT, dataDir },
      ui: { enabled: false },
    },
    dataconnect: {
      // Absolute path — config lives outside fst-web
      source: dataconnectSourceAbs.replace(/\\/g, '/'),
    },
  }
  const cfgPath = path.join(tmpRoot, 'firebase.json')
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8')
  // .firebaserc for project alias
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
  // Prefer Admin SDK against Auth emulator (accounts:update disableUser is unreliable).
  const { initFirebaseAdmin, getAdminAuth } = await importApi('_adminAuth.mjs')
  initFirebaseAdmin()
  await getAdminAuth().updateUser(localId, { disabled: true })
  return { localId, disabled: true }
}

function allG5Caps() {
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
    'sales.order.cancel': true,
    'sales.priority.change': true,
    'sales.shipment.post': true,
    'sales.shipment.cancel': true,
    'planning.read': true,
    'planning.mrp.run': true,
    'planning.productionDraft.create': true,
    'planning.shortage.manage': true,
    'planning.manualProduction.create': true,
    'procurement.read': true,
    'procurement.draft.edit': true,
    'procurement.order.submit': true,
    'procurement.order.approve': true,
    'procurement.order.markOrdered': true,
    'procurement.order.cancel': true,
    'procurement.receipt.post': true,
    'procurement.payment.view': true,
    'procurement.payment.record': true,
    'warehouse.read': true,
    'warehouse.document.post': true,
    'packaging.read': true,
    'shipment.post': true,
    'shipment.cancel': true,
    productionLineIds: ['*'],
  }
}

async function loadCritical(g1, helpers, storeId) {
  const dc = g1.getG1DataConnect()
  const { data } = await g1.getFstCriticalStore(dc, { id: storeId })
  const row = data?.fstCriticalStore
  assert(row, 'critical store missing')
  return { dc, row, payload: JSON.parse(row.payloadJson) }
}

async function casWrite(g1, helpers, storeId, actorUid, mutate) {
  const { dc, row, payload } = await loadCritical(g1, helpers, storeId)
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

async function cmd(g5, actor, commandType, command, key, storeId = STORE_ID) {
  return g5.executeG5Command({
    actor,
    storeId,
    idempotencyKey: key,
    commandType,
    command,
  })
}

async function seedReleasedFgLot(g1, helpers, actor, runId) {
  const { dc, row, payload } = await loadCritical(g1, helpers, STORE_ID)
  let p = helpers.markProductionDomainActive(payload, actor.uid)
  p = helpers.markPackagingQcFeatureActive(p, actor.uid)
  p.domains.warehouse.movements = [
    ...(p.domains.warehouse.movements ?? []).filter((m) => m.id !== `seed-fg-${runId}`),
    {
      id: `seed-fg-${runId}`,
      type: 'receipt',
      warehouseId: WH,
      locationId: FG_LOC,
      itemId: FG_ID,
      quantity: 100,
      batchNo: 'LOT-G53',
      date: DATE,
      at: `${DATE}T00:00:00.000Z`,
    },
  ]
  p.domains.production.finishedGoodsLots = [
    ...(p.domains.production.finishedGoodsLots ?? []).filter((l) => l.id !== LOT_ID),
    {
      id: LOT_ID,
      finishedProductId: FG_ID,
      warehouseId: WH,
      locationId: FG_LOC,
      warehouseItemId: FG_ID,
      lotNumber: 'LOT-G53',
      qcStatus: 'released',
      quantityQcReleased: 50,
      quantityProduced: 50,
      quantityShipped: 0,
      lotRevision: 1,
      currentDecisionId: `dec-${runId}`,
    },
  ]
  p.domains.production.qcDecisions = [
    ...(p.domains.production.qcDecisions ?? []).filter((d) => d.id !== `dec-${runId}`),
    { id: `dec-${runId}`, lotId: LOT_ID, status: 'released', lotRevision: 1 },
  ]
  const json = helpers.serializeCriticalPayload(p)
  await g1.updateFstCriticalStoreCas(dc, {
    id: STORE_ID,
    expectedRevision: row.revision,
    revision: row.revision + 1,
    payloadJson: json,
    fingerprint: helpers.fingerprintCriticalPayload(json),
    updatedByUid: actor.uid,
  })
}

async function runAuthChainFlow(runId) {
  assert(String(process.env.GCLOUD_PROJECT) === PROJECT, 'GCLOUD_PROJECT must be demo-otgruzka')
  assert(
    !String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? '').trim(),
    'FIREBASE_SERVICE_ACCOUNT_JSON must be unset',
  )
  assert(
    String(process.env.FIREBASE_AUTH_EMULATOR_HOST) === `${EMULATOR_HOST}:${AUTH_PORT}`,
    'FIREBASE_AUTH_EMULATOR_HOST must point at Auth emulator',
  )

  const email = `g53-${runId}@example.com`
  const password = 'G53-Smoke-Pass-1!'

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
  log(`OK verifyBearerToken uid=${auth.uid} email=${auth.email || '(none)'}`)

  const verifiedActor = {
    uid: auth.uid,
    email: auth.email,
    claims: auth.claims ?? {},
  }

  const g1 = await importApi('_g1DataConnect.mjs')
  const g2 = await importApi('_g2WarehouseService.mjs')
  const g5 = await importApi('_g5SalesProcurementService.mjs')
  const helpers = await importApi('_g1CriticalHelpers.mjs')

  // Grant G5 caps via Admin DC (sysadmin bootstrap) AFTER Auth token proof.
  const sys = {
    uid: 'g53-sys',
    email: 'admin@fibercell.net',
    claims: { fstSysadmin: true },
  }
  const granted = await g2.grantPrincipalAccess({
    actor: sys,
    firebaseUid: verifiedActor.uid,
    storeId: STORE_ID,
    roleId: 'planner',
    capabilities: allG5Caps(),
  })
  assert(granted.ok, `grantPrincipalAccess: ${granted.error}`)
  log('OK FstPrincipalAccess upsert with G5 caps (after Auth verify)')

  const mdAct = await cmd(
    g5,
    verifiedActor,
    'masterdata.domain.activate',
    { reason: 'g53 auth smoke' },
    `g53-md-${runId}`,
  )
  assert(mdAct.ok, `masterdata activate: ${mdAct.error}`)
  log('OK masterdata.domain.activate')

  await casWrite(g1, helpers, STORE_ID, verifiedActor.uid, (p) => {
    const marked = helpers.markWarehouseDomainActive(p, verifiedActor.uid)
    p.domainMeta = marked.domainMeta
    p.domains = marked.domains
    p.domains.warehouse.locations = [
      { id: LOC, warehouseId: WH },
      { id: FG_LOC, warehouseId: WH },
      { id: WH },
    ]
  })
  log('OK warehouse domain active + locations')

  for (const [type, body, key] of [
    [
      'masterdata.item.upsert',
      {
        id: ITEM_A,
        code: 'FILM-G53A',
        name: 'Film G53A',
        baseUnit: 'kg',
        moq: 10,
        orderMultiple: 10,
        leadTimeDays: 5,
        defaultSupplierId: SUP_ID,
      },
      `g53-item-a-${runId}`,
    ],
    [
      'masterdata.item.upsert',
      {
        id: ITEM_B,
        code: 'GLUE-G53B',
        name: 'Glue G53B',
        baseUnit: 'kg',
        moq: 5,
        orderMultiple: 5,
        leadTimeDays: 3,
        defaultSupplierId: SUP_ID,
      },
      `g53-item-b-${runId}`,
    ],
    [
      'masterdata.product.upsert',
      { id: FG_ID, code: 'FP-G53', name: 'Panel G53', packagingBomId: BOM_ID },
      `g53-fp-${runId}`,
    ],
    [
      'masterdata.customer.upsert',
      { id: CUST_ID, code: 'C-G53', name: 'Customer G53' },
      `g53-cust-${runId}`,
    ],
    [
      'masterdata.supplier.upsert',
      { id: SUP_ID, code: 'S-G53', name: 'Supplier G53', suppliedItemIds: [ITEM_A, ITEM_B] },
      `g53-sup-${runId}`,
    ],
  ]) {
    const r = await cmd(g5, verifiedActor, type, body, key)
    assert(r.ok, `${type}: ${r.error}`)
  }
  log('OK masterdata item/product/customer/supplier')

  const bomUpsert = await cmd(
    g5,
    verifiedActor,
    'masterdata.bom.upsert',
    {
      id: BOM_ID,
      finishedProductId: FG_ID,
      components: [
        { itemId: ITEM_A, quantity: 2, unit: 'kg' },
        { itemId: ITEM_B, quantity: 0.5, unit: 'kg' },
      ],
    },
    `g53-bom-${runId}`,
  )
  assert(bomUpsert.ok, `bom.upsert: ${bomUpsert.error}`)
  const bomApprove = await cmd(
    g5,
    verifiedActor,
    'masterdata.bom.approve',
    { id: BOM_ID },
    `g53-bom-apr-${runId}`,
  )
  assert(bomApprove.ok, `bom.approve: ${bomApprove.error}`)
  log('OK bom upsert+approve (multi components)')

  const salesAct = await cmd(
    g5,
    verifiedActor,
    'sales.domain.activate',
    { reason: 'g53 auth smoke' },
    `g53-sp-${runId}`,
  )
  assert(salesAct.ok, `sales activate: ${salesAct.error}`)
  log('OK sales.domain.activate')

  const soId = `so-g53-${runId}`
  assert(
    (
      await cmd(
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
              quantity: 20,
              unit: 'm2',
              requestedShipDate: DATE,
            },
          ],
        },
        `g53-sod-${runId}`,
      )
    ).ok,
    'sales draft failed',
  )
  const confirmKey = `g53-soc-${runId}`
  assert(
    (await cmd(g5, verifiedActor, 'sales.order.confirm', { id: soId }, confirmKey)).ok,
    'sales confirm failed',
  )
  log(`OK sales draft+confirm order=${soId}`)

  const mrp1 = await cmd(g5, verifiedActor, 'planning.mrp.run', {}, `g53-mrp1-${runId}`)
  assert(mrp1.ok, `mrp.run: ${mrp1.error}`)
  log(`OK planning.mrp.run id=${mrp1.planningRunId}`)

  assert(
    (
      await cmd(
        g5,
        verifiedActor,
        'procurement.domain.activate',
        { reason: 'g53 auth smoke' },
        `g53-pr-${runId}`,
      )
    ).ok,
    'procurement activate failed',
  )
  log('OK procurement.domain.activate')

  let poId = null
  if ((mrp1.shortageCount ?? 0) > 0) {
    const gen = await cmd(
      g5,
      verifiedActor,
      'procurement.generateDraftsFromMrp',
      { planningRunId: mrp1.planningRunId },
      `g53-gen-${runId}`,
    )
    assert(gen.ok, `generateDraftsFromMrp: ${gen.error}`)
    poId = gen.draftIds?.[0] ?? null
  }
  if (!poId) {
    poId = `po-g53-${runId}`
    assert(
      (
        await cmd(
          g5,
          verifiedActor,
          'procurement.draft.edit',
          {
            id: poId,
            supplierId: SUP_ID,
            lines: [{ lineId: 'pol-1', itemId: ITEM_A, requestedQty: 40, unit: 'kg' }],
          },
          `g53-pedit-${runId}`,
        )
      ).ok,
      'procurement.draft.edit failed',
    )
  }
  log(`OK procurement draft po=${poId}`)

  assert(
    (await cmd(g5, verifiedActor, 'procurement.order.submit', { id: poId }, `g53-sub-${runId}`))
      .ok,
    'submit failed',
  )
  assert(
    (await cmd(g5, verifiedActor, 'procurement.order.approve', { id: poId }, `g53-apr-${runId}`))
      .ok,
    'approve failed',
  )
  assert(
    (
      await cmd(g5, verifiedActor, 'procurement.order.markOrdered', { id: poId }, `g53-ord-${runId}`)
    ).ok,
    'markOrdered failed',
  )
  log('OK submit → approve → markOrdered')

  const { payload: beforeRecv } = await loadCritical(g1, helpers, STORE_ID)
  const poBefore = (beforeRecv.domains.procurement.orders ?? []).find((o) => o.id === poId)
  assert(poBefore, 'PO missing')
  const lineId = poBefore.lines[0].lineId
  const requestedQty = Number(poBefore.lines[0].requestedQty) || 40
  const partialQty = Math.max(1, Math.floor(requestedQty / 2))

  const receipt = await cmd(
    g5,
    verifiedActor,
    'procurement.receipt.post',
    {
      purchaseOrderId: poId,
      warehouseId: WH,
      date: DATE,
      lines: [{ lineId, quantity: partialQty, locationId: LOC, batchNo: 'B-G53' }],
    },
    `g53-recv-${runId}`,
  )
  assert(receipt.ok, `receipt.post: ${receipt.error}`)
  log(`OK partial receipt qty=${partialQty}`)

  await seedReleasedFgLot(g1, helpers, verifiedActor, runId)
  const shipId = `shp-g53-${runId}`
  assert(
    (
      await cmd(
        g5,
        verifiedActor,
        'sales.shipment.post',
        {
          salesOrderId: soId,
          salesLineId: 'sol-1',
          shipmentId: shipId,
          finishedGoodsLotId: LOT_ID,
          finishedProductId: FG_ID,
          quantity: 5,
          warehouseId: WH,
          date: DATE,
        },
        `g53-ship-${runId}`,
      )
    ).ok,
    'shipment.post failed',
  )
  assert(
    (
      await cmd(
        g5,
        verifiedActor,
        'sales.shipment.cancel',
        { shipmentId: shipId, reason: 'g53 smoke', date: DATE },
        `g53-ship-cancel-${runId}`,
      )
    ).ok,
    'shipment.cancel failed',
  )
  log('OK shipment → cancel')

  // Foreign storeId → 403
  const foreign = await cmd(
    g5,
    verifiedActor,
    'planning.mrp.run',
    {},
    `g53-foreign-${runId}`,
    FOREIGN_STORE,
  )
  assert(foreign.ok === false && Number(foreign.status) === 403, 'foreign storeId must be 403')
  log('OK foreign storeId → 403')

  // Disable Auth user — verifyBearerToken / revoked check must fail
  await disableAuthUser(signed.localId)
  const afterDisable = await verifyBearerToken({
    headers: { authorization: `Bearer ${signed.idToken}` },
  })
  assert(
    afterDisable.ok === false,
    `disabled user token must fail verifyBearerToken (got ok=${afterDisable.ok})`,
  )
  log(`OK disabled Auth user → verifyBearerToken fails (${afterDisable.error})`)

  // Capability path with disabled principal also fails
  await g2.grantPrincipalAccess({
    actor: sys,
    firebaseUid: verifiedActor.uid,
    storeId: STORE_ID,
    roleId: 'planner',
    capabilities: allG5Caps(),
    active: false,
  })
  const revokedCmd = await cmd(
    g5,
    verifiedActor,
    'planning.mrp.run',
    {},
    `g53-revoked-${runId}`,
  )
  assert(revokedCmd.ok === false && Number(revokedCmd.status) === 403, 'revoked principal must 403')
  log('OK revoked/disabled principal → G5 403')

  const { row: finalRow, payload: finalPayload } = await loadCritical(g1, helpers, STORE_ID)
  return {
    mode: 'live-auth-dc-emulator',
    project: PROJECT,
    storeId: STORE_ID,
    criticalRevision: finalRow.revision,
    authUid: verifiedActor.uid,
    counts: {
      masterDataItems: finalPayload.domains.masterData?.items?.length ?? 0,
      packagingBoms: finalPayload.domains.masterData?.packagingBoms?.length ?? 0,
      salesOrders: finalPayload.domains.sales?.orders?.length ?? 0,
      planningRuns: finalPayload.domains.planning?.planningRuns?.length ?? 0,
      procurementOrders: finalPayload.domains.procurement?.orders?.length ?? 0,
      warehouseMovements: finalPayload.domains.warehouse?.movements?.length ?? 0,
    },
  }
}

async function main() {
  scrubProdEnv()
  const runId = String(Date.now())

  if (ALLOW_MEMORY) {
    fail(
      'BLOCK: G53_ALLOW_MEMORY_FALLBACK=1 is set but G5_AUTH_CHAIN_SMOKE never claims Auth PASS via memory fallback. Unset G53_ALLOW_MEMORY_FALLBACK and run with Auth+DC emulators.',
    )
    return
  }

  const repoFb = readRepoFirebaseJson()
  if (repoFb?.emulators?.auth) {
    log('repo firebase.json already declares emulators.auth — still using TEMP config outside repo')
  } else {
    log('repo firebase.json has NO emulators.auth — using TEMP config outside repo (not modifying repo)')
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
        return
      }
      await new Promise((r) => setTimeout(r, 5000))
      log(`Auth+DC emulators up auth=${AUTH_PORT} dc=${DC_PORT} project=${PROJECT}`)
    } else {
      log(`reusing Auth=${AUTH_PORT} DC=${DC_PORT}`)
    }

    await waitForSchemaReady()
    const summary = await runAuthChainFlow(runId)
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
    log(`SMOKE PASS (liveAuthDcEmulator=true project=${PROJECT})`)
    process.exitCode = 0
  } catch (err) {
    fail(err?.stack || String(err))
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
