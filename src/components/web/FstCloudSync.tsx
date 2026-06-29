import { useCallback, useEffect, useRef, useState } from 'react'
import { useFstAuth } from '@/context/FstAuthContext'
import {
  cloudErrorMessage,
  ensureCloudStore,
  saveCloudStore,
} from '@/lib/cloud/firestoreSync'
import type { FstCloudSyncProps } from './fstCloudTypes'

const SAVE_DEBOUNCE_MS = 1200

export function FstCloudSync({ store, replaceStore }: FstCloudSyncProps) {
  const { user, configured } = useFstAuth()
  const [cloudReady, setCloudReady] = useState(!configured)
  const [cloudError, setCloudError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skipSave = useRef(true)

  const retryLoad = useCallback(() => {
    setCloudError(null)
    setReloadKey((k) => k + 1)
  }, [])

  useEffect(() => {
    if (!configured || !user) {
      setCloudReady(!configured)
      return
    }

    let cancelled = false
    setCloudReady(false)
    setCloudError(null)

    void (async () => {
      try {
        const data = await ensureCloudStore(user.uid)
        if (cancelled) return
        replaceStore(data)
        skipSave.current = false
        setCloudReady(true)
      } catch (err) {
        console.error('FST cloud load failed', err)
        if (!cancelled) {
          setCloudError(cloudErrorMessage(err, 'Не удалось загрузить данные из облака.'))
          setCloudReady(true)
          skipSave.current = true
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [configured, user, replaceStore, reloadKey])

  useEffect(() => {
    if (!configured || !user || !cloudReady || skipSave.current) return

    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void saveCloudStore(user.uid, store).catch((err) => {
        console.error('FST cloud save failed', err)
        setCloudError(cloudErrorMessage(err, 'Ошибка сохранения в облако.'))
      })
    }, SAVE_DEBOUNCE_MS)

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [store, configured, user, cloudReady])

  if (!configured) return null
  if (!cloudReady) {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-stone-100">
        <p className="text-sm text-stone-600">FST — загрузка данных…</p>
      </div>
    )
  }
  if (cloudError) {
    return (
      <div className="fixed bottom-4 right-4 z-[200] max-w-sm rounded-sm border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-sm max-lg:bottom-[calc(5.5rem+env(safe-area-inset-bottom))]">
        <p>{cloudError}</p>
        <button
          type="button"
          className="mt-2 rounded-sm bg-amber-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-900"
          onClick={retryLoad}
        >
          Повторить
        </button>
      </div>
    )
  }
  return null
}
