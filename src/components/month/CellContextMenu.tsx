import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { usePopoverZIndex } from '@/hooks/useModalScope'
import { getModalPortalRoot } from '@/lib/ui/modalScope'
import { useI18n } from '@/context/I18nContext'

type Props = {
  x: number
  y: number
  showSubstitution: boolean
  showBrigadier?: boolean
  isBrigadier?: boolean
  onComment: () => void
  onSubstitution: () => void
  onToggleBrigadier?: () => void
  onBrigadierMonth?: () => void
  onClose: () => void
}

export function CellContextMenu({
  x,
  y,
  showSubstitution,
  showBrigadier = false,
  isBrigadier = false,
  onComment,
  onSubstitution,
  onToggleBrigadier,
  onBrigadierMonth,
  onClose,
}: Props) {
  const { t } = useI18n()
  const ref = useRef<HTMLDivElement>(null)
  const popoverZ = usePopoverZIndex()

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      className="fixed min-w-[10rem] rounded-sm border border-grid bg-white py-1 shadow-sm"
      style={{ left: x, top: y, zIndex: popoverZ }}
    >
      <button
        type="button"
        className="block w-full px-3 py-2 text-left text-sm hover:bg-paper-dark"
        onClick={() => {
          onComment()
          onClose()
        }}
      >
        {t('comment.title')}
      </button>
      {showSubstitution && (
        <button
          type="button"
          className="block w-full px-3 py-2 text-left text-sm font-medium text-accent hover:bg-orange-50"
          onClick={() => {
            onSubstitution()
            onClose()
          }}
        >
          {t('substitution.title')}
        </button>
      )}
      {showBrigadier && onToggleBrigadier && (
        <button
          type="button"
          className="block w-full border-t border-grid px-3 py-2 text-left text-sm font-medium text-teal-700 hover:bg-teal-50"
          onClick={() => {
            onToggleBrigadier()
            onClose()
          }}
        >
          {isBrigadier ? t('brigadier.unmarkDay') : t('brigadier.markDay')}
        </button>
      )}
      {showBrigadier && onBrigadierMonth && (
        <button
          type="button"
          className="block w-full px-3 py-2 text-left text-sm text-teal-700 hover:bg-teal-50"
          onClick={() => {
            onBrigadierMonth()
            onClose()
          }}
        >
          {t('brigadier.markMonth')}
        </button>
      )}
    </div>,
    getModalPortalRoot(),
  )
}
