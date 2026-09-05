import { useCallback, useEffect, useRef, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useModalScope, type ModalInitialFocus } from '@/hooks/useModalScope'
import { useWindowChrome } from '@/hooks/useWindowChrome'
import { CHROME_BACKDROP_CLASS } from '@/lib/ui/chromeLayout'
import { getModalPortalRoot } from '@/lib/ui/modalScope'

type Props = {
  open: boolean
  onClose: () => void
  children: ReactNode
  zIndex?: number
  blockBackdropClose?: boolean
  onPrimaryAction?: () => void
  disableEnterSubmit?: boolean
  initialFocus?: ModalInitialFocus
  labelledBy?: string
  className?: string
  panelClassName?: string
  /** Заголовок для панели свёрнутых окон */
  title?: string
  minimizable?: boolean
  ephemeral?: boolean
  dirty?: boolean
  onSaveDirty?: () => void | Promise<void>
}

/**
 * Оболочка для кастомных модалок (без шапки AppDialog).
 * Та же политика окон: фон → свернуть, закрытие → спросить если dirty.
 */
export function ModalBackdrop({
  open,
  onClose,
  children,
  zIndex: zIndexProp = 420,
  blockBackdropClose = false,
  onPrimaryAction,
  disableEnterSubmit,
  initialFocus = 'first',
  labelledBy,
  className = CHROME_BACKDROP_CLASS,
  panelClassName =
    'app-dialog-panel flex w-full flex-col overflow-hidden rounded-t-sm border border-grid bg-white shadow-sm sm:rounded-sm',
  title = 'Окно',
  minimizable,
  ephemeral = false,
  dirty = false,
  onSaveDirty,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null)

  const { visible, requestClose, onBackdropInteract } = useWindowChrome({
    open,
    title,
    onClose,
    dirty,
    onSaveDirty,
    minimizable,
    ephemeral,
  })

  const { zIndex: stackZIndex } = useModalScope({
    open: visible,
    onClose: () => {
      void requestClose()
    },
    containerRef: panelRef,
    onPrimaryAction,
    disableEnterSubmit,
    initialFocus,
  })
  const zIndex = Math.max(zIndexProp, stackZIndex)

  useEffect(() => {
    if (!visible) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [visible])

  const onBackdropMouseDown = useCallback(
    (e: MouseEvent) => {
      if (blockBackdropClose) return
      if (e.target !== e.currentTarget) return
      onBackdropInteract()
    },
    [blockBackdropClose, onBackdropInteract],
  )

  if (!visible) return null

  return createPortal(
    <div
      className={className}
      style={{ zIndex }}
      role="presentation"
      onMouseDown={onBackdropMouseDown}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={panelClassName}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    getModalPortalRoot(),
  )
}
