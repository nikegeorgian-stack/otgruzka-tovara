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

  const { email } = req.body ?? {}
  const key = typeof email === 'string' ? email.trim().toLowerCase() : ''
  if (!key || !key.includes('@')) {
    res.status(400).json({ error: 'invalid_input' })
    return
  }

  if (auth.email === key) {
    res.status(403).json({ error: 'cannot_delete_self' })
    return
  }

  try {
    const adminAuth = getAdminAuth()
    const record = await adminAuth.getUserByEmail(key)
    await adminAuth.deleteUser(record.uid)
    res.status(200).json({ ok: true })
  } catch (err) {
    const code = err?.code || err?.errorInfo?.code
    if (code === 'auth/user-not-found') {
      res.status(404).json({ error: 'user_not_found' })
      return
    }
    console.error('delete-user failed', err)
    res.status(500).json({ error: 'delete_failed', message: err?.message })
  }
}
