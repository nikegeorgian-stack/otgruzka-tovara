import { FST_ADMIN_EMAILS, initFirebaseAdmin, verifyIdToken } from './_adminAuth.mjs'

export function isFstSysadmin(decoded) {
  const email = String(decoded?.email ?? '').trim().toLowerCase()
  return Boolean(decoded?.fstSysadmin === true || (email && FST_ADMIN_EMAILS.has(email)))
}

export async function verifyBearerToken(req) {
  const authHeader = req?.headers?.authorization || ''
  const token = String(authHeader).replace(/^Bearer\s+/i, '')
  if (!token) {
    return { ok: false, status: 401, error: 'unauthorized' }
  }

  try {
    initFirebaseAdmin()
  } catch {
    return { ok: false, status: 503, error: 'service_account_missing' }
  }

  try {
    const claims = await verifyIdToken(token)
    const email = String(claims?.email ?? '').trim().toLowerCase() || undefined
    return {
      ok: true,
      uid: claims.uid,
      email,
      claims,
      status: 200,
      error: undefined,
    }
  } catch {
    return { ok: false, status: 401, error: 'unauthorized' }
  }
}
