/**
 * Экспорт базы FST через Firebase Admin SDK (обходит Firestore rules).
 *
 * 1) Firebase Console → Project settings → Service accounts → Generate new private key
 * 2) Сохраните JSON как fst-web/service-account.source.json (не коммитить!)
 *
 * Run:
 *   npm run export:cloud-backup:admin
 *   npm run export:cloud-backup:admin -- --out=E:\Fibercell-FST-pack\cloud-backup
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const SHARED_STORE_ID = 'fibercell-main'
const SHARD_SUFFIXES = ['employees', 'months', 'warehouse']
const scriptsDir = dirname(fileURLToPath(import.meta.url))
const fstWebDir = join(scriptsDir, '..')

const outArg = process.argv.find((a) => a.startsWith('--out='))
const outDir = outArg?.slice(6) ?? join(fstWebDir, 'cloud-backup')

function resolveServiceAccountPath() {
  const fromEnv = process.env.FST_SOURCE_SERVICE_ACCOUNT
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  const local = join(fstWebDir, 'service-account.source.json')
  if (existsSync(local)) return local
  console.error('Нужен service account JSON от fst-uchet-14c02.')
  console.error('Сохраните как fst-web/service-account.source.json')
  console.error('или: $env:FST_SOURCE_SERVICE_ACCOUNT="C:\\path\\key.json"')
  process.exit(1)
}

function loadProjectId(serviceAccount) {
  return (
    process.env.FST_SOURCE_PROJECT_ID ??
    serviceAccount.project_id ??
    JSON.parse(readFileSync(join(fstWebDir, 'firebase.client.json'), 'utf8')).VITE_FIREBASE_PROJECT_ID
  )
}

async function readDoc(db, path) {
  const snap = await db.doc(path).get()
  return snap.exists ? snap.data() : null
}

async function listPrefixed(db, collectionName, prefix) {
  const snaps = await db.collection(collectionName).get()
  return snaps.docs
    .filter((s) => s.id.startsWith(prefix))
    .map((s) => ({ id: s.id, data: s.data() }))
}

const serviceAccountPath = resolveServiceAccountPath()
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'))
const projectId = loadProjectId(serviceAccount)

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount), projectId })
}
const db = getFirestore()

console.log('Admin export из:', projectId)
console.log('Service account:', serviceAccount.client_email ?? serviceAccountPath)
console.log('Папка:', outDir)

mkdirSync(outDir, { recursive: true })

const backup = {
  exportedAt: new Date().toISOString(),
  projectId,
  storeId: SHARED_STORE_ID,
  fstConfig: { access: await readDoc(db, 'fstConfig/access') },
  fstStores: { [SHARED_STORE_ID]: await readDoc(db, `fstStores/${SHARED_STORE_ID}`) },
  fstSyncMeta: { [SHARED_STORE_ID]: await readDoc(db, `fstSyncMeta/${SHARED_STORE_ID}`) },
  fstStoreShards: {},
  fstMonthArchive: {},
}

for (const shard of SHARD_SUFFIXES) {
  const id = `${SHARED_STORE_ID}__${shard}`
  backup.fstStoreShards[id] = await readDoc(db, `fstStoreShards/${id}`)
}

for (const row of await listPrefixed(db, 'fstMonthArchive', `${SHARED_STORE_ID}__`)) {
  backup.fstMonthArchive[row.id] = row.data
}

const mainPath = join(outDir, `fst-backup-${SHARED_STORE_ID}.json`)
writeFileSync(mainPath, JSON.stringify(backup, null, 2), 'utf8')

const meta = {
  exportedAt: backup.exportedAt,
  projectId: backup.projectId,
  storeId: SHARED_STORE_ID,
  files: [mainPath],
  sizesKb: { total: Math.round(JSON.stringify(backup).length / 1024) },
  counts: {
    shards: Object.values(backup.fstStoreShards).filter(Boolean).length,
    monthArchives: Object.keys(backup.fstMonthArchive).length,
  },
}
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(meta, null, 2), 'utf8')

console.log(`\nГотово: ${mainPath}`)
console.log(`Размер: ~${meta.sizesKb.total} KB`)
console.log(`Шарды: ${meta.counts.shards}, архив месяцев: ${meta.counts.monthArchives}`)
