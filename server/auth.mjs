const API_KEY = process.env.TABEL_DB_API_KEY?.trim() || ''

function isLoopback(req) {
  const ip = req.ip || req.socket?.remoteAddress || ''
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    ip.endsWith('127.0.0.1')
  )
}

/** Защита store/CEC/tracking: localhost или X-Tabel-Api-Key. */
export function requireLocalApiAuth(req, res, next) {
  if (API_KEY) {
    const header = req.headers['x-tabel-api-key']
    if (header !== API_KEY) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }
    next()
    return
  }
  if (!isLoopback(req)) {
    res.status(403).json({ error: 'forbidden' })
    return
  }
  next()
}

const LOCAL_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
])

export function localCorsOptions() {
  return {
    origin(origin, callback) {
      if (!origin || LOCAL_ORIGINS.has(origin)) {
        callback(null, true)
        return
      }
      callback(new Error('cors_not_allowed'))
    },
  }
}
