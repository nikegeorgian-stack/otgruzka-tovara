import {
  clearRsCredentialsFirestore,
  getRsCredentialsStatus,
  saveRsCredentialsFirestore,
  verifySysAdminRequest,
} from './_store.mjs'

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const auth = await verifySysAdminRequest(req)
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error })
      return
    }
    try {
      const status = await getRsCredentialsStatus()
      res.status(200).json(status)
    } catch (err) {
      console.error('rs credentials status failed', err)
      res.status(500).json({ error: 'status_failed' })
    }
    return
  }

  if (req.method === 'POST') {
    const auth = await verifySysAdminRequest(req)
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error })
      return
    }
    try {
      const result = await saveRsCredentialsFirestore({
        username: req.body?.username,
        password: req.body?.password,
        updatedBy: auth.email,
      })
      if (!result.ok) {
        res.status(400).json(result)
        return
      }
      res.status(200).json({
        ok: true,
        configured: true,
        source: 'firestore',
        usernameMasked: result.usernameMasked,
        lockedByEnv: false,
      })
    } catch (err) {
      console.error('rs credentials save failed', err)
      res.status(500).json({ error: 'save_failed' })
    }
    return
  }

  if (req.method === 'DELETE') {
    const auth = await verifySysAdminRequest(req)
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error })
      return
    }
    try {
      const result = await clearRsCredentialsFirestore()
      if (!result.ok) {
        res.status(400).json(result)
        return
      }
      res.status(200).json({ ok: true, configured: false })
    } catch (err) {
      console.error('rs credentials clear failed', err)
      res.status(500).json({ error: 'clear_failed' })
    }
    return
  }

  res.status(405).json({ error: 'method_not_allowed' })
}
