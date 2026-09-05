import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import {
  FST_STAGING_PROJECT_ID,
  isStagingIsolatedRuntime,
} from './_dataConnectRuntime.mjs'

export const FST_ADMIN_EMAILS = new Set([
  'admin@fibercell.net',
  'nikegeorgian@gmail.com',
  'admin-dm@fibercell.net',
  'levan-admin@fibercell.net',
])

function parseServiceAccountProjectId(raw) {
  try {
    const parsed = JSON.parse(raw)
    return String(parsed?.project_id ?? '').trim()
  } catch {
    return ''
  }
}

/**
 * Preview/staging: refuse any service account that is not otgruzka-tovara-stg.
 * Does not log or return the JSON contents.
 */
export function assertStagingServiceAccountIsolation(rawJson) {
  if (!isStagingIsolatedRuntime()) return
  const projectId = parseServiceAccountProjectId(rawJson)
  if (!projectId) {
    throw new Error('staging_service_account_project_missing')
  }
  if (projectId !== FST_STAGING_PROJECT_ID) {
    throw new Error('staging_service_account_project_mismatch')
  }
}

/** Explicit bucket for Admin Storage (signed URL / verify). Never logs values. */
export function resolveFirebaseStorageBucket(projectId = '') {
  const fromEnv = String(process.env.FST_FIREBASE_STORAGE_BUCKET ?? '').trim()
  if (fromEnv) return fromEnv
  const pid = String(projectId || '').trim()
  if (pid === FST_STAGING_PROJECT_ID || isStagingIsolatedRuntime()) {
    return `${FST_STAGING_PROJECT_ID}.firebasestorage.app`
  }
  return undefined
}

export function initFirebaseAdmin() {
  if (getApps().length > 0) return
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  if (raw?.trim()) {
    assertStagingServiceAccountIsolation(raw)
    const parsed = JSON.parse(raw)
    const storageBucket = resolveFirebaseStorageBucket(parsed?.project_id)
    initializeApp({
      credential: cert(parsed),
      ...(storageBucket ? { storageBucket } : {}),
    })
    return
  }
  // Local Data Connect emulator only — never use production service account here.
  const emulatorHost = String(
    process.env.DATA_CONNECT_EMULATOR_HOST ?? process.env.FIREBASE_DATA_CONNECT_EMULATOR_HOST ?? '',
  ).trim()
  if (emulatorHost || process.env.QC_LOCAL_EMULATOR === '1') {
    if (isStagingIsolatedRuntime()) {
      throw new Error('staging_service_account_required')
    }
    const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'otgruzka-tovara'
    initializeApp({
      projectId,
      ...(resolveFirebaseStorageBucket(projectId)
        ? { storageBucket: resolveFirebaseStorageBucket(projectId) }
        : {}),
    })
    return
  }
  throw new Error('service_account_missing')
}

export async function verifySysAdminRequest(req) {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return { ok: false, status: 401, error: 'unauthorized' }

  try {
    initFirebaseAdmin()
  } catch {
    return { ok: false, status: 503, error: 'service_account_missing' }
  }

  try {
    const decoded = await getAuth().verifyIdToken(token, true)
    const email = decoded.email?.trim().toLowerCase() || ''
    const bootstrapAdmin = email && FST_ADMIN_EMAILS.has(email)
    const claimAdmin = decoded.fstSysadmin === true
    if (!bootstrapAdmin && !claimAdmin) {
      return { ok: false, status: 403, error: 'forbidden' }
    }
    return { ok: true, email: email || decoded.uid, uid: decoded.uid, claims: decoded }
  } catch {
    return { ok: false, status: 401, error: 'unauthorized' }
  }
}

export function getAdminAuth() {
  initFirebaseAdmin()
  return getAuth()
}

/** Verifies Firebase ID token and rejects revoked/disabled sessions (checkRevoked=true). */
export async function verifyIdToken(token) {
  initFirebaseAdmin()
  return getAuth().verifyIdToken(token, true)
}
