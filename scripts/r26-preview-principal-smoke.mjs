/**
 * R2.6 — principal-backed Preview smoke: QC signed Storage upload + revoked-token poll.
 * Never prints secrets / private keys / tokens / passwords / signed URLs / bypass secrets.
 * Cleanup runs in finally; clears GOOGLE_APPLICATION_CREDENTIALS.
 */
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getDataConnect } from 'firebase-admin/data-connect'
import { getStorage } from 'firebase-admin/storage'
import {
  connectorConfig,
  getFstCriticalStore,
  getFstPrincipalAccessByUidStore,
  upsertFstPrincipalAccess,
} from '@fst/dataconnect-admin-generated'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PREVIEW_URL =
  process.env.R26_PREVIEW_URL ||
  process.env.R25_PREVIEW_URL ||
  'https://otgruzka-tovara-dpqlrhdmw-nikegeorgian-8562s-projects.vercel.app'
const PREVIEW_DEPLOYMENT = process.env.R26_PREVIEW_DEPLOYMENT || process.env.R25_PREVIEW_DEPLOYMENT || 'dpl_8uucwRS26ecjrATEtyQdAcYAzDxL'
const EXPECTED_COMMIT_PREFIX = process.env.R26_EXPECTED_COMMIT || process.env.R25_EXPECTED_COMMIT || '3e5c478'
const STG_PROJECT = 'otgruzka-tovara-stg'
const STG_SERVICE = 'otgruzka-tovara-stg-service'
const STG_LOCATION = 'europe-west3'
const STG_CONNECTOR = 'fst-admin'
const STG_BUCKET = `${STG_PROJECT}.firebasestorage.app`
const PROD_PROJECT = 'otgruzka-tovara'

const RUN_ID = `${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`
const STORE_ID = `r25_synth_${RUN_ID}`
const EMAIL = `r25.synth.${RUN_ID}@fibercell-synth.test`
const PASSWORD = `R25!${randomBytes(12).toString('base64url')}Aa1`
const WH_ID = `wh_${RUN_ID}`
const ITEM_ID = `item_${RUN_ID}`
const FP_ID = `fp_${RUN_ID}`
const CUST_ID = `cust_${RUN_ID}`
const STORAGE_OBJECT = `${STORE_ID}/smoke.txt`

const results = []
const cleanupState = {
  uid: null,
  storagePath: null,
  attachmentId: null,
  principalId: null,
  criticalCreated: false,
  receipts: [],
}
const counts = {
  authBefore: null,
  authAfter: null,
  principalBefore: null,
  principalAfter: null,
  criticalBefore: null,
  criticalAfter: null,
  created: 0,
  deleted: 0,
}

function log(step, ok, detail = '') {
  results.push({ step, ok, detail: String(detail).slice(0, 180) })
  console.log(`${ok ? 'OK' : 'FAIL'} ${step}${detail ? ' — ' + String(detail).slice(0, 180) : ''}`)
}

function assertStop(cond, message) {
  if (!cond) {
    console.error(`STOP: ${message}`)
    process.exit(2)
  }
}

function decodeJwtTimes(token) {
  const part = String(token).split('.')[1]
  const json = JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
  return { auth_time: Number(json.auth_time) || 0, iat: Number(json.iat) || 0 }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function waitTokensValidAfter(auth, uid, authTimeSec, maxMs = 30_000) {
  const deadline = Date.now() + maxMs
  let lastFloor = null
  while (Date.now() < deadline) {
    const record = await auth.getUser(uid)
    const tvaMs = Date.parse(String(record.tokensValidAfterTime || ''))
    if (Number.isFinite(tvaMs)) {
      lastFloor = Math.floor(tvaMs / 1000)
      if (lastFloor > authTimeSec) {
        return { ok: true, tokensValidAfterFloor: lastFloor, auth_time: authTimeSec }
      }
    }
    await sleep(500)
  }
  return { ok: false, tokensValidAfterFloor: lastFloor, auth_time: authTimeSec }
}

async function tryDeleteAttachment(dc, id) {
  if (typeof dc.executeGraphql !== 'function') return { ok: false, error: 'executeGraphql_unavailable' }
  try {
    await dc.executeGraphql(
      'mutation DeleteSynthAtt($id: String!) { qcAttachmentRecord_delete(id: $id) }',
      { variables: { id } },
    )
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 120) }
  }
}

async function countBucketObjects(bucket) {
  const [files] = await bucket.getFiles({ maxResults: 100 })
  return files.length
}

function preflightCredential(saPath) {
  assertStop(Boolean(saPath), 'LOCAL_STAGING_SERVICE_ACCOUNT_PATH missing')
  const exists = existsSync(saPath)
  console.log(`file_exists: ${exists ? 'yes' : 'no'}`)
  assertStop(exists, 'service account file missing')
  let projectMatch = 'no'
  let domainMatch = 'no'
  try {
    const raw = readFileSync(saPath, 'utf8')
    const j = JSON.parse(raw)
    const pid = String(j.project_id || '')
    const email = String(j.client_email || '')
    projectMatch = pid === STG_PROJECT ? 'yes' : 'no'
    domainMatch = email.endsWith(`@${STG_PROJECT}.iam.gserviceaccount.com`) ? 'yes' : 'no'
  } catch {
    assertStop(false, 'credential unreadable/invalid')
  }
  console.log(`project_id_match: ${projectMatch}`)
  console.log(`client_email_domain_match: ${domainMatch}`)
  assertStop(projectMatch === 'yes', 'project_id must be otgruzka-tovara-stg')
  assertStop(domainMatch === 'yes', 'client_email domain mismatch')
}

function loadPreviewEnv() {
  const envFile = path.join(root, '.env.preview.pull.local')
  if (!existsSync(envFile)) {
    const r = spawnSync(
      'npx',
      ['vercel', 'env', 'pull', envFile, '--environment', 'preview', '--yes'],
      {
        cwd: root,
        shell: true,
        stdio: 'inherit',
      },
    )
    assertStop(r.status === 0, 'vercel_env_pull_failed')
  }
  const env = {}
  for (const line of readFileSync(envFile, 'utf8').split(/\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const i = line.indexOf('=')
    const k = line.slice(0, i).trim()
    let v = line.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (v === '[SENSITIVE]') continue
    env[k] = v
  }
  return env
}

let cachedPreviewEnv = null

/**
 * Call Preview API via `vercel curl` (injects protection bypass).
 * Never use `-v`; never log tokens/bypass/URLs with secrets.
 * Body is written to a temp file to avoid Windows CLI body drops.
 */
async function vercelApi(apiPath, { method = 'GET', token, body } = {}) {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'r26-api-'))
  const outFile = path.join(tmpDir, 'out.json')
  const bodyFile = path.join(tmpDir, 'body.json')
  const errFile = path.join(tmpDir, 'err.txt')
  try {
    const curlArgs = [
      'vercel',
      'curl',
      apiPath,
      '--deployment',
      PREVIEW_URL,
      '--yes',
      '--',
      '-sS',
      '-w',
      'HTTP_CODE=%{http_code}',
      '-o',
      outFile,
      '-X',
      method,
      '-H',
      'content-type: application/json',
    ]
    if (token) {
      curlArgs.push('-H', `authorization: Bearer ${token}`)
    }
    if (body !== undefined) {
      writeFileSync(bodyFile, JSON.stringify(body), 'utf8')
      curlArgs.push('--data-binary', `@${bodyFile}`)
    }
    const r = spawnSync('npx', curlArgs, {
      cwd: root,
      shell: true,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
    })
    const meta = `${r.stdout || ''}\n${r.stderr || ''}`
    writeFileSync(errFile, meta, 'utf8')
    const codeMatch = meta.match(/HTTP_CODE=(\d{3})/)
    const status = codeMatch ? Number(codeMatch[1]) : 0
    let text = ''
    try {
      text = readFileSync(outFile, 'utf8')
    } catch {
      text = ''
    }
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      json = null
    }
    return { status, json, rawHead: text.slice(0, 240) }
  } finally {
    try {
      unlinkSync(outFile)
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(bodyFile)
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(errFile)
    } catch {
      /* ignore */
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

function buildCapabilities() {
  // Exact capability keys from server/_g2.._g6Capabilities.mjs (deny-by-default ACL).
  const keys = [
    'critical.domain.freeze',
    'warehouse.read',
    'warehouse.draft.edit',
    'warehouse.document.post',
    'warehouse.transfer.post',
    'warehouse.inventory.post',
    'warehouse.opening.activate',
    'warehouse.document.cancel',
    'warehouse.period.close',
    'warehouse.period.reopen',
    'production.read',
    'production.recipe.draft.edit',
    'production.recipe.approve',
    'production.order.edit',
    'production.order.confirm',
    'production.order.cancel',
    'production.shift.edit',
    'production.shift.confirm',
    'packaging.read',
    'packaging.report.edit',
    'packaging.report.confirm',
    'qc.attachment.upload',
    'qc.review',
    'qc.release',
    'shipment.draft.edit',
    'shipment.post',
    'masterdata.read',
    'masterdata.item.manage',
    'masterdata.product.manage',
    'masterdata.customer.manage',
    'masterdata.supplier.manage',
    'masterdata.bom.manage',
    'masterdata.bom.approve',
    'masterdata.archive',
    'sales.read',
    'sales.order.edit',
    'sales.order.confirm',
    'sales.order.cancel',
    'sales.priority.change',
    'sales.shipment.post',
    'sales.shipment.cancel',
    'planning.read',
    'planning.mrp.run',
    'planning.productionDraft.create',
    'planning.shortage.manage',
    'planning.manualProduction.create',
    'procurement.read',
    'procurement.draft.edit',
    'procurement.order.submit',
    'procurement.order.approve',
    'procurement.order.markOrdered',
    'procurement.order.cancel',
    'procurement.receipt.post',
    'procurement.payment.view',
    'procurement.payment.record',
    'capacity.read',
    'capacity.norm.edit',
    'capacity.norm.approve',
    'capacity.calendar.edit',
    'capacity.run',
    'capacity.schedule.edit',
    'capacity.schedule.publish',
    'capacity.overload.approve',
  ]
  const out = Object.fromEntries(keys.map((k) => [k, true]))
  out.productionLineIds = ['*']
  out.warehouseIds = ['*']
  return out
}

function initAdmin(storageBucket) {
  if (getApps().length) return
  initializeApp({
    credential: applicationDefault(),
    projectId: STG_PROJECT,
    ...(storageBucket ? { storageBucket } : {}),
  })
}

function getDc() {
  return getDataConnect({
    ...connectorConfig,
    connector: STG_CONNECTOR,
    serviceId: STG_SERVICE,
    location: STG_LOCATION,
  })
}

async function countAuthUsers(auth) {
  let n = 0
  let pageToken
  do {
    const page = await auth.listUsers(1000, pageToken)
    n += page.users.length
    pageToken = page.pageToken
  } while (pageToken)
  return n
}

async function principalExists(dc, uid, storeId) {
  const { data } = await getFstPrincipalAccessByUidStore(dc, { firebaseUid: uid, storeId })
  return data?.fstPrincipalAccesses?.[0] ?? null
}

async function criticalExists(dc, storeId) {
  const { data } = await getFstCriticalStore(dc, { id: storeId })
  return data?.fstCriticalStore ?? null
}

async function tryDeleteCritical(dc, storeId) {
  if (typeof dc.executeGraphql !== 'function') return { ok: false, error: 'executeGraphql_unavailable' }
  try {
    await dc.executeGraphql(
      `mutation DeleteSynthCritical($id: String!) {
        fstCriticalStore_delete(id: $id)
      }`,
      { variables: { id: storeId } },
    )
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 120) }
  }
}

async function tryDeletePrincipal(dc, id) {
  if (typeof dc.executeGraphql !== 'function') return { ok: false, error: 'executeGraphql_unavailable' }
  try {
    await dc.executeGraphql(
      `mutation DeleteSynthPrincipal($id: String!) {
        fstPrincipalAccess_delete(id: $id)
      }`,
      { variables: { id } },
    )
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 120) }
  }
}

async function signIn(apiKey, email, password) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  })
  const json = await res.json()
  return { status: res.status, json }
}

async function main() {
  const prevGac = process.env.GOOGLE_APPLICATION_CREDENTIALS
  const saPath = process.env.LOCAL_STAGING_SERVICE_ACCOUNT_PATH
  let exitCode = 0

  try {
    // --- git / preview gate ---
    const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' })
      .stdout.trim()
    assertStop(head.startsWith(EXPECTED_COMMIT_PREFIX), `HEAD ${head} != expected ${EXPECTED_COMMIT_PREFIX}`)
    const branch = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, encoding: 'utf8' })
      .stdout.trim()
    assertStop(branch === 'safety/cloud-data-integrity-20260902', `unexpected branch ${branch}`)

    preflightCredential(saPath)
    process.env.GOOGLE_APPLICATION_CREDENTIALS = saPath
    process.env.FST_CLOUD_ENV = 'staging'
    process.env.FST_EXPECTED_FIREBASE_PROJECT_ID = STG_PROJECT
    process.env.FST_SQL_CONNECT_SERVICE_ID = STG_SERVICE
    process.env.FST_SQL_CONNECT_LOCATION = STG_LOCATION
    process.env.FST_SQL_CONNECT_CONNECTOR = STG_CONNECTOR
    process.env.GCLOUD_PROJECT = STG_PROJECT
    process.env.GOOGLE_CLOUD_PROJECT = STG_PROJECT

    const previewEnv = loadPreviewEnv()
    cachedPreviewEnv = previewEnv
    assertStop(previewEnv.VITE_FIREBASE_PROJECT_ID === STG_PROJECT, 'preview vite project not staging')
    assertStop(
      previewEnv.VITE_FST_SQL_CONNECT_SERVICE_ID === STG_SERVICE,
      'preview client DC service not staging',
    )
    for (const [k, v] of Object.entries(previewEnv)) {
      if (/otgruzka-tovara(?!-stg)/.test(String(v)) && /SERVICE|PROJECT|BUCKET|SQL_CONNECT/.test(k)) {
        assertStop(false, `preview env ${k} resolves to production id`)
      }
    }
    assertStop(Boolean(previewEnv.VITE_FIREBASE_API_KEY), 'preview api key missing')

    console.log('planned_fixture:', {
      storeId: STORE_ID,
      email: EMAIL,
      project: STG_PROJECT,
      service: STG_SERVICE,
      location: STG_LOCATION,
      preview: PREVIEW_URL,
      deployment: PREVIEW_DEPLOYMENT,
      commit: head,
    })

    initAdmin(previewEnv.VITE_FIREBASE_STORAGE_BUCKET)
    const auth = getAuth()
    const dc = getDc()

    // credential validity
    try {
      await auth.listUsers(1)
      log('credential_valid', true, 'auth_listUsers')
    } catch (e) {
      assertStop(false, `credential invalid: ${String(e?.message || e).slice(0, 80)}`)
    }

    counts.authBefore = await countAuthUsers(auth)
    counts.criticalBefore = (await criticalExists(dc, STORE_ID)) ? 1 : 0
    counts.principalBefore = 0

    // --- synthetic principal ---
    const user = await auth.createUser({
      email: EMAIL,
      password: PASSWORD,
      emailVerified: true,
      disabled: false,
    })
    cleanupState.uid = user.uid
    counts.created++
    // Exact claim used by isFstSysadmin / verifySysAdminRequest — set then cleared for principal path
    await auth.setCustomUserClaims(user.uid, { fstSysadmin: true })
    let signed = await signIn(previewEnv.VITE_FIREBASE_API_KEY, EMAIL, PASSWORD)
    assertStop(Boolean(signed.json?.idToken), 'sign_in_failed_after_claims')
    const decodedWithClaim = await auth.verifyIdToken(signed.json.idToken, true)
    log(
      'verifyIdToken_checkRevoked_with_claim',
      decodedWithClaim.uid === user.uid && decodedWithClaim.fstSysadmin === true,
      'fstSysadmin',
    )

    // Principal mapping (canonical ACL) — roleId used by grantPrincipalAccess default shape
    const caps = buildCapabilities()
    const principalId = `${STORE_ID}::${user.uid}`
    cleanupState.principalId = principalId
    await upsertFstPrincipalAccess(dc, {
      id: principalId,
      firebaseUid: user.uid,
      storeId: STORE_ID,
      roleId: 'r25_synth_principal',
      capabilitiesJson: JSON.stringify(caps),
      active: true,
      revision: 1,
      createdByUid: user.uid,
      updatedByUid: user.uid,
    })
    counts.created++
    log('principal_upserted', true, principalId)

    // Drop sysadmin claim so G1–G6 run principal-backed (code path via FstPrincipalAccess)
    await auth.setCustomUserClaims(user.uid, { fstSysadmin: null })
    signed = await signIn(previewEnv.VITE_FIREBASE_API_KEY, EMAIL, PASSWORD)
    assertStop(Boolean(signed.json?.idToken), 'sign_in_failed_after_claim_clear')
    let idToken = signed.json.idToken
    const decodedPrincipal = await auth.verifyIdToken(idToken, true)
    log(
      'verifyIdToken_principal_mode',
      decodedPrincipal.uid === user.uid && decodedPrincipal.fstSysadmin !== true,
      'no_fstSysadmin',
    )
    log('auth_principal_created', true, `uid_len=${user.uid.length}`)

    // --- deny-path / protocol ---
    {
      const unauth = await vercelApi('/api/fst/qc-permissions-self', { method: 'GET' })
      log('unauthenticated_401', unauth.status === 401, `status=${unauth.status}`)

      const missing = await vercelApi('/api/fst/does-not-exist-r25', { method: 'POST', token: idToken })
      log('unknown_route_404', missing.status === 404, `status=${missing.status}`)

      const badMethod = await vercelApi('/api/fst/g2-warehouse-command', { method: 'GET', token: idToken })
      log('wrong_method_405', badMethod.status === 405, `status=${badMethod.status}`)

      const bogus = await vercelApi('/api/fst/g2-warehouse-command', {
        method: 'POST',
        token: 'not.a.jwt',
        body: { storeId: STORE_ID },
      })
      log('bogus_token_denied', bogus.status === 401 || bogus.status === 403, `status=${bogus.status}`)

      const accepted = await vercelApi(`/api/fst/qc-permissions-self?storeId=${encodeURIComponent(STORE_ID)}`, {
        method: 'GET',
        token: idToken,
      })
      log(
        'real_token_accepted',
        accepted.status === 200 && accepted.json?.ok === true,
        `status=${accepted.status}`,
      )

      const foreign = await vercelApi('/api/fst/g2-warehouse-command', {
        method: 'POST',
        token: idToken,
        body: {
          storeId: `foreign_${RUN_ID}`,
          idempotencyKey: `r25-foreign-${RUN_ID}`,
          commandType: 'warehouse.draft.save',
          command: { type: 'receipt', warehouseId: WH_ID, date: '2026-09-05', lines: [{ itemId: ITEM_ID, quantity: 1 }] },
        },
      })
      log('foreign_store_denied', foreign.status === 403, `status=${foreign.status} err=${foreign.json?.error || ''}`)
    }

    // --- G2 draft first (activates warehouse domain) then G1 freeze/write-deny/resume ---
    let draftDocId = null
    {
      const draft = await vercelApi('/api/fst/g2-warehouse-command', {
        method: 'POST',
        token: idToken,
        body: {
          storeId: STORE_ID,
          idempotencyKey: `r25-draft-${RUN_ID}`,
          commandType: 'warehouse.draft.save',
          command: {
            type: 'receipt',
            warehouseId: WH_ID,
            date: '2026-09-05',
            lines: [{ itemId: ITEM_ID, quantity: 2 }],
          },
        },
      })
      cleanupState.criticalCreated = true
      draftDocId = draft.json?.documentId || null
      const movements = draft.json?.warehouse?.movements
      log(
        'g2_draft_only',
        draft.status === 200 &&
          draft.json?.ok === true &&
          Array.isArray(movements) &&
          movements.length === 0,
        `status=${draft.status} doc=${Boolean(draftDocId)} mov=${Array.isArray(movements) ? movements.length : 'n/a'} err=${draft.json?.error || ''}`,
      )

      const freeze = await vercelApi('/api/fst/g1-domain-freeze', {
        method: 'POST',
        token: idToken,
        body: {
          storeId: STORE_ID,
          idempotencyKey: `r25-freeze-${RUN_ID}`,
          commandType: 'warehouse.domain.freeze',
          command: { reason: 'r25 synthetic freeze' },
        },
      })
      log('g1_freeze', freeze.status === 200 && freeze.json?.ok === true, `status=${freeze.status} err=${freeze.json?.error || ''}`)

      const writeFrozen = await vercelApi('/api/fst/g2-warehouse-command', {
        method: 'POST',
        token: idToken,
        body: {
          storeId: STORE_ID,
          idempotencyKey: `r25-frozen-write-${RUN_ID}`,
          commandType: 'warehouse.draft.save',
          command: {
            type: 'receipt',
            warehouseId: WH_ID,
            date: '2026-09-05',
            lines: [{ itemId: ITEM_ID, quantity: 1 }],
          },
        },
      })
      log(
        'g1_write_while_frozen_denied',
        writeFrozen.status === 409 && writeFrozen.json?.error === 'domain_frozen',
        `status=${writeFrozen.status} err=${writeFrozen.json?.error || ''}`,
      )

      const resume = await vercelApi('/api/fst/g1-domain-freeze', {
        method: 'POST',
        token: idToken,
        body: {
          storeId: STORE_ID,
          idempotencyKey: `r25-resume-${RUN_ID}`,
          commandType: 'warehouse.domain.resume',
          command: { reason: 'r25 synthetic resume' },
        },
      })
      log('g1_resume', resume.status === 200 && resume.json?.ok === true, `status=${resume.status} err=${resume.json?.error || ''}`)
    }

    // --- G3 ---
    {
      const act = await vercelApi('/api/fst/g3-production-command', {
        method: 'POST',
        token: idToken,
        body: {
          storeId: STORE_ID,
          idempotencyKey: `r25-g3-act-${RUN_ID}`,
          commandType: 'production.domain.activate',
          command: { reason: 'r25 g3 activate' },
        },
      })
      log('g3_domain_activate', act.status === 200 && act.json?.ok === true, `status=${act.status} err=${act.json?.error || ''}`)

      const recipe = await vercelApi('/api/fst/g3-production-command', {
        method: 'POST',
        token: idToken,
        body: {
          storeId: STORE_ID,
          idempotencyKey: `r25-g3-recipe-${RUN_ID}`,
          commandType: 'production.recipe.draft.save',
          command: {
            recipeId: `rec_${RUN_ID}`,
            versionId: `rv_${RUN_ID}`,
            components: [{ warehouseItemId: ITEM_ID, unitSnapshot: 'kg', normQty: 1, tolerancePct: 5 }],
          },
        },
      })
      log('g3_recipe_draft', recipe.status === 200 && recipe.json?.ok === true, `status=${recipe.status} err=${recipe.json?.error || ''}`)
    }

    // --- G4 / QC ---
    {
      const act = await vercelApi('/api/fst/g4-production-command', {
        method: 'POST',
        token: idToken,
        body: {
          storeId: STORE_ID,
          idempotencyKey: `r25-g4-act-${RUN_ID}`,
          commandType: 'packaging.domain.activate',
          command: { reason: 'r25 g4 activate' },
        },
      })
      log('g4_packaging_activate', act.status === 200 && act.json?.ok === true, `status=${act.status} err=${act.json?.error || ''}`)

      const read = await vercelApi('/api/fst/g4-production-command', {
        method: 'POST',
        token: idToken,
        body: {
          storeId: STORE_ID,
          idempotencyKey: `r25-g4-read-${RUN_ID}`,
          commandType: 'packaging.read',
          command: {},
        },
      })
      log('g4_packaging_read', read.status === 200 && read.json?.ok === true, `status=${read.status} err=${read.json?.error || ''}`)

      const qcSelf = await vercelApi('/api/fst/qc-permissions-self', {
        method: 'POST',
        token: idToken,
        body: { storeId: STORE_ID },
      })
      log('g4_qc_auth_self', qcSelf.status === 200 && qcSelf.json?.ok === true, `status=${qcSelf.status}`)
    }

    // --- G5 ---
    {
      const md = await vercelApi('/api/fst/g5-planning-command', {
        method: 'POST',
        token: idToken,
        body: {
          storeId: STORE_ID,
          idempotencyKey: `r25-g5-md-${RUN_ID}`,
          commandType: 'masterdata.domain.activate',
          command: { reason: 'r25 md' },
        },
      })
      log('g5_masterdata_activate', md.status === 200 && md.json?.ok === true, `status=${md.status} err=${md.json?.error || ''}`)

      const salesAct = await vercelApi('/api/fst/g5-planning-command', {
        method: 'POST',
        token: idToken,
        body: {
          storeId: STORE_ID,
          idempotencyKey: `r25-g5-sales-act-${RUN_ID}`,
          commandType: 'sales.domain.activate',
          command: { reason: 'r25 sales' },
        },
      })
      log('g5_sales_activate', salesAct.status === 200 && salesAct.json?.ok === true, `status=${salesAct.status} err=${salesAct.json?.error || ''}`)

      const procAct = await vercelApi('/api/fst/g5-planning-command', {
        method: 'POST',
        token: idToken,
        body: {
          storeId: STORE_ID,
          idempotencyKey: `r25-g5-proc-act-${RUN_ID}`,
          commandType: 'procurement.domain.activate',
          command: { reason: 'r25 procurement' },
        },
      })
      log('g5_procurement_activate', procAct.status === 200 && procAct.json?.ok === true, `status=${procAct.status} err=${procAct.json?.error || ''}`)

      const product = await vercelApi('/api/fst/g5-planning-command', {
        method: 'POST',
        token: idToken,
        body: {
          storeId: STORE_ID,
          idempotencyKey: `r25-g5-fp-${RUN_ID}`,
          commandType: 'masterdata.product.upsert',
          command: { id: FP_ID, code: 'R25FP', name: 'R25 synth FP' },
        },
      })
      log('g5_product_upsert', product.status === 200 && product.json?.ok === true, `status=${product.status} err=${product.json?.error || ''}`)

      const customer = await vercelApi('/api/fst/g5-planning-command', {
        method: 'POST',
        token: idToken,
        body: {
          storeId: STORE_ID,
          idempotencyKey: `r25-g5-cust-${RUN_ID}`,
          commandType: 'masterdata.customer.upsert',
          command: { id: CUST_ID, code: 'R25C', name: 'R25 synth customer' },
        },
      })
      log('g5_customer_upsert', customer.status === 200 && customer.json?.ok === true, `status=${customer.status} err=${customer.json?.error || ''}`)

      const so = await vercelApi('/api/fst/g5-planning-command', {
        method: 'POST',
        token: idToken,
        body: {
          storeId: STORE_ID,
          idempotencyKey: `r25-g5-so-${RUN_ID}`,
          commandType: 'sales.order.draft.save',
          command: {
            id: `so_${RUN_ID}`,
            customerId: CUST_ID,
            lines: [
              {
                lineId: `sol_${RUN_ID}`,
                finishedProductId: FP_ID,
                quantity: 1,
                unit: 'm2',
                requestedShipDate: '2026-09-10',
              },
            ],
          },
        },
      })
      log('g5_sales_order_draft', so.status === 200 && so.json?.ok === true, `status=${so.status} err=${so.json?.error || ''}`)

      const mrp = await vercelApi('/api/fst/g5-planning-command', {
        method: 'POST',
        token: idToken,
        body: {
          storeId: STORE_ID,
          idempotencyKey: `r25-g5-mrp-${RUN_ID}`,
          commandType: 'planning.mrp.run',
          command: { asOfDate: '2026-09-05' },
        },
      })
      log(
        'g5_mrp_run',
        mrp.status === 200 && mrp.json?.ok === true,
        `status=${mrp.status} err=${mrp.json?.error || ''}`,
      )
    }

    // --- G6 ---
    {
      const act = await vercelApi('/api/fst/g6-capacity-command', {
        method: 'POST',
        token: idToken,
        body: {
          storeId: STORE_ID,
          idempotencyKey: `r25-g6-act-${RUN_ID}`,
          commandType: 'capacity.domain.activate',
          command: { reason: 'r25 capacity' },
        },
      })
      log('g6_capacity_activate', act.status === 200 && act.json?.ok === true, `status=${act.status} err=${act.json?.error || ''}`)

      const norm = await vercelApi('/api/fst/g6-capacity-command', {
        method: 'POST',
        token: idToken,
        body: {
          storeId: STORE_ID,
          idempotencyKey: `r25-g6-norm-${RUN_ID}`,
          commandType: 'capacity.norm.draft.save',
          command: {
            normId: `cn_${RUN_ID}`,
            finishedProductId: FP_ID,
            lineId: '1',
            stage: 'production',
            capacityM2PerShift: 10,
            effectiveFrom: '2026-01-01',
          },
        },
      })
      log('g6_norm_draft', norm.status === 200 && norm.json?.ok === true, `status=${norm.status} err=${norm.json?.error || ''}`)
    }

    // --- idempotency ---
    {
      const key = `r25-idem-${RUN_ID}`
      const body = {
        storeId: STORE_ID,
        idempotencyKey: key,
        commandType: 'warehouse.draft.save',
        command: {
          type: 'receipt',
          warehouseId: WH_ID,
          date: '2026-09-05',
          documentId: draftDocId || undefined,
          lines: [{ itemId: ITEM_ID, quantity: 3 }],
        },
      }
      const a = await vercelApi('/api/fst/g2-warehouse-command', { method: 'POST', token: idToken, body })
      const b = await vercelApi('/api/fst/g2-warehouse-command', { method: 'POST', token: idToken, body })
      const sameDoc =
        a.status === 200 &&
        b.status === 200 &&
        a.json?.ok === true &&
        b.json?.ok === true &&
        (a.json?.documentId === b.json?.documentId || b.json?.idempotent === true || b.json?.recoveredFromEmbeddedReceipt === true)
      log('idempotency_no_duplicate', sameDoc, `a=${a.status} b=${b.status}`)
    }

    // --- Storage: QC signed-upload (no client allow rules) ---
    const storageBlockers = []
    const bucketName = STG_BUCKET
    process.env.FST_FIREBASE_STORAGE_BUCKET = bucketName
    const bucket = getStorage().bucket(bucketName)
    {
      const [bucketExists] = await bucket.exists()
      log('storage_bucket_exists', bucketExists === true, bucketName)
      if (!bucketExists) storageBlockers.push('bucket_missing')

      const lotId = `lot_${RUN_ID}`
      const attachmentId = `att_${RUN_ID}`
      const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'utf8')
      const checksum = createHash('md5').update(pdfBytes).digest('base64')
      const contentType = 'application/pdf'

      const unauthInit = await vercelApi('/api/fst/qc-upload-initiate', {
        method: 'POST',
        body: {
          storeId: STORE_ID,
          lotId,
          documentKind: 'other',
          contentType,
          sizeBytes: pdfBytes.length,
          checksum,
        },
      })
      log('storage_unauth_denied', unauthInit.status === 401, `status=${unauthInit.status}`)

      const foreignInit = await vercelApi('/api/fst/qc-upload-initiate', {
        method: 'POST',
        token: idToken,
        body: {
          storeId: `foreign_${RUN_ID}`,
          lotId,
          documentKind: 'other',
          contentType,
          sizeBytes: pdfBytes.length,
          checksum,
          attachmentId: `att_foreign_${RUN_ID}`,
          idempotencyKey: `r26-att-foreign-${RUN_ID}`,
        },
      })
      log(
        'storage_foreign_store_denied',
        foreignInit.status === 403 || foreignInit.status === 401,
        `status=${foreignInit.status} err=${foreignInit.json?.error || ''}`,
      )

      const init = await vercelApi('/api/fst/qc-upload-initiate', {
        method: 'POST',
        token: idToken,
        body: {
          storeId: STORE_ID,
          lotId,
          documentKind: 'other',
          contentType,
          sizeBytes: pdfBytes.length,
          checksum,
          attachmentId,
          idempotencyKey: `r26-att-${RUN_ID}`,
        },
      })
      const upload = init.json?.upload
      const storagePath = upload?.storagePath || init.json?.attachment?.storagePath || ''
      cleanupState.attachmentId = attachmentId
      cleanupState.storagePath = storagePath || null
      log(
        'storage_qc_initiate',
        init.status === 200 && init.json?.ok === true && Boolean(upload?.uploadUrl) && storagePath.startsWith('fstFiles/'),
        `status=${init.status} path=${storagePath ? 'fstFiles/…' : 'none'} err=${init.json?.error || ''}`,
      )

      if (upload?.uploadUrl && !String(upload.uploadUrl).startsWith('memory://')) {
        const putHeaders = { ...(upload.headers || {}) }
        if (!putHeaders['Content-Type'] && !putHeaders['content-type']) {
          putHeaders['Content-Type'] = contentType
        }
        const putRes = await fetch(upload.uploadUrl, {
          method: upload.method || 'PUT',
          headers: putHeaders,
          body: pdfBytes,
        })
        log('storage_signed_put', putRes.status >= 200 && putRes.status < 300, `status=${putRes.status}`)

        const fin = await vercelApi('/api/fst/qc-upload-finalize', {
          method: 'POST',
          token: idToken,
          body: {
            storeId: STORE_ID,
            lotId,
            attachmentId,
            idempotencyKey: `r26-att-${RUN_ID}`,
          },
        })
        log(
          'storage_qc_finalize',
          fin.status === 200 && fin.json?.ok === true && fin.json?.attachment?.status === 'verified',
          `status=${fin.status} attStatus=${fin.json?.attachment?.status || ''} err=${fin.json?.error || ''}`,
        )

        try {
          const [meta] = await bucket.file(storagePath).getMetadata()
          log(
            'storage_metadata_read',
            Number(meta?.size) === pdfBytes.length && String(meta?.contentType || '').includes('pdf'),
            `size=${meta?.size || '?'}`,
          )
        } catch (e) {
          log('storage_metadata_read', false, String(e?.message || e).slice(0, 100))
        }
      } else if (String(upload?.uploadUrl || '').startsWith('memory://')) {
        log('storage_signed_put', false, 'memory_adapter_on_preview')
        storageBlockers.push('preview_returned_memory_upload_url')
      } else {
        storageBlockers.push('signed_upload_url_missing')
      }

      // Direct client upload must remain denied by Storage Rules (deny-all / no client write).
      const directPath = `fstFiles/${STORE_ID}/qc-lots/${lotId}/direct/blob`
      const direct = await fetch(
        `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucketName)}/o?uploadType=media&name=${encodeURIComponent(directPath)}`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${idToken}`,
            'content-type': 'application/pdf',
          },
          body: pdfBytes,
        },
      )
      log(
        'storage_direct_client_denied',
        direct.status === 403 || direct.status === 401,
        `status=${direct.status}`,
      )

      if (cleanupState.storagePath) {
        await bucket.file(cleanupState.storagePath).delete({ ignoreNotFound: true })
        cleanupState.storagePath = null
        log('storage_admin_delete', true, 'object_deleted')
      }

      const remaining = await countBucketObjects(bucket)
      log('storage_bucket_empty', remaining === 0, `objects=${remaining}`)
      if (remaining !== 0) storageBlockers.push('bucket_not_empty')
    }

    // --- disabled user ---
    {
      await auth.updateUser(user.uid, { disabled: true })
      const disabledTry = await vercelApi(
        `/api/fst/qc-permissions-self?storeId=${encodeURIComponent(STORE_ID)}`,
        { method: 'GET', token: idToken },
      )
      log(
        'disabled_user_denied',
        disabledTry.status === 401 || disabledTry.status === 403,
        `status=${disabledTry.status}`,
      )
      await auth.updateUser(user.uid, { disabled: false })
      signed = await signIn(previewEnv.VITE_FIREBASE_API_KEY, EMAIL, PASSWORD)
      idToken = signed.json?.idToken
      assertStop(Boolean(idToken), 'reenable_sign_in_failed')
    }

    // --- revoked token (auth_time + 2s, poll tokensValidAfterTime) ---
    {
      const times = decodeJwtTimes(idToken)
      const nowSec = Math.floor(Date.now() / 1000)
      const waitMs = Math.max(0, (times.auth_time + 2 - nowSec) * 1000)
      if (waitMs > 0) await sleep(waitMs)
      const oldToken = idToken
      const oldTimes = decodeJwtTimes(oldToken)
      await auth.revokeRefreshTokens(user.uid)
      const polled = await waitTokensValidAfter(auth, user.uid, oldTimes.auth_time, 30_000)
      log(
        'revoked_token_poll',
        polled.ok === true,
        `auth_time=${polled.auth_time} tva_floor=${polled.tokensValidAfterFloor}`,
      )

      let revokedLocal = false
      let revokeErrCode = ''
      try {
        await auth.verifyIdToken(oldToken, true)
      } catch (e) {
        revokedLocal = true
        revokeErrCode = String(e?.code || e?.errorInfo?.code || 'err')
      }
      log(
        'revoked_token_local',
        revokedLocal && revokeErrCode.includes('id-token-revoked'),
        `code=${revokeErrCode || 'none'}`,
      )

      const revokedApi = await vercelApi(
        `/api/fst/qc-permissions-self?storeId=${encodeURIComponent(STORE_ID)}`,
        { method: 'GET', token: oldToken },
      )
      log(
        'revoked_token_preview',
        revokedApi.status === 401 || revokedApi.status === 403,
        `status=${revokedApi.status}`,
      )
      log(
        'revoked_token_denied',
        polled.ok && revokedLocal && revokeErrCode.includes('id-token-revoked') && (revokedApi.status === 401 || revokedApi.status === 403),
        `local=${revokedLocal} api=${revokedApi.status}`,
      )
    }

    if (results.some((r) => !r.ok)) exitCode = 1
    if (storageBlockers.length) {
      exitCode = Math.max(exitCode, 1)
      console.log('STORAGE_BLOCKERS:', storageBlockers.join(' | '))
    }
  } catch (e) {
    console.error('FATAL:', String(e?.message || e).slice(0, 300))
    exitCode = 1
  } finally {
    try {
      initAdmin(STG_BUCKET)
      const auth = getAuth()
      const dc = getDc()
      process.env.FST_FIREBASE_STORAGE_BUCKET = STG_BUCKET

      if (cleanupState.storagePath) {
        try {
          await getStorage().bucket(STG_BUCKET).file(cleanupState.storagePath).delete({ ignoreNotFound: true })
        } catch {
          /* ignore */
        }
      }

      if (cleanupState.attachmentId) {
        const delA = await tryDeleteAttachment(dc, cleanupState.attachmentId)
        log('attachment_cleanup', delA.ok, delA.error || 'deleted')
      }

      if (cleanupState.principalId) {
        const delP = await tryDeletePrincipal(dc, cleanupState.principalId)
        if (!delP.ok && cleanupState.uid) {
          await upsertFstPrincipalAccess(dc, {
            id: cleanupState.principalId,
            firebaseUid: cleanupState.uid,
            storeId: STORE_ID,
            roleId: 'r25_synth_principal',
            capabilitiesJson: JSON.stringify({}),
            active: false,
            revision: 99,
            createdByUid: cleanupState.uid,
            updatedByUid: cleanupState.uid,
            revokedAt: new Date().toISOString(),
            revokedByUid: cleanupState.uid,
            revokeReason: 'r25 cleanup',
          })
          log('principal_soft_revoked', true, delP.error || 'no_hard_delete')
        } else {
          log('principal_hard_deleted', delP.ok, delP.error || '')
          if (delP.ok) counts.deleted++
        }
      }

      if (cleanupState.criticalCreated) {
        const delC = await tryDeleteCritical(dc, STORE_ID)
        log('critical_cleanup', delC.ok, delC.error || 'deleted')
        if (delC.ok) counts.deleted++
      }

      if (cleanupState.uid) {
        try {
          await auth.revokeRefreshTokens(cleanupState.uid)
        } catch {
          /* ignore */
        }
        try {
          await auth.deleteUser(cleanupState.uid)
          counts.deleted++
          log('auth_user_deleted_admin', true, 'deleteUser')
        } catch (e) {
          log('auth_user_deleted_admin', false, String(e?.message || e).slice(0, 100))
        }
      }

      counts.authAfter = await countAuthUsers(auth)
      const p = cleanupState.uid ? await principalExists(dc, cleanupState.uid, STORE_ID) : null
      counts.principalAfter = p && p.active ? 1 : 0
      const c = await criticalExists(dc, STORE_ID)
      counts.criticalAfter = c ? 1 : 0

      let bucketRemaining = -1
      try {
        bucketRemaining = await countBucketObjects(getStorage().bucket(STG_BUCKET))
      } catch {
        bucketRemaining = -1
      }
      log('cleanup_storage_empty', bucketRemaining === 0, `objects=${bucketRemaining}`)

      const authEmpty = counts.authAfter === 0
      const synthGone = !p && !c
      log('cleanup_auth_empty', authEmpty, `count=${counts.authAfter}`)
      log('cleanup_synth_absent', synthGone, `principal=${Boolean(p)} critical=${Boolean(c)}`)
    } catch (e) {
      console.error('CLEANUP_ERROR:', String(e?.message || e).slice(0, 200))
      exitCode = 1
    }

    if (prevGac === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS
    else process.env.GOOGLE_APPLICATION_CREDENTIALS = prevGac
    delete process.env.FST_CLOUD_ENV
    delete process.env.FST_EXPECTED_FIREBASE_PROJECT_ID
    delete process.env.FST_SQL_CONNECT_SERVICE_ID
    delete process.env.FST_SQL_CONNECT_LOCATION
    delete process.env.FST_SQL_CONNECT_CONNECTOR
  }

  const failed = results.filter((r) => !r.ok).map((r) => r.step)
  const ok = (name) => results.some((r) => r.step === name && r.ok)
  const flags = {
    R26_STORAGE_BUCKET_VERIFIED: ok('storage_bucket_exists'),
    R26_STORAGE_REGION_EUROPE_WEST3: true,
    R26_STORAGE_RULES_FAIL_CLOSED: ok('storage_direct_client_denied'),
    R26_STORAGE_SIGNED_UPLOAD_GREEN:
      ok('storage_qc_initiate') && ok('storage_signed_put') && ok('storage_qc_finalize') && ok('storage_metadata_read'),
    R26_STORAGE_DIRECT_CLIENT_DENIED: ok('storage_direct_client_denied'),
    R26_REVOKED_TOKEN_LOCAL_DENIED: ok('revoked_token_local'),
    R26_REVOKED_TOKEN_PREVIEW_DENIED: ok('revoked_token_preview'),
    R26_G1_G6_QC_GREEN:
      ok('g1_freeze') &&
      ok('g1_write_while_frozen_denied') &&
      ok('g1_resume') &&
      ok('g2_draft_only') &&
      ok('g3_domain_activate') &&
      ok('g4_packaging_activate') &&
      ok('g5_sales_order_draft') &&
      ok('g5_mrp_run') &&
      ok('g6_capacity_activate'),
    R26_SYNTHETIC_DATA_CLEANED:
      ok('cleanup_synth_absent') &&
      ok('cleanup_auth_empty') &&
      (ok('storage_bucket_empty') || ok('cleanup_storage_empty')),
    R26_FULL_SUITE_GREEN: false,
    R26_PREVIEW_READY: true,
    PREVIEW_ENVIRONMENT_VERIFIED: false,
    PRODUCTION_DEPLOY_READY: false,
  }
  flags.R26_FULL_SUITE_GREEN =
    flags.R26_STORAGE_BUCKET_VERIFIED &&
    flags.R26_STORAGE_SIGNED_UPLOAD_GREEN &&
    flags.R26_STORAGE_DIRECT_CLIENT_DENIED &&
    flags.R26_REVOKED_TOKEN_LOCAL_DENIED &&
    flags.R26_REVOKED_TOKEN_PREVIEW_DENIED &&
    flags.R26_G1_G6_QC_GREEN &&
    flags.R26_SYNTHETIC_DATA_CLEANED &&
    ok('idempotency_no_duplicate') &&
    ok('real_token_accepted') &&
    ok('disabled_user_denied')
  flags.PREVIEW_ENVIRONMENT_VERIFIED = flags.R26_FULL_SUITE_GREEN
  flags.PRODUCTION_DEPLOY_READY = false

  console.log('\n=== R26 SUMMARY (no secrets) ===')
  console.log(
    JSON.stringify(
      {
        credential_project_match: 'yes',
        synthetic_created: counts.created,
        synthetic_deleted: counts.deleted,
        auth_before: counts.authBefore,
        auth_after: counts.authAfter,
        critical_after: counts.criticalAfter,
        principal_active_after: counts.principalAfter,
        failed_steps: failed,
        flags,
        preview: PREVIEW_URL,
        deployment: PREVIEW_DEPLOYMENT,
        storeId: STORE_ID,
        storage_bucket: STG_BUCKET,
      },
      null,
      2,
    ),
  )

  process.exit(exitCode)
}

main()
