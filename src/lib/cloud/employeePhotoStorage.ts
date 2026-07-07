import {
  deleteObject,
  getDownloadURL,
  getStorage,
  ref,
  uploadString,
} from 'firebase/storage'
import type { AppStore, Candidate, Employee } from '@/lib/types'
import { getFirebaseApp, isFirebaseConfigured } from './firebase'
import { stripInlinePhoto } from './cloudStoreShards'

export type PhotoEntityKind = 'employees' | 'candidates'

export function photoStoragePath(
  storeDocId: string,
  entityId: string,
  kind: PhotoEntityKind,
): string {
  return `fstPhotos/${storeDocId}/${kind}/${entityId}.jpg`
}

function isDataUrl(url: string | undefined): boolean {
  return !!url?.startsWith('data:')
}

async function uploadDataUrl(path: string, dataUrl: string): Promise<void> {
  const storage = getStorage(getFirebaseApp())
  await uploadString(ref(storage, path), dataUrl, 'data_url')
}

async function downloadUrl(path: string): Promise<string | undefined> {
  try {
    return await getDownloadURL(ref(getStorage(getFirebaseApp()), path))
  } catch {
    return undefined
  }
}

async function syncPersonPhoto<T extends Employee | Candidate>(
  row: T,
  storeDocId: string,
  kind: PhotoEntityKind,
): Promise<T> {
  if (!isDataUrl(row.photoDataUrl)) {
    return stripInlinePhoto(row)
  }
  const path = row.photoStoragePath ?? photoStoragePath(storeDocId, row.id, kind)
  try {
    await uploadDataUrl(path, row.photoDataUrl!)
    const { photoDataUrl: _, ...rest } = row
    return { ...rest, photoStoragePath: path } as T
  } catch (err) {
    console.warn('FST cloud: фото не загружено в Storage, сохраняем без фото в Firestore', err)
    return stripInlinePhoto(row)
  }
}

/** Перед записью в Firestore: загрузить base64-фото в Storage. */
export async function syncStorePhotosForCloud(
  store: AppStore,
  storeDocId: string,
): Promise<AppStore> {
  if (!isFirebaseConfigured()) return store

  const employees = await Promise.all(
    store.employees.map((e) => syncPersonPhoto(e, storeDocId, 'employees')),
  )
  const candidates = await Promise.all(
    store.candidates.map((c) => syncPersonPhoto(c, storeDocId, 'candidates')),
  )
  const trashEmployees = await Promise.all(
    store.trash.employees.map(async (t) => ({
      ...t,
      employee: await syncPersonPhoto(t.employee, storeDocId, 'employees'),
    })),
  )
  const trashCandidates = await Promise.all(
    store.trash.candidates.map(async (t) => ({
      ...t,
      candidate: await syncPersonPhoto(t.candidate, storeDocId, 'candidates'),
    })),
  )

  return {
    ...store,
    employees,
    candidates,
    trash: {
      ...store.trash,
      employees: trashEmployees,
      candidates: trashCandidates,
    },
  }
}

async function hydratePersonPhoto<T extends Employee | Candidate>(row: T): Promise<T> {
  if (row.photoDataUrl?.startsWith('data:') || row.photoDataUrl?.startsWith('http')) {
    return row
  }
  if (!row.photoStoragePath) return row
  const url = await downloadUrl(row.photoStoragePath)
  return url ? { ...row, photoDataUrl: url } : row
}

/** После загрузки из Firestore: подтянуть URL фото из Storage. */
export async function hydrateStorePhotosFromCloud(store: AppStore): Promise<AppStore> {
  if (!isFirebaseConfigured()) return store

  const employees = await Promise.all(store.employees.map(hydratePersonPhoto))
  const candidates = await Promise.all(store.candidates.map(hydratePersonPhoto))
  const trashEmployees = await Promise.all(
    store.trash.employees.map(async (t) => ({
      ...t,
      employee: await hydratePersonPhoto(t.employee),
    })),
  )
  const trashCandidates = await Promise.all(
    store.trash.candidates.map(async (t) => ({
      ...t,
      candidate: await hydratePersonPhoto(t.candidate),
    })),
  )

  return {
    ...store,
    employees,
    candidates,
    trash: {
      ...store.trash,
      employees: trashEmployees,
      candidates: trashCandidates,
    },
  }
}

export async function deleteEmployeePhoto(path: string): Promise<void> {
  if (!isFirebaseConfigured()) return
  try {
    await deleteObject(ref(getStorage(getFirebaseApp()), path))
  } catch {
    /* already gone */
  }
}
