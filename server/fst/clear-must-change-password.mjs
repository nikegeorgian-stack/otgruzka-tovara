import { getAdminAuth, initFirebaseAdmin } from './_adminAuth.mjs'
import { getAuth } from 'firebase-admin/auth'

const ALLOWED_ORIGINS = new Set([
  'https://otgruzka-tovara.vercel.app',
  'https://otgruzka-tovara.web.app',
  'https://otgruzka-tovara.firebaseapp.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
])

function applyCors(req, res) {
  const origin = req.headers.origin
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type',
    )
  }
}

export default async function handler(req, res) {
  applyCors(req, res)

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' })
    return
  }

  const authHeader = req.headers.authorization || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }

  try {
    initFirebaseAdmin()
  } catch {
    res.status(503).json({ error: 'service_account_missing' })
    return
  }

  try {
    const decoded = await getAuth().verifyIdToken(token)
    const adminAuth = getAdminAuth()
    const record = await adminAuth.getUser(decoded.uid)
    const claims = { ...(record.customClaims ?? {}) }
    delete claims.mustChangePassword
    await adminAuth.setCustomUserClaims(decoded.uid, claims)
    res.status(200).json({ ok: true })
  } catch (err) {
    console.error('clear-must-change-password failed', err)
    res.status(401).json({ error: 'unauthorized' })
  }
}
