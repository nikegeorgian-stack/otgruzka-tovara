/**
 * LIVE G2 Admin SDK smoke against local Data Connect emulator only.
 * Project: demo-otgruzka — no production credentials / reads / writes / deploy.
 *
 * Usage: node scripts/g2-warehouse-emulator-smoke.mjs
 */
import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import fs from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const fstWeb = path.join(repoRoot, 'fst-web')

const EMULATOR_HOST = '127.0.0.1'
const EMULATOR_PORT = 9399
const PROJECT = 'demo-otgruzka'

const steps = []
function log(msg) {
  process.stdout.write(`[g2-smoke] ${msg}\n`)
}
function step(name, ok, detail = '') {
  steps.push({ name, ok, detail })
  log(`${ok ? 'OK' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}
function fail(msg) {
  process.stderr.write(`[g2-smoke] FAIL: ${msg}\n`)
  process.exitCode = 1
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

function startEmulator() {
  log(`starting Data Connect emulator (project=${PROJECT})…`)
  const child = spawn(
    'firebase',
    ['emulators:start', '--only', 'dataconnect', '--project', PROJECT],
    {
      cwd: fstWeb,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
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
  log('stopping emulator…')
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

async function portFree(host, port) {
  return !(await waitPort(host, port, 800))
}

async function cleanupExtra() {
  // Best-effort: free demo emulator port; do not touch production.
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

async function main() {
  process.env.DATA_CONNECT_EMULATOR_HOST = `${EMULATOR_HOST}:${EMULATOR_PORT}`
  process.env.FIREBASE_DATA_CONNECT_EMULATOR_HOST = `${EMULATOR_HOST}:${EMULATOR_PORT}`
  process.env.GCLOUD_PROJECT = PROJECT
  process.env.GOOGLE_CLOUD_PROJECT = PROJECT
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON

  let emu = null
  let startedByUs = false
  try {
    if (!(await waitPort(EMULATOR_HOST, EMULATOR_PORT, 1500))) {
      emu = startEmulator()
      startedByUs = true
      const ready = await waitPort(EMULATOR_HOST, EMULATOR_PORT, 120000)
      if (!ready) {
        fail(
          `emulator did not open ${EMULATOR_HOST}:${EMULATOR_PORT}\n${emu.getLog().slice(-2500)}`,
        )
        await stopEmulator(emu.child)
        return
      }
      await new Promise((r) => setTimeout(r, 4000))
      log(`emulator listening on ${EMULATOR_HOST}:${EMULATOR_PORT}`)
    } else {
      log('reusing already-running local emulator')
    }

    const service = await import(
      pathToFileURL(path.join(repoRoot, 'api/fst/_g2WarehouseService.mjs')).href
    )
    const helpers = await import(
      pathToFileURL(path.join(repoRoot, 'api/fst/_g1CriticalHelpers.mjs')).href
    )

    const clientMut = fs.readFileSync(
      path.join(repoRoot, 'fst-web/dataconnect/fst-connector/mutations.gql'),
      'utf8',
    )
    if (/FstCriticalStore|FstPrincipalAccess|FstCommandReceipt/.test(clientMut)) {
      fail('client connector exposes G1/G2 admin tables')
      return
    }

    const sys = { uid: 'g2-smoke-sys', email: 'admin@fibercell.net', claims: { fstSysadmin: true } }
    const user = { uid: 'g2-smoke-user', email: 'g2@example.com', claims: {} }
    const storeId = 'fibercell-main'

    // 1. server-trusted principal
    const grant = await service.grantPrincipalAccess({
      actor: sys,
      firebaseUid: user.uid,
      storeId,
      capabilities: {
        'warehouse.read': true,
        'warehouse.draft.edit': true,
        'warehouse.document.post': true,
        'warehouse.transfer.post': true,
        'warehouse.document.cancel': true,
        'warehouse.period.close': true,
        'warehouse.period.reopen': true,
        'warehouse.inventory.post': true,
        'warehouse.opening.activate': true,
      },
    })
    step('1.create_principal', grant.ok, grant.error)

    // 2–3 draft save (bootstrap critical via first command)
    const draft = await service.executeG2Command({
      actor: user,
      storeId,
      idempotencyKey: 'g2-smoke-draft',
      commandType: 'warehouse.draft.save',
      command: {
        type: 'receipt',
        warehouseId: 'w1',
        date: '2026-09-04',
        lines: [{ itemId: 'smoke-item', quantity: 10, batchNo: 'LOT-A', expiryDate: '2026-12-01' }],
      },
    })
    step('2-3.bootstrap_and_draft', draft.ok && draft.warehouse?.documents?.[0]?.status === 'draft', draft.error)

    // 4. receipt (post new)
    const receipt = await service.executeG2Command({
      actor: user,
      storeId,
      idempotencyKey: 'g2-smoke-receipt',
      commandType: 'warehouse.document.post',
      command: {
        type: 'receipt',
        warehouseId: 'w1',
        date: '2026-09-04',
        lines: [
          { itemId: 'smoke-item', quantity: 10, batchNo: 'LOT-A', expiryDate: '2026-12-01' },
          { itemId: 'smoke-item', quantity: 5, batchNo: 'LOT-B', expiryDate: '2026-10-01' },
        ],
      },
    })
    step('4.receipt', receipt.ok, receipt.error)

    // 5. transfer
    const transfer = await service.executeG2Command({
      actor: user,
      storeId,
      idempotencyKey: 'g2-smoke-transfer',
      commandType: 'warehouse.transfer.post',
      command: {
        warehouseId: 'w1',
        targetWarehouseId: 'w2',
        date: '2026-09-04',
        lines: [{ itemId: 'smoke-item', quantity: 3 }],
      },
    })
    step('5.transfer', transfer.ok, transfer.error)

    // 6. close period
    const close = await service.executeG2Command({
      actor: user,
      storeId,
      idempotencyKey: 'g2-smoke-close',
      commandType: 'warehouse.period.close',
      command: { month: '2026-09' },
    })
    step('6.period_close', close.ok && (close.warehouse?.closedMonths ?? []).includes('2026-09'), close.error)

    // 7. blocked in closed period
    const blocked = await service.executeG2Command({
      actor: user,
      storeId,
      idempotencyKey: 'g2-smoke-blocked',
      commandType: 'warehouse.document.post',
      command: {
        type: 'issue',
        warehouseId: 'w1',
        date: '2026-09-10',
        lines: [{ itemId: 'smoke-item', quantity: 1 }],
      },
    })
    step('7.closed_period_block', !blocked.ok && blocked.error === 'period_closed', blocked.error)

    // 8. reopen with reason
    const reopen = await service.executeG2Command({
      actor: user,
      storeId,
      idempotencyKey: 'g2-smoke-reopen',
      commandType: 'warehouse.period.reopen',
      command: { month: '2026-09', reason: 'g2 smoke reopen audit' },
    })
    step(
      '8.period_reopen',
      reopen.ok && !(reopen.warehouse?.closedMonths ?? []).includes('2026-09'),
      reopen.error,
    )

    // 9. storno (cancel transfer issue side — cancels pair)
    const transferDocId = transfer.documentId
    const storno = await service.executeG2Command({
      actor: user,
      storeId,
      idempotencyKey: 'g2-smoke-storno',
      commandType: 'warehouse.document.cancel',
      command: { documentId: transferDocId, reason: 'g2 smoke storno of transfer' },
    })
    step('9.storno', storno.ok, storno.error)

    // 10. final state
    const auth = await service.getAuthoritativeCriticalStore?.(storeId)
    // getAuthoritative may live on g1 — fallback load via receipt balance
    const balW1 = helpers.computeServerBalance(reopen.warehouse?.movements ?? receipt.warehouse.movements, 'w1', 'smoke-item')
    // After storno, transfer undone; receipt 15 remains on w1 (if storno restored)
    const finalWh = storno.warehouse ?? reopen.warehouse
    const docs = finalWh?.documents ?? []
    const movs = finalWh?.movements ?? []
    const audits = finalWh?.auditLog ?? []
    const rev = storno.criticalRevision ?? reopen.criticalRevision
    step(
      '10.final_docs_movements_audit_revision',
      docs.length > 0 && movs.length > 0 && audits.length > 0 && Number(rev) > 0,
      `docs=${docs.length} movs=${movs.length} aud=${audits.length} rev=${rev} balW1≈${helpers.computeServerBalance(movs, 'w1', 'smoke-item')}`,
    )

    // 11. idempotent replay
    const replay = await service.executeG2Command({
      actor: user,
      storeId,
      idempotencyKey: 'g2-smoke-receipt',
      commandType: 'warehouse.document.post',
      command: {
        type: 'receipt',
        warehouseId: 'w1',
        date: '2026-09-04',
        lines: [{ itemId: 'smoke-item', quantity: 10 }],
      },
    })
    step('11.idempotent_replay', replay.ok && replay.idempotent === true, replay.error)

    // 12. stale CAS conflict — simulate by bumping revision in DB if possible
    // Unit-covered; here attempt second concurrent-ish by forcing conflict via mock is N/A.
    // Call with forged payload patch must fail.
    const forged = await service.executeG2Command({
      actor: user,
      storeId,
      idempotencyKey: 'g2-smoke-forged-patch',
      commandType: 'warehouse.document.post',
      command: { type: 'receipt', warehouseId: 'w1', lines: [{ itemId: 'x', quantity: 1 }] },
      payloadJson: '{"hack":true}',
    })
    step('12.arbitrary_patch_forbidden', !forged.ok && forged.error === 'arbitrary_patch_forbidden', forged.error)

    const failed = steps.filter((s) => !s.ok)
    if (failed.length) {
      fail(`SMOKE incomplete: ${failed.map((f) => f.name).join(', ')}`)
    } else {
      log('SMOKE PASS')
      process.exitCode = 0
    }
  } catch (err) {
    fail(err?.stack || String(err))
  } finally {
    if (startedByUs && emu?.child) await stopEmulator(emu.child)
    await cleanupExtra()
    const free = await portFree(EMULATOR_HOST, EMULATOR_PORT)
    log(`port ${EMULATOR_PORT} free=${free}`)
    if (!free && startedByUs) {
      log('WARN: emulator port still occupied after cleanup')
    }
  }
}

main()
