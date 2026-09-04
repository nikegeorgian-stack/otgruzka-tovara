/**
 * PHASE G6 — Auth + Data Connect capacity smoke (demo-otgruzka ONLY).
 *
 * Flow: Auth → grant capacity caps → activate capacity → norms line1/line2 →
 * calendar + downtime → run → overload publish blocked → approve+publish →
 * forged payload rejected → stop emulators.
 *
 * Usage:
 *   node scripts/g6-auth-capacity-smoke.mjs
 *
 * AUTH_SMOKE=0 means PASS. Does not modify repo firebase.json, .dataconnect,
 * or CURRENT_STATE.md. No commit / push / deploy.
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
const API_KEY = 'fake-api-key-g6'

const STORE_ID = 'fibercell-main'
const FP = 'fp-g6-smoke'
const DATE = '2026-09-04'

function log(msg) {
  process.stdout.write(`[g6-auth-capacity-smoke] ${msg}\n`)
}

function fail(msg) {
  process.stderr.write(`[g6-auth-capacity-smoke] FAIL: ${msg}\n`)
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

function writeTempFirebaseConfig() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'g6-demo-firebase-'))
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
  return authJson('accounts:signUp', { email, password, returnSecureToken: true })
}

async function signInAuthUser(email, password) {
  return authJson('accounts:signInWithPassword', { email, password, returnSecureToken: true })
}

function capacityCaps() {
  return {
    'capacity.read': true,
    'capacity.norm.edit': true,
    'capacity.norm.approve': true,
    'capacity.calendar.edit': true,
    'capacity.run': true,
    'capacity.schedule.edit': true,
    'capacity.schedule.publish': true,
    'capacity.overload.approve': true,
    productionLineIds: ['*', '1', '2', 'pack'],
  }
}

async function loadCritical(g1, storeId) {
  const dc = g1.getG1DataConnect()
  const { data } = await g1.getFstCriticalStore(dc, { id: storeId })
  const row = data?.fstCriticalStore
  assert(row, 'critical store missing')
  return { dc, row, payload: JSON.parse(row.payloadJson) }
}

async function casSeedMasterAndOrders(g1, helpers, storeId, actorUid) {
  const { dc, row, payload } = await loadCritical(g1, storeId)
  let next = helpers.markMasterDataDomainActive(payload, actorUid)
  next.domains.masterData = {
    ...(next.domains.masterData ?? {}),
    finishedProducts: [
      {
        id: FP,
        code: 'FP-G6',
        name: 'G6 Film',
        active: true,
        validProductionLineIds: ['1', '2'],
        validPackagingLineIds: ['pack'],
      },
    ],
  }
  next.domains.production = {
    ...(next.domains.production ?? {}),
    orders: [
      {
        id: 'ord-g6-overload',
        status: 'confirmed',
        finishedProductId: FP,
        lineId: '1',
        totalQtyMp: 50000,
        priority: 5,
        dueDate: DATE,
        createdAt: new Date().toISOString(),
      },
    ],
    shiftReports: [],
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

async function cmdG6(g6, actor, commandType, command, key) {
  return g6.executeG6Command({
    actor,
    storeId: STORE_ID,
    idempotencyKey: key,
    commandType,
    command,
  })
}

async function runCapacitySmoke(runId) {
  assert(String(process.env.GCLOUD_PROJECT) === PROJECT, 'GCLOUD_PROJECT must be demo-otgruzka')
  assert(
    !String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? '').trim(),
    'FIREBASE_SERVICE_ACCOUNT_JSON must be unset',
  )
  assert(
    String(process.env.FIREBASE_AUTH_EMULATOR_HOST) === `${EMULATOR_HOST}:${AUTH_PORT}`,
    'FIREBASE_AUTH_EMULATOR_HOST must point at Auth emulator',
  )

  const email = `g6-${runId}@example.com`
  const password = 'G6-Smoke-Pass-1!'
  const signed = await createAuthUser(email, password).then(() => signInAuthUser(email, password))
  assert(signed?.idToken && signed?.localId, 'Auth emulator sign-in failed')
  log(`OK Auth uid=${signed.localId}`)

  const { verifyBearerToken } = await importApi('_qcAuth.mjs')
  const auth = await verifyBearerToken({
    headers: { authorization: `Bearer ${signed.idToken}` },
  })
  assert(auth.ok === true, `verifyBearerToken: ${auth.error}`)
  const actor = { uid: auth.uid, email: auth.email, claims: auth.claims ?? {} }

  const g1 = await importApi('_g1DataConnect.mjs')
  const g2 = await importApi('_g2WarehouseService.mjs')
  const g6 = await importApi('_g6CapacityService.mjs')
  const helpers = await importApi('_g1CriticalHelpers.mjs')

  const sys = {
    uid: 'g6-sys',
    email: 'admin@fibercell.net',
    claims: { fstSysadmin: true },
  }
  const granted = await g2.grantPrincipalAccess({
    actor: sys,
    firebaseUid: actor.uid,
    storeId: STORE_ID,
    roleId: 'planner',
    capabilities: capacityCaps(),
  })
  assert(granted.ok, `grantPrincipalAccess: ${granted.error}`)
  log('OK capacity caps granted')

  const act = await cmdG6(g6, actor, 'capacity.domain.activate', { reason: 'g6 smoke' }, `g6-act-${runId}`)
  assert(act.ok, `activate: ${act.error}`)
  assert(act.capacityPlanningActive === true, 'capacityPlanning must be active')
  log('OK capacity domain activated')

  await casSeedMasterAndOrders(g1, helpers, STORE_ID, actor.uid)
  log('OK seeded product + firm order')

  for (const [lineId, cap, key] of [
    ['1', 10, 'n1'],
    ['2', 40, 'n2'],
  ]) {
    const draft = await cmdG6(
      g6,
      actor,
      'capacity.norm.draft.save',
      {
        normId: `cn-${lineId}`,
        finishedProductId: FP,
        lineId,
        stage: 'production',
        capacityM2PerShift: cap,
        effectiveFrom: '2026-01-01',
      },
      `g6-${key}-draft-${runId}`,
    )
    assert(draft.ok, `norm draft ${lineId}: ${draft.error}`)
    const ap = await cmdG6(
      g6,
      actor,
      'capacity.norm.approve',
      { normId: draft.normId, version: draft.version },
      `g6-${key}-ap-${runId}`,
    )
    assert(ap.ok, `norm approve ${lineId}: ${ap.error}`)
  }
  const packDraft = await cmdG6(
    g6,
    actor,
    'capacity.norm.draft.save',
    {
      normId: 'cn-pack',
      finishedProductId: FP,
      lineId: 'pack',
      stage: 'packaging',
      capacityM2PerShift: 10000,
      effectiveFrom: '2026-01-01',
    },
    `g6-pack-draft-${runId}`,
  )
  assert(packDraft.ok, `pack draft: ${packDraft.error}`)
  const packAp = await cmdG6(
    g6,
    actor,
    'capacity.norm.approve',
    { normId: packDraft.normId, version: packDraft.version },
    `g6-pack-ap-${runId}`,
  )
  assert(packAp.ok, `pack approve: ${packAp.error}`)
  log('OK norms approved for line 1, 2, pack')

  const cal = await cmdG6(
    g6,
    actor,
    'capacity.calendar.upsert',
    { lineId: '1', date: DATE, shiftId: 'day', status: 'reduced', capacityFactor: 0.5 },
    `g6-cal-${runId}`,
  )
  assert(cal.ok, `calendar: ${cal.error}`)
  const dt = await cmdG6(
    g6,
    actor,
    'capacity.downtime.record',
    { lineId: '1', date: DATE, minutes: 60, reason: 'smoke downtime' },
    `g6-dt-${runId}`,
  )
  assert(dt.ok, `downtime: ${dt.error}`)
  // Recurring Mon–Fri templates for long horizon (no fixed 22×norm)
  for (const [lineId, stage] of [
    ['1', 'production'],
    ['2', 'production'],
    ['pack', 'packaging'],
  ]) {
    for (const wd of [1, 2, 3, 4, 5]) {
      const tpl = await cmdG6(
        g6,
        actor,
        'capacity.calendarTemplate.upsert',
        {
          templateId: `ctpl-${lineId}-${stage}-${wd}`,
          lineId,
          stage,
          weekday: wd,
          weekdayConvention: 'ISO_8601',
          shiftId: 'day',
          plannedMinutes: 480,
          capacityFactor: 1,
          effectiveFrom: '2026-01-01',
          effectiveTo: '2029-12-31',
        },
        `g6-tpl-${lineId}-${stage}-${wd}-${runId}`,
      )
      assert(tpl.ok, `template ${lineId}/${stage}/${wd}: ${tpl.error}`)
    }
  }
  log('OK calendar + downtime + templates')

  const run = await cmdG6(
    g6,
    actor,
    'capacity.run',
    { asOfDate: DATE, capacityRunId: `crun-${runId}` },
    `g6-run-${runId}`,
  )
  assert(run.ok, `capacity.run: ${run.error}`)
  assert(Number(run.overloadQuantity) > 0, 'expected overload for huge order')
  const scheduleId = run.scheduleId
  assert(scheduleId, 'scheduleId missing')
  log(`OK capacity.run overloadQuantity=${run.overloadQuantity}`)

  const blocked = await cmdG6(
    g6,
    actor,
    'capacity.schedule.publish',
    { scheduleId },
    `g6-pub-blocked-${runId}`,
  )
  assert(
    blocked.ok === false && blocked.error === 'overload_blocks_publish',
    `publish must block (got ${blocked.error})`,
  )
  log('OK overload blocks publish')

  const approved = await cmdG6(
    g6,
    actor,
    'capacity.overload.approve',
    { scheduleId, reason: 'director smoke approve' },
    `g6-ov-${runId}`,
  )
  assert(approved.ok, `overload approve: ${approved.error}`)
  const published = await cmdG6(
    g6,
    actor,
    'capacity.schedule.publish',
    { scheduleId },
    `g6-pub-${runId}`,
  )
  assert(published.ok, `publish after approve: ${published.error}`)
  assert(published.status === 'published', 'schedule not published')
  log('OK approve + publish')

  const forged = await g6.executeG6Command({
    actor,
    storeId: STORE_ID,
    idempotencyKey: `g6-forge-${runId}`,
    commandType: 'capacity.run',
    command: { asOfDate: DATE },
    payloadJson: '{"hack":true}',
  })
  assert(
    forged.ok === false && forged.error === 'forged_client_payload_rejected',
    `forged payload must reject (got ${forged.error})`,
  )
  const forgedRole = await g6.executeG6Command({
    actor,
    storeId: STORE_ID,
    idempotencyKey: `g6-forge-role-${runId}`,
    commandType: 'capacity.run',
    command: { asOfDate: DATE },
    roleId: 'admin',
  })
  assert(
    forgedRole.ok === false && forgedRole.error === 'client_role_not_proof',
    `forged roleId must reject (got ${forgedRole.error})`,
  )
  log('OK forged payload/role rejected')

  const { row: finalRow, payload: finalPayload } = await loadCritical(g1, STORE_ID)
  return {
    mode: 'live-auth-dc-emulator',
    project: PROJECT,
    storeId: STORE_ID,
    criticalRevision: finalRow.revision,
    authUid: actor.uid,
    scheduleId,
    overloadQuantity: run.overloadQuantity,
    norms: finalPayload.domains.capacity?.norms?.length ?? 0,
    schedules: finalPayload.domains.capacity?.schedules?.length ?? 0,
  }
}

async function main() {
  scrubProdEnv()
  const runId = String(Date.now())
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
      if (!authReady || !dcReady) {
        const tail = emu?.getLog()?.slice(-2000) ?? ''
        fail(`BLOCK: emulators not ready\n${tail}`)
        await stopEmulator(emu?.child)
        process.stdout.write('AUTH_SMOKE=1\n')
        return
      }
      await new Promise((r) => setTimeout(r, 5000))
      log(`Auth+DC emulators up auth=${AUTH_PORT} dc=${DC_PORT}`)
    } else {
      log(`reusing Auth=${AUTH_PORT} DC=${DC_PORT}`)
    }

    await waitForSchemaReady()
    const summary = await runCapacitySmoke(runId)
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
    log(`SMOKE PASS (project=${PROJECT})`)
    process.stdout.write('AUTH_SMOKE=0\n')
    process.exitCode = 0
  } catch (err) {
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
