import { useEffect, useId, useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from 'react'
import {
  enterSubmitMode,
  getFocusableElements,
  getModalZIndex,
  getPopoverZIndex,
  isTopModal,
  peekModalZIndexForNew,
  registerModal,
  subscribeModalStack,
  trapTabKey,
  unregisterModal,
} from '@/lib/ui/modalScope'

export type ModalInitialFocus = 'first' | 'primary' | 'none'

export type UseModalScopeOptions = {
  open: boolean
  onClose: () => void
  containerRef: RefObject<HTMLElement | null>
  /** Enter (в однострочных полях) и Ctrl+Enter (везде) — основное действие. */
  onPrimaryAction?: () => void
  /** Не перехватывать Enter на уровне окна (свои правила внутри, напр. подбор). */
  disableEnterSubmit?: boolean
  initialFocus?: ModalInitialFocus
}

/**
 * Изолирует клавиатуру внутри модального окна:
 * Esc → onClose (только верхнее окно), Tab-ловушка, Enter/Ctrl+Enter → primary, возврат фокуса.
 */
export function useModalScope({
  open,
  onClose,
  containerRef,
  onPrimaryAction,
  disableEnterSubmit = false,
  initialFocus = 'first',
}: UseModalScopeOptions): { zIndex: number } {
  const modalId = useId()
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const openRef = useRef(open)
  openRef.current = open

  useLayoutEffect(() => {
    if (!open) return
    registerModal(modalId)
    return () => unregisterModal(modalId)
  }, [open, modalId])

  const zIndex = useSyncExternalStore(
    subscribeModalStack,
    () => (openRef.current ? getModalZIndex(modalId) : 0),
    () => peekModalZIndexForNew(),
  )

  useEffect(() => {
    if (!open) return

    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    const focusTimer = window.setTimeout(() => {
      const el = containerRef.current
      if (!el || initialFocus === 'none') return

      if (initialFocus === 'primary') {
        const primary = el.querySelector<HTMLElement>('[data-modal-primary]')
        if (primary) {
          primary.focus()
          return
        }
      }

      const autofocus = el.querySelector<HTMLElement>('[data-modal-autofocus]')
      if (autofocus) {
        autofocus.focus()
        return
      }

      const focusable = getFocusableElements(el)
      focusable[0]?.focus({ preventScroll: true })
    }, 0)

    function onKeyDown(e: KeyboardEvent) {
      if (!isTopModal(modalId)) return

      const container = containerRef.current
      if (!container) return

      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }

      if (e.key === 'Tab') {
        trapTabKey(container, e)
        return
      }

      if (!onPrimaryAction || disableEnterSubmit) return

      const isCtrlEnter = e.key === 'Enter' && (e.ctrlKey || e.metaKey)
      const isPlainEnter =
        e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey

      if (isCtrlEnter) {
        e.preventDefault()
        e.stopPropagation()
        onPrimaryAction()
        return
      }

      if (!isPlainEnter) return

      const mode = enterSubmitMode(e.target)
      if (mode === 'ignore') return
      if (mode === 'ctrl-only') return

      e.preventDefault()
      e.stopPropagation()
      onPrimaryAction()
    }

    window.addEventListener('keydown', onKeyDown, true)

    return () => {
      window.clearTimeout(focusTimer)
      window.removeEventListener('keydown', onKeyDown, true)

      const restore = restoreFocusRef.current
      if (restore && document.contains(restore)) {
        requestAnimationFrame(() => restore.focus({ preventScroll: true }))
      }
    }
  }, [
    open,
    onClose,
    onPrimaryAction,
    disableEnterSubmit,
    initialFocus,
    modalId,
    containerRef,
  ])

  return { zIndex }
}

/** z-index для портальных выпадающих панелей поверх модалок. */
export function usePopoverZIndex(active = true): number {
  return useSyncExternalStore(
    subscribeModalStack,
    () => (active ? getPopoverZIndex() : 0),
    () => getPopoverZIndex(),
  )
}
