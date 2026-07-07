import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useI18n } from '@/context/I18nContext'

export type PageOverflowItem = {
  id: string
  label: string
  onClick: () => void
  disabled?: boolean
  title?: string
  hidden?: boolean
}

type Props = {
  items: PageOverflowItem[]
  /** Дополнительные кнопки рядом с «Ещё» */
  children?: ReactNode
}

export function PageActionOverflow({ items, children }: Props) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const visible = items.filter((i) => !i.hidden)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  if (visible.length === 0 && !children) return null

  return (
    <div ref={rootRef} className="relative inline-flex items-center gap-1">
      {children}
      {visible.length > 0 ? (
        <>
          <button
            type="button"
            className="fc-btn fc-btn--secondary fc-btn--sm"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-haspopup="menu"
            title={t('workspace.moreActions')}
          >
            ⋯ {t('workspace.more')}
          </button>
          {open ? (
            <div
              className="absolute right-0 top-full z-[120] mt-1 min-w-[11rem] rounded-sm border border-grid bg-white py-1 shadow-lg"
              role="menu"
            >
              {visible.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  className="block w-full px-3 py-2 text-left text-sm text-stone-700 hover:bg-paper-dark disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => {
                    if (!item.disabled) {
                      item.onClick()
                      setOpen(false)
                    }
                  }}
                  disabled={item.disabled}
                  title={item.title}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
