import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '@/context/I18nContext'

type Props = {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'md' | 'lg' | 'xl' | 'preview'
  zIndex?: number
  /** Не закрывать по клику на фон (вложенные формы) */
  blockBackdropClose?: boolean
  /** Тонкая акцентная рамка (для важных форм) */
  accent?: boolean
}

const WIDTH = {
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  preview: 'max-w-[min(96vw,1100px)]',
} as const

export function AppDialog({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'lg',
  zIndex = 130,
  blockBackdropClose = false,
  accent = false,
}: Props) {
  const { t } = useI18n()

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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="app-dialog-backdrop fixed inset-0 flex items-end justify-center p-0 sm:items-center sm:p-4"
      style={{ zIndex }}
      role="presentation"
      onMouseDown={(e) => {
        if (blockBackdropClose) return
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-dialog-title"
        className={`app-dialog-panel flex max-h-[min(92vh,900px)] w-full flex-col overflow-hidden rounded-t-sm border bg-white shadow-sm sm:rounded-sm ${accent ? 'app-dialog-panel-accent' : 'border-grid'} ${WIDTH[size]}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-grid bg-stone-50 px-5 py-4">
          <div className="min-w-0">
            <h2 id="app-dialog-title" className="text-lg font-bold tracking-tight text-ink">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-1 text-sm leading-snug text-stone-500">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            className="shrink-0 rounded-sm p-2 text-stone-400 transition hover:bg-stone-100 hover:text-ink"
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>

        {footer && (
          <footer className="shrink-0 border-t border-grid bg-stone-50 px-5 py-4">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  )
}
