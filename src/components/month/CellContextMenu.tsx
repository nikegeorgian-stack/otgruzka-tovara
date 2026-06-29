import { useEffect, useRef } from 'react'
import { useI18n } from '@/context/I18nContext'

type Props = {
  x: number
  y: number
  showSubstitution: boolean
  onComment: () => void
  onSubstitution: () => void
  onClose: () => void
}

export function CellContextMenu({
  x,
  y,
  showSubstitution,
  onComment,
  onSubstitution,
  onClose,
}: Props) {
  const { t } = useI18n()
  const ref = useRef<HTMLDivElement>(null)

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

  return (
    <div
      ref={ref}
      className="fixed z-[120] min-w-[10rem] rounded-sm border border-grid bg-white py-1 shadow-sm"
      style={{ left: x, top: y }}
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
    </div>
  )
}
