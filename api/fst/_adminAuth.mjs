import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

export const FST_ADMIN_EMAILS = new Set([
  'admin@fibercell.net',
  'admin-dm@fibercell.net',
  'levan-admin@fibercell.net',
])

export function initFirebaseAdmin() {
  if (getApps().length > 0) return
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  if (!raw?.trim()) {
    throw new Error('service_account_missing')
  }
  initializeApp({ credential: cert(JSON.parse(raw)) })
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
    const email = decoded.email?.trim().toLowerCase()
    if (!email || !FST_ADMIN_EMAILS.has(email)) {
      return { ok: false, status: 403, error: 'forbidden' }
    }
    return { ok: true, email }
  } catch {
    return { ok: false, status: 401, error: 'unauthorized' }
  }
}

export function getAdminAuth() {
  initFirebaseAdmin()
  return getAuth()
}
