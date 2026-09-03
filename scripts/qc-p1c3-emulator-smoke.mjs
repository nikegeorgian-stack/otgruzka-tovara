/**
 * LIVE Admin SDK smoke against local Data Connect emulator only.
 * Starts emulator if needed, exercises grant/read/lot/attachment/decision/revoke,
 * then stops emulator. No production credentials.
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
  process.stdout.write(`[p1c3-smoke] ${msg}\n`)
}

function fail(msg) {
  process.stderr.write(`[p1c3-smoke] FAIL: ${msg}\n`)
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
  process.env.QC_LOCAL_EMULATOR = '1'
  process.env.QC_STORAGE_ADAPTER = 'memory'
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
      await new Promise((r) => setTimeout(r, 3000))
      log(`emulator listening on ${EMULATOR_HOST}:${EMULATOR_PORT}`)
    } else {
      log('reusing already-running local emulator')
    }

    const service = await import(pathToFileURL(path.join(repoRoot, 'api/fst/_qcService.mjs')).href)
    const adminSdk = await import(
      pathToFileURL(path.join(repoRoot, 'api/fst/dataconnect-admin-generated/index.cjs.js')).href
    )
    const storage = await import(pathToFileURL(path.join(repoRoot, 'api/fst/_qcStorage.mjs')).href)

    const clientDts = fs.readFileSync(
      path.join(repoRoot, 'fst-web/src/lib/dataconnect-generated/index.d.ts'),
      'utf8',
    )
    if (/upsertQcPermission|insertQcLotDecision|insertQcAttachmentRecord/i.test(clientDts)) {
      fail('client SDK exposes QC admin mutations')
      return
    }
    log('client SDK has no QC admin mutation exports')

    if (!adminSdk.connectorConfig?.connector) {
      fail('admin SDK connectorConfig missing')
      return
    }
    log(`admin connector=${adminSdk.connectorConfig.connector}`)

    const actor = { uid: 'p1c3-smoke-sys', email: 'admin@fibercell.net', claims: { fstSysadmin: true } }
    const storeId = 'fibercell-main'
    const targetUid = 'p1c3-smoke-user'
    const lotId = 'p1c3-smoke-lot-1'
    const attPassport = 'p1c3-smoke-att-passport'
    const attProtocol = 'p1c3-smoke-att-protocol'

    const grant = await service.grantPermission({
      actor,
      firebaseUid: targetUid,
      storeId,
      flags: {
        canView: true,
        canUpload: true,
        canRelease: true,
        canRegrade: false,
        canReject: false,
        canPostShipment: true,
      },
    })
    if (!grant.ok) {
      fail(`grantPermission: ${grant.error}`)
      return
    }
    log('QcPermission upsert ok')

    const perm = await service.requireActivePermission(targetUid, storeId, 'canRelease')
    if (!perm.ok) {
      fail(`requireActivePermission: ${perm.error}`)
      return
    }
    log('server permission read ok')

    const lot = await service.upsertLotProjection({
      actor: { uid: targetUid },
      id: lotId,
      storeId,
      finishedProductId: 'p1c3-smoke-fp',
      warehouseItemId: 'p1c3-smoke-wi',
      batchNo: 'SMOKE-B1',
      quantityProduced: 10,
      quantityShipped: 0,
      packagingReportId: 'p1c3-smoke-pack',
      status: 'pending',
    })
    if (!lot.ok) {
      fail(`upsertLotProjection: ${lot.error}`)
      return
    }
    log('QcFinishedGoodsLot upsert ok')

    const uploader = { uid: targetUid, email: 'otc-smoke@example.com', claims: {} }
    for (const [id, kind] of [
      [attPassport, 'passport'],
      [attProtocol, 'protocol'],
    ]) {
      const init = await service.initiateAttachment({
        actor: uploader,
        storeId,
        lotId,
        documentKind: kind,
        contentType: 'application/pdf',
        sizeBytes: 128,
        checksum: `chk-${kind}`,
        attachmentId: id,
        idempotencyKey: `p1c3-smoke-idem-${kind}`,
      })
      if (!init.ok) {
        fail(`initiateAttachment ${kind}: ${init.error}`)
        return
      }
      if (!init.upload?.uploadUrl || init.upload.storagePath !== init.attachment.storagePath) {
        fail(`signed session not bound to exact path for ${kind}`)
        return
      }
      const redeem = storage.redeemMemorySignedUpload({
        uploadUrl: init.upload.uploadUrl,
        bytes: Buffer.alloc(128, 1),
        contentType: 'application/pdf',
        checksum: `chk-${kind}`,
      })
      if (!redeem.ok) {
        fail(`memory redeem ${kind}: ${redeem.error}`)
        return
      }
      const fin = await service.finalizeAttachment({
        actor: uploader,
        storeId,
        lotId,
        attachmentId: id,
      })
      if (!fin.ok) {
        fail(`finalizeAttachment ${kind}: ${fin.error}`)
        return
      }
      log(`attachment ${kind} verified`)
    }

    const release = await service.releaseLot({
      actor: uploader,
      storeId,
      lotId,
      idempotencyKey: 'p1c3-smoke-release-1',
    })
    if (!release.ok) {
      fail(`releaseLot: ${release.error}`)
      return
    }
    if (!release.decision?.id) {
      fail('releaseLot missing decision id')
      return
    }
    log(`QcLotDecision created id=${release.decision.id}`)

    const release2 = await service.releaseLot({
      actor: uploader,
      storeId,
      lotId,
      idempotencyKey: 'p1c3-smoke-release-1',
    })
    if (!release2.ok) {
      fail(`idempotent release: ${release2.error}`)
      return
    }

    const revoke = await service.revokePermission({
      actor,
      firebaseUid: targetUid,
      storeId,
      reason: 'p1c3 smoke cleanup',
    })
    if (!revoke.ok) {
      fail(`revokePermission: ${revoke.error}`)
      return
    }
    const denied = await service.requireActivePermission(targetUid, storeId, 'canRelease')
    if (denied.ok) {
      fail('revoked permission still allows canRelease')
      return
    }
    log('revoke immediate deny ok (smoke permission revoked)')

    log('SMOKE PASS')
    process.exitCode = 0
  } catch (err) {
    fail(err?.stack || String(err))
  } finally {
    if (startedByUs && emu?.child) await stopEmulator(emu.child)
  }
}

main()
