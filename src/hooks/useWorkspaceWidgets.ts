import { useCallback, useEffect, useState } from 'react'
import {
  WORKSPACE_WIDGETS_STORAGE_PREFIX,
  type WorkspaceWidgetId,
} from '@/lib/ui/workspaceWidgets'
import { safeLocalGet, safeLocalRemove, safeLocalSet } from '@/lib/safeStorage'
import { onCloseOverlays } from '@/lib/ui/overlayEvents'

function readStored(viewKey: string): WorkspaceWidgetId | null {
  if (typeof window === 'undefined') return null
  const v = safeLocalGet(`${WORKSPACE_WIDGETS_STORAGE_PREFIX}${viewKey}`)
  return v || null
}

function writeStored(viewKey: string, id: WorkspaceWidgetId | null): void {
  if (typeof window === 'undefined') return
  const key = `${WORKSPACE_WIDGETS_STORAGE_PREFIX}${viewKey}`
  if (id) safeLocalSet(key, id)
  else safeLocalRemove(key)
}

/** Открытый виджет-панель; состояние сохраняется в localStorage по ключу раздела. */
export function useWorkspaceWidgets(viewKey: string) {
  const [openId, setOpenId] = useState<WorkspaceWidgetId | null>(() => readStored(viewKey))

  useEffect(() => {
    writeStored(viewKey, openId)
  }, [viewKey, openId])

  useEffect(() => onCloseOverlays(() => setOpenId(null)), [])

  const open = useCallback((id: WorkspaceWidgetId) => setOpenId(id), [])
  const close = useCallback(() => setOpenId(null), [])
  const toggle = useCallback((id: WorkspaceWidgetId) => {
    setOpenId((prev) => (prev === id ? null : id))
  }, [])

  return {
    openId,
    open,
    close,
    toggle,
    isOpen: (id: WorkspaceWidgetId) => openId === id,
  }
}
