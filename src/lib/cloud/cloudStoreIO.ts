import { doc, getDoc, type Transaction, serverTimestamp } from 'firebase/firestore'
import { parseStorePayload } from '@/lib/storage'
import type { AppStore, MonthSheet } from '@/lib/types'
import { getFirestoreDb } from './firebase'
import { stripUndefinedDeep } from './firestoreSanitize'
import {
  assembleStoreFromShards,
  isMonolithicStorePayload,
  parseEmployeesShard,
  parseMonthArchivePayload,
  parseMonthsShard,
  parseWarehouseShard,
  resolveArchiveMonthKeys,
  splitStoreForCloud,
  type CoreShardPayload,
} from './cloudStoreShards'
import { hydrateStorePhotosFromCloud } from './employeePhotoStorage'
import {
  CLOUD_STORAGE_FORMAT_SHARDED,
  fstMonthArchiveDocPath,
  fstStoreDocPath,
  fstStoreShardDocPath,
} from './firestoreSchema'

/** Firestore hard limit per document. */
const FIRESTORE_DOC_MAX_BYTES = 1_048_576

function shardTooLarge(label: string, bytes: number): never {
  throw new Error(`cloud_shard_too_large:${label}:${bytes}`)
}

function readMonthArchiveKeys(data: Record<string, unknown> | undefined): string[] {
  const raw = data?.monthArchiveKeys
  return Array.isArray(raw) ? raw.filter((k) => typeof k === 'string') : []
}

function parseCoreShardPayload(payload: Record<string, unknown>): CoreShardPayload | null {
  const parsed = parseStorePayload(payload)
  if (!parsed) return null
  const { employees: _e, candidates: _c, months: _m, warehouse: _w, trash, ...core } = parsed
  return {
    ...(core as CoreShardPayload),
    trash: {
      months: trash.months,
      employees: [],
      candidates: [],
    },
  }
}

async function fetchMonthArchives(
  storeDocId: string,
  monthKeys: string[],
): Promise<Record<string, MonthSheet>> {
  const db = getFirestoreDb()
  const out: Record<string, MonthSheet> = {}
  if (!monthKeys.length) return out
  const snaps = await Promise.all(
    monthKeys.map((key) => getDoc(doc(db, fstMonthArchiveDocPath(storeDocId, key)))),
  )
  for (let i = 0; i < monthKeys.length; i++) {
    const sheet = parseMonthArchivePayload(snaps[i]?.data() as Record<string, unknown>)
    if (sheet) out[monthKeys[i]!] = sheet
  }
  return out
}

async function assembleFromShardSnaps(
  storeDocId: string,
  coreData: Record<string, unknown> | undefined,
  employeesData: Record<string, unknown> | undefined,
  monthsData: Record<string, unknown> | undefined,
  warehouseData: Record<string, unknown> | undefined,
  hydratePhotos: boolean,
): Promise<AppStore | null> {
  if (!coreData?.payload || typeof coreData.payload !== 'object') return null

  const payload = coreData.payload as Record<string, unknown>
  const format = coreData.storageFormat

  if (format !== CLOUD_STORAGE_FORMAT_SHARDED && isMonolithicStorePayload(payload)) {
    const full = parseStorePayload(payload)
    if (!full) return null
    return hydratePhotos ? hydrateStorePhotosFromCloud(full) : full
  }

  const core = parseCoreShardPayload(payload)
  if (!core) return null

  const archiveKeys = readMonthArchiveKeys(coreData)
  const archivedMonths = await fetchMonthArchives(storeDocId, archiveKeys)

  const store = assembleStoreFromShards(
    core,
    parseEmployeesShard(employeesData),
    parseMonthsShard(monthsData),
    parseWarehouseShard(warehouseData),
    archivedMonths,
  )

  return hydratePhotos ? hydrateStorePhotosFromCloud(store) : store
}

export async function loadAssembledCloudStore(
  storeDocId: string,
  hydratePhotos = true,
): Promise<AppStore | null> {
  const db = getFirestoreDb()
  const [coreSnap, empSnap, monthsSnap, whSnap] = await Promise.all([
    getDoc(doc(db, fstStoreDocPath(storeDocId))),
    getDoc(doc(db, fstStoreShardDocPath(storeDocId, 'employees'))),
    getDoc(doc(db, fstStoreShardDocPath(storeDocId, 'months'))),
    getDoc(doc(db, fstStoreShardDocPath(storeDocId, 'warehouse'))),
  ])

  if (!coreSnap.exists()) return null

  return assembleFromShardSnaps(
    storeDocId,
    coreSnap.data() as Record<string, unknown>,
    empSnap.exists() ? (empSnap.data() as Record<string, unknown>) : undefined,
    monthsSnap.exists() ? (monthsSnap.data() as Record<string, unknown>) : undefined,
    whSnap.exists() ? (whSnap.data() as Record<string, unknown>) : undefined,
    hydratePhotos,
  )
}

export async function assembleFromTransaction(
  transaction: Transaction,
  storeDocId: string,
): Promise<{ store: AppStore | null; revision: number; monthArchiveKeys: string[] }> {
  const db = getFirestoreDb()
  const coreRef = doc(db, fstStoreDocPath(storeDocId))
  const empRef = doc(db, fstStoreShardDocPath(storeDocId, 'employees'))
  const monthsRef = doc(db, fstStoreShardDocPath(storeDocId, 'months'))
  const whRef = doc(db, fstStoreShardDocPath(storeDocId, 'warehouse'))

  const [coreSnap, empSnap, monthsSnap, whSnap] = await Promise.all([
    transaction.get(coreRef),
    transaction.get(empRef),
    transaction.get(monthsRef),
    transaction.get(whRef),
  ])

  if (!coreSnap.exists()) {
    return { store: null, revision: 0, monthArchiveKeys: [] }
  }

  const coreData = coreSnap.data() as Record<string, unknown>
  const revision =
    typeof coreData.revision === 'number' && Number.isFinite(coreData.revision)
      ? coreData.revision
      : 0
  const monthArchiveKeys = readMonthArchiveKeys(coreData)
  const payload = coreData.payload as Record<string, unknown>

  if (coreData.storageFormat !== CLOUD_STORAGE_FORMAT_SHARDED && isMonolithicStorePayload(payload)) {
    return {
      store: parseStorePayload(payload),
      revision,
      monthArchiveKeys,
    }
  }

  const core = parseCoreShardPayload(payload)
  if (!core) {
    return { store: null, revision, monthArchiveKeys }
  }

  const archivedMonths: Record<string, MonthSheet> = {}
  if (monthArchiveKeys.length) {
    const archiveSnaps = await Promise.all(
      monthArchiveKeys.map((key) =>
        transaction.get(doc(db, fstMonthArchiveDocPath(storeDocId, key))),
      ),
    )
    for (let i = 0; i < monthArchiveKeys.length; i++) {
      const sheet = parseMonthArchivePayload(archiveSnaps[i]?.data() as Record<string, unknown>)
      if (sheet) archivedMonths[monthArchiveKeys[i]!] = sheet
    }
  }

  return {
    store: assembleStoreFromShards(
      core,
      empSnap.exists() ? parseEmployeesShard(empSnap.data() as Record<string, unknown>) : null,
      monthsSnap.exists() ? parseMonthsShard(monthsSnap.data() as Record<string, unknown>) : null,
      whSnap.exists() ? parseWarehouseShard(whSnap.data() as Record<string, unknown>) : null,
      archivedMonths,
    ),
    revision,
    monthArchiveKeys,
  }
}

export function writeShardedStoreToTransaction(
  transaction: Transaction,
  storeDocId: string,
  store: AppStore,
  revision: number,
  existingArchiveKeys: string[],
): { totalBytes: number; monthArchiveKeys: string[] } {
  const db = getFirestoreDb()
  const split = splitStoreForCloud(store)
  const monthArchiveKeys = [
    ...new Set([...existingArchiveKeys, ...split.monthArchives.map((a) => a.monthKey)]),
  ].sort()

  const shardWrites: Array<{ path: string; payload: Record<string, unknown>; label: string }> = [
    {
      path: fstStoreDocPath(storeDocId),
      label: 'core',
      payload: {
        ...(split.core as unknown as Record<string, unknown>),
        employees: [],
        candidates: [],
        months: {},
      },
    },
    {
      path: fstStoreShardDocPath(storeDocId, 'employees'),
      label: 'employees',
      payload: split.employees as unknown as Record<string, unknown>,
    },
    {
      path: fstStoreShardDocPath(storeDocId, 'months'),
      label: 'months',
      payload: split.months as unknown as Record<string, unknown>,
    },
    {
      path: fstStoreShardDocPath(storeDocId, 'warehouse'),
      label: 'warehouse',
      payload: split.warehouse as unknown as Record<string, unknown>,
    },
  ]

  let totalBytes = 0
  for (const w of shardWrites) {
    const json = JSON.stringify(w.payload)
    totalBytes += json.length
    if (json.length > FIRESTORE_DOC_MAX_BYTES) {
      shardTooLarge(w.label, json.length)
    }
    transaction.set(
      doc(db, w.path),
      stripUndefinedDeep({
        app: 'FST',
        shard: w.label,
        storageFormat: CLOUD_STORAGE_FORMAT_SHARDED,
        payload: w.payload,
        revision,
        updatedAt: serverTimestamp(),
        version: store.version,
        ...(w.label === 'core' ? { monthArchiveKeys } : {}),
      }),
    )
  }

  for (const { monthKey, sheet } of split.monthArchives) {
    const json = JSON.stringify(sheet)
    totalBytes += json.length
    if (json.length > FIRESTORE_DOC_MAX_BYTES) {
      shardTooLarge(`month:${monthKey}`, json.length)
    }
    transaction.set(
      doc(db, fstMonthArchiveDocPath(storeDocId, monthKey)),
      stripUndefinedDeep({
        app: 'FST',
        monthKey,
        payload: { sheet },
        revision,
        updatedAt: serverTimestamp(),
      }),
    )
  }

  return { totalBytes, monthArchiveKeys }
}

export function collectArchiveKeysForStore(store: AppStore): string[] {
  return [...resolveArchiveMonthKeys(store)].sort()
}
