/**
 * Загружает JSON-бэкап в целевой Firebase-проект (.env.target).
 * Run: $env:FST_TARGET_PASSWORD="..."; npm run import:cloud-backup -- --in=E:\Fibercell-FST\cloud-backup
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { doc, setDoc } from 'firebase/firestore'
import {
  loadEnvFile,
  connectFirebase,
  disconnectFirebase,
  requirePassword,
} from './_firebaseEnv.mjs'

const inArg = process.argv.find((a) => a.startsWith('--in='))
if (!inArg) {
  console.error('Укажите --in=путь/к/cloud-backup')
  process.exit(1)
}

const backupDir = inArg.slice(5)
const manifestPath = join(backupDir, 'manifest.json')
let backupPath = join(backupDir, 'fst-backup-fibercell-main.json')

if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  backupPath = manifest.files?.[0] ?? backupPath
}

if (!existsSync(backupPath)) {
  console.error('Не найден файл бэкапа:', backupPath)
  process.exit(1)
}

const backup = JSON.parse(readFileSync(backupPath, 'utf8'))
const { env: targetEnv } = loadEnvFile('target')
const targetEmail = process.env.FST_TARGET_EMAIL ?? 'nikegeorgian@gmail.com'
const targetPassword = requirePassword('FST_TARGET_PASSWORD')

function stripUndefinedDeep(value) {
  if (value === undefined || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(stripUndefinedDeep)
  const out = {}
  for (const [k, v] of Object.entries(value)) {
    if (v !== undefined) out[k] = stripUndefinedDeep(v)
  }
  return out
}

console.log('Импорт в:', targetEnv.VITE_FIREBASE_PROJECT_ID)
console.log('Из файла:', backupPath)

const target = await connectFirebase({
  env: targetEnv,
  label: 'import',
  email: targetEmail,
  password: targetPassword,
  appName: 'fst-import',
})

try {
  if (backup.fstConfig?.access) {
    await setDoc(doc(target.db, 'fstConfig/access'), stripUndefinedDeep(backup.fstConfig.access))
    console.log('✓ fstConfig/access')
  }

  const storeId = backup.storeId ?? 'fibercell-main'
  const core = backup.fstStores?.[storeId]
  if (core) {
    await setDoc(doc(target.db, `fstStores/${storeId}`), stripUndefinedDeep(core))
    console.log(`✓ fstStores/${storeId}`)
  }

  const meta = backup.fstSyncMeta?.[storeId]
  if (meta) {
    await setDoc(doc(target.db, `fstSyncMeta/${storeId}`), stripUndefinedDeep(meta))
    console.log(`✓ fstSyncMeta/${storeId}`)
  }

  for (const [id, data] of Object.entries(backup.fstStoreShards ?? {})) {
    if (!data) continue
    await setDoc(doc(target.db, `fstStoreShards/${id}`), stripUndefinedDeep(data))
    console.log(`✓ fstStoreShards/${id}`)
  }

  for (const [id, data] of Object.entries(backup.fstMonthArchive ?? {})) {
    if (!data) continue
    await setDoc(doc(target.db, `fstMonthArchive/${id}`), stripUndefinedDeep(data))
    console.log(`✓ fstMonthArchive/${id}`)
  }

  console.log('\nИмпорт завершён.')
} finally {
  await disconnectFirebase(target)
}
