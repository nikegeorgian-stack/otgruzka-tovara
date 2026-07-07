import { getAdminAuth, verifySysAdminRequest } from './_adminAuth.mjs'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method_not_allowed' })
    return
  }

  const auth = await verifySysAdminRequest(req)
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error })
    return
  }

  try {
    const adminAuth = getAdminAuth()
    const users = []
    let pageToken
    do {
      const batch = await adminAuth.listUsers(1000, pageToken)
      for (const u of batch.users) {
        if (!u.email) continue
        users.push({
          email: u.email.trim().toLowerCase(),
          displayName: u.displayName || u.email,
          disabled: u.disabled === true,
          uid: u.uid,
        })
      }
      pageToken = batch.pageToken
    } while (pageToken)

    users.sort((a, b) => a.email.localeCompare(b.email, 'ru'))
    res.status(200).json({ users })
  } catch (err) {
    console.error('list-users failed', err)
    res.status(500).json({ error: 'list_failed', message: err?.message })
  }
}
