/**
 * Скачивает всю облачную базу FST в JSON (для переноса на другой аккаунт).
 * Run: $env:FST_SOURCE_PASSWORD="..."; npm run export:cloud-backup
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { doc, getDoc, getDocs, collection, query, where, documentId } from 'firebase/firestore'
import {
  SHARED_STORE_ID,
  loadEnvFile,
  connectFirebase,
  disconnectFirebase,
  requirePassword,
} from './_firebaseEnv.mjs'

const outArg = process.argv.find((a) => a.startsWith('--out='))
const outDir = outArg?.slice(6) ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'cloud-backup')

const SHARD_SUFFIXES = ['employees', 'months', 'warehouse']

async function readDoc(db, path) {
  try {
    const snap = await getDoc(doc(db, path))
    return snap.exists() ? snap.data() : null
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? err.code : String(err)
    throw new Error(`read ${path} failed (${code})`)
  }
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

function collectMonthArchiveKeys(backup) {
  const keys = new Set()
  const add = (value) => {
    if (typeof value === 'string' && value.trim()) keys.add(value.trim())
  }

  const syncMeta = backup.fstSyncMeta?.[SHARED_STORE_ID]
  if (Array.isArray(syncMeta?.monthArchiveKeys)) syncMeta.monthArchiveKeys.forEach(add)

  for (const shard of Object.values(backup.fstStoreShards ?? {})) {
    if (Array.isArray(shard?.monthArchiveKeys)) shard.monthArchiveKeys.forEach(add)
  }

  const main = backup.fstStores?.[SHARED_STORE_ID]
  const payload = main?.payload ?? main
  for (const key of Object.keys(payload?.months ?? {})) add(key)

  const monthsShard = backup.fstStoreShards?.[`${SHARED_STORE_ID}__months`]
  const monthsPayload = monthsShard?.payload ?? monthsShard
  for (const key of Object.keys(monthsPayload?.months ?? {})) add(key)

  return [...keys].sort()
}

async function readMonthArchives(db, backup) {
  const out = {}
  const keys = collectMonthArchiveKeys(backup)
  console.log(`[export] Архив месяцев: ${keys.length} ключ(ей)`)
  for (const monthKey of keys) {
    const id = `${SHARED_STORE_ID}__${monthKey}`
    const data = await readDoc(db, `fstMonthArchive/${id}`)
    if (data) out[id] = data
  }
  return out
}

const { env: sourceEnv } = loadEnvFile('source')
const sourceEmail = process.env.FST_SOURCE_EMAIL ?? 'admin@fibercell.net'
const sourcePassword = requirePassword('FST_SOURCE_PASSWORD')

console.log('Экспорт из:', sourceEnv.VITE_FIREBASE_PROJECT_ID)
console.log('Папка:', outDir)

mkdirSync(outDir, { recursive: true })

const source = await connectFirebase({
  env: sourceEnv,
  label: 'export',
  email: sourceEmail,
  password: sourcePassword,
  appName: 'fst-export',
})

try {
  const backup = {
    exportedAt: new Date().toISOString(),
    projectId: sourceEnv.VITE_FIREBASE_PROJECT_ID,
    storeId: SHARED_STORE_ID,
    fstConfig: { access: await readDoc(source.db, 'fstConfig/access') },
    fstStores: { [SHARED_STORE_ID]: await readDoc(source.db, `fstStores/${SHARED_STORE_ID}`) },
    fstSyncMeta: { [SHARED_STORE_ID]: await readDoc(source.db, `fstSyncMeta/${SHARED_STORE_ID}`) },
    fstStoreShards: {},
    fstMonthArchive: {},
  }

  for (const shard of SHARD_SUFFIXES) {
    const id = `${SHARED_STORE_ID}__${shard}`
    backup.fstStoreShards[id] = await readDoc(source.db, `fstStoreShards/${id}`)
  }

  backup.fstMonthArchive = await readMonthArchives(source.db, backup)

  const mainPath = join(outDir, `fst-backup-${SHARED_STORE_ID}.json`)
  writeFileSync(mainPath, JSON.stringify(backup, null, 2), 'utf8')

  const meta = {
    exportedAt: backup.exportedAt,
    projectId: backup.projectId,
    storeId: SHARED_STORE_ID,
    files: [mainPath],
    sizesKb: {
      total: Math.round(JSON.stringify(backup).length / 1024),
    },
    counts: {
      shards: Object.values(backup.fstStoreShards).filter(Boolean).length,
      monthArchives: Object.keys(backup.fstMonthArchive).length,
    },
  }
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(meta, null, 2), 'utf8')

  console.log(`\nГотово: ${mainPath}`)
  console.log(`Размер: ~${meta.sizesKb.total} KB`)
  console.log(`Шарды: ${meta.counts.shards}, архив месяцев: ${meta.counts.monthArchives}`)
} finally {
  await disconnectFirebase(source)
}
