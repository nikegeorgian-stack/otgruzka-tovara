/**
 * POST /api/fst/migrate-cloud-shards
 * Admin-only: migrate monolithic fstStores/fibercell-main → sharded format.
 * Requires FIREBASE_SERVICE_ACCOUNT_JSON on Vercel.
 */
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { verifySysAdminRequest } from './_adminAuth.mjs'

const SHARED_STORE_ID = 'fibercell-main'
const FIRESTORE_DOC_MAX_BYTES = 1_048_576
const CLOUD_STORAGE_FORMAT_SHARDED = 2
const AUTO_ARCHIVE_MONTHS_BACK = 6

function monthKeyFromDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
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

  return {
    core: {
      ...coreRest,
      trash: { months: trash?.months ?? [], employees: [], candidates: [] },
    },
    employees: {
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
    },
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

function checkSize(label, payload) {
  const json = JSON.stringify(payload)
  if (json.length > FIRESTORE_DOC_MAX_BYTES) {
    throw new Error(`cloud_shard_too_large:${label}:${json.length}`)
  }
  return { label, bytes: json.length, kb: Math.round(json.length / 1024) }
}

function initAdmin() {
  if (getApps().length > 0) return
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  if (!raw?.trim()) throw new Error('service_account_missing')
  initializeApp({ credential: cert(JSON.parse(raw)) })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' })
    return
  }

  const auth = await verifySysAdminRequest(req)
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error })
    return
  }

  try {
    initAdmin()
    const db = getFirestore()
    const coreRef = db.collection('fstStores').doc(SHARED_STORE_ID)
    const coreSnap = await coreRef.get()

    if (!coreSnap.exists) {
      res.status(404).json({ error: 'store_not_found' })
      return
    }

    const coreData = coreSnap.data()
    if (coreData.storageFormat === CLOUD_STORAGE_FORMAT_SHARDED) {
      res.json({ ok: true, message: 'already_sharded' })
      return
    }

    const payload = coreData.payload
    if (!payload || typeof payload !== 'object') {
      res.status(400).json({ error: 'empty_payload' })
      return
    }

    const store = structuredClone(payload)
    const split = splitStoreForCloud(store)
    const revision = (typeof coreData.revision === 'number' ? coreData.revision : 0) + 1
    const monthArchiveKeys = [...new Set(split.monthArchiveKeys)].sort()

    const sizes = [
      checkSize('core', { ...split.core, employees: [], candidates: [], months: {} }),
      checkSize('employees', split.employees),
      checkSize('months', split.months),
      checkSize('warehouse', split.warehouse),
      ...split.monthArchives.map(({ monthKey, sheet }) => checkSize(`archive:${monthKey}`, sheet)),
    ]
    const totalBytes = sizes.reduce((s, x) => s + x.bytes, 0)

    await db.runTransaction(async (tx) => {
      const shardWrites = [
        { ref: coreRef, label: 'core', payload: { ...split.core, employees: [], candidates: [], months: {} }, extra: { monthArchiveKeys } },
        { ref: db.collection('fstStoreShards').doc(`${SHARED_STORE_ID}__employees`), label: 'employees', payload: split.employees },
        { ref: db.collection('fstStoreShards').doc(`${SHARED_STORE_ID}__months`), label: 'months', payload: split.months },
        { ref: db.collection('fstStoreShards').doc(`${SHARED_STORE_ID}__warehouse`), label: 'warehouse', payload: split.warehouse },
      ]

      for (const w of shardWrites) {
        tx.set(w.ref, {
          app: 'FST',
          shard: w.label,
          storageFormat: CLOUD_STORAGE_FORMAT_SHARDED,
          payload: w.payload,
          revision,
          updatedAt: FieldValue.serverTimestamp(),
          version: store.version ?? 6,
          ...(w.extra ?? {}),
        })
      }

      for (const { monthKey, sheet } of split.monthArchives) {
        tx.set(db.collection('fstMonthArchive').doc(`${SHARED_STORE_ID}__${monthKey}`), {
          app: 'FST',
          monthKey,
          payload: { sheet },
          revision,
          updatedAt: FieldValue.serverTimestamp(),
        })
      }

      const fullJson = JSON.stringify(store)
      tx.set(
        db.collection('fstSyncMeta').doc(SHARED_STORE_ID),
        {
          revision,
          fingerprint: fingerprintJson(fullJson),
          bytes: totalBytes,
          sharded: true,
          migratedAt: new Date().toISOString(),
          migratedBy: auth.email,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
    })

    res.json({
      ok: true,
      revision,
      totalKb: Math.round(totalBytes / 1024),
      sizes,
      monthArchives: split.monthArchives.length,
    })
  } catch (err) {
    console.error('migrate-cloud-shards failed', err)
    res.status(500).json({
      error: 'migration_failed',
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
