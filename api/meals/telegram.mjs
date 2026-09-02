import { verifyAllowedFstUser, checkRateLimit } from '../fst/_allowedUser.mjs'

/**
 * POST { text, kind?: 'lunch'|'extra' }
 * Sends a kitchen summary via Telegram. Bot token and chat ids stay in env:
 * MEALS_TELEGRAM_BOT_TOKEN, MEALS_TELEGRAM_LUNCH_CHAT_ID, MEALS_TELEGRAM_EXTRA_CHAT_ID.
 * Does not read FBeda Firestore.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' })
    return
  }

  const cron = process.env.MEALS_TELEGRAM_CRON_SECRET
  const header = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  let caller = 'cron'
  if (!cron || header !== cron) {
    const auth = await verifyAllowedFstUser(req)
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error })
      return
    }
    caller = auth.email
    const limited = checkRateLimit(`meals-tg:${caller}`, { limit: 10, windowMs: 60_000 })
    if (!limited.ok) {
      res.status(limited.status).json({ error: limited.error })
      return
    }
  }

  const token = process.env.MEALS_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN
  const kind = req.body?.kind === 'extra' ? 'extra' : 'lunch'
  const chatId =
    kind === 'extra'
      ? process.env.MEALS_TELEGRAM_EXTRA_CHAT_ID || process.env.TELEGRAM_EXTRA_CHAT_ID
      : process.env.MEALS_TELEGRAM_LUNCH_CHAT_ID || process.env.TELEGRAM_LUNCH_CHAT_ID
  const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 3500) : ''
  if (!token || !chatId || !text) {
    res.status(400).json({ error: 'telegram_not_configured_or_empty' })
    return
  }

  try {
    const tg = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    })
    if (!tg.ok) {
      res.status(502).json({ error: 'telegram_failed', caller })
      return
    }
    res.status(200).json({ ok: true, caller })
  } catch {
    res.status(502).json({ error: 'telegram_failed', caller })
  }
}
