/**
 * Обновляет схему SQLite (data/tabel.db): добавляет новые поля журналов и т.п.
 * Run: npm run migrate:local-db
 */
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '../data')
const DB_PATH = process.env.TABEL_DB_PATH || path.join(DATA_DIR, 'tabel.db')

function patchStore(store) {
  if (!store || typeof store !== 'object') return null

  if (store.version == null) store.version = 6

  if (!store.technologistQc || typeof store.technologistQc !== 'object') {
    store.technologistQc = {}
  }
  const qc = store.technologistQc
  if (!Array.isArray(qc.eadCalculations)) qc.eadCalculations = []
  if (!Array.isArray(qc.eadControls)) qc.eadControls = []
  if (!Array.isArray(qc.incomingControls)) qc.incomingControls = []
  if (!Array.isArray(qc.impregnationQc)) qc.impregnationQc = []
  if (!Array.isArray(qc.roomClimateLog)) qc.roomClimateLog = []
  if (!qc.settings || typeof qc.settings !== 'object') {
    qc.settings = { defaultNvTolerancePp: 5 }
  }

  if (!store.warehouse || typeof store.warehouse !== 'object') {
    store.warehouse = { auditLog: [], movements: [], items: [] }
  }
  if (!Array.isArray(store.warehouse.auditLog)) store.warehouse.auditLog = []
  if (!Array.isArray(store.warehouse.movements)) store.warehouse.movements = []

  if (!Array.isArray(store.auditLog)) store.auditLog = []

  if (!store.formulations || typeof store.formulations !== 'object') {
    store.formulations = { recipes: [], batchRuns: [] }
  }
  if (!Array.isArray(store.formulations.batchRuns)) store.formulations.batchRuns = []

  if (!store.production || typeof store.production !== 'object') {
    store.production = { requests: [] }
  }
  if (!Array.isArray(store.production.requests)) store.production.requests = []

  return store
}

if (!fs.existsSync(DB_PATH)) {
  console.log(`Файл базы не найден: ${DB_PATH}`)
  console.log('Запустите npm run dev — база создастся при первом сохранении.')
  process.exit(0)
}

const db = new Database(DB_PATH)
const row = db.prepare('SELECT payload FROM app_store WHERE id = 1').get()

if (!row?.payload) {
  console.log('SQLite пуст — миграция не нужна. Откройте программу один раз.')
  db.close()
  process.exit(0)
}

let store
try {
  store = JSON.parse(row.payload)
} catch (err) {
  console.error('Не удалось прочитать JSON из базы:', err.message)
  db.close()
  process.exit(1)
}

const beforeClimate = store.technologistQc?.roomClimateLog?.length ?? 'missing'
const patched = patchStore(store)
const afterClimate = patched.technologistQc.roomClimateLog.length

const updatedAt = new Date().toISOString()
db.prepare(
  `INSERT INTO app_store (id, payload, updated_at) VALUES (1, ?, ?)
   ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
).run(JSON.stringify(patched), updatedAt)

db.close()

console.log(`Готово: ${DB_PATH}`)
console.log(`  technologistQc.roomClimateLog: ${beforeClimate} → ${afterClimate} записей`)
console.log(`  updated_at: ${updatedAt}`)
