/**
 * LIVE G3 smoke against local Data Connect emulator (demo-otgruzka only).
 * No production credentials / deploy / reads.
 */
import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const fstWeb = path.join(repoRoot, 'fst-web')
const EMULATOR_HOST = '127.0.0.1'
const EMULATOR_PORT = 9399
const PROJECT = 'demo-otgruzka'

function log(msg) {
  process.stdout.write(`[g3-smoke] ${msg}\n`)
}
function fail(msg) {
  process.stderr.write(`[g3-smoke] FAIL: ${msg}\n`)
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
  const child = spawn(
    'firebase',
    ['emulators:start', '--only', 'dataconnect', '--project', PROJECT],
    { cwd: fstWeb, shell: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } },
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
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { shell: true, stdio: 'ignore' })
    } else child.kill('SIGTERM')
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
      log(`starting emulator project=${PROJECT}`)
      emu = startEmulator()
      startedByUs = true
      if (!(await waitPort(EMULATOR_HOST, EMULATOR_PORT, 120000))) {
        fail(`emulator not ready\n${emu.getLog().slice(-2000)}`)
        await stopEmulator(emu.child)
        return
      }
      await new Promise((r) => setTimeout(r, 4000))
    } else log('reusing local emulator')

    const g2 = await import(pathToFileURL(path.join(repoRoot, 'api/fst/_g2WarehouseService.mjs')).href)
    const g3 = await import(pathToFileURL(path.join(repoRoot, 'api/fst/_g3ProductionService.mjs')).href)

    const sys = { uid: 'g3-sys', email: 'admin@fibercell.net', claims: { fstSysadmin: true } }
    const user = { uid: 'g3-user', email: 'g3@example.com', claims: {} }
    const storeId = 'fibercell-main'

    const grant = await g2.grantPrincipalAccess({
      actor: sys,
      firebaseUid: user.uid,
      storeId,
      capabilities: {
        'warehouse.read': true,
        'warehouse.document.post': true,
        'production.recipe.draft.edit': true,
        'production.recipe.approve': true,
        'production.order.edit': true,
        'production.order.confirm': true,
        'production.material.issue': true,
        'production.shift.confirm': true,
        'production.shift.correct': true,
        'production.order.confirm': true,
        productionLineIds: ['*'],
      },
    })
    if (!grant.ok) {
      fail(`grant: ${grant.error}`)
      return
    }
    log('OK principal')

    const activate = await g3.executeG3Command({
      actor: user,
      storeId,
      idempotencyKey: 'g3-smoke-activate',
      commandType: 'production.domain.activate',
      command: { reason: 'smoke bootstrap' },
    })
    if (!activate.ok) {
      fail(`activate: ${activate.error}`)
      return
    }
    log('OK production domain activate')

    // Seed raw stock via G2 receipt
    const receipt = await g2.executeG2Command({
      actor: user,
      storeId,
      idempotencyKey: 'g3-smoke-receipt',
      commandType: 'warehouse.document.post',
      command: {
        type: 'receipt',
        warehouseId: 'raw',
        date: '2026-09-04',
        lines: [{ itemId: 'mat-1', quantity: 20, batchNo: 'LOT1', expiryDate: '2026-12-01' }],
      },
    })
    if (!receipt.ok) {
      fail(`receipt: ${receipt.error}`)
      return
    }
    // Bind line
    const payload = JSON.parse(
      (
        await (
          await import(pathToFileURL(path.join(repoRoot, 'api/fst/_g1DataConnect.mjs')).href)
        ).getFstCriticalStore((await import(pathToFileURL(path.join(repoRoot, 'api/fst/_g1DataConnect.mjs')).href)).getG1DataConnect(), {
          id: storeId,
        })
      ).data.fstCriticalStore.payloadJson,
    )
    payload.domains.warehouse.productionLineBindings = [
      { id: 'L1', lineId: 'L1', productionWarehouseId: 'prod', productionLocationId: 'loc1' },
    ]
    payload.domains.warehouse.locations = [{ id: 'raw' }, { id: 'prod' }, { id: 'loc1' }, { id: 'scrap' }]
    payload.domains.warehouse.scrapLocationId = 'scrap'
    // Force via G2 period no-op close/open to rewrite? Instead use upsert through next G3 command after manual CAS — simplify: inject via updateCas by revision bump using g3 recipe which loads critical
    // Direct upsertCriticalStore:
    const dcMod = await import(pathToFileURL(path.join(repoRoot, 'api/fst/_g1DataConnect.mjs')).href)
    const helpers = await import(pathToFileURL(path.join(repoRoot, 'api/fst/_g1CriticalHelpers.mjs')).href)
    const dc = dcMod.getG1DataConnect()
    const { data } = await dcMod.getFstCriticalStore(dc, { id: storeId })
    const row = data.fstCriticalStore
    const json = JSON.stringify(payload)
    await dcMod.updateFstCriticalStoreCas(dc, {
      id: storeId,
      expectedRevision: row.revision,
      revision: row.revision + 1,
      payloadJson: json,
      fingerprint: helpers.fingerprintCriticalPayload(json),
      updatedByUid: user.uid,
    })
    log('OK stock+bindings')

    const draft = await g3.executeG3Command({
      actor: user,
      storeId,
      idempotencyKey: 'g3-smoke-recipe',
      commandType: 'production.recipe.draft.save',
      command: {
        recipeId: 'R1',
        versionId: 'RV1',
        components: [{ warehouseItemId: 'mat-1', unitSnapshot: 'kg', normQty: 1, tolerancePct: 10 }],
      },
    })
    if (!draft.ok) {
      fail(`recipe draft: ${draft.error}`)
      return
    }
    const approve = await g3.executeG3Command({
      actor: user,
      storeId,
      idempotencyKey: 'g3-smoke-approve',
      commandType: 'production.recipe.version.approve',
      command: { versionId: 'RV1' },
    })
    if (!approve.ok) {
      fail(`approve: ${approve.error}`)
      return
    }
    log('OK recipe approve')

    await g3.executeG3Command({
      actor: user,
      storeId,
      idempotencyKey: 'g3-smoke-order-draft',
      commandType: 'production.order.draft.save',
      command: {
        orderId: 'O1',
        finishedProductId: 'FP1',
        formulationRecipeId: 'R1',
        lineId: 'L1',
        totalQtyMp: 25,
        startDate: '2026-09-04',
        endDate: '2026-09-05',
        productName: 'P',
        customer: 'C',
      },
    })
    const confirm = await g3.executeG3Command({
      actor: user,
      storeId,
      idempotencyKey: 'g3-smoke-confirm',
      commandType: 'production.order.confirm',
      command: { orderId: 'O1', rawWarehouseId: 'raw' },
    })
    if (!confirm.ok) {
      fail(`confirm: ${confirm.error}`)
      return
    }
    log(`OK order confirm partial reserve shortages=${confirm.warehouse.materialShortages?.length ?? 0}`)

    const issue = await g3.executeG3Command({
      actor: user,
      storeId,
      idempotencyKey: 'g3-smoke-issue',
      commandType: 'production.material.issueToLine',
      command: {
        orderId: 'O1',
        lineId: 'L1',
        rawWarehouseId: 'raw',
        lines: [{ itemId: 'mat-1', quantity: 10 }],
      },
    })
    if (!issue.ok) {
      fail(`issue: ${issue.error}`)
      return
    }
    log('OK issue to line')

    const shift = await g3.executeG3Command({
      actor: user,
      storeId,
      idempotencyKey: 'g3-smoke-shift',
      commandType: 'production.shift.confirm',
      command: {
        orderId: 'O1',
        lineId: 'L1',
        shiftDate: '2026-09-04',
        outputMp: 8,
        actualInputs: [{ itemId: 'mat-1', quantity: 8 }],
        wasteLines: [{ itemId: 'mat-1', quantity: 1, reason: 'trim' }],
        semiFinishedItemId: 'WIP1',
        packLocationId: 'loc1',
      },
    })
    if (!shift.ok) {
      fail(`shift: ${shift.error}`)
      return
    }
    log(`OK shift WIP=${shift.wipBatchId} fg=${shift.isFinishedGoods}`)

    const corr = await g3.executeG3Command({
      actor: user,
      storeId,
      idempotencyKey: 'g3-smoke-corr',
      commandType: 'production.shift.confirmCorrection',
      command: {
        originalReportId: shift.reportId,
        correctionReason: 'smoke correction',
        orderId: 'O1',
        lineId: 'L1',
        shiftDate: '2026-09-04',
        outputMp: 7,
        actualInputs: [{ itemId: 'mat-1', quantity: 7 }],
        wasteLines: [{ itemId: 'mat-1', quantity: 0.5, reason: 'trim' }],
        semiFinishedItemId: 'WIP1',
        packLocationId: 'loc1',
      },
    })
    if (!corr.ok) {
      fail(`correction: ${corr.error}`)
      return
    }
    log(`OK correction reverses=${(corr.reverseDocumentIds ?? []).length}`)

    log('SMOKE PASS')
    process.exitCode = 0
  } catch (err) {
    fail(err?.stack || String(err))
  } finally {
    if (startedByUs && emu?.child) await stopEmulator(emu.child)
    const free = !(await waitPort(EMULATOR_HOST, EMULATOR_PORT, 800))
    log(`port ${EMULATOR_PORT} free=${free}`)
  }
}

main()
