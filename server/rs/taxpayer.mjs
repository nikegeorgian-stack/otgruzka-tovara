import { getTpInfoPublic } from './soap.mjs'
import { checkRateLimit, verifyAllowedFstUser } from '../fst/_allowedUser.mjs'
import { resolveRsCredentials } from './_store.mjs'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' })
    return
  }

  const auth = await verifyAllowedFstUser(req)
  if (!auth.ok) {
    res.status(auth.status).json({ ok: false, error: auth.error })
    return
  }

  const limited = checkRateLimit(`rs-taxpayer:${auth.email}`, { limit: 40, windowMs: 60_000 })
  if (!limited.ok) {
    res.status(limited.status).json({ ok: false, error: limited.error })
    return
  }

  const tpCode = String(req.body?.tpCode ?? req.body?.personalId ?? '').trim()
  if (!tpCode || tpCode.length > 32) {
    res.status(400).json({ ok: false, error: 'invalid_tp_code' })
    return
  }
  try {
    const creds = await resolveRsCredentials()
    if (!creds) {
      res.status(503).json({ ok: false, error: 'rs_not_configured' })
      return
    }
    const result = await getTpInfoPublic({
      username: creds.username,
      password: creds.password,
      tpCode,
    })
    // Бизнес-ошибки RS (не найден / неверный логин) — HTTP 200 + ok:false,
    // чтобы клиент не путал с падением API и показал точный код.
    if (!result.ok && result.error === 'invalid_tp_code') {
      res.status(400).json(result)
      return
    }
    res.status(200).json(result)
  } catch (err) {
    console.error('rs taxpayer failed', err)
    res.status(500).json({ ok: false, error: 'rs_failed' })
  }
}
