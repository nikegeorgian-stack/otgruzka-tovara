import type { AppStore } from './types'
import { sanitizeStoreForExport } from './storage'

const DAILY_BACKUPS_KEY = 'fibercell-daily-backups'

type DailyBackup = { date: string; data: string }

/** Локальные копии за последние 7 дней (без автоматического скачивания) */
export function runDailyBackup(store: AppStore): AppStore {
  if (import.meta.env.VITE_FST_WEB === 'true') return store
  const today = new Date().toISOString().slice(0, 10)
  if (store.settings.lastBackupDate === today) return store

  try {
    const safe = sanitizeStoreForExport(store)
    const raw = localStorage.getItem(DAILY_BACKUPS_KEY)
    const list: DailyBackup[] = raw ? (JSON.parse(raw) as DailyBackup[]) : []
    const next: DailyBackup[] = [
      { date: today, data: JSON.stringify(safe) },
      ...list.filter((b) => b.date !== today),
    ].slice(0, 7)
    localStorage.setItem(DAILY_BACKUPS_KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }

  return {
    ...store,
    settings: { ...store.settings, lastBackupDate: today },
  }
}

export function listDailyBackups(): DailyBackup[] {
  try {
    const raw = localStorage.getItem(DAILY_BACKUPS_KEY)
    return raw ? (JSON.parse(raw) as DailyBackup[]) : []
  } catch {
    return []
  }
}

export function restoreDailyBackup(date: string): AppStore | null {
  const item = listDailyBackups().find((b) => b.date === date)
  if (!item) return null
  try {
    return JSON.parse(item.data) as AppStore
  } catch {
    return null
  }
}

/** File System Access API — сохранить JSON в выбранную папку */
export async function saveBackupToFolder(store: AppStore): Promise<boolean> {
  if (!('showDirectoryPicker' in window)) return false
  try {
    // @ts-expect-error File System Access API
    const dir = await window.showDirectoryPicker({ mode: 'readwrite' })
    const name = `fibercell-tabel-${new Date().toISOString().slice(0, 10)}.json`
    const handle = await dir.getFileHandle(name, { create: true })
    const writable = await handle.createWritable()
    await writable.write(JSON.stringify(sanitizeStoreForExport(store), null, 2))
    await writable.close()
    return true
  } catch {
    return false
  }
}
