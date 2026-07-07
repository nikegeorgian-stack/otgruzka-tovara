import { getAuth } from 'firebase-admin/auth'
import { initFirebaseAdmin, verifySysAdminRequest } from './_adminAuth.mjs'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' })
    return
  }

  const auth = await verifySysAdminRequest(req)
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error })
    return
  }

  const { email, password, displayName } = req.body ?? {}
  const newEmail = typeof email === 'string' ? email.trim().toLowerCase() : ''
  if (!newEmail || !newEmail.includes('@') || typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ error: 'invalid_input' })
    return
  }

  try {
    initFirebaseAdmin()
    await getAuth().createUser({
      email: newEmail,
      password,
      displayName: typeof displayName === 'string' && displayName.trim() ? displayName.trim() : newEmail,
      emailVerified: false,
    })
    res.status(200).json({ ok: true })
  } catch (err) {
    const code = err?.code || err?.errorInfo?.code
    if (code === 'auth/email-already-exists') {
      res.status(409).json({ error: 'email_exists' })
      return
    }
    console.error('create-user failed', err)
    res.status(500).json({ error: 'create_failed', message: err?.message })
  }
}
