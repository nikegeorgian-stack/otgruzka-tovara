/**
 * PHASE G5.2 — LIVE Data Connect emulator smoke (demo-otgruzka only).
 *
 * Auth: firebase.json has NO emulators.auth block — Auth emulator is NOT started.
 * Actors are in-process `{uid,email}` with FstPrincipalAccess upsert via Admin DC
 * (same pattern as g3/g4/g41 smokes). Production Auth / SA JSON is scrubbed.
 *
 * Default: must hit live DC on 127.0.0.1:9399. If emulator cannot start → exit 1
 * (no silent memory PASS). Set G52_ALLOW_MEMORY_FALLBACK=1 ONLY for offline CI —
 * then runs vitest memory suite and labels result MEMORY_FALLBACK (not live PASS).
 *
 * Usage:
 *   node scripts/g52-live-dataconnect-smoke.mjs
 *   G52_ALLOW_MEMORY_FALLBACK=1 node scripts/g52-live-dataconnect-smoke.mjs
 *
 * No commit / push / deploy. Does not touch .dataconnect/ or CURRENT_STATE.md.
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const fstWeb = path.join(repoRoot, 'fst-web')
const apiDir = path.join(repoRoot, 'server', 'fst')

const EMULATOR_HOST = '127.0.0.1'
const EMULATOR_PORT = 9399
const PROJECT = 'demo-otgruzka'
const FORBIDDEN_PROJECT = 'otgruzka-tovara'

const STORE_ID = 'fibercell-main'
const WH = 'wh-main'
const LOC = 'loc-1'
const FG_LOC = 'fg-loc'
const ITEM_ID = 'item-film-g52'
const FG_ID = 'fp-g52'
const CUST_ID = 'cust-g52'
const SUP_ID = 'sup-g52'
const BOM_ID = 'bom-g52'
const LOT_ID = 'lot-g52'
const DATE = '2026-09-04'
const ALLOW_MEMORY = String(process.env.G52_ALLOW_MEMORY_FALLBACK ?? '') === '1'

function log(msg) {
  process.stdout.write(`[g52-live-smoke] ${msg}\n`)
}

function fail(msg) {
  process.stderr.write(`[g52-live-smoke] FAIL: ${msg}\n`)
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

function documentAuthLimitation(firebaseJson) {
  const hasAuth = Boolean(firebaseJson?.emulators?.auth)
  if (!hasAuth) {
    log(
      'limitation: firebase.json has NO emulators.auth — Auth emulator not started; using in-process actor + FstPrincipalAccess Admin DC upsert (not production Auth)',
    )
  } else {
    log('limitation: auth emulator declared but G5.2 smoke still uses in-process actor (no ID tokens)')
  }
}

function startDataConnectEmulator() {
  log(`starting firebase emulators:start --only dataconnect --project ${PROJECT}`)
  const child = spawn(
    'firebase',
    ['emulators:start', '--only', 'dataconnect', '--project', PROJECT],
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
  log('stopping emulator process tree (Java/Postgres children)…')
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

async function cleanupExtraPorts() {
  if (process.platform === 'win32') {
    try {
      spawn(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `Get-NetTCPConnection -LocalPort ${EMULATOR_PORT} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`,
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

async function waitForSchemaReady(ms = 90000) {
  const start = Date.now()
  let lastErr = ''
  while (Date.now() - start < ms) {
    try {
      const g1 = await importApi('_g1DataConnect.mjs')
      const dc = g1.getG1DataConnect()
      await g1.getFstCriticalStore(dc, { id: STORE_ID })
      log('OK Data Connect schema ready (probe getFstCriticalStore)')
      return true
    } catch (err) {
      lastErr = String(err?.message || err)
      if (!/no schema found|UNAVAILABLE|ECONNREFUSED/i.test(lastErr)) {
        // Other errors (e.g. missing row) still mean schema is up
        log(`OK Data Connect schema ready (probe reached service: ${lastErr.slice(0, 120)})`)
        return true
      }
      await new Promise((r) => setTimeout(r, 1500))
    }
  }
  throw new Error(`Data Connect schema not ready after ${ms}ms: ${lastErr}`)
}

function allG5Caps() {
  return {
    'masterdata.read': true,
    'masterdata.item.manage': true,
    'masterdata.product.manage': true,
    'masterdata.customer.manage': true,
    'masterdata.supplier.manage': true,
    'masterdata.bom.manage': true,
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

async function cmd(g5, actor, commandType, command, key) {
  return g5.executeG5Command({
    actor,
    storeId: STORE_ID,
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
      batchNo: 'LOT-G52',
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
      lotNumber: 'LOT-G52',
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

function runMemoryFallback() {
  log('G52_ALLOW_MEMORY_FALLBACK=1 — running vitest memory suite (NOT a live DC PASS)…')
  const result = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    [
      'vitest',
      'run',
      'tests/g52BypassAndUiFailClosed.test.ts',
      'tests/g52UiGatewayMatrix.test.ts',
      'tests/g5SalesMrpProcurement.test.ts',
      'tests/g51ProcurementReceiptSafety.test.ts',
      'tests/g51SalesShipmentCas.test.ts',
      'tests/g51IssuedToLineMrp.test.ts',
    ],
    {
      cwd: repoRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        GCLOUD_PROJECT: PROJECT,
        GOOGLE_CLOUD_PROJECT: PROJECT,
      },
      shell: process.platform === 'win32',
    },
  )
  if (result.status !== 0) {
    fail('MEMORY_FALLBACK vitest failed')
    return
  }
  log('MEMORY_FALLBACK PASS (mocked DC — not live emulator)')
  process.exitCode = 0
}

async function runLiveFlow(runId) {
  const g1 = await importApi('_g1DataConnect.mjs')
  const g2 = await importApi('_g2WarehouseService.mjs')
  const g5 = await importApi('_g5SalesProcurementService.mjs')
  const helpers = await importApi('_g1CriticalHelpers.mjs')

  assert(String(process.env.GCLOUD_PROJECT) === PROJECT, 'GCLOUD_PROJECT must be demo-otgruzka')
  assert(
    !String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? '').trim(),
    'FIREBASE_SERVICE_ACCOUNT_JSON must be unset',
  )

  const sys = { uid: 'g52-sys', email: 'admin@fibercell.net', claims: { fstSysadmin: true } }
  const actor = { uid: `g52-user-${runId}`, email: 'g52@example.com', claims: {} }

  const granted = await g2.grantPrincipalAccess({
    actor: sys,
    firebaseUid: actor.uid,
    storeId: STORE_ID,
    roleId: 'planner',
    capabilities: allG5Caps(),
  })
  assert(granted.ok, `grantPrincipalAccess: ${granted.error}`)
  log('OK principal upsert (in-process actor, Admin DC)')

  const mdAct = await cmd(g5, actor, 'masterdata.domain.activate', { reason: 'g52 smoke' }, `g52-md-${runId}`)
  assert(mdAct.ok, `masterdata activate: ${mdAct.error}`)
  log('OK masterdata.domain.activate')

  await casWrite(g1, helpers, STORE_ID, actor.uid, (p) => {
    const marked = helpers.markWarehouseDomainActive(p, actor.uid)
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
        id: ITEM_ID,
        code: 'FILM-G52',
        name: 'Film G52',
        baseUnit: 'kg',
        moq: 10,
        orderMultiple: 10,
        leadTimeDays: 5,
        defaultSupplierId: SUP_ID,
      },
      `g52-item-${runId}`,
    ],
    [
      'masterdata.product.upsert',
      { id: FG_ID, code: 'FP-G52', name: 'Panel G52', packagingBomId: BOM_ID },
      `g52-fp-${runId}`,
    ],
    [
      'masterdata.customer.upsert',
      { id: CUST_ID, code: 'C-G52', name: 'Customer G52' },
      `g52-cust-${runId}`,
    ],
    [
      'masterdata.supplier.upsert',
      { id: SUP_ID, code: 'S-G52', name: 'Supplier G52', suppliedItemIds: [ITEM_ID] },
      `g52-sup-${runId}`,
    ],
    [
      'masterdata.bom.upsert',
      {
        id: BOM_ID,
        finishedProductId: FG_ID,
        version: 1,
        lines: [{ itemId: ITEM_ID, qty: 2, unit: 'kg' }],
      },
      `g52-bom-${runId}`,
    ],
  ]) {
    const r = await cmd(g5, actor, type, body, key)
    assert(r.ok, `${type}: ${r.error}`)
  }
  log('OK masterdata catalog upsert')

  const salesAct = await cmd(
    g5,
    actor,
    'sales.domain.activate',
    { reason: 'g52 smoke' },
    `g52-sp-${runId}`,
  )
  assert(salesAct.ok, `sales activate: ${salesAct.error}`)
  log('OK sales.domain.activate')

  const soId = `so-g52-${runId}`
  const draft = await cmd(
    g5,
    actor,
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
    `g52-sod-${runId}`,
  )
  assert(draft.ok, `sales draft: ${draft.error}`)
  const confirmKey = `g52-soc-${runId}`
  const confirmed = await cmd(g5, actor, 'sales.order.confirm', { id: soId }, confirmKey)
  assert(confirmed.ok, `sales confirm: ${confirmed.error}`)
  log(`OK sales draft+confirm order=${soId}`)

  const mrp1 = await cmd(g5, actor, 'planning.mrp.run', {}, `g52-mrp1-${runId}`)
  assert(mrp1.ok, `mrp.run: ${mrp1.error}`)
  assert(mrp1.planningRunId, 'planningRunId missing')
  log(
    `OK planning.mrp.run id=${mrp1.planningRunId} shortages=${mrp1.shortageCount ?? 0} hash=${mrp1.contentHash}`,
  )

  const procAct = await cmd(
    g5,
    actor,
    'procurement.domain.activate',
    { reason: 'g52 smoke' },
    `g52-pr-${runId}`,
  )
  assert(procAct.ok, `procurement activate: ${procAct.error}`)
  log('OK procurement.domain.activate')

  let poId = null
  if ((mrp1.shortageCount ?? 0) > 0) {
    const gen = await cmd(
      g5,
      actor,
      'procurement.generateDraftsFromMrp',
      { planningRunId: mrp1.planningRunId },
      `g52-gen-${runId}`,
    )
    assert(gen.ok, `generateDraftsFromMrp: ${gen.error}`)
    poId = gen.draftIds?.[0] ?? null
    if (poId) log(`OK generateDraftsFromMrp po=${poId}`)
    else log('WARN generateDraftsFromMrp returned no drafts — falling back to draft.edit')
  }
  if (!poId) {
    poId = `po-g52-${runId}`
    const edited = await cmd(
      g5,
      actor,
      'procurement.draft.edit',
      {
        id: poId,
        supplierId: SUP_ID,
        lines: [{ lineId: 'pol-1', itemId: ITEM_ID, requestedQty: 40, unit: 'kg' }],
      },
      `g52-pedit-${runId}`,
    )
    assert(edited.ok, `procurement.draft.edit: ${edited.error}`)
    log(`OK procurement.draft.edit po=${poId}`)
  }

  assert(
    (await cmd(g5, actor, 'procurement.order.submit', { id: poId }, `g52-sub-${runId}`)).ok,
    'submit failed',
  )
  assert(
    (await cmd(g5, actor, 'procurement.order.approve', { id: poId }, `g52-apr-${runId}`)).ok,
    'approve failed',
  )
  assert(
    (await cmd(g5, actor, 'procurement.order.markOrdered', { id: poId }, `g52-ord-${runId}`)).ok,
    'markOrdered failed',
  )
  log('OK submit → approve → markOrdered')

  const { payload: beforeRecv } = await loadCritical(g1, helpers, STORE_ID)
  const poBefore = (beforeRecv.domains.procurement.orders ?? []).find((o) => o.id === poId)
  assert(poBefore, 'PO missing after markOrdered')
  const lineId = poBefore.lines[0].lineId
  const requestedQty = Number(poBefore.lines[0].requestedQty) || 40
  const partialQty = Math.max(1, Math.floor(requestedQty / 2))
  const inboundBefore = requestedQty - (Number(poBefore.lines[0].receivedQty) || 0)

  const recvKey = `g52-recv-${runId}`
  const receipt = await cmd(
    g5,
    actor,
    'procurement.receipt.post',
    {
      purchaseOrderId: poId,
      warehouseId: WH,
      date: DATE,
      lines: [{ lineId, quantity: partialQty, locationId: LOC, batchNo: 'B-G52' }],
    },
    recvKey,
  )
  assert(receipt.ok, `receipt.post: ${receipt.error}`)
  assert(receipt.touchesWarehouse === true, 'receipt must touch warehouse')

  const { row: afterRecvRow, payload: afterRecv } = await loadCritical(g1, helpers, STORE_ID)
  const movements = afterRecv.domains.warehouse.movements ?? []
  assert(movements.length > 0, 'expected warehouse movements after receipt')
  const poAfter = (afterRecv.domains.procurement.orders ?? []).find((o) => o.id === poId)
  assert(Number(poAfter.lines[0].receivedQty) === partialQty, 'receivedQty mismatch')
  log(`OK partial receipt qty=${partialQty} movements=${movements.length} rev=${afterRecvRow.revision}`)

  const mrp2 = await cmd(g5, actor, 'planning.mrp.run', {}, `g52-mrp2-${runId}`)
  assert(mrp2.ok, `mrp re-run: ${mrp2.error}`)
  const { payload: afterMrp2 } = await loadCritical(g1, helpers, STORE_ID)
  const run2 = (afterMrp2.domains.planning.planningRuns ?? []).find((r) => r.id === mrp2.planningRunId)
  assert(run2, 'second planning run missing')
  const openAfter = Math.max(
    0,
    (Number(poAfter.lines[0].requestedQty) || 0) - (Number(poAfter.lines[0].receivedQty) || 0),
  )
  assert(openAfter < inboundBefore, `inbound open should drop after receipt (${openAfter} < ${inboundBefore})`)
  const supply = run2.supplyEvents ?? []
  const inboundEv = supply.filter((e) => e.kind === 'procurement_inbound' && e.itemId === ITEM_ID)
  const inboundQty = inboundEv.reduce((s, e) => s + (Number(e.qty) || 0), 0)
  assert(
    inboundQty <= openAfter + 0.01,
    `inbound supply ${inboundQty} must not exceed open ${openAfter}`,
  )
  log(`OK re-MRP inboundOpen=${openAfter} (was ${inboundBefore}) inboundSupply=${inboundQty}`)

  await seedReleasedFgLot(g1, helpers, actor, runId)
  log('OK seeded released FG lot (direct critical CAS)')

  const shipKey = `g52-ship-${runId}`
  const shipped = await cmd(
    g5,
    actor,
    'sales.shipment.post',
    {
      salesOrderId: soId,
      salesLineId: 'sol-1',
      shipmentId: `shp-g52-${runId}`,
      finishedGoodsLotId: LOT_ID,
      finishedProductId: FG_ID,
      quantity: 5,
      warehouseId: WH,
      date: DATE,
    },
    shipKey,
  )
  assert(shipped.ok, `sales.shipment.post: ${shipped.error}`)
  log('OK sales.shipment.post partial')

  const cancelShip = await cmd(
    g5,
    actor,
    'sales.shipment.cancel',
    { shipmentId: `shp-g52-${runId}`, reason: 'g52 smoke', date: DATE },
    `g52-ship-cancel-${runId}`,
  )
  assert(cancelShip.ok, `sales.shipment.cancel: ${cancelShip.error}`)
  log('OK sales.shipment.cancel')

  const confirmReplay = await cmd(g5, actor, 'sales.order.confirm', { id: soId }, confirmKey)
  assert(confirmReplay.ok && confirmReplay.idempotent === true, 'confirm replay must be idempotent')
  const receiptReplay = await cmd(
    g5,
    actor,
    'procurement.receipt.post',
    {
      purchaseOrderId: poId,
      warehouseId: WH,
      date: DATE,
      lines: [{ lineId, quantity: partialQty, locationId: LOC, batchNo: 'B-G52' }],
    },
    recvKey,
  )
  assert(receiptReplay.ok && receiptReplay.idempotent === true, 'receipt replay must be idempotent')
  log('OK idempotent confirm + receipt replay')

  let revisionConflict = false
  try {
    const { dc, row } = await loadCritical(g1, helpers, STORE_ID)
    const json = row.payloadJson
    await g1.updateFstCriticalStoreCas(dc, {
      id: STORE_ID,
      expectedRevision: Math.max(0, row.revision - 1),
      revision: row.revision + 1,
      payloadJson: json,
      fingerprint: helpers.fingerprintCriticalPayload(json),
      updatedByUid: actor.uid,
    })
  } catch {
    revisionConflict = true
  }
  log(`OK revision conflict attempt conflicted=${revisionConflict}`)

  const { row: finalRow, payload: finalPayload } = await loadCritical(g1, helpers, STORE_ID)
  return {
    mode: 'live-dc-emulator',
    project: PROJECT,
    storeId: STORE_ID,
    criticalRevision: finalRow.revision,
    counts: {
      masterDataItems: finalPayload.domains.masterData?.items?.length ?? 0,
      salesOrders: finalPayload.domains.sales?.orders?.length ?? 0,
      planningRuns: finalPayload.domains.planning?.planningRuns?.length ?? 0,
      shortages: (finalPayload.domains.planning?.shortages ?? []).filter((s) => s.status === 'open')
        .length,
      procurementOrders: finalPayload.domains.procurement?.orders?.length ?? 0,
      warehouseMovements: finalPayload.domains.warehouse?.movements?.length ?? 0,
      finishedGoodsLots: finalPayload.domains.production?.finishedGoodsLots?.length ?? 0,
    },
    keys: {
      planningRunId: mrp2.planningRunId,
      purchaseOrderId: poId,
      salesOrderId: soId,
      receiptIdempotencyKey: recvKey,
      shipmentIdempotencyKey: shipKey,
    },
    revisionConflictAttempted: true,
    revisionConflictObserved: revisionConflict,
  }
}

async function main() {
  scrubProdEnv()
  const runId = String(Date.now())
  documentAuthLimitation(readFirebaseJson())

  let emu = null
  let startedByUs = false

  try {
    if (!(await waitPort(EMULATOR_HOST, EMULATOR_PORT, 1500))) {
      try {
        emu = startDataConnectEmulator()
        startedByUs = true
      } catch (err) {
        if (ALLOW_MEMORY) {
          log(`emulator spawn failed (${err?.message || err}) — memory fallback`)
          runMemoryFallback()
          return
        }
        fail(`BLOCK: failed to spawn firebase CLI — ${err?.message || err}`)
        return
      }
      const ready = await waitPort(EMULATOR_HOST, EMULATOR_PORT, 120000)
      if (!ready) {
        const tail = emu?.getLog()?.slice(-2500) ?? ''
        if (ALLOW_MEMORY) {
          log(`emulator not ready — memory fallback\n${tail.slice(-500)}`)
          await stopEmulator(emu?.child)
          runMemoryFallback()
          return
        }
        fail(
          `BLOCK: Data Connect emulator did not open ${EMULATOR_HOST}:${EMULATOR_PORT}` +
            (/java|JDK|JRE/i.test(tail) ? ' (Java/JDK missing?)' : '') +
            (/firebase|not recognized|ENOENT/i.test(tail) ? ' (firebase CLI missing?)' : '') +
            `\n${tail}`,
        )
        await stopEmulator(emu?.child)
        return
      }
      await new Promise((r) => setTimeout(r, 4000))
      log(`live DC emulator listening on ${EMULATOR_HOST}:${EMULATOR_PORT} project=${PROJECT}`)
    } else {
      log(`reusing already-running DC emulator on ${EMULATOR_PORT}`)
    }

    await waitForSchemaReady()

    const summary = await runLiveFlow(runId)
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
    log(`SMOKE PASS (liveDcEmulator=true project=${PROJECT})`)
    process.exitCode = 0
  } catch (err) {
    fail(err?.stack || String(err))
  } finally {
    if (startedByUs && emu?.child) {
      await stopEmulator(emu.child)
      await cleanupExtraPorts()
    }
    const dcFree = !(await waitPort(EMULATOR_HOST, EMULATOR_PORT, 800))
    log(`port ${EMULATOR_PORT} free=${dcFree}`)
    if (startedByUs && !dcFree) {
      log('WARN: port 9399 still occupied after stop — check orphaned java/firebase/postgres processes')
    }
  }
}

main()
