import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useModalScope, type ModalInitialFocus } from '@/hooks/useModalScope'
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
  /** id заголовка для aria-labelledby */
  labelledBy?: string
  className?: string
  panelClassName?: string
}

/**
 * Оболочка для кастомных модалок (без шапки AppDialog).
 * Даёт изоляцию клавиатуры, клик по фону и Tab-ловушку.
 */
export function ModalBackdrop({
  open,
  onClose,
  children,
  zIndex: zIndexProp = 130,
  blockBackdropClose = false,
  onPrimaryAction,
  disableEnterSubmit,
  initialFocus = 'first',
  labelledBy,
  className = 'app-dialog-backdrop fixed inset-0 flex items-end justify-center p-0 sm:items-center sm:p-4',
  panelClassName = 'app-dialog-panel flex max-h-[min(92vh,900px)] w-full flex-col overflow-hidden rounded-t-sm border border-grid bg-white shadow-sm sm:rounded-sm',
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null)

  const { zIndex: stackZIndex } = useModalScope({
    open,
    onClose,
    containerRef: panelRef,
    onPrimaryAction,
    disableEnterSubmit,
    initialFocus,
  })
  const zIndex = Math.max(zIndexProp, stackZIndex)

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      className={className}
      style={{ zIndex }}
      role="presentation"
      onMouseDown={(e) => {
        if (blockBackdropClose) return
        if (e.target === e.currentTarget) onClose()
      }}
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
