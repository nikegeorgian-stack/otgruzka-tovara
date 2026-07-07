import { getAdminAuth, verifySysAdminRequest } from './_adminAuth.mjs'

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

  const { email, password, disabled, displayName } = req.body ?? {}
  const key = typeof email === 'string' ? email.trim().toLowerCase() : ''
  if (!key || !key.includes('@')) {
    res.status(400).json({ error: 'invalid_input' })
    return
  }

  try {
    const adminAuth = getAdminAuth()
    const record = await adminAuth.getUserByEmail(key)
    const patch = {}

    if (typeof password === 'string' && password.length >= 8) {
      patch.password = password
    }
    if (typeof disabled === 'boolean') {
      patch.disabled = disabled
    }
    if (typeof displayName === 'string' && displayName.trim()) {
      patch.displayName = displayName.trim()
    }

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: 'nothing_to_update' })
      return
    }

    await adminAuth.updateUser(record.uid, patch)
    res.status(200).json({ ok: true })
  } catch (err) {
    const code = err?.code || err?.errorInfo?.code
    if (code === 'auth/user-not-found') {
      res.status(404).json({ error: 'user_not_found' })
      return
    }
    console.error('update-user failed', err)
    res.status(500).json({ error: 'update_failed', message: err?.message })
  }
}
