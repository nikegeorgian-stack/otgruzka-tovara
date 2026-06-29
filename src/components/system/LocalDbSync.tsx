import { useCallback, useEffect, useRef, useState } from 'react'
import {
  LOCAL_DB_POLL_MS,
  LOCAL_DB_SAVE_DEBOUNCE_MS,
} from '@/lib/localDb/config'
import {
  loadFromLocalDb,
  localDbErrorMessage,
  saveToLocalDb,
  seedStoreForLocalDb,
} from '@/lib/localDb/client'
import { postStoreSaved, subscribeStoreSaved } from '@/lib/persistence/broadcast'
import type { AppStore } from '@/lib/types'
import type { SaveStoreResult } from '@/lib/storage'

type Props = {
  store: AppStore
  replaceStore: (next: AppStore) => void
  onSaveError: (err: SaveStoreResult | null) => void
}

function formatSavedAt(iso: string | null): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return iso
  }
}

export function LocalDbSync({ store, replaceStore, onSaveError }: Props) {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dbPath, setDbPath] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [isDirty, setIsDirty] = useState(false)
  const [lastSavedLabel, setLastSavedLabel] = useState<string | null>(null)

  const skipSave = useRef(true)
  const dirty = useRef(false)
  const saving = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastRemoteAt = useRef<string | null>(null)
  const lastSavedAt = useRef<string | null>(null)
  const storeRef = useRef(store)
  storeRef.current = store

  const retry = useCallback(() => {
    setError(null)
    setReloadKey((k) => k + 1)
  }, [])

  const persistStore = useCallback(async () => {
    if (skipSave.current || saving.current) return
    saving.current = true
    try {
      const updatedAt = await saveToLocalDb(storeRef.current)
      lastSavedAt.current = updatedAt
      lastRemoteAt.current = updatedAt
      dirty.current = false
      setIsDirty(false)
      setLastSavedLabel(formatSavedAt(updatedAt))
      postStoreSaved(updatedAt)
      onSaveError(null)
    } catch (err) {
      console.error('Local DB save failed', err)
      onSaveError({
        ok: false,
        error: 'unknown',
        message: localDbErrorMessage(err, 'Ошибка сохранения в SQLite.'),
      })
    } finally {
      saving.current = false
    }
  }, [onSaveError])

  useEffect(() => {
    let cancelled = false
    setReady(false)

    void (async () => {
      try {
        const loaded = await loadFromLocalDb()
        if (cancelled) return

        if (loaded) {
          replaceStore(loaded.store)
          lastRemoteAt.current = loaded.updatedAt
          lastSavedAt.current = loaded.updatedAt
          setLastSavedLabel(formatSavedAt(loaded.updatedAt))
        } else {
          const seed = seedStoreForLocalDb()
          replaceStore(seed)
          const updatedAt = await saveToLocalDb(seed)
          lastRemoteAt.current = updatedAt
          lastSavedAt.current = updatedAt
          setLastSavedLabel(formatSavedAt(updatedAt))
        }

        dirty.current = false
        setIsDirty(false)
        skipSave.current = false
        setReady(true)
        onSaveError(null)
      } catch (err) {
        console.error('Local DB load failed', err)
        if (!cancelled) {
          setError(localDbErrorMessage(err, 'Ошибка загрузки локальной базы.'))
          setReady(true)
          skipSave.current = true
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [replaceStore, onSaveError, reloadKey])

  useEffect(() => {
    if (!ready || skipSave.current) return

    dirty.current = true
    setIsDirty(true)

    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void persistStore()
    }, LOCAL_DB_SAVE_DEBOUNCE_MS)

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [store, ready, persistStore])

  useEffect(() => {
    if (!ready) return
    const onUnload = () => {
      if (!dirty.current || skipSave.current) return
      void fetch('/api/store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store: storeRef.current }),
        keepalive: true,
      })
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [ready])

  useEffect(() => {
    if (!ready || skipSave.current) return
    return subscribeStoreSaved((updatedAt) => {
      if (dirty.current || saving.current) return
      if (updatedAt === lastRemoteAt.current) return
      void loadFromLocalDb()
        .then((loaded) => {
          if (!loaded?.updatedAt || loaded.updatedAt !== updatedAt) return
          lastRemoteAt.current = loaded.updatedAt
          lastSavedAt.current = loaded.updatedAt
          setLastSavedLabel(formatSavedAt(loaded.updatedAt))
          replaceStore(loaded.store)
        })
        .catch(() => {})
    })
  }, [ready, replaceStore])

  useEffect(() => {
    if (!ready || skipSave.current) return

    const timer = setInterval(() => {
      if (dirty.current || saving.current) return

      void loadFromLocalDb()
        .then((loaded) => {
          if (!loaded?.updatedAt) return
          if (loaded.updatedAt === lastRemoteAt.current) return
          if (loaded.updatedAt === lastSavedAt.current) {
            lastRemoteAt.current = loaded.updatedAt
            return
          }
          lastRemoteAt.current = loaded.updatedAt
          lastSavedAt.current = loaded.updatedAt
          setLastSavedLabel(formatSavedAt(loaded.updatedAt))
          replaceStore(loaded.store)
        })
        .catch(() => {
          /* ignore transient poll errors */
        })
    }, LOCAL_DB_POLL_MS)

    return () => clearInterval(timer)
  }, [ready, replaceStore])

  useEffect(() => {
    void fetch('/api/health')
      .then((r) => r.json())
      .then((d: { db?: string }) => setDbPath(d.db ?? null))
      .catch(() => {})
  }, [ready])

  if (!ready) {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-stone-100">
        <p className="text-sm text-stone-600">Загрузка локальной базы SQLite…</p>
      </div>
    )
  }

  return (
    <>
      {error && (
        <div className="fixed bottom-4 right-4 z-[200] max-w-sm rounded-sm border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 shadow-sm">
          <p>{error}</p>
          <button
            type="button"
            className="mt-2 rounded-sm bg-red-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-900"
            onClick={retry}
          >
            Повторить
          </button>
        </div>
      )}
      {!error && dbPath && (
        <div
          className={`fixed bottom-3 left-3 z-[50] rounded-sm border px-2.5 py-1 text-[10px] shadow-sm print:hidden ${
            isDirty
              ? 'border-amber-200 bg-amber-50/95 text-amber-900'
              : 'border-emerald-200 bg-emerald-50/95 text-emerald-900'
          }`}
          title={dbPath}
        >
          SQLite · {dbPath.split(/[/\\]/).slice(-2).join('/')}
          {isDirty ? ' · сохранение…' : lastSavedLabel ? ` · ${lastSavedLabel}` : ''}
        </div>
      )}
    </>
  )
}
