import { getFirestore } from 'firebase-admin/firestore'
import { sanitizeRsCredential, sanitizeRsPassword } from './soap.mjs'
import { initFirebaseAdmin, verifySysAdminRequest } from '../fst/_adminAuth.mjs'

const SECRETS_DOC = 'secrets/rsGe'

export async function verifyAnyFirebaseUser(req) {
  const { verifyAllowedFstUser } = await import('../fst/_allowedUser.mjs')
  return verifyAllowedFstUser(req)
}

function envCreds() {
  const username = sanitizeRsCredential(process.env.RS_GE_USERNAME)
  const password = sanitizeRsPassword(process.env.RS_GE_PASSWORD)
  if (!username || !password) return null
  return { username, password, source: 'env' }
}

export function maskUsername(username) {
  const u = String(username || '')
  if (u.length <= 2) return '••'
  if (u.length <= 4) return `${u.slice(0, 1)}••${u.slice(-1)}`
  return `${u.slice(0, 2)}•••${u.slice(-2)}`
}

async function readFirestoreCreds() {
  initFirebaseAdmin()
  const snap = await getFirestore().doc(SECRETS_DOC).get()
  if (!snap.exists) return null
  const data = snap.data() || {}
  const username = typeof data.username === 'string' ? sanitizeRsCredential(data.username) : ''
  const password = typeof data.password === 'string' ? sanitizeRsPassword(data.password) : ''
  if (!username || !password) return null
  return { username, password, source: 'firestore' }
}

/** Env > Firestore. */
export async function resolveRsCredentials() {
  return envCreds() || (await readFirestoreCreds())
}

export async function getRsCredentialsStatus() {
  const env = envCreds()
  if (env) {
    return {
      configured: true,
      source: 'env',
      usernameMasked: maskUsername(env.username),
      lockedByEnv: true,
    }
  }
  const fsCreds = await readFirestoreCreds()
  if (fsCreds) {
    return {
      configured: true,
      source: 'firestore',
      usernameMasked: maskUsername(fsCreds.username),
      lockedByEnv: false,
    }
  }
  return { configured: false, source: null, usernameMasked: null, lockedByEnv: false }
}

export async function saveRsCredentialsFirestore({ username, password, updatedBy }) {
  if (envCreds()) return { ok: false, error: 'locked_by_env' }
  const user = sanitizeRsCredential(username)
  if (!user) return { ok: false, error: 'invalid_username' }

  initFirebaseAdmin()
  const ref = getFirestore().doc(SECRETS_DOC)
  const prev = await ref.get()
  const prevPass =
    typeof prev.data()?.password === 'string' ? sanitizeRsPassword(prev.data().password) : ''
  const pass = sanitizeRsPassword(password)
  const nextPass = pass || prevPass
  if (!nextPass) return { ok: false, error: 'invalid_password' }

  await ref.set(
    {
      username: user,
      password: nextPass,
      updatedAt: new Date().toISOString(),
      updatedBy: updatedBy || null,
    },
    { merge: true },
  )
  return { ok: true, usernameMasked: maskUsername(user) }
}

export async function clearRsCredentialsFirestore() {
  if (envCreds()) return { ok: false, error: 'locked_by_env' }
  initFirebaseAdmin()
  await getFirestore().doc(SECRETS_DOC).delete().catch(() => {})
  return { ok: true }
}

export { verifySysAdminRequest }
