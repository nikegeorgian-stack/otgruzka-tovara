import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { FST_ADMIN_EMAILS, initFirebaseAdmin } from './_adminAuth.mjs'

/** Совпадает с legacyAllowedEmails в firestore.rules / storage.rules. */
export const FST_LEGACY_ALLOWED_EMAILS = new Set([
  'admin@fibercell.net',
  'nikegeorgian@gmail.com',
  'admin-dm@fibercell.net',
  'levan-admin@fibercell.net',
  'hr-nino@fibercell.net',
  'inspektor-nata@fibercell.net',
  'finans-lizi@fibercell.net',
  'sklad-alexandra@fibercell.net',
  'manager-ved-tamara@fibercell.net',
  'technolog-lasha@fibercell.net',
  'technolog-ekaterina@fibercell.net',
  'technolog-annastasia@fibercell.net',
  'technolog-maria@fibercell.net',
  'master-karlo@fibercell.net',
  'master-valera@fibercell.net',
])

async function emailOnDynamicAllowlist(email) {
  try {
    const snap = await getFirestore().doc('fstConfig/access').get()
    const list = snap.data()?.allowedLogins
    if (!Array.isArray(list)) return false
    return list.some((e) => String(e).trim().toLowerCase() === email)
  } catch {
    return false
  }
}

export async function isAllowedFstEmail(email) {
  const key = String(email || '')
    .trim()
    .toLowerCase()
  if (!key || !key.includes('@')) return false
  if (FST_ADMIN_EMAILS.has(key) || FST_LEGACY_ALLOWED_EMAILS.has(key)) return true
  return emailOnDynamicAllowlist(key)
}

/**
 * Любой вошедший Firebase-пользователь из allowlist FST (не «любой аккаунт проекта»).
 */
export async function verifyAllowedFstUser(req) {
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
    if (!email) return { ok: false, status: 401, error: 'unauthorized' }
    if (!(await isAllowedFstEmail(email))) {
      return { ok: false, status: 403, error: 'forbidden' }
    }
    return { ok: true, email, uid: decoded.uid }
  } catch {
    return { ok: false, status: 401, error: 'unauthorized' }
  }
}

/** Простой in-memory rate limit (per serverless instance). */
const buckets = new Map()

export function checkRateLimit(key, { limit = 30, windowMs = 60_000 } = {}) {
  const now = Date.now()
  let bucket = buckets.get(key)
  if (!bucket || now - bucket.start >= windowMs) {
    bucket = { start: now, count: 0 }
    buckets.set(key, bucket)
  }
  bucket.count += 1
  if (bucket.count > limit) {
    return { ok: false, status: 429, error: 'rate_limited' }
  }
  return { ok: true }
}
