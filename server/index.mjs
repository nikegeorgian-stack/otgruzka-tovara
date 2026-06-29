import cors from 'cors'
import express from 'express'
import { getDbPath, readStoreRow, writeStoreRow } from './db.mjs'
import { registerCecRoutes } from './cec/routes.mjs'
import { registerTrackingRoutes } from './tracking/routes.mjs'
import { localCorsOptions, requireLocalApiAuth } from './auth.mjs'

const PORT = Number(process.env.TABEL_DB_PORT || 3847)
const HOST = process.env.TABEL_DB_HOST || '127.0.0.1'
const app = express()

app.set('trust proxy', 1)
app.use(cors(localCorsOptions()))
app.use(express.json({ limit: '32mb' }))

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    db: getDbPath(),
    engine: 'sqlite',
  })
})

app.get('/api/store', requireLocalApiAuth, (_req, res) => {
  const row = readStoreRow()
  if (!row) {
    res.json({ store: null, updatedAt: null })
    return
  }
  res.json(row)
})

function handleStoreSave(req, res) {
  const store = req.body?.store
  if (!store || typeof store !== 'object') {
    res.status(400).json({ error: 'invalid_payload' })
    return
  }
  try {
    const updatedAt = writeStoreRow(store)
    res.json({ ok: true, updatedAt })
  } catch (err) {
    console.error('SQLite save failed', err)
    res.status(500).json({ error: 'save_failed' })
  }
}

app.put('/api/store', requireLocalApiAuth, handleStoreSave)
app.post('/api/store', requireLocalApiAuth, handleStoreSave)

registerTrackingRoutes(app, requireLocalApiAuth)
registerCecRoutes(app, requireLocalApiAuth)

app.listen(PORT, HOST, () => {
  console.log(`FST local DB (SQLite): http://${HOST}:${PORT}`)
  console.log(`File: ${getDbPath()}`)
  if (process.env.TABEL_DB_API_KEY?.trim()) {
    console.log('API key auth: enabled (X-Tabel-Api-Key)')
  } else if (HOST === '127.0.0.1' || HOST === 'localhost') {
    console.log('Network: localhost only (set TABEL_DB_HOST=0.0.0.0 + TABEL_DB_API_KEY for LAN)')
  }
})
