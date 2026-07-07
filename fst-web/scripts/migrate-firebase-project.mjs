/**
 * Копирует базу FST из одного Firebase-проекта в другой.
 *
 * Источник: fst-web/.env.production (сейчас fst-uchet-14c02)
 * Цель:    fst-web/.env.target     (новый проект)
 *
 * Run:
 *   $env:FST_SOURCE_PASSWORD="..."; $env:FST_TARGET_PASSWORD="..."
 *   npm run migrate:firebase-project
 *
 * Опции:
 *   --dry-run   только чтение и отчёт
 */
import { doc, getDoc, getDocs, collection, setDoc, serverTimestamp, query, where, documentId } from 'firebase/firestore'
import {
  SHARED_STORE_ID,
  loadEnvFile,
  connectFirebase,
  disconnectFirebase,
  requirePassword,
} from './_firebaseEnv.mjs'

const SHARD_SUFFIXES = ['employees', 'months', 'warehouse']
const dryRun = process.argv.includes('--dry-run')

function stripUndefinedDeep(value) {
  if (value === undefined || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(stripUndefinedDeep)
  const out = {}
  for (const [k, v] of Object.entries(value)) {
    if (v !== undefined) out[k] = stripUndefinedDeep(v)
  }
  return out
}

function kb(data) {
  return Math.round(JSON.stringify(data).length / 1024)
}

async function readDoc(db, path) {
  const snap = await getDoc(doc(db, path))
  if (!snap.exists()) return null
  return { id: snap.id, data: snap.data() }
}

async function listPrefixed(db, collectionName, prefix) {
  const end = `${prefix}\uf8ff`
  const q = query(
    collection(db, collectionName),
    where(documentId(), '>=', prefix),
    where(documentId(), '<=', end),
  )
  const snaps = await getDocs(q)
  return snaps.docs.map((s) => ({ id: s.id, data: s.data() }))
}

async function writeDoc(db, collectionName, id, data) {
  const path = `${collectionName}/${id}`
  if (dryRun) {
    console.log(`  [dry-run] set ${path} (${kb(data)} KB)`)
    return
  }
  await setDoc(doc(db, path), stripUndefinedDeep({ ...data, migratedAt: new Date().toISOString() }), {
    merge: false,
  })
  console.log(`  ✓ ${path} (${kb(data)} KB)`)
}

const { env: sourceEnv } = loadEnvFile('source')
const { env: targetEnv } = loadEnvFile('target')

if (sourceEnv.VITE_FIREBASE_PROJECT_ID === targetEnv.VITE_FIREBASE_PROJECT_ID) {
  console.error('Источник и цель — один проект. Укажите другой .env.target')
  process.exit(1)
}

const sourceEmail = process.env.FST_SOURCE_EMAIL ?? 'admin@fibercell.net'
const targetEmail = process.env.FST_TARGET_EMAIL ?? 'nikegeorgian@gmail.com'
const sourcePassword = requirePassword('FST_SOURCE_PASSWORD')
const targetPassword = requirePassword('FST_TARGET_PASSWORD')

console.log('=== FST Firebase migration ===')
console.log(`Источник: ${sourceEnv.VITE_FIREBASE_PROJECT_ID}`)
console.log(`Цель:     ${targetEnv.VITE_FIREBASE_PROJECT_ID}`)
console.log(`Store ID: ${SHARED_STORE_ID}`)
if (dryRun) console.log('Режим: DRY RUN (запись отключена)\n')

const source = await connectFirebase({
  env: sourceEnv,
  label: 'source',
  email: sourceEmail,
  password: sourcePassword,
  appName: 'fst-source',
})

let target = null
if (!dryRun) {
  target = await connectFirebase({
    env: targetEnv,
    label: 'target',
    email: targetEmail,
    password: targetPassword,
    appName: 'fst-target',
  })
}

try {
  const report = { docs: 0, kb: 0 }

  const access = await readDoc(source.db, 'fstConfig/access')
  if (access) {
    console.log('\nfstConfig/access')
    if (!dryRun) await writeDoc(target.db, 'fstConfig', 'access', access.data)
    else console.log(`  [dry-run] fstConfig/access (${kb(access.data)} KB)`)
    report.docs += 1
    report.kb += kb(access.data)
  }

  const core = await readDoc(source.db, `fstStores/${SHARED_STORE_ID}`)
  if (!core) {
    console.error(`\nНет fstStores/${SHARED_STORE_ID} в источнике.`)
    process.exit(1)
  }
  console.log(`\nfstStores/${SHARED_STORE_ID}`)
  if (!dryRun) await writeDoc(target.db, 'fstStores', SHARED_STORE_ID, core.data)
  else console.log(`  [dry-run] fstStores/${SHARED_STORE_ID} (${kb(core.data)} KB)`)
  report.docs += 1
  report.kb += kb(core.data)

  const meta = await readDoc(source.db, `fstSyncMeta/${SHARED_STORE_ID}`)
  if (meta) {
    console.log(`\nfstSyncMeta/${SHARED_STORE_ID}`)
    if (!dryRun) await writeDoc(target.db, 'fstSyncMeta', SHARED_STORE_ID, meta.data)
    else console.log(`  [dry-run] fstSyncMeta (${kb(meta.data)} KB)`)
    report.docs += 1
    report.kb += kb(meta.data)
  }

  console.log('\nfstStoreShards')
  for (const shard of SHARD_SUFFIXES) {
    const id = `${SHARED_STORE_ID}__${shard}`
    const row = await readDoc(source.db, `fstStoreShards/${id}`)
    if (!row) {
      console.log(`  — ${id} (нет)`)
      continue
    }
    if (!dryRun) await writeDoc(target.db, 'fstStoreShards', id, row.data)
    else console.log(`  [dry-run] fstStoreShards/${id} (${kb(row.data)} KB)`)
    report.docs += 1
    report.kb += kb(row.data)
  }

  const archives = await listPrefixed(source.db, 'fstMonthArchive', `${SHARED_STORE_ID}__`)
  console.log(`\nfstMonthArchive (${archives.length} док.)`)
  for (const row of archives) {
    if (!dryRun) await writeDoc(target.db, 'fstMonthArchive', row.id, row.data)
    else console.log(`  [dry-run] fstMonthArchive/${row.id} (${kb(row.data)} KB)`)
    report.docs += 1
    report.kb += kb(row.data)
  }

  console.log(`\n=== Готово: ${report.docs} документов, ~${report.kb} KB ===`)
  if (dryRun) {
    console.log('\nЗапустите без --dry-run для записи в целевой проект.')
  } else {
    console.log('\nДальше:')
    console.log('  1. npm run switch:firebase-project   # переключить приложение на новый проект')
    console.log('  2. cd fst-web && firebase use <NEW_ID> && npm run deploy:firestore-rules')
    console.log('  3. vercel --prod')
    console.log('\nФото в Storage копируются отдельно (если включён Storage).')
  }
} finally {
  await disconnectFirebase(source)
  if (target) await disconnectFirebase(target)
}
