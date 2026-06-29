import { LOCAL_DB_API } from './config'
import { createDefaultStore, parseStorePayload } from '@/lib/storage'
import { purgeExpiredTrash } from '@/lib/trash'
import type { AppStore } from '@/lib/types'

function localDbHeaders(extra?: HeadersInit): HeadersInit {
  const headers = new Headers(extra)
  const key = import.meta.env.VITE_LOCAL_DB_API_KEY
  if (typeof key === 'string' && key.trim()) {
    headers.set('X-Tabel-Api-Key', key.trim())
  }
  return headers
}

export type LocalDbLoadResult = {
  store: AppStore
  updatedAt: string | null
}

export async function checkLocalDbHealth(): Promise<{ ok: boolean; db?: string }> {
  try {
    const res = await fetch(`${LOCAL_DB_API}/health`)
    if (!res.ok) return { ok: false }
    const data = (await res.json()) as { ok?: boolean; db?: string }
    return { ok: !!data.ok, db: data.db }
  } catch {
    return { ok: false }
  }
}

export async function loadFromLocalDb(): Promise<LocalDbLoadResult | null> {
  const res = await fetch(`${LOCAL_DB_API}/store`)
  if (!res.ok) throw new Error('local_db_load_failed')
  const data = (await res.json()) as { store: unknown; updatedAt: string | null }
  if (!data.store) return null
  const parsed = parseStorePayload(data.store)
  if (!parsed) throw new Error('local_db_corrupt')
  return {
    store: purgeExpiredTrash(parsed),
    updatedAt: data.updatedAt,
  }
}

export async function saveToLocalDb(store: AppStore): Promise<string> {
  const res = await fetch(`${LOCAL_DB_API}/store`, {
    method: 'PUT',
    headers: localDbHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ store }),
  })
  if (!res.ok) throw new Error('local_db_save_failed')
  const data = (await res.json()) as { updatedAt: string }
  return data.updatedAt
}

/** Первый запуск: миграция из localStorage или пустой store. */
export function seedStoreForLocalDb(): AppStore {
  try {
    const raw = localStorage.getItem('fibercell-tabel-v6')
    if (raw) {
      const parsed = parseStorePayload(JSON.parse(raw))
      if (parsed) return purgeExpiredTrash(parsed)
    }
  } catch {
    /* use default */
  }
  return createDefaultStore()
}

export function localDbErrorMessage(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('load_failed') || msg.includes('Failed to fetch')) {
    return 'Не удалось подключиться к локальной базе. Запустите: npm run dev'
  }
  if (msg.includes('save_failed')) {
    return 'Ошибка записи в SQLite. Проверьте файл data/tabel.db'
  }
  if (msg.includes('corrupt')) {
    return 'Данные в SQLite повреждены. Восстановите из JSON-бэкапа.'
  }
  return fallback
}
