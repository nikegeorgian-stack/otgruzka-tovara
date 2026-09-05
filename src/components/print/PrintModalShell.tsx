import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useModalScope } from '@/hooks/useModalScope'
import { FULLSCREEN_OVER_CHROME_Z, zOverChrome } from '@/lib/ui/chromeLayout'
import { getModalPortalRoot } from '@/lib/ui/modalScope'
import { onCloseOverlays } from '@/lib/ui/overlayEvents'

type Props = {
  open: boolean
  onClose: () => void
  children: ReactNode
  zIndex?: number
}

/** Полноэкранная оболочка для предпросмотра печати (поверх сайдбара). */
export function PrintModalShell({
  open,
  onClose,
  children,
  zIndex: zIndexProp = FULLSCREEN_OVER_CHROME_Z,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null)

  const { zIndex: stackZIndex } = useModalScope({
    open,
    onClose,
    containerRef: panelRef,
    initialFocus: 'none',
  })
  const zIndex = zOverChrome(Math.max(zIndexProp, stackZIndex))

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    return onCloseOverlays(onClose)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      ref={panelRef}
      className="print-modal-root fixed inset-0 flex flex-col bg-stone-900/60"
      style={{ zIndex }}
      role="dialog"
      aria-modal="true"
    >
      {children}
    </div>,
    getModalPortalRoot(),
  )
}
