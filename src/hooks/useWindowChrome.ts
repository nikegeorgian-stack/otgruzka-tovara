import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useConfirm } from '@/context/ConfirmContext'
import { useModalMinimizeOptional } from '@/context/ModalMinimizeContext'
import { onCloseOverlays, onMinimizeOverlays, onRestoreWindow } from '@/lib/ui/overlayEvents'

export type UseWindowChromeOptions = {
  open: boolean
  title: string
  onClose: () => void
  /** Стабильный id окна (несколько карточек сотрудника). */
  windowId?: string
  /** Есть несохранённые правки */
  dirty?: boolean
  /** Сохранить перед закрытием (если пользователь выбрал «Сохранить») */
  onSaveDirty?: () => void | Promise<void>
  /**
   * Можно свернуть в панель внизу.
   * undefined = да, если есть ModalMinimizeProvider.
   */
  minimizable?: boolean
  /**
   * true = это системный диалог (confirm/alert): без сворачивания,
   * клик снаружи закрывает, смена раздела закрывает.
   */
  ephemeral?: boolean
}

/**
 * Единая политика окон FST:
 * - клик снаружи / смена раздела → свернуть (если можно)
 * - крестик «Закрыть» → при dirty спросить сохранить / не сохранять / отмена
 */
export function useWindowChrome({
  open,
  title,
  onClose,
  windowId: externalId,
  dirty = false,
  onSaveDirty,
  minimizable,
  ephemeral = false,
}: UseWindowChromeOptions) {
  const { confirmUnsaved } = useConfirm()
  const minimizeApi = useModalMinimizeOptional()
  const reactId = useId()
  const dialogId = externalId ?? reactId
  const [minimized, setMinimized] = useState(false)
  const closingRef = useRef(false)

  // Context value меняется при каждом items[] — нельзя класть minimizeApi в deps
  // cleanup-эффекта, иначе сразу после minimize сработает remove() и окно пропадёт из панели.
  const minimizeApiRef = useRef(minimizeApi)
  minimizeApiRef.current = minimizeApi
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const onSaveDirtyRef = useRef(onSaveDirty)
  onSaveDirtyRef.current = onSaveDirty
  const titleRef = useRef(title)
  titleRef.current = title

  const canMinimize = !ephemeral && (minimizable ?? Boolean(minimizeApi))

  const handleMinimize = useCallback(() => {
    const api = minimizeApiRef.current
    if (!canMinimize || !api || minimized || !open) return
    api.minimize({
      id: dialogId,
      title: titleRef.current,
      restore: () => setMinimized(false),
      close: () => onCloseRef.current(),
    })
    setMinimized(true)
  }, [canMinimize, minimized, open, dialogId])

  const requestClose = useCallback(async () => {
    if (closingRef.current) return
    closingRef.current = true
    try {
      if (dirty) {
        const choice = await confirmUnsaved()
        if (choice === 'cancel') return
        if (choice === 'save') {
          try {
            await onSaveDirtyRef.current?.()
          } catch {
            return
          }
        }
      }
      minimizeApiRef.current?.remove(dialogId)
      setMinimized(false)
      onCloseRef.current()
    } finally {
      closingRef.current = false
    }
  }, [dirty, confirmUnsaved, dialogId])

  /** Клик по фону / уход без явного закрытия */
  const onBackdropInteract = useCallback(() => {
    if (canMinimize) handleMinimize()
    else void requestClose()
  }, [canMinimize, handleMinimize, requestClose])

  useEffect(() => {
    if (!open) {
      setMinimized(false)
      minimizeApiRef.current?.remove(dialogId)
    }
  }, [open, dialogId])

  useEffect(() => {
    return () => {
      minimizeApiRef.current?.remove(dialogId)
    }
  }, [dialogId])

  // Смена раздела / releaseUiChrome → свернуть рабочие окна
  useEffect(() => {
    if (!open || minimized || !canMinimize) return
    return onMinimizeOverlays(handleMinimize)
  }, [open, minimized, canMinimize, handleMinimize])

  // Эфемерные / без minimize — закрыть при смене раздела
  useEffect(() => {
    if (!open || minimized) return
    if (canMinimize) return
    return onCloseOverlays(() => {
      void requestClose()
    })
  }, [open, minimized, canMinimize, requestClose])

  // Внешнее восстановление (открыли того же сотрудника из списка)
  useEffect(() => {
    if (!open) return
    return onRestoreWindow((id) => {
      if (id !== dialogId) return
      setMinimized(false)
      minimizeApiRef.current?.remove(dialogId)
    })
  }, [open, dialogId])

  return {
    dialogId,
    minimized,
    canMinimize,
    visible: open && !minimized,
    handleMinimize,
    requestClose,
    onBackdropInteract,
  }
}
