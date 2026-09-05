import { getFirestore } from 'firebase-admin/firestore'
import { getMessaging } from 'firebase-admin/messaging'
import { initFirebaseAdmin } from './_adminAuth.mjs'
import { checkRateLimit, verifyAllowedFstUser } from './_allowedUser.mjs'

/**
 * POST { emails: string[], title, body, data? }
 * Auth: Firebase-пользователь из allowlist FST + rate limit.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' })
    return
  }

  const auth = await verifyAllowedFstUser(req)
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error })
    return
  }
  const callerEmail = auth.email

  const limited = checkRateLimit(`send-push:${callerEmail}`, { limit: 20, windowMs: 60_000 })
  if (!limited.ok) {
    res.status(limited.status).json({ error: limited.error })
    return
  }

  try {
    initFirebaseAdmin()
  } catch {
    res.status(503).json({ error: 'service_account_missing' })
    return
  }

  const { emails, title, body, data } = req.body ?? {}
  const list = Array.isArray(emails)
    ? [...new Set(emails.map((e) => String(e).trim().toLowerCase()).filter((e) => e.includes('@')))]
    : []
  const t = typeof title === 'string' ? title.trim().slice(0, 120) : ''
  const b = typeof body === 'string' ? body.trim().slice(0, 400) : ''
  if (!list.length || !t) {
    res.status(400).json({ error: 'invalid_input' })
    return
  }
  if (list.length > 80) {
    res.status(400).json({ error: 'too_many_recipients' })
    return
  }

  try {
    const db = getFirestore()
    const tokens = new Set()
    for (const email of list) {
      const snap = await db.collection('fstPushTokens').where('email', '==', email).limit(5).get()
      for (const doc of snap.docs) {
        const arr = doc.data()?.tokens
        if (Array.isArray(arr)) {
          for (const tok of arr) {
            if (typeof tok === 'string' && tok.trim()) tokens.add(tok.trim())
          }
        }
      }
    }

    if (!tokens.size) {
      res.status(200).json({ ok: true, sent: 0, reason: 'no_tokens', caller: callerEmail })
      return
    }

    const messaging = getMessaging()
    const tokenList = [...tokens]
    let sent = 0
    // FCM multicast max 500
    for (let i = 0; i < tokenList.length; i += 500) {
      const chunk = tokenList.slice(i, i + 500)
      const resp = await messaging.sendEachForMulticast({
        tokens: chunk,
        notification: { title: t, body: b || t },
        data:
          data && typeof data === 'object'
            ? Object.fromEntries(
                Object.entries(data)
                  .filter(([, v]) => v != null)
                  .map(([k, v]) => [String(k), String(v)]),
              )
            : { source: 'fst' },
        android: {
          priority: 'high',
          notification: { channelId: 'fst_default', sound: 'default' },
        },
      })
      sent += resp.successCount
    }

    res.status(200).json({ ok: true, sent, recipients: list.length })
  } catch (err) {
    console.error('send-push failed', err)
    res.status(500).json({ error: 'send_failed', message: err?.message })
  }
}
