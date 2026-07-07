/**
 * Миграция монолитного fstStores/fibercell-main → шардированный формат.
 * Run: $env:FST_ADMIN_PASSWORD="..."; npm run migrate:cloud-shards
 */
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore'
import { SHARED_STORE_ID, connectCloudFirebase } from './_cloudFirebase.mjs'

const FIRESTORE_DOC_MAX_BYTES = 1_048_576
const CLOUD_STORAGE_FORMAT_SHARDED = 2
const AUTO_ARCHIVE_MONTHS_BACK = 6

function monthKeyFromDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function stripUndefinedDeep(value) {
  if (value === undefined || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(stripUndefinedDeep)
  const out = {}
  for (const [k, v] of Object.entries(value)) {
    if (v !== undefined) out[k] = stripUndefinedDeep(v)
  }
  return out
}

function stripInlinePhoto(row) {
  if (!row?.photoDataUrl) return row
  const { photoDataUrl: _, ...rest } = row
  return rest
}

function stripHrDocuments(row) {
  const stripList = (docs) => {
    if (!docs?.some((d) => d.fileUrl?.startsWith('data:'))) return docs
    return docs.map((d) => {
      if (!d.fileUrl?.startsWith('data:')) return d
      const { fileUrl: _, ...rest } = d
      return rest
    })
  }
  const hrDocuments = stripList(row.hrDocuments)
  const documents = stripList(row.documents)
  if (hrDocuments === row.hrDocuments && documents === row.documents) return row
  return {
    ...row,
    ...(hrDocuments !== row.hrDocuments ? { hrDocuments } : {}),
    ...(documents !== row.documents ? { documents } : {}),
  }
}

function stripWarehouseInlinePhotos(warehouse) {
  if (!warehouse?.items) return warehouse
  let changed = false
  const items = warehouse.items.map((it) => {
    if (!it.photoDataUrl?.startsWith('data:') && !it.photoDataUrl?.startsWith('http')) return it
    changed = true
    const { photoDataUrl: _, ...rest } = it
    return rest
  })
  return changed ? { ...warehouse, items } : warehouse
}

function resolveArchiveMonthKeys(store, now = new Date()) {
  const keys = new Set(store.archivedMonths ?? [])
  for (const m of store.closedMonths ?? []) keys.add(m)
  const cutoff = new Date(now.getFullYear(), now.getMonth() - AUTO_ARCHIVE_MONTHS_BACK, 1)
  const cutoffKey = monthKeyFromDate(cutoff)
  for (const key of Object.keys(store.months ?? {})) {
    if (key < cutoffKey) keys.add(key)
  }
  return keys
}

function splitStoreForCloud(store, now = new Date()) {
  const archiveKeys = resolveArchiveMonthKeys(store, now)
  const monthsActive = {}
  const monthArchives = []

  for (const [key, sheet] of Object.entries(store.months ?? {})) {
    if (archiveKeys.has(key)) monthArchives.push({ monthKey: key, sheet })
    else monthsActive[key] = sheet
  }

  const { employees, candidates, months: _m, warehouse, trash, ...coreRest } = store

  const employeesShard = {
    employees: (employees ?? []).map((e) => stripHrDocuments(stripInlinePhoto(e))),
    candidates: (candidates ?? []).map((c) => stripHrDocuments(stripInlinePhoto(c))),
    trashEmployees: (trash?.employees ?? []).map((t) => ({
      ...t,
      employee: stripHrDocuments(stripInlinePhoto(t.employee)),
    })),
    trashCandidates: (trash?.candidates ?? []).map((t) => ({
      ...t,
      candidate: stripHrDocuments(stripInlinePhoto(t.candidate)),
    })),
  }

  const core = {
    ...coreRest,
    trash: {
      months: trash?.months ?? [],
      employees: [],
      candidates: [],
    },
  }

  return {
    core,
    employees: employeesShard,
    months: { months: monthsActive },
    warehouse: { warehouse: stripWarehouseInlinePhotos(warehouse ?? {}) },
    monthArchives,
    monthArchiveKeys: [...archiveKeys, ...monthArchives.map((a) => a.monthKey)].sort(),
  }
}

function fingerprintJson(json) {
  let h = 5381
  for (let i = 0; i < json.length; i++) h = (h * 33) ^ json.charCodeAt(i)
  return `${json.length}:${h >>> 0}`
}

function shardPath(shard) {
  return `fstStoreShards/${SHARED_STORE_ID}__${shard}`
}

function monthArchivePath(monthKey) {
  return `fstMonthArchive/${SHARED_STORE_ID}__${monthKey}`
}

function checkSize(label, payload) {
  const json = JSON.stringify(payload)
  const kb = Math.round(json.length / 1024)
  console.log(`  ${label}: ${kb} KB`)
  if (json.length > FIRESTORE_DOC_MAX_BYTES) {
    throw new Error(`cloud_shard_too_large:${label}:${json.length}`)
  }
  return json.length
}

const { db } = await connectCloudFirebase()

const coreRef = doc(db, `fstStores/${SHARED_STORE_ID}`)
const coreSnap = await getDoc(coreRef)
if (!coreSnap.exists()) {
  console.log('Документ fstStores/fibercell-main не найден.')
  process.exit(0)
}

const coreData = coreSnap.data()
if (coreData.storageFormat === CLOUD_STORAGE_FORMAT_SHARDED) {
  console.log('База уже в шардированном формате (storageFormat=2).')
  process.exit(0)
}

const payload = coreData.payload
if (!payload || typeof payload !== 'object') {
  console.log('Пустой payload — нечего мигрировать.')
  process.exit(0)
}

const store = structuredClone(payload)
const split = splitStoreForCloud(store)
const revision = (typeof coreData.revision === 'number' ? coreData.revision : 0) + 1
const monthArchiveKeys = [...new Set(split.monthArchiveKeys)].sort()

console.log('Размеры шардов после разбиения:')
let totalBytes = 0
totalBytes += checkSize('core', {
  ...split.core,
  employees: [],
  candidates: [],
  months: {},
})
totalBytes += checkSize('employees', split.employees)
totalBytes += checkSize('months', split.months)
totalBytes += checkSize('warehouse', split.warehouse)
for (const { monthKey, sheet } of split.monthArchives) {
  totalBytes += checkSize(`archive:${monthKey}`, sheet)
}

console.log(`\nЗапись в Firestore (revision ${revision})...`)

await runTransaction(db, async (transaction) => {
  const shardWrites = [
    {
      path: `fstStores/${SHARED_STORE_ID}`,
      label: 'core',
      payload: { ...split.core, employees: [], candidates: [], months: {} },
      extra: { monthArchiveKeys },
    },
    { path: shardPath('employees'), label: 'employees', payload: split.employees },
    { path: shardPath('months'), label: 'months', payload: split.months },
    { path: shardPath('warehouse'), label: 'warehouse', payload: split.warehouse },
  ]

  for (const w of shardWrites) {
    transaction.set(
      doc(db, w.path),
      stripUndefinedDeep({
        app: 'FST',
        shard: w.label,
        storageFormat: CLOUD_STORAGE_FORMAT_SHARDED,
        payload: w.payload,
        revision,
        updatedAt: serverTimestamp(),
        version: store.version ?? 6,
        ...(w.extra ?? {}),
      }),
    )
  }

  for (const { monthKey, sheet } of split.monthArchives) {
    transaction.set(
      doc(db, monthArchivePath(monthKey)),
      stripUndefinedDeep({
        app: 'FST',
        monthKey,
        payload: { sheet },
        revision,
        updatedAt: serverTimestamp(),
      }),
    )
  }

  const fullJson = JSON.stringify(store)
  transaction.set(
    doc(db, `fstSyncMeta/${SHARED_STORE_ID}`),
    stripUndefinedDeep({
      revision,
      fingerprint: fingerprintJson(fullJson),
      bytes: totalBytes,
      sharded: true,
      migratedAt: new Date().toISOString(),
      updatedAt: serverTimestamp(),
    }),
    { merge: true },
  )
})

console.log(`\nГотово: fibercell-main мигрирован в шарды (${Math.round(totalBytes / 1024)} KB суммарно).`)
console.log('Откройте https://fst-uchet-theta.vercel.app и проверьте сохранение.')
