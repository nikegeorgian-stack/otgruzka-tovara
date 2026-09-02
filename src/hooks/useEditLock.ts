import { useCallback, useEffect, useRef, useState } from 'react'
import {
  acquireEditLock,
  forceClearEditLock,
  heartbeatEditLock,
  releaseEditLock,
  subscribeEditLock,
} from '@/lib/editLocks/service'
import {
  EDIT_LOCK_HEARTBEAT_MS,
  type EditLockRecord,
  type EditLockResourceType,
} from '@/lib/editLocks/types'

export type EditLockMode = 'edit' | 'readonly' | 'pending'

type Options = {
  resourceId: string | null
  resourceType: EditLockResourceType
  holderUid: string
  holderName: string
  enabled: boolean
  /** Перехват чужого активного замка — только sysadmin (правила Firestore + UI). */
  canForceTakeOver?: boolean
}

/**
 * Soft-lock: при открытии карточки захватываем замок.
 * Чужой замок → readonly + баннер; «Перехватить» → force acquire (sysadmin).
 */
export function useEditLock({
  resourceId,
  resourceType,
  holderUid,
  holderName,
  enabled,
  canForceTakeOver = false,
}: Options) {
  const [mode, setMode] = useState<EditLockMode>('pending')
  const [foreignLock, setForeignLock] = useState<EditLockRecord | null>(null)
  const holderRef = useRef({ uid: holderUid, name: holderName })
  holderRef.current = { uid: holderUid, name: holderName }
  const heldRef = useRef(false)

  const release = useCallback(async () => {
    if (!resourceId || !heldRef.current) return
    heldRef.current = false
    await releaseEditLock(resourceId, holderRef.current)
  }, [resourceId])

  const takeOver = useCallback(async () => {
    if (!resourceId || !canForceTakeOver) return
    const result = await acquireEditLock({
      resourceId,
      resourceType,
      holder: holderRef.current,
      force: true,
    })
    if (result.status === 'acquired') {
      heldRef.current = true
      setForeignLock(null)
      setMode('edit')
    }
  }, [canForceTakeOver, resourceId, resourceType])

  const resetForeignLock = useCallback(async (): Promise<boolean> => {
    if (!resourceId || !canForceTakeOver || !foreignLock) return false
    const cleared = await forceClearEditLock(foreignLock)
    if (!cleared) return false
    const result = await acquireEditLock({
      resourceId,
      resourceType,
      holder: holderRef.current,
      force: true,
    })
    if (result.status !== 'acquired') return false
    heldRef.current = true
    setForeignLock(null)
    setMode('edit')
    return true
  }, [canForceTakeOver, foreignLock, resourceId, resourceType])

  const stayReadonly = useCallback(() => {
    setMode('readonly')
  }, [])

  useEffect(() => {
    if (!enabled || !resourceId || !holderUid) {
      setMode('edit')
      setForeignLock(null)
      return
    }

    let cancelled = false
    heldRef.current = false
    setMode('pending')

    void (async () => {
      const result = await acquireEditLock({
        resourceId,
        resourceType,
        holder: holderRef.current,
      })
      if (cancelled) {
        if (result.status === 'acquired') {
          await releaseEditLock(resourceId, holderRef.current)
        }
        return
      }
      if (result.status === 'blocked') {
        setForeignLock(result.lock)
        setMode('readonly')
        return
      }
      heldRef.current = true
      setForeignLock(null)
      setMode('edit')
    })()

    const unsub = subscribeEditLock(resourceId, holderRef.current, (foreign) => {
      if (cancelled) return
      if (foreign && !heldRef.current) {
        setForeignLock(foreign)
        setMode((m) => (m === 'edit' ? 'readonly' : m))
      } else if (!foreign) {
        setForeignLock(null)
      }
    })

    const beat = window.setInterval(() => {
      if (!heldRef.current || cancelled) return
      void heartbeatEditLock(resourceId, resourceType, holderRef.current)
    }, EDIT_LOCK_HEARTBEAT_MS)

    return () => {
      cancelled = true
      window.clearInterval(beat)
      unsub()
      if (heldRef.current) {
        heldRef.current = false
        void releaseEditLock(resourceId, holderRef.current)
      }
    }
  }, [enabled, resourceId, resourceType, holderUid])

  return {
    mode,
    foreignLock,
    takeOver,
    resetForeignLock,
    canForceTakeOver,
    stayReadonly,
    release,
  }
}
