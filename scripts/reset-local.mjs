#!/usr/bin/env node
/**
 * Локальный сброс FST:
 * - удаляет SQLite (data/tabel.db)
 * - подсказка по очистке браузера и облачного персонала
 *
 * Запуск: npm run reset-local   (из корня или fst-web)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dbPath = process.env.TABEL_DB_PATH || path.join(root, 'data', 'tabel.db')

const dbFiles = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]

let removed = 0
for (const f of dbFiles) {
  if (fs.existsSync(f)) {
    fs.unlinkSync(f)
    console.log(`Удалено: ${f}`)
    removed += 1
  }
}

if (!removed) {
  console.log('SQLite-база не найдена (data/tabel.db) — пропуск.')
}

console.log('')
console.log('Дальше в браузере (локальный dev):')
console.log('  http://localhost:5173/reset-local.html')
console.log('  http://localhost:5174/reset-local.html')
console.log('')
console.log('Страница очистит localStorage, sessionStorage и кэш Firebase.')
console.log('')
console.log('Облако (Firestore) — очистка персонала:')
console.log('  powershell -ExecutionPolicy Bypass -File scripts/clear-hr-cloud.ps1')
console.log('  или: $env:FST_ADMIN_PASSWORD="..."; npm run clear:hr-cloud')
console.log('')
console.log('После сброса (десктоп без Firebase): логин admin → задайте новый пароль.')
console.log('Облачный вход: admin@fibercell.net — пароль из Firebase Console.')
