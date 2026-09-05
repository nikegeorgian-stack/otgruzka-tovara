/**
 * LIVE G1 Admin SDK smoke against local Data Connect emulator only.
 * No production credentials / reads / writes.
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

function log(msg) {
  process.stdout.write(`[g1-smoke] ${msg}\n`)
}

function fail(msg) {
  process.stderr.write(`[g1-smoke] FAIL: ${msg}\n`)
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
        fail(`emulator did not open ${EMULATOR_HOST}:${EMULATOR_PORT}\n${emu.getLog().slice(-2500)}`)
        await stopEmulator(emu.child)
        return
      }
      await new Promise((r) => setTimeout(r, 4000))
      log(`emulator listening on ${EMULATOR_HOST}:${EMULATOR_PORT}`)
    } else {
      log('reusing already-running local emulator')
    }

    const service = await import(pathToFileURL(path.join(repoRoot, 'server/fst/_g1WarehouseService.mjs')).href)
    const helpers = await import(pathToFileURL(path.join(repoRoot, 'server/fst/_g1CriticalHelpers.mjs')).href)

    const clientMut = fs.readFileSync(
      path.join(repoRoot, 'fst-web/dataconnect/fst-connector/mutations.gql'),
      'utf8',
    )
    if (/FstCriticalStore|FstPrincipalAccess|FstCommandReceipt/.test(clientMut)) {
      fail('client connector exposes G1 admin tables')
      return
    }
    log('client connector has no G1 mutations')

    const actor = { uid: 'g1-smoke-sys', email: 'admin@fibercell.net', claims: { fstSysadmin: true } }
    const storeId = 'fibercell-main'
    const targetUid = 'g1-smoke-user'

    const grant = await service.grantPrincipalAccess({
      actor,
      firebaseUid: targetUid,
      storeId,
      capabilities: { canViewWarehouse: true, canPostWarehouseDocument: true },
    })
    if (!grant.ok) {
      fail(`grantPrincipalAccess: ${grant.error}`)
      return
    }
    log('FstPrincipalAccess grant ok')

    const forger = await service.postWarehouseDocumentCommand({
      actor: { uid: 'no-perm', email: 'x@y' },
      storeId,
      idempotencyKey: 'g1-smoke-forged',
      command: { type: 'receipt', warehouseId: 'w1', lines: [{ itemId: 'i1', quantity: 1 }] },
    })
    if (forger.ok) {
      fail('forged user without principal was allowed to post')
      return
    }
    log('forged post denied')

    const patch = await service.postWarehouseDocumentCommand({
      actor: { uid: targetUid },
      storeId,
      idempotencyKey: 'g1-smoke-patch',
      command: { type: 'receipt', warehouseId: 'w1', lines: [{ itemId: 'i1', quantity: 1 }] },
      payloadJson: '{"domains":{"warehouse":{"documents":[]}}}',
    })
    if (patch.ok || patch.error !== 'arbitrary_patch_forbidden') {
      fail(`arbitrary patch not blocked: ${patch.error}`)
      return
    }
    log('arbitrary patch forbidden')

    const post = await service.postWarehouseDocumentCommand({
      actor: { uid: targetUid, email: 'g1@example.com' },
      storeId,
      idempotencyKey: 'g1-smoke-post-1',
      command: {
        type: 'receipt',
        warehouseId: 'w1',
        lines: [{ itemId: 'i1', quantity: 5, itemNameSnapshot: 'Smoke Item' }],
      },
    })
    if (!post.ok) {
      fail(`postWarehouseDocumentCommand: ${post.error}`)
      return
    }
    log(`post ok doc=${post.documentId} rev=${post.criticalRevision}`)

    const replay = await service.postWarehouseDocumentCommand({
      actor: { uid: targetUid },
      storeId,
      idempotencyKey: 'g1-smoke-post-1',
      command: {
        type: 'receipt',
        warehouseId: 'w1',
        lines: [{ itemId: 'i1', quantity: 5 }],
      },
    })
    if (!replay.ok || !replay.idempotent) {
      fail(`idempotent replay failed: ${replay.error}`)
      return
    }
    log('idempotent replay ok')

    const auth = await service.getAuthoritativeCriticalStore(storeId)
    if (!auth.ok || !(auth.revision > 0)) {
      fail('authoritative store missing')
      return
    }
    const forgedLegacy = { documents: [{ id: 'forged' }], movements: [{ quantity: 999 }] }
    const resolved = service.resolveAuthoritativeWarehouse(forgedLegacy, auth.warehouse, auth.revision)
    if (resolved.source !== 'fst_critical_store' || resolved.warehouse.documents?.[0]?.id === 'forged') {
      fail('forged legacy warehouse won over critical store')
      return
    }
    const bal = helpers.computeServerBalance(auth.warehouse.movements, 'w1', 'i1')
    if (bal !== 5) {
      fail(`expected balance 5, got ${bal}`)
      return
    }
    log('forged UpdateFstStore warehouse ignored; balance=5')

    const revoke = await service.revokePrincipalAccess({
      actor,
      firebaseUid: targetUid,
      storeId,
      reason: 'g1 smoke cleanup',
    })
    if (!revoke.ok) {
      fail(`revoke: ${revoke.error}`)
      return
    }
    const denied = await service.postWarehouseDocumentCommand({
      actor: { uid: targetUid },
      storeId,
      idempotencyKey: 'g1-smoke-after-revoke',
      command: { type: 'receipt', warehouseId: 'w1', lines: [{ itemId: 'i1', quantity: 1 }] },
    })
    if (denied.ok) {
      fail('post allowed after revoke')
      return
    }
    log('revoke deny ok')

    log('SMOKE PASS')
    process.exitCode = 0
  } catch (err) {
    fail(err?.stack || String(err))
  } finally {
    if (startedByUs && emu?.child) await stopEmulator(emu.child)
  }
}

main()
