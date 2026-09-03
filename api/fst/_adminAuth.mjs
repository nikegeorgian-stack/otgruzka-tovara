import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

export const FST_ADMIN_EMAILS = new Set([
  'admin@fibercell.net',
  'nikegeorgian@gmail.com',
  'admin-dm@fibercell.net',
  'levan-admin@fibercell.net',
])

export function initFirebaseAdmin() {
  if (getApps().length > 0) return
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  if (raw?.trim()) {
    initializeApp({ credential: cert(JSON.parse(raw)) })
    return
  }
  // Local Data Connect emulator only — never use production service account here.
  const emulatorHost = String(
    process.env.DATA_CONNECT_EMULATOR_HOST ?? process.env.FIREBASE_DATA_CONNECT_EMULATOR_HOST ?? '',
  ).trim()
  if (emulatorHost || process.env.QC_LOCAL_EMULATOR === '1') {
    initializeApp({
      projectId: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'otgruzka-tovara',
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
    const decoded = await getAuth().verifyIdToken(token)
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

export async function verifyIdToken(token) {
  initFirebaseAdmin()
  return getAuth().verifyIdToken(token)
}
