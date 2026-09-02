import { getAdminAuth, verifySysAdminRequest } from './_adminAuth.mjs'

async function setMustChangePassword(adminAuth, uid, value) {
  const record = await adminAuth.getUser(uid)
  const claims = { ...(record.customClaims ?? {}) }
  if (value) claims.mustChangePassword = true
  else delete claims.mustChangePassword
  await adminAuth.setCustomUserClaims(uid, claims)
}

async function setSysadminClaim(adminAuth, uid, isSysadmin) {
  const record = await adminAuth.getUser(uid)
  const claims = { ...(record.customClaims ?? {}) }
  if (isSysadmin) claims.fstSysadmin = true
  else delete claims.fstSysadmin
  await adminAuth.setCustomUserClaims(uid, claims)
}

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

  const { email, password, disabled, displayName, mustChangePassword, roleId } = req.body ?? {}
  const key = typeof email === 'string' ? email.trim().toLowerCase() : ''
  if (!key || !key.includes('@')) {
    res.status(400).json({ error: 'invalid_input' })
    return
  }

  if (typeof password === 'string' && password.length > 0 && password.length < 8) {
    res.status(400).json({ error: 'password_too_short' })
    return
  }

  const hasPassword = typeof password === 'string' && password.length >= 8
  const name =
    typeof displayName === 'string' && displayName.trim() ? displayName.trim() : key

  try {
    const adminAuth = getAdminAuth()
    let record
    try {
      record = await adminAuth.getUserByEmail(key)
    } catch (lookupErr) {
      const lookupCode = lookupErr?.code || lookupErr?.errorInfo?.code
      if (lookupCode !== 'auth/user-not-found' || !hasPassword) {
        throw lookupErr
      }
      const created = await adminAuth.createUser({
        email: key,
        password,
        displayName: name,
        emailVerified: false,
      })
      await setMustChangePassword(adminAuth, created.uid, true)
      res.status(200).json({ ok: true, created: true })
      return
    }

    const patch = {}
    if (hasPassword) patch.password = password
    if (typeof disabled === 'boolean') patch.disabled = disabled
    if (typeof displayName === 'string' && displayName.trim()) {
      patch.displayName = displayName.trim()
    }

    if (Object.keys(patch).length === 0 && typeof mustChangePassword !== 'boolean') {
      res.status(400).json({ error: 'nothing_to_update' })
      return
    }

    if (Object.keys(patch).length > 0) {
      await adminAuth.updateUser(record.uid, patch)
    }

    if (patch.password || typeof mustChangePassword === 'boolean') {
      const flag = patch.password ? true : mustChangePassword === true
      await setMustChangePassword(adminAuth, record.uid, flag)
    }

    if (typeof roleId === 'string') {
      await setSysadminClaim(adminAuth, record.uid, roleId === 'sysadmin')
    }

    res.status(200).json({ ok: true })
  } catch (err) {
    const code = err?.code || err?.errorInfo?.code
    if (code === 'auth/user-not-found') {
      res.status(404).json({ error: 'user_not_found' })
      return
    }
    if (code === 'auth/email-already-exists') {
      res.status(409).json({ error: 'email_exists' })
      return
    }
    console.error('update-user failed', err)
    res.status(500).json({ error: 'update_failed', message: err?.message })
  }
}
