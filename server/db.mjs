import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '../data')
const DB_PATH = process.env.TABEL_DB_PATH || path.join(DATA_DIR, 'tabel.db')

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS app_store (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`)

export function getDbPath() {
  return DB_PATH
}

export function readStoreRow() {
  const row = db.prepare('SELECT payload, updated_at FROM app_store WHERE id = 1').get()
  if (!row) return null
  return {
    store: JSON.parse(row.payload),
    updatedAt: row.updated_at,
  }
}

export function writeStoreRow(store) {
  const updatedAt = new Date().toISOString()
  const payload = JSON.stringify(store)
  db.prepare(
    `INSERT INTO app_store (id, payload, updated_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       payload = excluded.payload,
       updated_at = excluded.updated_at`,
  ).run(payload, updatedAt)
  return updatedAt
}
